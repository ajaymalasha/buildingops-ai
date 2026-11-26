"""Pay rates are visible, and settable, only with `employees:read_compensation`."""

from decimal import Decimal

import pytest

from buildingops.core.permissions import ROLE_PERMISSIONS, Permission, Role
from buildingops.modules.identity.models import Organization
from buildingops.modules.workforce.models import Employee, JobRole
from tests.conftest import Actor, ActorFactory, Factory, problem

JOB_ROLES = "/api/v1/job-roles"
EMPLOYEES = "/api/v1/employees"


@pytest.fixture
def organization(factory: Factory) -> Organization:
    return factory.organization()


@pytest.fixture
def porter(factory: Factory, organization: Organization) -> JobRole:
    return factory.job_role(organization, name="Day Porter", default_hourly_rate=Decimal("21.50"))


@pytest.fixture
def employee(factory: Factory, organization: Organization, porter: JobRole) -> Employee:
    return factory.employee(organization, porter, hourly_rate=Decimal("23.75"))


@pytest.fixture
def scheduler(
    make_actor: ActorFactory, organization: Organization, monkeypatch: pytest.MonkeyPatch
) -> Actor:
    """Someone who manages employees but may not see what they are paid.

    No built-in role is like that, so for these tests supervisors are given write access.
    The rule under test is about the permission, whoever holds it.
    """
    monkeypatch.setitem(
        ROLE_PERMISSIONS,
        Role.SUPERVISOR,
        ROLE_PERMISSIONS[Role.SUPERVISOR] | {Permission.EMPLOYEES_WRITE},
    )
    return make_actor(Role.SUPERVISOR, organization=organization)


def _rates(actor: Actor, employee: Employee) -> tuple[str | None, str | None, str | None]:
    """The rates as this caller sees them: on the job role, in the list, on the employee."""
    (job_role,) = actor.get(JOB_ROLES).json()["items"]
    (listed,) = actor.get(EMPLOYEES).json()["items"]
    detail = actor.get(f"{EMPLOYEES}/{employee.id}").json()
    return job_role["default_hourly_rate"], listed["hourly_rate"], detail["hourly_rate"]


@pytest.mark.parametrize("role", [Role.COMPANY_ADMIN, Role.OPERATIONS_MANAGER])
def test_managers_see_pay_rates(
    make_actor: ActorFactory, organization: Organization, employee: Employee, role: Role
):
    manager = make_actor(role, organization=organization)

    assert _rates(manager, employee) == ("21.50", "23.75", "23.75")


def test_pay_rates_are_hidden_from_supervisors(
    make_actor: ActorFactory, organization: Organization, employee: Employee
):
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)

    assert _rates(supervisor, employee) == (None, None, None)


def test_someone_who_cannot_see_pay_rates_cannot_set_them(
    make_actor: ActorFactory,
    scheduler: Actor,
    organization: Organization,
    porter: JobRole,
    employee: Employee,
):
    new_hire = {
        "first_name": "Maria",
        "last_name": "Lopez",
        "job_role_id": str(porter.id),
        "employment_type": "full_time",
    }

    refusals = [
        scheduler.post(EMPLOYEES, json={**new_hire, "hourly_rate": "30"}),
        scheduler.patch(f"{EMPLOYEES}/{employee.id}", json={"hourly_rate": "30"}),
        # Clearing a rate is setting it too.
        scheduler.patch(f"{EMPLOYEES}/{employee.id}", json={"hourly_rate": None}),
        scheduler.post(JOB_ROLES, json={"name": "Night Porter", "default_hourly_rate": "30"}),
        scheduler.patch(f"{JOB_ROLES}/{porter.id}", json={"default_hourly_rate": "30"}),
    ]

    for refusal in refusals:
        assert refusal.status_code == 403
        body = problem(refusal)
        assert body["code"] == "permission_denied"
        assert body["detail"] == "You do not have permission to set pay rates."
        assert body["errors"][0]["field"] in {"hourly_rate", "default_hourly_rate"}
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)
    assert _rates(manager, employee) == ("21.50", "23.75", "23.75")  # nothing was changed


def test_other_changes_leave_a_hidden_pay_rate_alone(
    make_actor: ActorFactory,
    scheduler: Actor,
    organization: Organization,
    porter: JobRole,
    employee: Employee,
):
    hired = scheduler.post(
        EMPLOYEES,
        json={
            "first_name": "Maria",
            "last_name": "Lopez",
            "job_role_id": str(porter.id),
            "employment_type": "part_time",
        },
    )
    edited = scheduler.patch(f"{EMPLOYEES}/{employee.id}", json={"phone": "212-555-0144"})
    renamed = scheduler.patch(f"{JOB_ROLES}/{porter.id}", json={"description": "Daytime upkeep"})

    assert (hired.status_code, edited.status_code, renamed.status_code) == (201, 200, 200)
    assert hired.json()["hourly_rate"] is None
    assert edited.json()["hourly_rate"] is None  # still hidden in the answer
    assert renamed.json()["default_hourly_rate"] is None
    manager = make_actor(Role.COMPANY_ADMIN, organization=organization)
    assert manager.get(f"{EMPLOYEES}/{employee.id}").json()["hourly_rate"] == "23.75"
    assert manager.get(JOB_ROLES).json()["items"][0]["default_hourly_rate"] == "21.50"
