from decimal import Decimal

from buildingops.core.models import utcnow
from tests.conftest import ActorFactory, Factory, audit_entries, problem

JOB_ROLES = "/api/v1/job-roles"


def test_a_job_role_is_created_with_its_default_rate(make_actor: ActorFactory):
    admin = make_actor()

    response = admin.post(
        JOB_ROLES,
        json={"name": "Day Porter", "default_hourly_rate": 21.5, "description": "Daytime upkeep"},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Day Porter"
    assert created["default_hourly_rate"] == "21.50"  # money travels as a string, never a float
    assert (created["is_supervisory"], created["employee_count"]) == (False, 0)
    (entry,) = audit_entries(admin, "job_role", created["id"])
    assert entry["action"] == "job_role.created"
    assert entry["summary"] == "Created job role Day Porter"
    assert entry["changes"] == {
        "name": {"from": None, "to": "Day Porter"},
        "description": {"from": None, "to": "Daytime upkeep"},
        "default_hourly_rate": {"from": None, "to": "21.50"},
        "is_supervisory": {"from": None, "to": False},
    }


def test_names_are_unique_whatever_their_case(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    factory.job_role(admin.organization, name="Day Porter")
    other = factory.job_role(admin.organization, name="Night Porter")
    factory.job_role(admin.organization, name="Floor Tech", deleted_at=utcnow())
    factory.job_role(factory.organization(), name="Site Lead")

    on_create = admin.post(JOB_ROLES, json={"name": "day porter"})
    on_update = admin.patch(f"{JOB_ROLES}/{other.id}", json={"name": "DAY PORTER"})

    assert on_create.status_code == on_update.status_code == 409
    assert problem(on_create)["errors"] == [
        {"field": "name", "message": "A job role named day porter already exists."}
    ]
    # Changing only the case of its own name is fine, and so is reusing a name that
    # belongs to an archived role or to another organization.
    assert admin.patch(f"{JOB_ROLES}/{other.id}", json={"name": "NIGHT PORTER"}).status_code == 200
    assert admin.post(JOB_ROLES, json={"name": "Floor Tech"}).status_code == 201
    assert admin.post(JOB_ROLES, json={"name": "Site Lead"}).status_code == 201


def test_listing_counts_the_employees_in_each_role(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization, name="Day Porter")
    factory.job_role(organization, name="Site Supervisor", is_supervisory=True)
    factory.job_role(organization, name="Retired Role", deleted_at=utcnow())
    factory.job_role(factory.organization(), name="Day Porter")
    factory.employee(organization, porter)
    factory.employee(organization, porter)
    factory.employee(organization, porter, deleted_at=utcnow())

    listed = admin.get(JOB_ROLES).json()
    reversed_names = [
        item["name"] for item in admin.get(JOB_ROLES, params={"sort": "-name"}).json()["items"]
    ]

    assert listed["total"] == 2
    assert [(item["name"], item["employee_count"]) for item in listed["items"]] == [
        ("Day Porter", 2),
        ("Site Supervisor", 0),
    ]
    assert reversed_names == ["Site Supervisor", "Day Porter"]
    assert admin.get(JOB_ROLES, params={"q": "super"}).json()["total"] == 1
    assert admin.get(JOB_ROLES, params={"sort": "employee_count"}).status_code == 422


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    admin = make_actor()

    negative = admin.post(JOB_ROLES, json={"name": "", "default_hourly_rate": -1})
    too_precise = admin.post(JOB_ROLES, json={"name": "x" * 121, "default_hourly_rate": "18.125"})

    assert negative.status_code == too_precise.status_code == 422
    for response in (negative, too_precise):
        assert {error["field"] for error in problem(response)["errors"]} == {
            "name",
            "default_hourly_rate",
        }


def test_updating_a_job_role_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    job_role = factory.job_role(
        admin.organization, name="Day Porter", default_hourly_rate=Decimal("18.00")
    )

    response = admin.patch(
        f"{JOB_ROLES}/{job_role.id}", json={"default_hourly_rate": "19.5", "is_supervisory": True}
    )

    assert response.status_code == 200
    assert response.json()["default_hourly_rate"] == "19.50"
    (entry,) = audit_entries(admin, "job_role", job_role.id)
    assert entry["action"] == "job_role.updated"
    assert entry["summary"] == "Updated job role Day Porter: default hourly rate, is supervisory"
    assert entry["changes"] == {
        "default_hourly_rate": {"from": "18.00", "to": "19.50"},
        "is_supervisory": {"from": False, "to": True},
    }


def test_job_roles_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.job_role(factory.organization())

    assert admin.patch(f"{JOB_ROLES}/{foreign.id}", json={"name": "Taken over"}).status_code == 404
    assert admin.delete(f"{JOB_ROLES}/{foreign.id}").status_code == 404


def test_a_job_role_in_use_cannot_be_archived(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    porter = factory.job_role(organization, name="Day Porter")
    cleaner = factory.job_role(organization, name="Cleaner")
    employees = [factory.employee(organization, porter) for _ in range(2)]
    url = f"{JOB_ROLES}/{porter.id}"

    refused = admin.delete(url)

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        "Day Porter still has 2 employees. Before archiving, give them another job role."
    )

    # One moves to another role and the other is archived: nobody holds the role now.
    admin.patch(f"/api/v1/employees/{employees[0].id}", json={"job_role_id": str(cleaner.id)})
    admin.delete(f"/api/v1/employees/{employees[1].id}")

    assert admin.delete(url).status_code == 204
    assert [item["name"] for item in admin.get(JOB_ROLES).json()["items"]] == ["Cleaner"]
    entry = audit_entries(admin, "job_role", porter.id)[0]
    assert (entry["action"], entry["summary"]) == (
        "job_role.archived",
        "Archived job role Day Porter",
    )
