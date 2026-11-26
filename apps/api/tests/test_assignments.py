import uuid
from datetime import date

import pytest

from buildingops.core.models import utcnow
from tests.conftest import Actor, ActorFactory, Factory, audit_entries, problem

EMPLOYEES = "/api/v1/employees"


@pytest.fixture
def admin(make_actor: ActorFactory) -> Actor:
    return make_actor()


def _assignments(employee_id: uuid.UUID) -> str:
    return f"{EMPLOYEES}/{employee_id}/assignments"


def _open_assignments(actor: Actor, employee_id: uuid.UUID) -> list[tuple[str, bool]]:
    """(building, is primary) for each of the employee's open assignments, by building."""
    detail = actor.get(f"{EMPLOYEES}/{employee_id}").json()
    return sorted(
        (assignment["building"]["name"], assignment["is_primary"])
        for assignment in detail["assignments"]
        if assignment["ends_on"] is None
    )


def test_an_employee_is_assigned_to_a_building(admin: Actor, factory: Factory):
    employee = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization, name="Tower One")

    response = admin.post(
        _assignments(employee.id), json={"building_id": str(tower.id), "starts_on": "2026-02-02"}
    )

    assert response.status_code == 201
    created = response.json()
    assert created["building"] == {"id": str(tower.id), "name": "Tower One"}
    assert (created["is_primary"], created["starts_on"], created["ends_on"]) == (
        False,
        "2026-02-02",
        None,
    )
    assert admin.get(f"{EMPLOYEES}/{employee.id}").json()["assignments"] == [created]
    (entry,) = audit_entries(admin, "employee", employee.id)
    assert entry["action"] == "employee.assigned"
    assert entry["summary"] == "Assigned Maria Lopez to Tower One"
    assert entry["changes"] == {
        "building_id": {"from": None, "to": str(tower.id)},
        "starts_on": {"from": None, "to": "2026-02-02"},
    }


def test_an_employee_has_one_open_assignment_per_building(admin: Actor, factory: Factory):
    employee = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization, name="Tower One")
    first = factory.assignment(employee, tower)
    again = {"building_id": str(tower.id), "starts_on": "2026-07-01"}

    duplicate = admin.post(_assignments(employee.id), json=again)

    assert duplicate.status_code == 409
    assert problem(duplicate)["errors"] == [
        {
            "field": "building_id",
            "message": "Maria Lopez already has an open assignment at Tower One.",
        }
    ]

    # Once the first one has ended, they can come back, and the old one stays as history.
    admin.patch(f"{_assignments(employee.id)}/{first.id}", json={"ends_on": "2026-06-30"})
    returned = admin.post(_assignments(employee.id), json=again)

    assert returned.status_code == 201
    history = admin.get(f"{EMPLOYEES}/{employee.id}").json()["assignments"]
    assert [(a["starts_on"], a["ends_on"]) for a in history] == [
        ("2026-07-01", None),
        ("2026-01-05", "2026-06-30"),
    ]


