from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from buildingops.core.models import utcnow
from buildingops.modules.identity.models import Organization
from buildingops.modules.workorders.models import (
    WorkOrder,
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderStatus,
)
from buildingops.modules.workorders.service import ALLOWED_MOVES
from tests.conftest import ActorFactory, Factory, audit_entries, problem

WORK_ORDERS = "/api/v1/work-orders"

_S = WorkOrderStatus
ALLOWED = [(current, target) for current, targets in ALLOWED_MOVES.items() for target in targets]
REFUSED = [
    (current, target)
    for current in WorkOrderStatus
    for target in WorkOrderStatus
    if target not in ALLOWED_MOVES[current]
]


def _new_work_order(building, **overrides):
    payload = {
        "title": "Replace lobby lights",
        "building_id": str(building.id),
        "category": "electrical",
    }
    payload.update(overrides)
    return payload


def _in_status(
    factory: Factory, organization: Organization, status: WorkOrderStatus, **fields
) -> WorkOrder:
    """A work order as it stands in `status`: started if work has begun, finished if done."""
    if status in (_S.IN_PROGRESS, _S.COMPLETED):
        fields["started_at"] = datetime(2026, 3, 2, 9, tzinfo=UTC)
    if status is _S.COMPLETED:
        fields["completed_at"] = datetime(2026, 3, 2, 17, tzinfo=UTC)
    return factory.work_order(organization, status=status, **fields)


