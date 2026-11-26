import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from buildingops.core.models import DecisionStatus, utcnow
from buildingops.core.permissions import Role
from buildingops.modules.buildings.models import Building
from buildingops.modules.timesheets.costing import labor_cost
from buildingops.modules.workforce.models import Employee
from tests.conftest import Actor, ActorFactory, Factory, audit_entries, problem

TIMESHEETS = "/api/v1/timesheets"

APPROVED, REJECTED = DecisionStatus.APPROVED, DecisionStatus.REJECTED

# --- what hours cost ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("regular", "overtime", "rate", "multiplier", "cost"),
    [
        ("8.00", "0.00", "20.00", "1.50", "160.00"),
        ("8.00", "2.00", "20.00", "1.50", "220.00"),
        ("0.00", "4.00", "25.00", "2.00", "200.00"),
        # Exactly half a cent goes up, where banker's rounding would send it down.
        ("7.50", "0.00", "19.75", "1.50", "148.13"),  # 148.125
        ("0.50", "0.00", "18.05", "1.50", "9.03"),  # 9.025
        ("0.00", "1.00", "20.03", "1.50", "30.05"),  # 30.045
        ("0.10", "0.00", "0.05", "1.50", "0.01"),  # 0.005
        # Anything less than half a cent goes down.
        ("0.07", "0.00", "0.07", "1.50", "0.00"),  # 0.0049
        ("3.25", "0.00", "17.33", "1.50", "56.32"),  # 56.3225
        # Rounded once, on the sum. 9.025 and 13.5375 rounded separately would make 22.57.
        ("0.50", "0.50", "18.05", "1.50", "22.56"),  # 22.5625
        # Large amounts keep every digit: nothing here is ever a float.
        ("24.00", "0.00", "99999999.99", "1.50", "2399999999.76"),
    ],
)
def test_labor_cost_is_hours_at_the_rate_rounded_half_up_to_cents(
    regular: str, overtime: str, rate: str, multiplier: str, cost: str
):
    result = labor_cost(Decimal(regular), Decimal(overtime), Decimal(rate), Decimal(multiplier))

    assert str(result) == cost  # the amount, always written with two decimal places


# --- entering time -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Site:
    """An organization with a company admin, an employee paid 21.50 an hour and a building."""

    admin: Actor
    maria: Employee
    tower: Building


@pytest.fixture
def site(make_actor: ActorFactory, factory: Factory) -> Site:
    admin = make_actor()
    maria = factory.employee(
        admin.organization,
        first_name="Maria",
        last_name="Lopez",
        employee_number="E-7",
        hourly_rate=Decimal("21.50"),
    )
    return Site(admin, maria, factory.building(admin.organization, name="Tower One"))


def _new_timesheet(employee, building, **overrides):
    payload = {
        "employee_id": str(employee.id),
        "building_id": str(building.id),
        "work_date": "2026-03-02",
        "hours_regular": "8",
    }
    payload.update(overrides)
    return payload


