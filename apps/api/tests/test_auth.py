import uuid
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from buildingops.core.db import Database
from buildingops.core.models import utcnow
from buildingops.core.permissions import ROLE_PERMISSIONS, Role
from buildingops.core.security import hash_session_token
from buildingops.main import create_app
from buildingops.modules.identity.models import AuthSession, Membership, MembershipStatus, User
from tests.conftest import PASSWORD, ActorFactory, Factory, make_settings, problem, sign_in

LOGIN = "/api/v1/auth/login"
ME = "/api/v1/auth/me"


def _login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post(LOGIN, json={"email": email, "password": password})


def test_login_returns_a_token_and_the_callers_profile(client: TestClient, factory: Factory):
    organization = factory.organization()
    user = factory.user()
    factory.membership(organization, user, Role.OPERATIONS_MANAGER)

    response = _login(client, user.email.upper())  # emails are case-insensitive

    assert response.status_code == 200
    body = response.json()
    assert body["me"]["user"]["email"] == user.email
    assert body["me"]["organization"]["id"] == str(organization.id)
    assert body["me"]["role"] == "operations_manager"
    assert body["me"]["permissions"] == sorted(ROLE_PERMISSIONS[Role.OPERATIONS_MANAGER])
    assert [m["organization"]["id"] for m in body["me"]["memberships"]] == [str(organization.id)]

    me = client.get(ME, headers={"Authorization": f"Bearer {body['session_token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["id"] == str(user.id)


def test_wrong_password_and_unknown_email_get_the_same_answer(client: TestClient, factory: Factory):
    user = factory.user()

    wrong_password = _login(client, user.email, "not-the-password")
    unknown_email = _login(client, f"nobody-{uuid.uuid4().hex}@buildingops.example", "whatever")

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert problem(wrong_password) == problem(unknown_email)
    assert problem(wrong_password)["code"] == "invalid_credentials"


def test_a_deactivated_user_cannot_sign_in(client: TestClient, factory: Factory):
    user = factory.user(is_active=False)

    response = _login(client, user.email)

    assert response.status_code == 401
    assert problem(response)["code"] == "invalid_credentials"


def test_sign_in_is_throttled_after_repeated_failures(client: TestClient, factory: Factory):
    user = factory.user()
    for _ in range(5):
        assert _login(client, user.email, "wrong").status_code == 401

    # Even the correct password is refused while the account is throttled.
    response = _login(client, user.email)

    assert response.status_code == 429
    assert problem(response)["code"] == "rate_limited"
    assert 1 <= int(response.headers["retry-after"]) <= 15 * 60


def test_a_successful_sign_in_resets_the_failure_count(client: TestClient, factory: Factory):
    user = factory.user()
    for _ in range(4):
        assert _login(client, user.email, "wrong").status_code == 401
    assert _login(client, user.email).status_code == 200

    for _ in range(4):
        assert _login(client, user.email, "wrong").status_code == 401
    assert _login(client, user.email).status_code == 200


def test_sign_in_is_throttled_per_address(admin_database: Database):
    app = create_app(make_settings(login_max_failures_per_ip=3))
    address = f"198.51.100.{uuid.uuid4().int % 250 + 1}"
    with TestClient(app, client=(address, 50000)) as isolated:
        for _ in range(3):
            email = f"nobody-{uuid.uuid4().hex}@buildingops.example"
            assert _login(isolated, email, "wrong").status_code == 401

        response = _login(isolated, f"nobody-{uuid.uuid4().hex}@buildingops.example", "wrong")

    assert response.status_code == 429


def test_requests_without_a_valid_token_are_rejected(client: TestClient):
    missing = client.get(ME)
    invalid = client.get(ME, headers={"Authorization": "Bearer not-a-real-token"})

    assert missing.status_code == invalid.status_code == 401
    assert problem(missing)["code"] == "unauthenticated"
    assert missing.headers["www-authenticate"] == "Bearer"


def test_only_a_hash_of_the_session_token_is_stored(
    client: TestClient, factory: Factory, admin_database: Database
):
    user = factory.user()
    token = sign_in(client, user.email)

    with admin_database.session() as db:
        stored = db.scalars(
            select(AuthSession.token_hash).where(AuthSession.user_id == user.id)
        ).all()

    assert stored == [hash_session_token(token)]
    assert token not in stored


def test_sign_out_ends_the_session(make_actor: ActorFactory):
    actor = make_actor()

    assert actor.post("/api/v1/auth/logout").status_code == 204

    assert actor.get(ME).status_code == 401


def test_an_idle_session_expires(make_actor: ActorFactory, admin_database: Database):
    actor = make_actor()
    long_ago = utcnow() - timedelta(days=8)  # the idle limit is 7 days
    with admin_database.session() as db:
        db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == actor.user.id)
            .values(last_seen_at=long_ago)
        )
        db.commit()

    assert actor.get(ME).status_code == 401


