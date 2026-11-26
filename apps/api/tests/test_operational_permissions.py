"""Who may read, change and decide on operational records: every endpoint, for every role."""

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from buildingops.core.permissions import Role
from buildingops.modules.identity.models import Organization
from tests.conftest import Actor, ActorFactory, Factory, problem

API = "/api/v1"

# What a supervisor needs to run their sites.
SITE_READS = [
    ("GET", "/work-orders"),
    ("GET", "/work-orders/{work_order}"),
    ("GET", "/shifts?from=2026-03-01&to=2026-03-31"),
    ("GET", "/shifts/{shift}"),
    ("GET", "/timesheets"),
    ("GET", "/timesheets/summary"),
    ("GET", "/timesheets/{timesheet}"),
    ("GET", "/expenses"),
    ("GET", "/expenses/{expense}"),
]
SITE_WRITES = [
    ("POST", "/work-orders"),
    ("PATCH", "/work-orders/{work_order}"),
    ("POST", "/work-orders/{work_order}/status"),
    ("POST", "/work-orders/{work_order}/comments"),
    ("POST", "/shifts"),
    ("PATCH", "/shifts/{shift}"),
    ("POST", "/shifts/{shift}/cancel"),
    ("POST", "/timesheets"),
    ("PATCH", "/timesheets/{timesheet}"),
    ("POST", "/expenses"),
    ("PATCH", "/expenses/{expense}"),
]
TIMESHEET_DECISIONS = [
    ("POST", "/timesheets/approve"),
    ("POST", "/timesheets/{timesheet}/approve"),
    ("POST", "/timesheets/{timesheet}/reject"),
    ("POST", "/timesheets/{timesheet}/reopen"),
]
# What stays with managers.
EXPENSE_DECISIONS = [
    ("POST", "/expenses/{expense}/approve"),
    ("POST", "/expenses/{expense}/reject"),
    ("POST", "/expenses/{expense}/reopen"),
]
INVOICE_READS = [
    ("GET", "/invoices"),
    ("GET", "/invoices/{invoice}"),
]
EVERYTHING = SITE_READS + SITE_WRITES + TIMESHEET_DECISIONS + EXPENSE_DECISIONS + INVOICE_READS


@dataclass(frozen=True, slots=True)
class Records:
    """An organization with one of each record, and the ids that go into the paths."""

    organization: Organization
    ids: dict[str, str]


@pytest.fixture
def records(factory: Factory) -> Records:
    organization = factory.organization()
    employee, building = factory.employee(organization), factory.building(organization)
    rows = {
        "work_order": factory.work_order(organization, building),
        "shift": factory.shift(employee, building),
        "timesheet": factory.timesheet(employee, building),
        "expense": factory.expense(organization),
        "invoice": factory.invoice(organization),
    }
    return Records(organization, {name: str(row.id) for name, row in rows.items()})


def _call(actor: Actor, records: Records, method: str, path: str) -> Response:
    # An empty body is enough: permission is decided before the body is looked at.
    body = {} if method in {"POST", "PATCH"} else None
    return actor.client.request(
        method, API + path.format(**records.ids), headers=actor.headers, json=body
    )


def _statuses(actor: Actor, records: Records, endpoints: list[tuple[str, str]]) -> set[int]:
    return {_call(actor, records, method, path).status_code for method, path in endpoints}


@pytest.mark.parametrize("role", [Role.COMPANY_ADMIN, Role.OPERATIONS_MANAGER])
def test_admins_and_operations_managers_have_full_access(
    make_actor: ActorFactory, records: Records, role: Role
):
    manager = make_actor(role, organization=records.organization)

    assert _statuses(manager, records, SITE_READS + INVOICE_READS) == {200}
    # Whatever each write answers to an empty body, it is not a refusal.
    writes = SITE_WRITES + TIMESHEET_DECISIONS + EXPENSE_DECISIONS
    assert _statuses(manager, records, writes).isdisjoint({401, 403})


def test_supervisors_run_their_sites_but_do_not_approve_spending_or_see_invoices(
    make_actor: ActorFactory, records: Records
):
    supervisor = make_actor(Role.SUPERVISOR, organization=records.organization)

    assert _statuses(supervisor, records, SITE_READS) == {200}
    assert _statuses(supervisor, records, SITE_WRITES + TIMESHEET_DECISIONS).isdisjoint({401, 403})
    assert _statuses(supervisor, records, EXPENSE_DECISIONS + INVOICE_READS) == {403}
    refused = _call(supervisor, records, "GET", "/invoices")
    assert problem(refused)["code"] == "permission_denied"


@pytest.mark.parametrize("role", [Role.EMPLOYEE, Role.CUSTOMER, Role.VENDOR])
def test_other_roles_have_no_access_to_operational_records(
    make_actor: ActorFactory, records: Records, role: Role
):
    member = make_actor(role, organization=records.organization)

    assert _statuses(member, records, EVERYTHING) == {403}


def test_operational_records_need_a_signed_in_user(client: TestClient, records: Records):
    for method, path in EVERYTHING:
        response = client.request(method, API + path.format(**records.ids))
        assert response.status_code == 401, (method, path)


def test_a_refusal_changes_nothing(make_actor: ActorFactory, records: Records):
    employee = make_actor(Role.EMPLOYEE, organization=records.organization)
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=records.organization)

    _statuses(employee, records, SITE_WRITES + TIMESHEET_DECISIONS + EXPENSE_DECISIONS)

    def status(path: str) -> str:
        return manager.get(API + path.format(**records.ids)).json()["status"]

    assert status("/work-orders/{work_order}") == "open"
    assert status("/shifts/{shift}") == "scheduled"
    assert status("/timesheets/{timesheet}") == status("/expenses/{expense}") == "pending"
    assert manager.get(f"{API}/work-orders").json()["total"] == 1


def test_a_platform_admin_works_with_the_organization_they_have_entered(
    make_actor: ActorFactory, records: Records, factory: Factory
):
    factory.work_order(factory.organization())  # another organization's work order
    platform_admin = make_actor(platform_admin=True)
    assert platform_admin.get(f"{API}/work-orders").status_code == 403  # not inside one yet

    platform_admin.post(
        f"{API}/auth/switch-organization",
        json={"organization_id": str(records.organization.id)},
    )

    listed = platform_admin.get(f"{API}/work-orders").json()
    assert [item["id"] for item in listed["items"]] == [records.ids["work_order"]]
    assert _statuses(platform_admin, records, SITE_READS + INVOICE_READS) == {200}
    # They have no employee record here, so the time they approve is never their own.
    approved = platform_admin.post(f"{API}/timesheets/{records.ids['timesheet']}/approve")
    assert approved.status_code == 200
    assert approved.json()["decided_by_name"] == platform_admin.user.full_name
