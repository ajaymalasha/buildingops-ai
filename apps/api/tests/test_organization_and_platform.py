import uuid

from fastapi.testclient import TestClient

from buildingops.core.permissions import Role
from tests.conftest import ActorFactory, Factory, problem, sign_in

ORGANIZATION = "/api/v1/organization"
PLATFORM = "/api/v1/platform/organizations"


# --- the active organization -------------------------------------------------------------


def test_any_member_can_read_their_organization(make_actor: ActorFactory):
    employee = make_actor(Role.EMPLOYEE)

    body = employee.get(ORGANIZATION).json()

    assert body["id"] == str(employee.organization.id)
    assert body["timezone"] == "America/New_York"


def test_admin_updates_the_profile_and_the_change_is_audited(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)

    response = admin.patch(
        ORGANIZATION, json={"legal_name": "Renamed Holdings, LLC", "timezone": "America/Chicago"}
    )

    assert response.status_code == 200
    assert response.json()["legal_name"] == "Renamed Holdings, LLC"
    entry = admin.get("/api/v1/audit-logs", params={"action": "organization.updated"}).json()[
        "items"
    ][0]
    assert entry["changes"] == {
        "legal_name": {"from": None, "to": "Renamed Holdings, LLC"},
        "timezone": {"from": "America/New_York", "to": "America/Chicago"},
    }


def test_profile_values_are_validated(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)

    response = admin.patch(ORGANIZATION, json={"timezone": "Mars/Olympus", "currency": "usd"})

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {"timezone", "currency"}


def test_only_admins_can_update_the_profile(make_actor: ActorFactory):
    manager = make_actor(Role.OPERATIONS_MANAGER)

    assert manager.patch(ORGANIZATION, json={"name": "Takeover"}).status_code == 403


# --- platform administration -------------------------------------------------------------


def test_platform_endpoints_are_for_platform_admins_only(make_actor: ActorFactory):
    company_admin = make_actor(Role.COMPANY_ADMIN)

    assert company_admin.get(PLATFORM).status_code == 403
    assert company_admin.post(PLATFORM, json={}).status_code == 403


def test_platform_admin_lists_organizations_with_member_counts(
    make_actor: ActorFactory, factory: Factory
):
    organization = factory.organization(name=f"Countable {uuid.uuid4().hex[:8]}")
    factory.member(organization, Role.COMPANY_ADMIN)
    factory.member(organization, Role.EMPLOYEE)
    admin = make_actor(platform_admin=True)

    body = admin.get(PLATFORM, params={"q": organization.name}).json()

    assert body["total"] == 1
    assert body["items"][0]["id"] == str(organization.id)
    assert body["items"][0]["member_count"] == 2


def test_platform_admin_creates_an_organization_with_its_first_admin(
    client: TestClient, make_actor: ActorFactory
):
    admin = make_actor(platform_admin=True)
    suffix = uuid.uuid4().hex[:8]
    email = f"owner-{suffix}@buildingops.example"

    response = admin.post(
        PLATFORM,
        json={
            "name": f"Harbor & Co. {suffix}",
            "timezone": "America/Los_Angeles",
            "admin_email": email,
            "admin_full_name": "Olive Harbor",
            "admin_password": "a-solid-initial-password",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["slug"] == f"harbor-co-{suffix}"
    assert created["member_count"] == 1

    token = sign_in(client, email, "a-solid-initial-password")
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["organization"]["id"] == created["id"]
    assert me["role"] == "company_admin"


def test_organization_identifiers_are_unique(make_actor: ActorFactory, factory: Factory):
    existing = factory.organization()
    admin = make_actor(platform_admin=True)

    response = admin.post(
        PLATFORM,
        json={
            "name": "Another Company",
            "slug": existing.slug,
            "admin_email": f"owner-{uuid.uuid4().hex[:8]}@buildingops.example",
            "admin_full_name": "Someone",
            "admin_password": "a-solid-initial-password",
        },
    )

    assert response.status_code == 409
    assert problem(response)["errors"][0]["field"] == "slug"


def test_suspending_an_organization_cuts_off_its_members(make_actor: ActorFactory):
    member = make_actor(Role.COMPANY_ADMIN)
    platform_admin = make_actor(platform_admin=True)
    assert member.get(ORGANIZATION).status_code == 200

    response = platform_admin.patch(
        f"{PLATFORM}/{member.organization.id}", json={"status": "suspended"}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "suspended"
    assert member.get(ORGANIZATION).status_code == 403
    assert member.get("/api/v1/auth/me").json()["organization"] is None

    platform_admin.patch(f"{PLATFORM}/{member.organization.id}", json={"status": "active"})
    assert member.get(ORGANIZATION).status_code == 200


def test_a_platform_admin_outside_any_organization_has_no_tenant_access(make_actor: ActorFactory):
    admin = make_actor(platform_admin=True)

    assert admin.get("/api/v1/members").status_code == 403
    assert admin.get(ORGANIZATION).status_code == 403