def test_a_timesheet_is_priced_at_the_employees_rate_when_it_is_entered(site: Site):
    admin = site.admin

    response = admin.post(
        TIMESHEETS,
        json=_new_timesheet(
            site.maria, site.tower, hours_overtime=1.5, notes="Stayed for the late delivery"
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["employee"] == {
        "id": str(site.maria.id),
        "full_name": "Maria Lopez",
        "employee_number": "E-7",
    }
    assert created["building"] == {"id": str(site.tower.id), "name": "Tower One"}
    assert (
        created["hours_regular"],
        created["hours_overtime"],
        created["overtime_multiplier"],
    ) == (
        "8.00",
        "1.50",
        "1.50",
    )
    # 8 hours at 21.50 and 1.5 more at one and a half times that: 172.00 + 48.375.
    assert (created["hourly_rate"], created["labor_cost"]) == ("21.50", "220.38")
    assert (created["status"], created["source"], created["contract"], created["shift_id"]) == (
        "pending",
        "manual",
        None,
        None,
    )
    assert (created["decided_by_name"], created["decided_at"], created["rejection_reason"]) == (
        None,
        None,
        None,
    )
    assert created["submitted_at"] is not None
    assert admin.get(f"{TIMESHEETS}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "timesheet", created["id"])
    assert entry["action"] == "timesheet.created"
    assert entry["summary"] == "Entered the timesheet of Maria Lopez for 2026-03-02 at Tower One"
    assert entry["changes"]["labor_cost"] == {"from": None, "to": "220.38"}


def test_the_rate_the_cost_and_the_decision_are_never_taken_from_a_request(
    site: Site, factory: Factory
):
    existing = factory.timesheet(site.maria, site.tower, work_date=date(2026, 3, 3))
    not_for_clients = {
        "hourly_rate": "99.00",
        "labor_cost": "1.00",
        "status": "approved",
        "source": "voice",
        "submitted_at": "2026-03-02T22:00:00Z",
        "decided_by_name": "Nobody",
    }

    for field, value in not_for_clients.items():
        on_create = site.admin.post(
            TIMESHEETS, json=_new_timesheet(site.maria, site.tower, **{field: value})
        )
        on_update = site.admin.patch(f"{TIMESHEETS}/{existing.id}", json={field: value})
        assert on_create.status_code == on_update.status_code == 422, field
        assert [error["field"] for error in problem(on_create)["errors"]] == [field]
        assert [error["field"] for error in problem(on_update)["errors"]] == [field]
    assert site.admin.get(TIMESHEETS).json()["total"] == 1


def test_time_cannot_be_entered_for_an_employee_who_has_no_rate(site: Site, factory: Factory):
    sam = factory.employee(site.admin.organization, first_name="Sam", last_name="Reed")

    response = site.admin.post(TIMESHEETS, json=_new_timesheet(sam, site.tower))

    assert response.status_code == 422
    assert problem(response)["errors"] == [
        {
            "field": "employee_id",
            "message": (
                "Sam Reed has no hourly rate, so their time cannot be priced."
                " Give them a rate first."
            ),
            "code": "no_hourly_rate",
        }
    ]


def test_a_raise_does_not_reprice_time_already_entered(site: Site):
    admin = site.admin
    created = admin.post(TIMESHEETS, json=_new_timesheet(site.maria, site.tower)).json()
    url = f"{TIMESHEETS}/{created['id']}"
    assert (created["hourly_rate"], created["labor_cost"]) == ("21.50", "172.00")
    raised = admin.patch(f"/api/v1/employees/{site.maria.id}", json={"hourly_rate": "30.00"})
    assert raised.status_code == 200

    # The cost is worked out again on every change, at the rate the time was entered with.
    shortened = admin.patch(url, json={"hours_regular": "6", "hours_overtime": "1"}).json()
    doubled = admin.patch(url, json={"overtime_multiplier": 2}).json()
    entered_later = admin.post(
        TIMESHEETS, json=_new_timesheet(site.maria, site.tower, work_date="2026-03-03")
    ).json()

    assert (shortened["hourly_rate"], shortened["labor_cost"]) == ("21.50", "161.25")
    assert (doubled["hourly_rate"], doubled["labor_cost"]) == ("21.50", "172.00")
    assert (entered_later["hourly_rate"], entered_later["labor_cost"]) == ("30.00", "240.00")
    newest, older, _ = audit_entries(admin, "timesheet", created["id"])
    assert older["action"] == "timesheet.updated"
    assert older["summary"] == (
        "Updated the timesheet of Maria Lopez for 2026-03-02 at Tower One:"
        " hours overtime, hours regular, labor cost"
    )
    assert older["changes"]["labor_cost"] == {"from": "172.00", "to": "161.25"}
    assert set(newest["changes"]) == {"overtime_multiplier", "labor_cost"}


def test_time_moved_to_another_employee_is_priced_at_their_rate(site: Site, factory: Factory):
    organization = site.admin.organization
    sam = factory.employee(
        organization, first_name="Sam", last_name="Reed", hourly_rate=Decimal("18.00")
    )
    unpaid = factory.employee(organization)
    timesheet = factory.timesheet(site.maria, site.tower, hourly_rate=Decimal("21.50"))
    url = f"{TIMESHEETS}/{timesheet.id}"

    moved = site.admin.patch(url, json={"employee_id": str(sam.id)})
    refused = site.admin.patch(url, json={"employee_id": str(unpaid.id)})

    assert moved.status_code == 200
    assert moved.json()["employee"]["full_name"] == "Sam Reed"
    assert (moved.json()["hourly_rate"], moved.json()["labor_cost"]) == ("18.00", "144.00")
    assert refused.status_code == 422
    assert problem(refused)["errors"][0]["code"] == "no_hourly_rate"


def test_hours_must_come_to_something_and_to_no_more_than_a_day(site: Site):
    admin = site.admin

    def refusal(**fields) -> dict:
        response = admin.post(TIMESHEETS, json=_new_timesheet(site.maria, site.tower, **fields))
        assert response.status_code == 422, response.text
        (error,) = problem(response)["errors"]
        return error

    assert refusal(hours_regular="0") == {
        "field": "hours_regular",
        "message": "Enter the hours worked. They cannot all be zero.",
        "code": "no_hours",
    }
    assert refusal(hours_regular="20", hours_overtime="4.25") == {
        "field": "hours_overtime",
        "message": "Regular and overtime hours cannot come to more than 24 in a day (24.25).",
        "code": "too_many_hours",
    }
    assert refusal(hours_regular="24.01")["field"] == "hours_regular"
    assert refusal(hours_regular="-1")["field"] == "hours_regular"
    assert refusal(hours_regular="7.555")["field"] == "hours_regular"
    assert refusal(hours_overtime="-0.5")["field"] == "hours_overtime"
    assert refusal(overtime_multiplier="0.99")["field"] == "overtime_multiplier"
    assert refusal(overtime_multiplier="3.01")["field"] == "overtime_multiplier"

    # Overtime alone is time worked, and a whole day is the limit, not beyond it.
    only_overtime = admin.post(
        TIMESHEETS,
        json=_new_timesheet(site.maria, site.tower, hours_regular="0", hours_overtime="3"),
    )
    a_whole_day = admin.post(
        TIMESHEETS,
        json=_new_timesheet(
            site.maria,
            site.tower,
            work_date="2026-03-03",
            hours_regular="20",
            hours_overtime="4",
        ),
    )
    assert only_overtime.status_code == a_whole_day.status_code == 201

    # The same holds when hours are changed.
    emptied = admin.patch(f"{TIMESHEETS}/{only_overtime.json()['id']}", json={"hours_overtime": 0})
    overfilled = admin.patch(f"{TIMESHEETS}/{a_whole_day.json()['id']}", json={"hours_regular": 21})
    assert emptied.status_code == overfilled.status_code == 422
    assert problem(emptied)["errors"][0]["code"] == "no_hours"
    assert problem(overfilled)["errors"][0]["code"] == "too_many_hours"


def test_an_employee_has_one_timesheet_for_a_day_at_a_building(site: Site, factory: Factory):
    admin = site.admin
    depot = factory.building(admin.organization, name="Pier Nine Depot")

    first = admin.post(TIMESHEETS, json=_new_timesheet(site.maria, site.tower))
    again = admin.post(TIMESHEETS, json=_new_timesheet(site.maria, site.tower, hours_regular=2))
    at_the_depot = admin.post(TIMESHEETS, json=_new_timesheet(site.maria, depot))
    next_day = admin.post(
        TIMESHEETS, json=_new_timesheet(site.maria, site.tower, work_date="2026-03-03")
    )

    assert [r.status_code for r in (first, again, at_the_depot, next_day)] == [201, 409, 201, 201]
    taken = {
        "field": "work_date",
        "message": "Maria Lopez already has a timesheet for 2026-03-02 at Tower One.",
    }
    assert problem(again)["errors"] == [taken]

    # Nor can another one be moved onto it.
    moved_in_time = admin.patch(
        f"{TIMESHEETS}/{next_day.json()['id']}", json={"work_date": "2026-03-02"}
    )
    moved_in_place = admin.patch(
        f"{TIMESHEETS}/{at_the_depot.json()['id']}", json={"building_id": str(site.tower.id)}
    )
    assert moved_in_time.status_code == moved_in_place.status_code == 409
    assert problem(moved_in_time)["errors"] == problem(moved_in_place)["errors"] == [taken]


def test_a_timesheet_points_only_at_live_records_of_its_own_organization(
    site: Site, factory: Factory
):
    organization, elsewhere = site.admin.organization, factory.organization()
    archived = {"deleted_at": utcnow()}
    rate = {"hourly_rate": Decimal("20.00")}
    cases = [
        ("employee_id", "Employee not found.", factory.employee(elsewhere, **rate)),
        ("employee_id", "Employee not found.", factory.employee(organization, **rate, **archived)),
        ("building_id", "Building not found.", factory.building(elsewhere)),
        ("building_id", "Building not found.", factory.building(organization, **archived)),
        ("contract_id", "Contract not found.", factory.contract(elsewhere)),
    ]

    for field, message, record in cases:
        payload = _new_timesheet(site.maria, site.tower, **{field: str(record.id)})
        response = site.admin.post(TIMESHEETS, json=payload)
        assert response.status_code == 422, (field, response.text)
        assert problem(response)["errors"] == [
            {"field": field, "message": message, "code": "not_found"}
        ]
    assert site.admin.get(TIMESHEETS).json()["total"] == 0


def test_a_contract_on_a_timesheet_must_cover_its_building(site: Site, factory: Factory):
    admin, organization = site.admin, site.admin.organization
    depot = factory.building(organization, name="Pier Nine Depot")
    contract = factory.contract(
        organization, buildings=[site.tower], contract_number="K-7", name="Cleaning"
    )

    booked = admin.post(
        TIMESHEETS, json=_new_timesheet(site.maria, site.tower, contract_id=str(contract.id))
    )
    refused = admin.post(
        TIMESHEETS, json=_new_timesheet(site.maria, depot, contract_id=str(contract.id))
    )

    assert booked.status_code == 201
    assert booked.json()["contract"] == {
        "id": str(contract.id),
        "contract_number": "K-7",
        "name": "Cleaning",
    }
    assert refused.status_code == 422
    assert problem(refused)["errors"] == [
        {
            "field": "contract_id",
            "message": "Contract K-7 does not cover Pier Nine Depot.",
            "code": "contract_does_not_cover_building",
        }
    ]


def test_a_timesheet_can_be_tied_to_a_shift_of_its_own_employee_and_building(
    site: Site, factory: Factory
):
    admin, organization = site.admin, site.admin.organization
    sam = factory.employee(organization, hourly_rate=Decimal("18.00"))
    depot = factory.building(organization)
    elsewhere = factory.organization()
    shift = factory.shift(site.maria, site.tower)
    sams = factory.shift(sam, site.tower)
    at_the_depot = factory.shift(
        site.maria,
        depot,
        starts_at=datetime(2026, 3, 3, 14, tzinfo=UTC),
        ends_at=datetime(2026, 3, 3, 22, tzinfo=UTC),
    )
    foreign = factory.shift(factory.employee(elsewhere), factory.building(elsewhere))

    def refusal(shift_id: uuid.UUID) -> dict:
        response = admin.post(
            TIMESHEETS, json=_new_timesheet(site.maria, site.tower, shift_id=str(shift_id))
        )
        assert response.status_code == 422, response.text
        (error,) = problem(response)["errors"]
        assert error["field"] == "shift_id"
        return error

    assert refusal(sams.id)["message"] == "This shift belongs to another employee."
    assert refusal(at_the_depot.id)["message"] == "This shift is at another building."
    assert refusal(foreign.id)["message"] == "Shift not found."

    tied = admin.post(
        TIMESHEETS, json=_new_timesheet(site.maria, site.tower, shift_id=str(shift.id))
    )
    assert tied.status_code == 201
    assert tied.json()["shift_id"] == str(shift.id)
    url = f"{TIMESHEETS}/{tied.json()['id']}"

    # Time moved to someone else cannot stay tied to the first person's shift.
    moved = admin.patch(url, json={"employee_id": str(sam.id)})
    moved_and_untied = admin.patch(url, json={"employee_id": str(sam.id), "shift_id": None})

    assert moved.status_code == 422
    assert problem(moved)["errors"][0] == {
        "field": "shift_id",
        "message": "This shift belongs to another employee.",
        "code": "shift_of_another_employee",
    }
    assert moved_and_untied.status_code == 200
    assert moved_and_untied.json()["shift_id"] is None


def test_time_already_entered_outlives_the_employee_record(site: Site, factory: Factory):
    timesheet = factory.timesheet(site.maria, site.tower)
    url = f"{TIMESHEETS}/{timesheet.id}"
    assert site.admin.delete(f"/api/v1/employees/{site.maria.id}").status_code == 204

    edited = site.admin.patch(url, json={"employee_id": str(site.maria.id), "hours_regular": 7})
    approved = site.admin.post(f"{url}/approve")

    assert edited.status_code == approved.status_code == 200
    assert approved.json()["employee"]["full_name"] == "Maria Lopez"
    assert approved.json()["labor_cost"] == "140.00"


# --- deciding on time --------------------------------------------------------------------


def test_approving_a_timesheet_records_who_decided(site: Site, factory: Factory):
    admin = site.admin
    timesheet = factory.timesheet(site.maria, site.tower)
    url = f"{TIMESHEETS}/{timesheet.id}"

    response = admin.post(f"{url}/approve")

    assert response.status_code == 200
    approved = response.json()
    assert (approved["status"], approved["decided_by_name"], approved["rejection_reason"]) == (
        "approved",
        admin.user.full_name,
        None,
    )
    assert approved["decided_at"] is not None
    assert admin.get(url).json() == approved
    (entry,) = audit_entries(admin, "timesheet", timesheet.id)
    assert entry["action"] == "timesheet.approved"
    assert entry["summary"] == "Approved the timesheet of Maria Lopez for 2026-03-02 at Tower One"
    assert set(entry["changes"]) == {
        "status",
        "decided_by_user_id",
        "decided_by_name",
        "decided_at",
    }
    assert entry["changes"]["status"] == {"from": "pending", "to": "approved"}
    assert entry["changes"]["decided_by_user_id"] == {"from": None, "to": str(admin.user.id)}

    # A decision is made once. To make another, the timesheet is reopened.
    again = admin.post(f"{url}/approve")
    rejected_after_all = admin.post(f"{url}/reject", json={"reason": "On second thoughts"})
    assert again.status_code == rejected_after_all.status_code == 409
    assert problem(again)["detail"] == (
        "This timesheet has already been approved. Reopen it to decide again."
    )
    assert len(audit_entries(admin, "timesheet", timesheet.id)) == 1


def test_rejecting_a_timesheet_needs_a_reason_and_keeps_it(site: Site, factory: Factory):
    admin = site.admin
    timesheet = factory.timesheet(site.maria, site.tower)
    url = f"{TIMESHEETS}/{timesheet.id}"

    for body in ({}, {"reason": "   "}, {"reason": "x" * 501}):
        refused = admin.post(f"{url}/reject", json=body)
        assert refused.status_code == 422
        assert [error["field"] for error in problem(refused)["errors"]] == ["reason"]

    response = admin.post(f"{url}/reject", json={"reason": "Hours do not match the sign-in sheet."})

    assert response.status_code == 200
    rejected = response.json()
    assert (rejected["status"], rejected["rejection_reason"], rejected["decided_by_name"]) == (
        "rejected",
        "Hours do not match the sign-in sheet.",
        admin.user.full_name,
    )
    (entry,) = audit_entries(admin, "timesheet", timesheet.id)
    assert entry["action"] == "timesheet.rejected"
    assert entry["summary"] == "Rejected the timesheet of Maria Lopez for 2026-03-02 at Tower One"
    assert entry["changes"]["status"] == {"from": "pending", "to": "rejected"}
    assert entry["changes"]["rejection_reason"] == {
        "from": None,
        "to": "Hours do not match the sign-in sheet.",
    }


def test_reopening_clears_the_decision_and_the_audit_log_keeps_what_it_was(
    site: Site, factory: Factory
):
    admin = site.admin
    timesheet = factory.timesheet(
        site.maria,
        site.tower,
        status=REJECTED,
        rejection_reason="Wrong building",
        decided_by_name="Sam Reed",
    )
    url = f"{TIMESHEETS}/{timesheet.id}"

    response = admin.post(f"{url}/reopen")

    assert response.status_code == 200
    reopened = response.json()
    assert (
        reopened["status"],
        reopened["decided_by_name"],
        reopened["decided_at"],
        reopened["rejection_reason"],
    ) == ("pending", None, None, None)
    (entry,) = audit_entries(admin, "timesheet", timesheet.id)
    assert entry["action"] == "timesheet.reopened"
    assert entry["summary"] == "Reopened the timesheet of Maria Lopez for 2026-03-02 at Tower One"
    assert entry["changes"]["status"] == {"from": "rejected", "to": "pending"}
    assert entry["changes"]["decided_by_name"] == {"from": "Sam Reed", "to": None}
    assert entry["changes"]["rejection_reason"] == {"from": "Wrong building", "to": None}
    assert entry["changes"]["decided_at"]["to"] is None

    again = admin.post(f"{url}/reopen")
    assert again.status_code == 409
    assert problem(again)["detail"] == (
        "This timesheet is still pending. There is no decision to reopen."
    )


@pytest.mark.parametrize("status", [APPROVED, REJECTED])
def test_a_decided_timesheet_cannot_be_edited_until_it_is_reopened(
    site: Site, factory: Factory, status: DecisionStatus
):
    admin = site.admin
    timesheet = factory.timesheet(site.maria, site.tower, status=status)
    url = f"{TIMESHEETS}/{timesheet.id}"

    refused = admin.patch(url, json={"hours_regular": 4})

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        f"This timesheet has been {status.value}, and only a pending timesheet can be changed."
        " Reopen it first."
    )
    assert admin.get(url).json()["hours_regular"] == "8.00"

    assert admin.post(f"{url}/reopen").status_code == 200
    edited = admin.patch(url, json={"hours_regular": 4})
    assert edited.status_code == 200
    assert (edited.json()["hours_regular"], edited.json()["labor_cost"]) == ("4.00", "80.00")


def test_nobody_approves_their_own_time(make_actor: ActorFactory, factory: Factory):
    organization = factory.organization()
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)
    rate = Decimal("29.50")
    themselves = factory.employee(
        organization, membership_id=supervisor.membership.id, hourly_rate=rate
    )
    tower = factory.building(organization)
    own = factory.timesheet(themselves, tower)
    someone_elses = factory.timesheet(factory.employee(organization, hourly_rate=rate), tower)

    refused = supervisor.post(f"{TIMESHEETS}/{own.id}/approve")
    accepted = supervisor.post(f"{TIMESHEETS}/{someone_elses.id}/approve")

    assert refused.status_code == 403
    assert problem(refused)["code"] == "permission_denied"
    assert problem(refused)["detail"] == (
        "You cannot approve your own time. Someone else has to approve it."
    )
    assert accepted.status_code == 200
    assert supervisor.get(f"{TIMESHEETS}/{own.id}").json()["status"] == "pending"
    assert audit_entries(manager, "timesheet", own.id) == []
    # Someone else can.
    assert manager.post(f"{TIMESHEETS}/{own.id}/approve").status_code == 200


def test_several_timesheets_are_approved_at_once(site: Site, factory: Factory):
    admin = site.admin
    sheets = [
        factory.timesheet(site.maria, site.tower, work_date=date(2026, 3, day)) for day in (2, 3, 4)
    ]
    ids = [str(sheet.id) for sheet in sheets]

    # An id given twice is one timesheet.
    response = admin.post(f"{TIMESHEETS}/approve", json={"ids": [*ids, ids[0]]})

    assert response.status_code == 200
    assert response.json() == {"approved": 3}
    listed = admin.get(TIMESHEETS).json()["items"]
    assert {(sheet["status"], sheet["decided_by_name"]) for sheet in listed} == {
        ("approved", admin.user.full_name)
    }
    for sheet in sheets:
        (entry,) = audit_entries(admin, "timesheet", sheet.id)
        assert entry["action"] == "timesheet.approved"
        assert entry["summary"] == (
            f"Approved the timesheet of Maria Lopez for {sheet.work_date.isoformat()} at Tower One"
        )


def test_approving_several_timesheets_is_all_or_nothing(make_actor: ActorFactory, factory: Factory):
    organization, elsewhere = factory.organization(), factory.organization()
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)
    rate = Decimal("20.00")
    priya = factory.employee(
        organization,
        first_name="Priya",
        last_name="Raman",
        membership_id=supervisor.membership.id,
        hourly_rate=rate,
    )
    maria = factory.employee(organization, first_name="Maria", last_name="Lopez", hourly_rate=rate)
    tower = factory.building(organization, name="Tower One")
    waiting = [factory.timesheet(maria, tower, work_date=date(2026, 3, day)) for day in (2, 3)]
    decided = factory.timesheet(maria, tower, work_date=date(2026, 3, 6), status=REJECTED)
    own = factory.timesheet(priya, tower)
    foreign = factory.timesheet(factory.employee(elsewhere), factory.building(elsewhere))

    def attempt(*extra: uuid.UUID):
        ids = [str(sheet.id) for sheet in waiting] + [str(extra_id) for extra_id in extra]
        return supervisor.post(f"{TIMESHEETS}/approve", json={"ids": ids})

    with_one_decided = attempt(decided.id)
    with_their_own = attempt(own.id)
    with_another_organizations = attempt(foreign.id)
    with_an_unknown_one = attempt(uuid.uuid4(), uuid.uuid4())

    assert with_one_decided.status_code == 409
    assert problem(with_one_decided)["detail"] == (
        "1 timesheet had already been decided (Maria Lopez on 2026-03-06 at Tower One)."
        " Nothing was approved."
    )
    assert problem(with_one_decided)["errors"][0]["field"] == "ids"
    assert with_their_own.status_code == 403
    assert problem(with_their_own)["detail"] == (
        "You cannot approve your own time (Priya Raman on 2026-03-02 at Tower One)."
        " Leave it out for someone else to approve. Nothing was approved."
    )
    assert with_another_organizations.status_code == with_an_unknown_one.status_code == 422
    assert problem(with_another_organizations)["errors"] == [
        {
            "field": "ids",
            "message": (
                "1 timesheet could not be found. Reload the list and try again."
                " Nothing was approved."
            ),
            "code": "not_found",
        }
    ]
    assert "2 timesheets could not be found." in problem(with_an_unknown_one)["detail"]

    # Each refusal left every timesheet as it was, the ones that could have gone through too.
    assert supervisor.get(TIMESHEETS, params={"status": "approved"}).json()["total"] == 0
    approvals = manager.get("/api/v1/audit-logs", params={"action": "timesheet.approved"})
    assert approvals.json()["total"] == 0

    # Without anything in the way, they all go through.
    assert attempt().json() == {"approved": 2}
    assert supervisor.get(TIMESHEETS, params={"status": "approved"}).json()["total"] == 2


