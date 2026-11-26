from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import pytest

from buildingops.core.db import Database, DbContext
from buildingops.core.models import utcnow
from buildingops.modules.scheduling import service as scheduling_service
from buildingops.modules.scheduling.models import ShiftStatus
from buildingops.modules.scheduling.schemas import ShiftCreate
from tests.conftest import ActorFactory, Factory, audit_entries, problem

SHIFTS = "/api/v1/shifts"

# The organizations in these tests are in New York, five hours behind UTC in early March.
MONDAY = {"from": "2026-03-02", "to": "2026-03-02"}


def _at(day: int, hour: int, minute: int = 0) -> datetime:
    """A moment in March 2026, in UTC."""
    return datetime(2026, 3, day, hour, minute, tzinfo=UTC)


def _new_shift(employee, building, **overrides):
    payload = {
        "employee_id": str(employee.id),
        "building_id": str(building.id),
        "starts_at": "2026-03-02T09:00:00-05:00",
        "ends_at": "2026-03-02T17:00:00-05:00",
    }
    payload.update(overrides)
    return payload


def test_a_shift_is_scheduled_for_an_employee_at_a_building(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    maria = factory.employee(
        admin.organization, first_name="Maria", last_name="Lopez", employee_number="E-7"
    )
    tower = factory.building(admin.organization, name="Tower One")

    # An evening shift in New York. In UTC it starts on the following day.
    response = admin.post(
        SHIFTS,
        json=_new_shift(
            maria,
            tower,
            starts_at="2026-03-02T20:00:00-05:00",
            ends_at="2026-03-03T04:30:00-05:00",
            break_minutes=30,
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["employee"] == {
        "id": str(maria.id),
        "full_name": "Maria Lopez",
        "employee_number": "E-7",
    }
    assert created["building"] == {"id": str(tower.id), "name": "Tower One"}
    assert (created["starts_at"], created["ends_at"]) == (
        "2026-03-03T01:00:00Z",
        "2026-03-03T09:30:00Z",
    )
    assert (created["status"], created["break_minutes"], created["notes"]) == (
        "scheduled",
        30,
        None,
    )
    assert admin.get(f"{SHIFTS}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "shift", created["id"])
    assert entry["action"] == "shift.created"
    # The day is the one on the clocks where the organization works.
    assert entry["summary"] == "Scheduled Maria Lopez at Tower One on 2026-03-02"
    assert entry["changes"]["starts_at"] == {"from": None, "to": "2026-03-03T01:00:00+00:00"}


def test_a_shift_ends_after_it_starts_and_within_a_day(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    maria = factory.employee(admin.organization)
    tower = factory.building(admin.organization)

    def refusal(**fields) -> dict:
        response = admin.post(SHIFTS, json=_new_shift(maria, tower, **fields))
        assert response.status_code == 422, response.text
        (error,) = problem(response)["errors"]
        return error

    assert refusal(ends_at="2026-03-02T09:00:00-05:00") == {
        "field": "ends_at",
        "message": "A shift has to end after it starts.",
        "code": "ends_before_start",
    }
    assert refusal(ends_at="2026-03-03T09:00:01-05:00") == {
        "field": "ends_at",
        "message": "A shift cannot be longer than 24 hours.",
        "code": "shift_too_long",
    }
    # A time has to say which zone it is in.
    assert refusal(starts_at="2026-03-02T09:00:00")["field"] == "starts_at"
    assert refusal(break_minutes=241)["field"] == "break_minutes"
    assert refusal(status="completed")["field"] == "status"  # a new shift is a scheduled one

    a_full_day = admin.post(
        SHIFTS, json=_new_shift(maria, tower, ends_at="2026-03-03T09:00:00-05:00")
    )
    assert a_full_day.status_code == 201


def test_a_shift_needs_a_live_employee_and_building_of_the_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization, elsewhere = admin.organization, factory.organization()
    maria, tower = factory.employee(organization), factory.building(organization)
    archived = {"deleted_at": utcnow()}

    for employee in (factory.employee(elsewhere), factory.employee(organization, **archived)):
        response = admin.post(SHIFTS, json=_new_shift(employee, tower))
        assert response.status_code == 422
        assert problem(response)["errors"] == [
            {"field": "employee_id", "message": "Employee not found.", "code": "not_found"}
        ]
    for building in (factory.building(elsewhere), factory.building(organization, **archived)):
        response = admin.post(SHIFTS, json=_new_shift(maria, building))
        assert response.status_code == 422
        assert problem(response)["errors"] == [
            {"field": "building_id", "message": "Building not found.", "code": "not_found"}
        ]
    assert admin.get(SHIFTS, params=MONDAY).json()["total"] == 0


def test_an_employee_cannot_be_given_two_shifts_that_overlap(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    maria = factory.employee(organization, first_name="Maria", last_name="Lopez")
    sam = factory.employee(organization)
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization)
    factory.shift(maria, tower, starts_at=_at(2, 14), ends_at=_at(2, 22))  # 09:00 to 17:00

    def schedule(employee, start: str, end: str):
        return admin.post(
            SHIFTS,
            json=_new_shift(
                employee,
                depot,
                starts_at=f"2026-03-02T{start}:00-05:00",
                ends_at=f"2026-03-02T{end}:00-05:00",
            ),
        )

    message = (
        "Maria Lopez already has a shift at Tower One that overlaps this one"
        " (2026-03-02 09:00 to 17:00)."
    )
    # Across its start, across its end, inside it and around it.
    for start, end in (
        ("08:00", "09:01"),
        ("16:59", "20:00"),
        ("10:00", "11:00"),
        ("07:00", "19:00"),
    ):
        refused = schedule(maria, start, end)
        assert refused.status_code == 409, (start, end)
        assert problem(refused)["detail"] == message
        assert problem(refused)["errors"] == [{"field": "starts_at", "message": message}]

    # One shift may start the moment another ends, and someone else is free all day.
    assert schedule(maria, "07:00", "09:00").status_code == 201
    assert schedule(maria, "17:00", "19:00").status_code == 201
    assert schedule(sam, "09:00", "17:00").status_code == 201


def test_an_overlap_with_a_shift_that_runs_past_midnight_gives_both_dates(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    maria = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization, name="Tower One")
    factory.shift(maria, tower, starts_at=_at(3, 1), ends_at=_at(3, 9, 30))  # 20:00 to 04:30

    refused = admin.post(
        SHIFTS,
        json=_new_shift(
            maria,
            tower,
            starts_at="2026-03-03T04:00:00-05:00",
            ends_at="2026-03-03T12:00:00-05:00",
        ),
    )

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        "Maria Lopez already has a shift at Tower One that overlaps this one"
        " (2026-03-02 20:00 to 2026-03-03 04:30)."
    )


def test_a_cancelled_shift_leaves_its_time_free(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    maria = factory.employee(admin.organization)
    tower = factory.building(admin.organization)
    factory.shift(maria, tower, status=ShiftStatus.CANCELLED)

    assert admin.post(SHIFTS, json=_new_shift(maria, tower)).status_code == 201


def test_moving_a_shift_is_checked_against_the_employees_other_shifts(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    maria = factory.employee(organization, first_name="Maria", last_name="Lopez")
    sam = factory.employee(organization, first_name="Sam", last_name="Reed")
    tower = factory.building(organization, name="Tower One")
    factory.shift(maria, tower, starts_at=_at(2, 14), ends_at=_at(2, 18))  # 09:00 to 13:00
    afternoon = factory.shift(maria, tower, starts_at=_at(2, 19), ends_at=_at(2, 23))
    sams = factory.shift(sam, tower, starts_at=_at(2, 19), ends_at=_at(2, 23))
    url = f"{SHIFTS}/{afternoon.id}"

    into_the_morning = admin.patch(url, json={"starts_at": "2026-03-02T12:00:00-05:00"})
    to_someone_busy = admin.patch(f"{SHIFTS}/{sams.id}", json={"employee_id": str(maria.id)})
    # A shift does not get in its own way.
    shortened = admin.patch(url, json={"starts_at": "2026-03-02T15:00:00-05:00"})
    annotated = admin.patch(url, json={"notes": "Bring the lift key"})

    assert into_the_morning.status_code == to_someone_busy.status_code == 409
    assert problem(into_the_morning)["errors"] == [
        {
            "field": "starts_at",
            "message": (
                "Maria Lopez already has a shift at Tower One that overlaps this one"
                " (2026-03-02 09:00 to 13:00)."
            ),
        }
    ]
    assert "Maria Lopez already has a shift" in problem(to_someone_busy)["detail"]
    assert shortened.status_code == annotated.status_code == 200
    assert annotated.json()["starts_at"] == "2026-03-02T20:00:00Z"


def test_the_database_stops_overlapping_shifts_entered_at_the_same_moment(
    app_database: Database, make_actor: ActorFactory, factory: Factory
):
    """The service's check reads committed shifts. Two requests can both pass it."""
    admin = make_actor()
    maria = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization)
    context = DbContext(organization_id=admin.organization.id, user_id=admin.user.id)

    with ThreadPoolExecutor(max_workers=1) as pool, app_database.session(context) as db:
        # One shift is on its way in, in a transaction still open.
        scheduling_service.create_shift(
            admin.service_context(db),
            ShiftCreate(
                employee_id=maria.id,
                building_id=tower.id,
                starts_at=_at(2, 14),
                ends_at=_at(2, 22),
            ),
        )
        second = pool.submit(admin.post, SHIFTS, json=_new_shift(maria, tower))
        # It cannot see the first one, so its check passes. The constraint can, and waits
        # to learn whether the first one is kept.
        with pytest.raises(TimeoutError):
            second.result(timeout=0.4)
        db.commit()
        response = second.result(timeout=10)

    assert response.status_code == 409
    message = (
        "Maria Lopez has just been given another shift that overlaps this one."
        " Reload the schedule and try again."
    )
    assert problem(response)["detail"] == message
    assert problem(response)["errors"] == [{"field": "starts_at", "message": message}]
    assert admin.get(SHIFTS, params=MONDAY).json()["total"] == 1
    # The request that lost left nothing behind, in the audit log either.
    assert admin.get("/api/v1/audit-logs", params={"entity_type": "shift"}).json()["total"] == 1


def test_updating_a_shift_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    maria = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    shift = factory.shift(maria, factory.building(admin.organization))

    response = admin.patch(
        f"{SHIFTS}/{shift.id}",
        json={"status": "completed", "break_minutes": 45, "ends_at": "2026-03-02T18:00:00-05:00"},
    )

    assert response.status_code == 200
    updated = response.json()
    assert (updated["status"], updated["break_minutes"], updated["ends_at"]) == (
        "completed",
        45,
        "2026-03-02T23:00:00Z",
    )
    (entry,) = audit_entries(admin, "shift", shift.id)
    assert entry["action"] == "shift.updated"
    assert entry["summary"] == (
        "Updated the shift of Maria Lopez on 2026-03-02: break minutes, ends at, status"
    )
    assert entry["changes"] == {
        "status": {"from": "scheduled", "to": "completed"},
        "break_minutes": {"from": 0, "to": 45},
        "ends_at": {"from": "2026-03-02T22:00:00+00:00", "to": "2026-03-02T23:00:00+00:00"},
    }


def test_cancelling_a_shift_keeps_it_on_record_and_closes_it_to_changes(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    maria = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization, name="Tower One")
    shift = factory.shift(maria, tower, starts_at=_at(3, 1), ends_at=_at(3, 9))
    url = f"{SHIFTS}/{shift.id}"

    response = admin.post(f"{url}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    (entry,) = audit_entries(admin, "shift", shift.id)
    assert entry["action"] == "shift.cancelled"
    assert entry["summary"] == "Cancelled the shift of Maria Lopez at Tower One on 2026-03-02"
    assert entry["changes"] == {"status": {"from": "scheduled", "to": "cancelled"}}

    again = admin.post(f"{url}/cancel")
    edited = admin.patch(url, json={"status": "scheduled"})

    assert again.status_code == edited.status_code == 409
    assert problem(again)["detail"] == (
        "Only a scheduled shift can be cancelled. This one is cancelled."
    )
    assert problem(edited)["detail"] == (
        "A cancelled shift cannot be changed. Schedule a new one instead."
    )
    assert admin.get(url).json()["status"] == "cancelled"
    assert len(audit_entries(admin, "shift", shift.id)) == 1


@pytest.mark.parametrize("status", [ShiftStatus.COMPLETED, ShiftStatus.MISSED])
def test_a_shift_that_is_over_cannot_be_cancelled(
    make_actor: ActorFactory, factory: Factory, status: ShiftStatus
):
    admin = make_actor()
    shift = factory.shift(
        factory.employee(admin.organization), factory.building(admin.organization), status=status
    )

    response = admin.post(f"{SHIFTS}/{shift.id}/cancel")

    assert response.status_code == 409
    assert problem(response)["detail"] == (
        f"Only a scheduled shift can be cancelled. This one is {status.value}."
    )


def test_a_shift_is_not_cancelled_by_editing_its_status(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    shift = factory.shift(
        factory.employee(admin.organization), factory.building(admin.organization)
    )
    url = f"{SHIFTS}/{shift.id}"

    response = admin.patch(url, json={"status": "cancelled"})

    assert response.status_code == 422
    assert problem(response)["errors"] == [
        {
            "field": "status",
            "message": "To cancel a shift, use its cancel action.",
            "code": "use_cancel",
        }
    ]
    # Its outcome can be recorded that way, and taken back.
    assert admin.patch(url, json={"status": "missed"}).json()["status"] == "missed"
    assert admin.patch(url, json={"status": "scheduled"}).json()["status"] == "scheduled"


def test_listing_reads_days_as_the_organization_has_them(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    maria, sam, ana = (factory.employee(organization) for _ in range(3))
    tower, depot = factory.building(organization), factory.building(organization)
    # 23:30 on Sunday in New York is already Monday in UTC.
    factory.shift(maria, tower, starts_at=_at(2, 4, 30), ends_at=_at(2, 12), notes="Sunday night")
    factory.shift(maria, tower, starts_at=_at(2, 14), ends_at=_at(2, 22), notes="Monday day")
    # 23:59 on Monday in New York, and midnight one minute later.
    factory.shift(
        sam,
        depot,
        starts_at=_at(3, 4, 59),
        ends_at=_at(3, 12),
        notes="Monday night",
        status=ShiftStatus.COMPLETED,
    )
    factory.shift(ana, depot, starts_at=_at(3, 5), ends_at=_at(3, 13), notes="Tuesday")
    elsewhere = factory.organization()
    factory.shift(factory.employee(elsewhere), factory.building(elsewhere), notes="Not ours")

    def notes(**params) -> list[str]:
        response = admin.get(SHIFTS, params={**MONDAY, **params})
        assert response.status_code == 200, response.text
        return [item["notes"] for item in response.json()["items"]]

    assert notes() == ["Monday day", "Monday night"]  # earliest first
    assert notes(sort="-starts_at") == ["Monday night", "Monday day"]
    assert notes(**{"from": "2026-03-01"}) == ["Sunday night", "Monday day", "Monday night"]
    assert notes(to="2026-03-03") == ["Monday day", "Monday night", "Tuesday"]
    assert notes(employee_id=str(sam.id)) == notes(status="completed") == ["Monday night"]
    assert notes(building_id=str(tower.id)) == ["Monday day"]
    assert notes(**{"from": "2026-03-01", "to": "2026-03-03"}, page_size=1, page=4) == ["Tuesday"]


def test_a_list_of_shifts_must_say_which_days_and_at_most_62_of_them(make_actor: ActorFactory):
    admin = make_actor()

    unbounded = admin.get(SHIFTS)
    backwards = admin.get(SHIFTS, params={"from": "2026-03-02", "to": "2026-03-01"})
    too_long = admin.get(SHIFTS, params={"from": "2026-03-01", "to": "2026-05-02"})
    two_months = admin.get(SHIFTS, params={"from": "2026-03-01", "to": "2026-05-01"})

    assert unbounded.status_code == backwards.status_code == too_long.status_code == 422
    assert {error["field"] for error in problem(unbounded)["errors"]} == {"from", "to"}
    assert problem(backwards)["errors"] == [
        {
            "field": "to",
            "message": "The end of the range cannot be before its start (2026-03-02).",
            "code": "invalid_range",
        }
    ]
    assert problem(too_long)["errors"] == [
        {"field": "to", "message": "Ask for at most 62 days at a time.", "code": "range_too_long"}
    ]
    assert two_months.status_code == 200


def test_shifts_of_another_organization_are_not_found(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    elsewhere = factory.organization()
    foreign = factory.shift(factory.employee(elsewhere), factory.building(elsewhere))
    url = f"{SHIFTS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"notes": "Taken over"}).status_code == 404
    assert admin.post(f"{url}/cancel").status_code == 404
    assert problem(admin.get(url))["detail"] == "Shift not found."