def test_a_session_ends_at_its_absolute_limit(make_actor: ActorFactory, admin_database: Database):
    actor = make_actor()
    with admin_database.session() as db:
        db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == actor.user.id)
            .values(expires_at=utcnow() - timedelta(seconds=1))
        )
        db.commit()

    assert actor.get(ME).status_code == 401


def test_deactivating_a_user_ends_their_session_immediately(
    make_actor: ActorFactory, admin_database: Database
):
    actor = make_actor()
    with admin_database.session() as db:
        db.execute(update(User).where(User.id == actor.user.id).values(is_active=False))
        db.commit()

    assert actor.get(ME).status_code == 401


def test_suspending_a_membership_removes_access_immediately(
    make_actor: ActorFactory, admin_database: Database
):
    actor = make_actor(Role.COMPANY_ADMIN)
    assert actor.get("/api/v1/members").status_code == 200
    with admin_database.session() as db:
        db.execute(
            update(Membership)
            .where(Membership.id == actor.membership.id)
            .values(status=MembershipStatus.SUSPENDED)
        )
        db.commit()

    assert actor.get("/api/v1/members").status_code == 403
    me = actor.get(ME).json()
    assert me["organization"] is None
    assert me["permissions"] == []


def test_switching_organization_changes_role_and_data_scope(client: TestClient, factory: Factory):
    alpha = factory.organization(name="Alpha Services")
    bravo = factory.organization(name="Bravo Services")
    user = factory.user()
    factory.membership(alpha, user, Role.COMPANY_ADMIN)
    factory.membership(bravo, user, Role.EMPLOYEE)
    headers = {"Authorization": f"Bearer {sign_in(client, user.email)}"}

    # The first organization by name is active after sign-in.
    assert client.get("/api/v1/organization", headers=headers).json()["id"] == str(alpha.id)

    switched = client.post(
        "/api/v1/auth/switch-organization", headers=headers, json={"organization_id": str(bravo.id)}
    )

    assert switched.status_code == 200
    assert switched.json()["role"] == "employee"
    assert client.get("/api/v1/organization", headers=headers).json()["id"] == str(bravo.id)
    assert client.get("/api/v1/members", headers=headers).status_code == 403  # employee in Bravo


def test_cannot_switch_to_an_organization_you_do_not_belong_to(
    make_actor: ActorFactory, factory: Factory
):
    actor = make_actor()
    other = factory.organization()

    response = actor.post(
        "/api/v1/auth/switch-organization", json={"organization_id": str(other.id)}
    )

    assert response.status_code == 404
    assert actor.get("/api/v1/organization").json()["id"] == str(actor.organization.id)


def test_platform_admin_can_enter_any_organization_and_it_is_audited(
    make_actor: ActorFactory, factory: Factory
):
    organization = factory.organization()
    admin = make_actor(platform_admin=True)
    assert admin.get(ME).json()["organization"] is None

    entered = admin.post(
        "/api/v1/auth/switch-organization", json={"organization_id": str(organization.id)}
    )

    assert entered.status_code == 200
    assert entered.json()["role"] == "platform_admin"
    entries = admin.get("/api/v1/audit-logs", params={"action": "platform"}).json()["items"]
    assert [entry["action"] for entry in entries] == ["platform.organization_entered"]


def test_changing_password_requires_the_current_one(make_actor: ActorFactory):
    actor = make_actor()

    response = actor.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong", "new_password": "a-much-better-password"},
    )

    assert response.status_code == 422
    assert problem(response)["errors"][0]["field"] == "current_password"


def test_new_password_must_meet_the_policy(make_actor: ActorFactory):
    actor = make_actor()

    response = actor.post(
        "/api/v1/auth/change-password", json={"current_password": PASSWORD, "new_password": "short"}
    )

    assert response.status_code == 422
    assert problem(response)["errors"][0] == {
        "field": "new_password",
        "message": "Use at least 10 characters.",
        "code": "password_too_short",
    }


def test_changing_password_signs_out_other_sessions(client: TestClient, make_actor: ActorFactory):
    actor = make_actor()
    other_session = {"Authorization": f"Bearer {sign_in(client, actor.user.email)}"}
    new_password = "a-much-better-password"

    response = actor.post(
        "/api/v1/auth/change-password",
        json={"current_password": PASSWORD, "new_password": new_password},
    )

    assert response.status_code == 204
    assert actor.get(ME).status_code == 200  # the session that made the change stays signed in
    assert client.get(ME, headers=other_session).status_code == 401
    assert _login(client, actor.user.email, PASSWORD).status_code == 401
    assert _login(client, actor.user.email, new_password).status_code == 200