def test_a_refusal_names_a_few_timesheets_and_counts_the_rest(site: Site, factory: Factory):
    decided = [
        factory.timesheet(site.maria, site.tower, work_date=date(2026, 3, day), status=APPROVED)
        for day in range(2, 7)
    ]

    response = site.admin.post(
        f"{TIMESHEETS}/approve", json={"ids": [str(sheet.id) for sheet in decided]}
    )

    assert response.status_code == 409
    detail = problem(response)["detail"]
    assert detail.startswith("5 timesheets had already been decided (Maria Lopez on 2026-03-")
    assert detail.endswith(", 2 more). Nothing was approved.")


def test_an_approval_takes_between_one_and_200_timesheets(site: Site):
    none = site.admin.post(f"{TIMESHEETS}/approve", json={"ids": []})
    too_many = site.admin.post(
        f"{TIMESHEETS}/approve", json={"ids": [str(uuid.uuid4()) for _ in range(201)]}
    )

    assert none.status_code == too_many.status_code == 422
    assert [error["field"] for error in problem(none)["errors"]] == ["ids"]
    assert [error["code"] for error in problem(too_many)["errors"]] == ["too_long"]


# --- who sees what -----------------------------------------------------------------------


def test_supervisors_see_hours_but_neither_the_rate_nor_the_cost(
    make_actor: ActorFactory, factory: Factory
):
    organization = factory.organization()
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)
    maria = factory.employee(organization, hourly_rate=Decimal("21.50"))
    tower = factory.building(organization)
    timesheet = factory.timesheet(maria, tower, hourly_rate=Decimal("21.50"))
    url = f"{TIMESHEETS}/{timesheet.id}"

    def money(actor: Actor) -> set[tuple[str | None, str | None]]:
        """The rate and the cost as this caller sees them, in the list and on the record."""
        sheets = [*actor.get(TIMESHEETS).json()["items"], actor.get(url).json()]
        return {(sheet["hourly_rate"], sheet["labor_cost"]) for sheet in sheets}

    assert money(manager) == {("21.50", "172.00")}
    assert money(supervisor) == {(None, None)}
    assert supervisor.get(url).json()["hours_regular"] == "8.00"

    # Entering, changing and deciding on time answer the same way.
    entered = supervisor.post(TIMESHEETS, json=_new_timesheet(maria, tower, work_date="2026-03-03"))
    changed = supervisor.patch(f"{TIMESHEETS}/{entered.json()['id']}", json={"hours_regular": 6})
    approved = supervisor.post(f"{url}/approve")
    for response in (entered, changed, approved):
        assert response.status_code in (200, 201), response.text
        assert (response.json()["hourly_rate"], response.json()["labor_cost"]) == (None, None)
    # The figures are kept all the same, for those who may see them.
    priced = manager.get(f"{TIMESHEETS}/{entered.json()['id']}").json()
    assert (priced["hourly_rate"], priced["labor_cost"]) == ("21.50", "129.00")