def test_a_work_order_is_created_open_with_the_next_number(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    tower = factory.building(organization, customer, name="Tower One")
    contract = factory.contract(
        organization, customer, buildings=[tower], contract_number="K-7", name="Cleaning"
    )
    maria = factory.employee(
        organization, first_name="Maria", last_name="Lopez", employee_number="E-7"
    )
    brightline = factory.vendor(organization, name="Brightline Electric")

    response = admin.post(
        WORK_ORDERS,
        json=_new_work_order(
            tower,
            contract_id=str(contract.id),
            assigned_employee_id=str(maria.id),
            vendor_id=str(brightline.id),
            priority="high",
            due_on="2030-01-15",
            scheduled_for="2030-01-14T08:30:00-05:00",
            requested_by="Front desk",
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert created["number"] == "WO-0001"
    assert created["scheduled_for"] == "2030-01-14T13:30:00Z"  # times are kept in UTC
    assert (created["status"], created["source"], created["billable"], created["is_overdue"]) == (
        "open",
        "internal",
        True,
        False,
    )
    assert created["building"] == {"id": str(tower.id), "name": "Tower One"}
    assert created["contract"] == {
        "id": str(contract.id),
        "contract_number": "K-7",
        "name": "Cleaning",
    }
    assert created["assigned_employee"] == {
        "id": str(maria.id),
        "full_name": "Maria Lopez",
        "employee_number": "E-7",
    }
    assert created["vendor"] == {"id": str(brightline.id), "name": "Brightline Electric"}
    assert (created["started_at"], created["completed_at"]) == (None, None)
    # Who it was given to is the first thing in its history.
    assert [(a["kind"], a["body"], a["author_name"]) for a in created["activities"]] == [
        ("assignment", "Assigned to Maria Lopez.", admin.user.full_name),
        ("assignment", "Vendor set to Brightline Electric.", admin.user.full_name),
    ]
    assert admin.get(f"{WORK_ORDERS}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "work_order", created["id"])
    assert entry["action"] == "work_order.created"
    assert entry["summary"] == "Created work order WO-0001 (Replace lobby lights) at Tower One"
    assert entry["changes"]["building_id"] == {"from": None, "to": str(tower.id)}


def test_listing_supports_search_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    maria = factory.employee(organization)
    brightline = factory.vendor(organization)

    def add(day: int, building, **fields) -> None:
        factory.work_order(
            organization, building, created_at=datetime(2026, 3, day, tzinfo=UTC), **fields
        )

    add(
        2,
        tower,
        number="WO-0002",
        title="Lights",
        priority=WorkOrderPriority.HIGH,
        category=WorkOrderCategory.ELECTRICAL,
        assigned_employee_id=maria.id,
        due_on=date(2030, 2, 1),
    )
    add(
        3,
        depot,
        number="WO-0010",
        title="Floors",
        status=_S.IN_PROGRESS,
        priority=WorkOrderPriority.LOW,
        category=WorkOrderCategory.CLEANING,
    )
    add(
        4,
        tower,
        number="WO-9999",
        title="Valve",
        status=_S.COMPLETED,
        priority=WorkOrderPriority.URGENT,
        category=WorkOrderCategory.PLUMBING,
        vendor_id=brightline.id,
        due_on=date(2030, 1, 10),
    )
    add(
        5,
        depot,
        number="WO-10000",
        title="Doors",
        status=_S.SCHEDULED,
        category=WorkOrderCategory.INSPECTION,
        assigned_employee_id=maria.id,
        due_on=date(2030, 3, 5),
    )
    factory.work_order(factory.organization(), title="Lights of Another Company")

    def titles(**params) -> list[str]:
        response = admin.get(WORK_ORDERS, params=params)
        assert response.status_code == 200, response.text
        return [item["title"] for item in response.json()["items"]]

    assert admin.get(WORK_ORDERS).json()["total"] == 4
    assert titles() == ["Doors", "Valve", "Floors", "Lights"]  # newest first
    assert titles(status=["open", "scheduled"]) == ["Doors", "Lights"]
    assert titles(priority="urgent") == titles(vendor_id=str(brightline.id)) == ["Valve"]
    assert titles(category="cleaning") == ["Floors"]
    assert titles(building_id=str(tower.id)) == ["Valve", "Lights"]
    assert titles(assigned_employee_id=str(maria.id)) == ["Doors", "Lights"]
    assert titles(q="wo-9999") == ["Valve"]
    assert titles(q="LIGHT") == ["Lights"]
    # By number as a number: WO-10000 is the highest, not the lowest.
    assert titles(sort="number") == ["Lights", "Floors", "Valve", "Doors"]
    # By what a priority or a status means, not by how it is spelled.
    assert titles(sort="priority") == ["Floors", "Doors", "Lights", "Valve"]
    assert titles(sort="-priority") == ["Valve", "Lights", "Doors", "Floors"]
    assert titles(sort="status") == ["Lights", "Doors", "Floors", "Valve"]
    # A work order with no due date comes last, whichever way the list is sorted.
    assert titles(sort="due_on") == ["Valve", "Lights", "Doors", "Floors"]
    assert titles(sort="-due_on") == ["Doors", "Lights", "Valve", "Floors"]
    assert titles(sort="created_at", page_size=2, page=2) == ["Valve", "Doors"]
    assert admin.get(WORK_ORDERS, params={"sort": "title"}).status_code == 422


def test_overdue_means_due_before_today_and_not_yet_closed(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    today = datetime.now(ZoneInfo(organization.timezone)).date()
    past, ahead = today - timedelta(days=2), today + timedelta(days=2)
    factory.work_order(organization, title="Late", due_on=past)
    _in_status(factory, organization, _S.COMPLETED, title="Late but done", due_on=past)
    factory.work_order(organization, title="Late but cancelled", due_on=past, status=_S.CANCELLED)
    factory.work_order(organization, title="Due later", due_on=ahead)
    factory.work_order(organization, title="No due date")

    def titles(overdue: str) -> list[str]:
        items = admin.get(WORK_ORDERS, params={"overdue": overdue}).json()["items"]
        return sorted(item["title"] for item in items)

    assert titles("true") == ["Late"]
    assert titles("false") == ["Due later", "Late but cancelled", "Late but done", "No due date"]
    flags = {item["title"]: item["is_overdue"] for item in admin.get(WORK_ORDERS).json()["items"]}
    assert [title for title, is_overdue in flags.items() if is_overdue] == ["Late"]


def test_overdue_is_judged_by_the_date_where_the_organization_is(
    make_actor: ActorFactory, factory: Factory
):
    # The two zones are 26 hours apart, so the later one is always at least a day ahead.
    earliest, latest = "Etc/GMT+12", "Pacific/Kiritimati"
    due_on = datetime.now(ZoneInfo(latest)).date() - timedelta(days=1)
    overdue = {}
    for timezone in (earliest, latest):
        admin = make_actor(organization=factory.organization(timezone=timezone))
        work_order = factory.work_order(admin.organization, due_on=due_on)
        overdue[timezone] = admin.get(f"{WORK_ORDERS}/{work_order.id}").json()["is_overdue"]

    # The same date is yesterday in one place and not yet past in the other.
    assert overdue == {earliest: False, latest: True}


def test_a_work_order_points_only_at_live_records_of_its_own_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization, elsewhere = admin.organization, factory.organization()
    tower = factory.building(organization)
    archived = {"deleted_at": utcnow()}
    cases = {
        "building_id": (
            "Building not found.",
            [factory.building(elsewhere), factory.building(organization, **archived)],
        ),
        "assigned_employee_id": (
            "Employee not found.",
            [factory.employee(elsewhere), factory.employee(organization, **archived)],
        ),
        "vendor_id": (
            "Vendor not found.",
            [factory.vendor(elsewhere), factory.vendor(organization, **archived)],
        ),
        "contract_id": ("Contract not found.", [factory.contract(elsewhere)]),
    }

    for field, (message, records) in cases.items():
        for record in records:
            payload = _new_work_order(tower, **{field: str(record.id)})
            response = admin.post(WORK_ORDERS, json=payload)
            assert response.status_code == 422, (field, response.text)
            assert problem(response)["errors"] == [
                {"field": field, "message": message, "code": "not_found"}
            ]
    assert admin.get(WORK_ORDERS).json()["total"] == 0


def test_a_contract_on_a_work_order_must_cover_its_building(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    tower = factory.building(organization, customer, name="Tower One")
    depot = factory.building(organization, customer, name="Pier Nine Depot")
    contract = factory.contract(organization, customer, buildings=[tower], contract_number="K-7")
    not_covered = {
        "message": "Contract K-7 does not cover Pier Nine Depot.",
        "code": "contract_does_not_cover_building",
    }

    refused = admin.post(WORK_ORDERS, json=_new_work_order(depot, contract_id=str(contract.id)))
    accepted = admin.post(WORK_ORDERS, json=_new_work_order(tower, contract_id=str(contract.id)))

    assert refused.status_code == 422
    assert problem(refused)["errors"] == [{"field": "contract_id", **not_covered}]
    assert accepted.status_code == 201
    url = f"{WORK_ORDERS}/{accepted.json()['id']}"

    # Moved to a building the contract does not cover, it is the building that is wrong.
    moved = admin.patch(url, json={"building_id": str(depot.id)})
    moved_off_the_contract = admin.patch(
        url, json={"building_id": str(depot.id), "contract_id": None}
    )

    assert moved.status_code == 422
    assert problem(moved)["errors"] == [{"field": "building_id", **not_covered}]
    assert moved_off_the_contract.status_code == 200
    assert moved_off_the_contract.json()["contract"] is None
    assert moved_off_the_contract.json()["building"]["name"] == "Pier Nine Depot"


def test_updating_a_work_order_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    work_order = factory.work_order(
        admin.organization, number="WO-7", title="Fix door closer", due_on=date(2030, 1, 10)
    )
    url = f"{WORK_ORDERS}/{work_order.id}"

    response = admin.patch(
        url, json={"priority": "urgent", "due_on": "2030-01-05", "description": "Rear exit"}
    )

    assert response.status_code == 200
    assert (response.json()["priority"], response.json()["due_on"]) == ("urgent", "2030-01-05")
    (entry,) = audit_entries(admin, "work_order", work_order.id)
    assert entry["action"] == "work_order.updated"
    assert entry["summary"] == (
        "Updated work order WO-7 (Fix door closer): description, due on, priority"
    )
    assert entry["changes"] == {
        "priority": {"from": "normal", "to": "urgent"},
        "due_on": {"from": "2030-01-10", "to": "2030-01-05"},
        "description": {"from": None, "to": "Rear exit"},
    }
    # Details are not history: only status changes, reassignments and comments are.
    assert response.json()["activities"] == []


def test_the_status_and_the_number_are_not_fields_to_edit(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    work_order = factory.work_order(admin.organization, number="WO-7")
    url = f"{WORK_ORDERS}/{work_order.id}"

    for field, value in {
        "status": "completed",
        "number": "WO-8",
        "started_at": "2030-01-05T09:00:00Z",
        "completed_at": "2030-01-05T17:00:00Z",
    }.items():
        response = admin.patch(url, json={field: value})
        assert response.status_code == 422, field
        assert [error["field"] for error in problem(response)["errors"]] == [field]

    unchanged = admin.get(url).json()
    assert (unchanged["status"], unchanged["number"], unchanged["started_at"]) == (
        "open",
        "WO-7",
        None,
    )


def test_required_fields_cannot_be_cleared(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    work_order = factory.work_order(admin.organization)

    response = admin.patch(
        f"{WORK_ORDERS}/{work_order.id}",
        json={"title": None, "building_id": None, "category": None, "billable": None},
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "title",
        "building_id",
        "category",
        "billable",
    }


def test_every_change_of_assignee_or_vendor_goes_into_the_history(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    maria = factory.employee(organization, first_name="Maria", last_name="Lopez")
    sam = factory.employee(organization, first_name="Sam", last_name="Reed")
    brightline = factory.vendor(organization, name="Brightline Electric")
    volta = factory.vendor(organization, name="Volta Power")
    work_order = factory.work_order(
        organization, assigned_employee_id=maria.id, vendor_id=brightline.id
    )
    url = f"{WORK_ORDERS}/{work_order.id}"

    for change in (
        {"assigned_employee_id": str(sam.id), "vendor_id": str(volta.id)},
        {"assigned_employee_id": None},
        {"vendor_id": None, "title": "Renamed"},
        # Nothing about who does the work changes here.
        {"assigned_employee_id": None, "priority": "low"},
        {"assigned_employee_id": str(maria.id)},
    ):
        assert admin.patch(url, json=change).status_code == 200

    history = admin.get(url).json()["activities"]
    assert [(entry["kind"], entry["body"]) for entry in history] == [
        ("assignment", "Reassigned from Maria Lopez to Sam Reed."),
        ("assignment", "Vendor changed from Brightline Electric to Volta Power."),
        ("assignment", "No longer assigned to Sam Reed."),
        ("assignment", "Vendor Volta Power removed."),
        ("assignment", "Assigned to Maria Lopez."),
    ]
    assert {entry["author_name"] for entry in history} == {admin.user.full_name}
    assert {(entry["from_status"], entry["to_status"]) for entry in history} == {(None, None)}


def test_a_work_order_keeps_the_people_it_named_after_they_are_archived(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    maria = factory.employee(organization, first_name="Maria", last_name="Lopez")
    brightline = factory.vendor(organization, name="Brightline Electric")
    work_order = factory.work_order(
        organization, assigned_employee_id=maria.id, vendor_id=brightline.id
    )
    other = factory.work_order(organization)
    url = f"{WORK_ORDERS}/{work_order.id}"
    assert admin.delete(f"/api/v1/employees/{maria.id}").status_code == 204
    assert admin.delete(f"/api/v1/vendors/{brightline.id}").status_code == 204
    same_people = {"assigned_employee_id": str(maria.id), "vendor_id": str(brightline.id)}

    # Saving it again with the people it already has is not a new choice of them.
    resaved = admin.patch(url, json={**same_people, "title": "Renamed"})
    given_to_another = admin.patch(f"{WORK_ORDERS}/{other.id}", json=same_people)

    assert resaved.status_code == 200
    assert resaved.json()["assigned_employee"]["full_name"] == "Maria Lopez"
    assert resaved.json()["vendor"]["name"] == "Brightline Electric"
    assert resaved.json()["activities"] == []
    assert given_to_another.status_code == 422
    assert problem(given_to_another)["errors"][0]["message"] == "Employee not found."


@pytest.mark.parametrize(("current", "target"), ALLOWED, ids=lambda status: status.value)
def test_a_work_order_can_make_every_allowed_move(
    make_actor: ActorFactory, factory: Factory, current: WorkOrderStatus, target: WorkOrderStatus
):
    admin = make_actor()
    work_order = _in_status(factory, admin.organization, current)

    response = admin.post(f"{WORK_ORDERS}/{work_order.id}/status", json={"status": target.value})

    assert response.status_code == 200, response.text
    moved = response.json()
    assert moved["status"] == target.value
    (activity,) = moved["activities"]
    assert (activity["kind"], activity["from_status"], activity["to_status"]) == (
        "status_change",
        current.value,
        target.value,
    )
    assert (activity["body"], activity["author_name"]) == (None, admin.user.full_name)
    (entry,) = audit_entries(admin, "work_order", work_order.id)
    assert entry["action"] == "work_order.status_changed"
    assert entry["changes"]["status"] == {"from": current.value, "to": target.value}


@pytest.mark.parametrize(("current", "target"), REFUSED, ids=lambda status: status.value)
def test_any_other_move_is_refused_and_names_the_allowed_ones(
    make_actor: ActorFactory, factory: Factory, current: WorkOrderStatus, target: WorkOrderStatus
):
    admin = make_actor()
    work_order = _in_status(factory, admin.organization, current)
    url = f"{WORK_ORDERS}/{work_order.id}"

    response = admin.post(f"{url}/status", json={"status": target.value})

    assert response.status_code == 409
    body = problem(response)
    for allowed in ALLOWED_MOVES[current]:
        assert allowed.value.replace("_", " ") in body["detail"]
    assert body["errors"] == [{"field": "status", "message": body["detail"]}]
    unchanged = admin.get(url).json()
    assert (unchanged["status"], unchanged["activities"]) == (current.value, [])
    assert audit_entries(admin, "work_order", work_order.id) == []


def test_a_refused_move_says_plainly_where_the_work_order_can_go(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    done = _in_status(factory, admin.organization, _S.COMPLETED)
    new = factory.work_order(admin.organization)

    cancelled_after_the_fact = admin.post(
        f"{WORK_ORDERS}/{done.id}/status", json={"status": "cancelled"}
    )
    opened_twice = admin.post(f"{WORK_ORDERS}/{new.id}/status", json={"status": "open"})

    assert problem(cancelled_after_the_fact)["detail"] == (
        "A work order that is completed cannot move to cancelled. It can move to in progress."
    )
    assert problem(opened_twice)["detail"] == (
        "This work order is already open."
        " It can move to scheduled, in progress, on hold or cancelled."
    )


def test_starting_finishing_and_reopening_keep_the_right_times(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    work_order = factory.work_order(admin.organization, number="WO-7", title="Fix door closer")
    url = f"{WORK_ORDERS}/{work_order.id}"

    def move(status: str, **body) -> dict:
        response = admin.post(f"{url}/status", json={"status": status, **body})
        assert response.status_code == 200, response.text
        return response.json()

    started = move("in_progress")
    assert started["started_at"] is not None
    assert started["completed_at"] is None

    move("on_hold", comment="Waiting for the part")
    resumed = move("in_progress")
    assert resumed["started_at"] == started["started_at"]  # the first start is the one kept

    finished = move("completed")
    assert finished["started_at"] == started["started_at"]
    assert datetime.fromisoformat(finished["completed_at"]) >= datetime.fromisoformat(
        finished["started_at"]
    )

    reopened = move("in_progress")
    assert (reopened["started_at"], reopened["completed_at"]) == (started["started_at"], None)
    assert [(a["from_status"], a["to_status"], a["body"]) for a in reopened["activities"]] == [
        ("open", "in_progress", None),
        ("in_progress", "on_hold", "Waiting for the part"),
        ("on_hold", "in_progress", None),
        ("in_progress", "completed", None),
        ("completed", "in_progress", None),
    ]
    newest = audit_entries(admin, "work_order", work_order.id)[0]
    assert newest["summary"] == (
        "Moved work order WO-7 (Fix door closer) from completed to in progress"
    )
    assert set(newest["changes"]) == {"status", "completed_at"}
    assert newest["changes"]["completed_at"]["to"] is None


def test_a_comment_is_added_to_the_end_of_the_history(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    work_order = factory.work_order(admin.organization, number="WO-7", title="Fix door closer")
    factory.work_order_activity(
        work_order,
        body="Reported by the night porter.",
        author_name="Sam Reed",
        created_at=datetime(2026, 1, 5, tzinfo=UTC),
    )
    url = f"{WORK_ORDERS}/{work_order.id}"

    response = admin.post(f"{url}/comments", json={"body": "  Parts ordered, due Thursday.  "})

    assert response.status_code == 201
    comment = response.json()
    assert (comment["kind"], comment["body"], comment["author_name"]) == (
        "comment",
        "Parts ordered, due Thursday.",
        admin.user.full_name,
    )
    assert (comment["from_status"], comment["to_status"]) == (None, None)
    history = admin.get(url).json()["activities"]
    assert [(entry["author_name"], entry["body"]) for entry in history] == [
        ("Sam Reed", "Reported by the night porter."),
        (admin.user.full_name, "Parts ordered, due Thursday."),
    ]
    assert history[-1] == comment
    (entry,) = audit_entries(admin, "work_order", work_order.id)
    assert entry["action"] == "work_order.commented"
    assert entry["summary"] == "Commented on work order WO-7 (Fix door closer)"
    assert entry["changes"] == {"comment": {"from": None, "to": "Parts ordered, due Thursday."}}

    empty = admin.post(f"{url}/comments", json={"body": "   "})
    assert empty.status_code == 422
    assert problem(empty)["errors"][0]["field"] == "body"


def test_the_history_can_only_be_added_to(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    work_order = factory.work_order(admin.organization)
    activity = factory.work_order_activity(work_order)
    url = f"{WORK_ORDERS}/{work_order.id}"

    assert admin.patch(f"{url}/comments", json={"body": "Rewritten"}).status_code == 405
    assert admin.delete(f"{url}/comments").status_code == 405
    assert admin.patch(f"{url}/comments/{activity.id}", json={"body": "x"}).status_code == 404
    assert admin.delete(f"{url}/comments/{activity.id}").status_code == 404
    # Nor is a work order deleted. It ends as completed or cancelled.
    assert admin.delete(url).status_code == 405
    assert [entry["body"] for entry in admin.get(url).json()["activities"]] == ["Checked on site."]


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    response = make_actor().post(
        WORK_ORDERS,
        json={
            "title": "",
            "building_id": "not-an-id",
            "category": "painting",
            "priority": "asap",
            "source": "phone",
            "due_on": "next week",
            # A time has to say which zone it is in.
            "scheduled_for": "2030-01-15T09:00:00",
            "billable": "sometimes",
            "number": "WO-1",
        },
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "title",
        "building_id",
        "category",
        "priority",
        "source",
        "due_on",
        "scheduled_for",
        "billable",
        "number",
    }


def test_work_orders_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.work_order(factory.organization())
    url = f"{WORK_ORDERS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"title": "Taken over"}).status_code == 404
    assert admin.post(f"{url}/status", json={"status": "cancelled"}).status_code == 404
    assert admin.post(f"{url}/comments", json={"body": "Seen"}).status_code == 404
    assert problem(admin.get(url))["detail"] == "Work order not found."
    assert admin.get(WORK_ORDERS).json()["total"] == 0