def test_a_new_primary_assignment_takes_over_from_the_old_one(admin: Actor, factory: Factory):
    organization = admin.organization
    employee = factory.employee(organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    factory.assignment(employee, tower, is_primary=True)

    response = admin.post(
        _assignments(employee.id),
        json={"building_id": str(depot.id), "starts_on": "2026-03-02", "is_primary": True},
    )

    assert response.status_code == 201
    assert _open_assignments(admin, employee.id) == [
        ("Pier Nine Depot", True),
        ("Tower One", False),
    ]
    detail = admin.get(f"{EMPLOYEES}/{employee.id}").json()
    assert detail["primary_building"] == {"id": str(depot.id), "name": "Pier Nine Depot"}
    entry = audit_entries(admin, "employee", employee.id)[0]
    assert entry["summary"] == "Assigned Maria Lopez to Pier Nine Depot as their primary building"
    assert entry["changes"]["primary_building_id"] == {"from": str(tower.id), "to": str(depot.id)}


def test_the_primary_flag_can_be_moved_and_removed(admin: Actor, factory: Factory):
    organization = admin.organization
    employee = factory.employee(organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    factory.assignment(employee, tower, is_primary=True)
    secondary = factory.assignment(employee, depot)
    url = f"{_assignments(employee.id)}/{secondary.id}"

    moved = admin.patch(url, json={"is_primary": True})

    assert moved.status_code == 200
    assert moved.json()["is_primary"] is True
    assert _open_assignments(admin, employee.id) == [
        ("Pier Nine Depot", True),
        ("Tower One", False),
    ]
    entry = audit_entries(admin, "employee", employee.id)[0]
    assert entry["action"] == "employee.updated"
    assert entry["summary"] == "Made Pier Nine Depot the primary building of Maria Lopez"
    assert entry["changes"] == {"primary_building_id": {"from": str(tower.id), "to": str(depot.id)}}

    removed = admin.patch(url, json={"is_primary": False})

    assert removed.status_code == 200
    assert admin.get(f"{EMPLOYEES}/{employee.id}").json()["primary_building"] is None
    entry = audit_entries(admin, "employee", employee.id)[0]
    assert entry["summary"] == "Pier Nine Depot is no longer the primary building of Maria Lopez"
    assert entry["changes"] == {"primary_building_id": {"from": str(depot.id), "to": None}}

    restored = admin.patch(url, json={"is_primary": True})

    assert restored.status_code == 200
    assert audit_entries(admin, "employee", employee.id)[0]["changes"] == {
        "primary_building_id": {"from": None, "to": str(depot.id)}
    }


def test_ending_an_assignment_closes_it(admin: Actor, factory: Factory):
    organization = admin.organization
    employee = factory.employee(organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(organization, name="Tower One")
    assignment = factory.assignment(employee, tower, is_primary=True)
    url = f"{_assignments(employee.id)}/{assignment.id}"

    response = admin.patch(url, json={"ends_on": "2026-06-30"})

    assert response.status_code == 200
    assert response.json()["ends_on"] == "2026-06-30"
    detail = admin.get(f"{EMPLOYEES}/{employee.id}").json()
    assert detail["primary_building"] is None
    assert admin.get(EMPLOYEES, params={"building_id": str(tower.id)}).json()["total"] == 0
    (entry,) = audit_entries(admin, "employee", employee.id)
    assert entry["action"] == "employee.assignment_ended"
    assert entry["summary"] == "Ended the assignment of Maria Lopez to Tower One"
    assert entry["changes"] == {
        "ends_on": {"from": None, "to": "2026-06-30"},
        "primary_building_id": {"from": str(tower.id), "to": None},
    }


def test_an_ended_assignment_only_accepts_a_corrected_end_date(admin: Actor, factory: Factory):
    employee = factory.employee(admin.organization, first_name="Maria", last_name="Lopez")
    tower = factory.building(admin.organization, name="Tower One")
    assignment = factory.assignment(
        employee, tower, starts_on=date(2026, 1, 5), ends_on=date(2026, 6, 30)
    )
    url = f"{_assignments(employee.id)}/{assignment.id}"

    def refusal(payload: dict) -> dict:
        response = admin.patch(url, json=payload)
        assert response.status_code == 422, response.text
        (error,) = problem(response)["errors"]
        return error

    assert refusal({"ends_on": None}) == {
        "field": "ends_on",
        "message": "An assignment that has ended cannot be reopened. Add a new one instead.",
        "code": "assignment_ended",
    }
    assert refusal({"ends_on": "2026-01-04"}) == {
        "field": "ends_on",
        "message": "The end date cannot be before the start date (2026-01-05).",
        "code": "ends_before_start",
    }
    assert refusal({"is_primary": True}) == {
        "field": "is_primary",
        "message": "Only an open assignment can change whether it is the primary one.",
        "code": "assignment_ended",
    }
    assert refusal({"is_primary": None})["field"] == "is_primary"

    corrected = admin.patch(url, json={"ends_on": "2026-07-15"})

    assert corrected.status_code == 200
    entry = audit_entries(admin, "employee", employee.id)[0]
    assert entry["summary"] == "Corrected the end of the assignment of Maria Lopez to Tower One"
    assert entry["changes"] == {"ends_on": {"from": "2026-06-30", "to": "2026-07-15"}}


def test_the_building_must_be_a_live_one_from_the_same_organization(admin: Actor, factory: Factory):
    employee = factory.employee(admin.organization)
    foreign = factory.building(factory.organization())
    archived = factory.building(admin.organization, deleted_at=utcnow())

    for building in (foreign, archived):
        response = admin.post(
            _assignments(employee.id),
            json={"building_id": str(building.id), "starts_on": "2026-02-02"},
        )
        assert response.status_code == 422
        assert problem(response)["errors"] == [
            {"field": "building_id", "message": "Building not found.", "code": "not_found"}
        ]

    missing_date = admin.post(_assignments(employee.id), json={"building_id": str(foreign.id)})
    assert problem(missing_date)["errors"][0]["field"] == "starts_on"


def test_assignments_are_reached_only_through_their_own_employee(admin: Actor, factory: Factory):
    organization = admin.organization
    employee = factory.employee(organization)
    colleague = factory.employee(organization)
    building = factory.building(organization)
    assignment = factory.assignment(colleague, building)
    foreign_organization = factory.organization()
    foreign_employee = factory.employee(foreign_organization)
    foreign_assignment = factory.assignment(
        foreign_employee, factory.building(foreign_organization)
    )
    end = {"ends_on": "2026-06-30"}

    # Another employee's assignment, an unknown one, and another organization's employee.
    wrong_employee = admin.patch(f"{_assignments(employee.id)}/{assignment.id}", json=end)
    unknown = admin.patch(f"{_assignments(employee.id)}/{uuid.uuid4()}", json=end)
    foreign_patch = admin.patch(
        f"{_assignments(foreign_employee.id)}/{foreign_assignment.id}", json=end
    )
    foreign_post = admin.post(
        _assignments(foreign_employee.id),
        json={"building_id": str(building.id), "starts_on": "2026-02-02"},
    )

    assert [r.status_code for r in (wrong_employee, unknown, foreign_patch, foreign_post)] == [
        404,
        404,
        404,
        404,
    ]
    assert problem(wrong_employee)["detail"] == "Assignment not found."
    assert problem(foreign_post)["detail"] == "Employee not found."