# --- lists and totals --------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Week:
    """Four timesheets of two people at two buildings, one of them booked to a contract."""

    admin: Actor
    sam_id: str
    depot_id: str
    contract_id: str


@pytest.fixture
def week(site: Site, factory: Factory) -> Week:
    organization = site.admin.organization
    sam = factory.employee(organization, first_name="Sam", last_name="Adams")
    depot = factory.building(organization, name="Pier Nine Depot")
    contract = factory.contract(organization, buildings=[depot])

    def entered(day: int) -> datetime:
        return datetime(2026, 3, day, tzinfo=UTC)

    factory.timesheet(site.maria, site.tower, created_at=entered(10))
    factory.timesheet(
        site.maria,
        depot,
        work_date=date(2026, 3, 3),
        hours_regular=Decimal("6.00"),
        hours_overtime=Decimal("1.00"),
        contract_id=contract.id,
        status=APPROVED,
        created_at=entered(13),
    )
    factory.timesheet(
        sam,
        site.tower,
        work_date=date(2026, 3, 4),
        hours_regular=Decimal("4.00"),
        status=REJECTED,
        created_at=entered(12),
    )
    factory.timesheet(sam, site.tower, created_at=entered(11))
    elsewhere = factory.organization()
    factory.timesheet(factory.employee(elsewhere), factory.building(elsewhere))
    return Week(site.admin, str(sam.id), str(depot.id), str(contract.id))


