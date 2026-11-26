"""Who may read and change master data: every endpoint, for every role."""

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from buildingops.core.permissions import Role
from buildingops.modules.identity.models import Organization
from tests.conftest import Actor, ActorFactory, Factory, problem

API = "/api/v1"

DIRECTORY_READS = [
    ("GET", "/customers"),
    ("GET", "/customers/{customer}"),
    ("GET", "/buildings"),
    ("GET", "/buildings/{building}"),
    ("GET", "/vendors"),
    ("GET", "/vendors/{vendor}"),
    ("GET", "/job-roles"),
    ("GET", "/employees"),
    ("GET", "/employees/{employee}"),
]
CONTRACT_READS = [
    ("GET", "/contracts"),
    ("GET", "/contracts/{contract}"),
]
WRITES = [
    ("POST", "/customers"),
    ("PATCH", "/customers/{customer}"),
    ("DELETE", "/customers/{customer}"),
    ("POST", "/buildings"),
    ("PATCH", "/buildings/{building}"),
    ("DELETE", "/buildings/{building}"),
    ("POST", "/vendors"),
    ("PATCH", "/vendors/{vendor}"),
    ("DELETE", "/vendors/{vendor}"),
    ("POST", "/job-roles"),
    ("PATCH", "/job-roles/{job_role}"),
    ("DELETE", "/job-roles/{job_role}"),
    ("POST", "/employees"),
    ("PATCH", "/employees/{employee}"),
    ("DELETE", "/employees/{employee}"),
    ("POST", "/employees/{employee}/assignments"),
    ("PATCH", "/employees/{employee}/assignments/{assignment}"),
    ("POST", "/contracts"),
    ("PATCH", "/contracts/{contract}"),
]


@dataclass(frozen=True, slots=True)
class Directory:
    """An organization with one of each record, and the ids that go into the paths."""

    organization: Organization
    ids: dict[str, str]


@pytest.fixture
def directory(factory: Factory) -> Directory:
    organization = factory.organization()
    customer = factory.customer(organization)
    building = factory.building(organization, customer)
    job_role = factory.job_role(organization)
    employee = factory.employee(organization, job_role)
    records = {
        "customer": customer,
        "building": building,
        "vendor": factory.vendor(organization),
        "job_role": job_role,
        "employee": employee,
        "assignment": factory.assignment(employee, building),
        "contract": factory.contract(organization, customer, buildings=[building]),
    }
    return Directory(organization, {name: str(record.id) for name, record in records.items()})


def _call(actor: Actor, directory: Directory, method: str, path: str) -> Response:
    # An empty body is enough: permission is decided before the body is looked at.
    body = {} if method in {"POST", "PATCH"} else None
    return actor.client.request(
        method, API + path.format(**directory.ids), headers=actor.headers, json=body
    )


def _statuses(actor: Actor, directory: Directory, endpoints: list[tuple[str, str]]) -> set[int]:
    return {_call(actor, directory, method, path).status_code for method, path in endpoints}


@pytest.mark.parametrize("role", [Role.COMPANY_ADMIN, Role.OPERATIONS_MANAGER])
def test_admins_and_operations_managers_have_full_access(
    make_actor: ActorFactory, directory: Directory, role: Role
):
    manager = make_actor(role, organization=directory.organization)

    assert _statuses(manager, directory, DIRECTORY_READS + CONTRACT_READS) == {200}
    # Whatever each write answers to an empty body, it is not a refusal.
    assert _statuses(manager, directory, WRITES).isdisjoint({401, 403})


def test_supervisors_read_the_directory_but_not_contracts_and_change_nothing(
    make_actor: ActorFactory, directory: Directory
):
    supervisor = make_actor(Role.SUPERVISOR, organization=directory.organization)

    assert _statuses(supervisor, directory, DIRECTORY_READS) == {200}
    assert _statuses(supervisor, directory, CONTRACT_READS) == {403}
    assert _statuses(supervisor, directory, WRITES) == {403}


@pytest.mark.parametrize("role", [Role.EMPLOYEE, Role.CUSTOMER, Role.VENDOR])
def test_other_roles_have_no_access_to_master_data(
    make_actor: ActorFactory, directory: Directory, role: Role
):
    member = make_actor(role, organization=directory.organization)

    refused = _call(member, directory, "GET", "/customers")

    assert problem(refused)["code"] == "permission_denied"
    assert _statuses(member, directory, DIRECTORY_READS + CONTRACT_READS + WRITES) == {403}


def test_master_data_needs_a_signed_in_user(client: TestClient, directory: Directory):
    for method, path in DIRECTORY_READS + CONTRACT_READS + WRITES:
        response = client.request(method, API + path.format(**directory.ids))
        assert response.status_code == 401, (method, path)


def test_a_platform_admin_works_with_the_organization_they_have_entered(
    make_actor: ActorFactory, directory: Directory, factory: Factory
):
    factory.customer(factory.organization())  # another organization's customer
    platform_admin = make_actor(platform_admin=True)
    assert platform_admin.get(f"{API}/customers").status_code == 403  # not inside one yet

    platform_admin.post(
        f"{API}/auth/switch-organization",
        json={"organization_id": str(directory.organization.id)},
    )

    listed = platform_admin.get(f"{API}/customers").json()
    assert [item["id"] for item in listed["items"]] == [directory.ids["customer"]]
    assert platform_admin.post(f"{API}/customers", json={"name": "Added"}).status_code == 201
