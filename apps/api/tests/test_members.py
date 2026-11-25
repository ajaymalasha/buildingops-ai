from fastapi.testclient import TestClient

from buildingops.core.permissions import Role
from tests.conftest import PASSWORD, ActorFactory, Factory, problem, sign_in

MEMBERS = "/api/v1/members"


def _new_member(**overrides):
    payload = {
        "email": "new.person@buildingops.example",
        "full_name": "New Person",
        "role": "supervisor",
        "title": "Night Supervisor",
        "password": "a-solid-initial-password",
    }
    payload.update(overrides)
    return payload


def test_listing_shows_only_the_active_organizations_members(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor(Role.COMPANY_ADMIN)
    colleague, _ = factory.member(admin.organization, Role.EMPLOYEE)
    factory.member(factory.organization(), Role.EMPLOYEE)  # someone else's employee

    body = admin.get(MEMBERS).json()

    assert body["total"] == 2
    assert {item["user_id"] for item in body["items"]} == {str(admin.user.id), str(colleague.id)}


def test_listing_supports_search_filters_sorting_and_paging(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor(Role.COMPANY_ADMIN)
    for name in ("Zed Alvarez", "Amy Alvarez", "Bob Stone"):
        factory.member(admin.organization, Role.EMPLOYEE, full_name=name)

    searched = admin.get(MEMBERS, params={"q": "alvarez", "sort": "-name"}).json()
    assert [item["full_name"] for item in searched["items"]] == ["Zed Alvarez", "Amy Alvarez"]

    employees = admin.get(MEMBERS, params={"role": "employee", "page_size": 2, "page": 2}).json()
    assert employees["total"] == 3
    assert [item["full_name"] for item in employees["items"]] == ["Zed Alvarez"]

    # LIKE wildcards in the search text are matched literally, not as patterns.
    assert admin.get(MEMBERS, params={"q": "%"}).json()["total"] == 0


def test_sorting_by_an_unknown_field_is_rejected(make_actor: ActorFactory):
    response = make_actor().get(MEMBERS, params={"sort": "password_hash"})

    assert response.status_code == 422
    assert problem(response)["errors"][0]["field"] == "sort"


def test_admin_adds_a_member_who_can_then_sign_in(client: TestClient, make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)
    email = f"hire-{admin.user.id.hex[:8]}@buildingops.example"

    response = admin.post(MEMBERS, json=_new_member(email=email))

    assert response.status_code == 201
    created = response.json()
    assert created["existing_account"] is False
    assert (created["role"], created["status"], created["title"]) == (
        "supervisor",
        "active",
        "Night Supervisor",
    )
    assert "password" not in created

    token = sign_in(client, email, "a-solid-initial-password")
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["organization"]["id"] == str(admin.organization.id)
    assert me["role"] == "supervisor"


def test_adding_someone_with_an_existing_account_only_adds_access(
    client: TestClient, make_actor: ActorFactory, factory: Factory
):
    """An administrator must not be able to rename or re-password another company's user."""
    admin = make_actor(Role.COMPANY_ADMIN)
    existing, _ = factory.member(factory.organization(), Role.EMPLOYEE, full_name="Real Name")

    response = admin.post(
        MEMBERS,
        json=_new_member(
            email=existing.email, full_name="Different Name", password="hijack-attempt-1"
        ),
    )

    assert response.status_code == 201
    assert response.json()["existing_account"] is True
    assert response.json()["full_name"] == "Real Name"
    assert (
        client.post(
            "/api/v1/auth/login", json={"email": existing.email, "password": "hijack-attempt-1"}
        ).status_code
        == 401
    )
    sign_in(client, existing.email, PASSWORD)  # their own password still works


def test_adding_an_existing_member_again_is_a_conflict(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(Role.COMPANY_ADMIN)
    colleague, _ = factory.member(admin.organization, Role.EMPLOYEE)

    response = admin.post(MEMBERS, json=_new_member(email=colleague.email))

    assert response.status_code == 409
    assert problem(response)["errors"][0]["field"] == "email"


def test_a_new_account_needs_a_password_that_meets_the_policy(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)
    email = f"weak-{admin.user.id.hex[:8]}@buildingops.example"

    missing = admin.post(MEMBERS, json=_new_member(email=email, password=None))
    weak = admin.post(MEMBERS, json=_new_member(email=email, password="short"))

    assert missing.status_code == weak.status_code == 422
    assert problem(missing)["errors"][0]["code"] == "password_required"
    assert problem(weak)["errors"][0]["code"] == "password_too_short"
    assert admin.get(MEMBERS, params={"q": email}).json()["total"] == 0  # nothing was created


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)

    response = admin.post(
        MEMBERS,
        json=_new_member(email="not-an-email", role="platform_admin", unexpected="field"),
    )

    assert response.status_code == 422
    fields = {error["field"] for error in problem(response)["errors"]}
    assert fields == {"email", "role", "unexpected"}


def test_only_company_admins_can_manage_members(make_actor: ActorFactory, factory: Factory):
    organization = factory.organization()
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)
    employee = make_actor(Role.EMPLOYEE, organization=organization)

    assert manager.get(MEMBERS).status_code == 200
    assert supervisor.get(MEMBERS).status_code == 200
    assert employee.get(MEMBERS).status_code == 403

    denied = manager.post(MEMBERS, json=_new_member())
    assert denied.status_code == 403
    assert problem(denied)["code"] == "permission_denied"
    assert (
        manager.patch(
            f"{MEMBERS}/{employee.membership.id}", json={"role": "supervisor"}
        ).status_code
        == 403
    )


def test_changing_a_role_is_recorded_in_the_audit_log(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(Role.COMPANY_ADMIN)
    _, membership = factory.member(admin.organization, Role.EMPLOYEE, full_name="Sam Rivera")

    response = admin.patch(f"{MEMBERS}/{membership.id}", json={"role": "supervisor"})

    assert response.status_code == 200
    assert response.json()["role"] == "supervisor"
    entry = admin.get(
        "/api/v1/audit-logs", params={"entity_type": "member", "entity_id": str(membership.id)}
    ).json()["items"][0]
    assert entry["action"] == "member.updated"
    assert entry["summary"] == "Changed Sam Rivera's role to supervisor"
    assert entry["changes"] == {"role": {"from": "employee", "to": "supervisor"}}
    assert entry["actor_user_id"] == str(admin.user.id)


def test_an_update_that_changes_nothing_writes_no_audit_entry(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor(Role.COMPANY_ADMIN)
    _, membership = factory.member(admin.organization, Role.EMPLOYEE)

    assert admin.patch(f"{MEMBERS}/{membership.id}", json={"role": "employee"}).status_code == 200

    entries = admin.get("/api/v1/audit-logs", params={"entity_type": "member"}).json()
    assert entries["total"] == 0


def test_admins_cannot_change_their_own_role_or_status(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)

    demote = admin.patch(f"{MEMBERS}/{admin.membership.id}", json={"role": "employee"})
    suspend = admin.patch(f"{MEMBERS}/{admin.membership.id}", json={"status": "suspended"})
    retitle = admin.patch(f"{MEMBERS}/{admin.membership.id}", json={"title": "Head of Ops"})

    assert demote.status_code == suspend.status_code == 409
    assert retitle.status_code == 200


def test_an_organization_always_keeps_one_active_admin(make_actor: ActorFactory, factory: Factory):
    organization = factory.organization()
    first = make_actor(Role.COMPANY_ADMIN, organization=organization)
    second = make_actor(Role.COMPANY_ADMIN, organization=organization)

    # With two administrators, one may demote the other.
    assert (
        first.patch(
            f"{MEMBERS}/{second.membership.id}", json={"role": "operations_manager"}
        ).status_code
        == 200
    )

    # A platform administrator acting in the organization still cannot remove the last one.
    platform_admin = make_actor(platform_admin=True)
    platform_admin.post(
        "/api/v1/auth/switch-organization", json={"organization_id": str(organization.id)}
    )
    last = platform_admin.patch(f"{MEMBERS}/{first.membership.id}", json={"status": "suspended"})

    assert last.status_code == 409
    assert "at least one active company administrator" in problem(last)["detail"]


def test_members_of_another_organization_are_not_found(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(Role.COMPANY_ADMIN)
    _, foreign = factory.member(factory.organization(), Role.EMPLOYEE)

    assert admin.get(f"{MEMBERS}/{foreign.id}").status_code == 404
    assert admin.patch(f"{MEMBERS}/{foreign.id}", json={"role": "company_admin"}).status_code == 404