def test_listing_supports_filters_and_sorting(week: Week):
    def sheets(**params) -> list[tuple[str, str]]:
        response = week.admin.get(TIMESHEETS, params=params)
        assert response.status_code == 200, response.text
        return [
            (item["employee"]["full_name"], item["work_date"]) for item in response.json()["items"]
        ]

    maria_monday = ("Maria Lopez", "2026-03-02")
    maria_tuesday = ("Maria Lopez", "2026-03-03")
    sam_monday = ("Sam Adams", "2026-03-02")
    sam_wednesday = ("Sam Adams", "2026-03-04")

    assert week.admin.get(TIMESHEETS).json()["total"] == 4
    # Latest work first. Within a day, in the order the time was entered.
    assert sheets() == [sam_wednesday, maria_tuesday, maria_monday, sam_monday]
    assert sheets(sort="work_date") == [maria_monday, sam_monday, maria_tuesday, sam_wednesday]
    # By last name, then first name.
    assert sheets(sort="employee") == [sam_wednesday, sam_monday, maria_monday, maria_tuesday]
    assert sheets(sort="-created_at") == [maria_tuesday, sam_wednesday, sam_monday, maria_monday]
    assert sheets(status="pending") == [maria_monday, sam_monday]
    assert sheets(building_id=week.depot_id) == sheets(contract_id=week.contract_id)
    assert sheets(contract_id=week.contract_id) == [maria_tuesday]
    assert sheets(employee_id=week.sam_id) == [sam_wednesday, sam_monday]
    assert sheets(**{"from": "2026-03-03"}) == [sam_wednesday, maria_tuesday]
    assert sheets(to="2026-03-02") == [maria_monday, sam_monday]
    assert sheets(**{"from": "2026-03-03", "to": "2026-03-03"}) == [maria_tuesday]
    assert sheets(page_size=1, page=2) == [maria_tuesday]

    backwards = week.admin.get(TIMESHEETS, params={"from": "2026-03-03", "to": "2026-03-02"})
    assert backwards.status_code == 422
    assert problem(backwards)["errors"][0]["field"] == "to"
    assert week.admin.get(TIMESHEETS, params={"sort": "labor_cost"}).status_code == 422


def test_the_summary_counts_timesheets_and_adds_up_hours_by_status(week: Week):
    def summary(**params) -> dict:
        response = week.admin.get(f"{TIMESHEETS}/summary", params=params)
        assert response.status_code == 200, response.text
        return response.json()

    nothing = {
        "count": 0,
        "hours_regular": "0.00",
        "hours_overtime": "0.00",
        "hours_total": "0.00",
    }
    tuesday_at_the_depot = {
        "count": 1,
        "hours_regular": "6.00",
        "hours_overtime": "1.00",
        "hours_total": "7.00",
    }

    assert summary() == {
        "pending": {
            "count": 2,
            "hours_regular": "16.00",
            "hours_overtime": "0.00",
            "hours_total": "16.00",
        },
        "approved": tuesday_at_the_depot,
        "rejected": {
            "count": 1,
            "hours_regular": "4.00",
            "hours_overtime": "0.00",
            "hours_total": "4.00",
        },
    }
    # It takes the filters the list takes, and counts what the list would show.
    assert summary(building_id=week.depot_id) == summary(contract_id=week.contract_id)
    assert summary(building_id=week.depot_id) == {
        "pending": nothing,
        "approved": tuesday_at_the_depot,
        "rejected": nothing,
    }
    assert summary(employee_id=week.sam_id, **{"from": "2026-03-03"})["rejected"]["count"] == 1
    assert summary(employee_id=week.sam_id, to="2026-03-03")["pending"]["count"] == 1
    assert summary(status="approved")["pending"] == nothing
    backwards = week.admin.get(
        f"{TIMESHEETS}/summary", params={"from": "2026-03-03", "to": "2026-03-02"}
    )
    assert backwards.status_code == 422


def test_timesheets_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    elsewhere = factory.organization()
    foreign = factory.timesheet(factory.employee(elsewhere), factory.building(elsewhere))
    url = f"{TIMESHEETS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"notes": "Taken over"}).status_code == 404
    assert admin.post(f"{url}/approve").status_code == 404
    assert admin.post(f"{url}/reject", json={"reason": "Not ours"}).status_code == 404
    assert admin.post(f"{url}/reopen").status_code == 404
    assert problem(admin.get(url))["detail"] == "Timesheet not found."
    assert admin.get(TIMESHEETS).json()["total"] == 0
    assert admin.get(f"{TIMESHEETS}/summary").json()["pending"]["count"] == 0
