from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from buildingops.core.db import Database
from buildingops.core.models import utcnow
from buildingops.core.permissions import Role
from buildingops.main import create_app
from tests.conftest import ActorFactory, Factory, make_settings, problem

AUDIT = "/api/v1/audit-logs"


# --- audit log ---------------------------------------------------------------------------


def test_the_audit_log_is_scoped_to_the_active_organization(make_actor: ActorFactory):
    alpha = make_actor(Role.COMPANY_ADMIN)
    bravo = make_actor(Role.COMPANY_ADMIN)
    alpha.patch("/api/v1/organization", json={"legal_name": "Alpha Legal"})

    alpha_actions = [entry["action"] for entry in alpha.get(AUDIT).json()["items"]]
    bravo_actions = [entry["action"] for entry in bravo.get(AUDIT).json()["items"]]

    assert alpha_actions == ["organization.updated", "auth.signed_in"]  # newest first
    assert bravo_actions == ["auth.signed_in"]


def test_the_audit_log_can_be_filtered(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(Role.COMPANY_ADMIN)
    _, membership = factory.member(admin.organization, Role.EMPLOYEE, full_name="Jo Park")
    admin.patch(f"/api/v1/members/{membership.id}", json={"title": "Porter"})
    admin.patch("/api/v1/organization", json={"legal_name": "Filtered LLC"})

    def actions(**params) -> list[str]:
        return [entry["action"] for entry in admin.get(AUDIT, params=params).json()["items"]]

    assert actions(action="member") == ["member.updated"]
    assert actions(action="member.updated") == ["member.updated"]
    assert actions(entity_type="organization") == ["organization.updated"]
    assert actions(q="jo park") == ["member.updated"]
    assert actions(actor_user_id=str(admin.user.id), page_size=1) == ["organization.updated"]
    tomorrow = (utcnow() + timedelta(days=1)).isoformat()
    assert actions(since=tomorrow) == []


def test_reading_the_audit_log_needs_permission(make_actor: ActorFactory):
    assert make_actor(Role.OPERATIONS_MANAGER).get(AUDIT).status_code == 200
    assert make_actor(Role.SUPERVISOR).get(AUDIT).status_code == 403
    assert make_actor(Role.EMPLOYEE).get(AUDIT).status_code == 403


def test_a_failed_request_leaves_no_audit_entry(make_actor: ActorFactory):
    """The entry is part of the same transaction as the change it describes."""
    admin = make_actor(Role.COMPANY_ADMIN)

    assert (
        admin.patch(f"/api/v1/members/{admin.membership.id}", json={"role": "employee"}).status_code
        == 409
    )

    assert admin.get(AUDIT, params={"entity_type": "member"}).json()["total"] == 0


# --- error contract and request handling -------------------------------------------------


def test_health_endpoints(client: TestClient):
    assert client.get("/healthz").json()["status"] == "ok"
    assert client.get("/readyz").json() == {"status": "ok", "database": "ok"}


def test_unknown_routes_return_a_problem_document(client: TestClient):
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert problem(response)["code"] == "not_found"


def test_malformed_requests_return_field_errors(client: TestClient):
    response = client.post("/api/v1/auth/login", json={"email": "a@b.co"})

    assert response.status_code == 422
    body = problem(response)
    assert body["code"] == "validation_error"
    assert body["errors"] == [{"field": "password", "message": "Field required", "code": "missing"}]


def test_unexpected_errors_are_reported_without_leaking_details(admin_database: Database):
    app: FastAPI = create_app(make_settings())

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internal detail")

    with TestClient(app) as isolated:
        response = isolated.get("/boom", headers={"X-Request-ID": "trace-789"})

    assert response.status_code == 500
    assert problem(response)["code"] == "internal_error"
    assert "secret internal detail" not in response.text
    assert response.headers["x-request-id"] == "trace-789"
    assert response.json()["request_id"] == "trace-789"


def test_request_ids_are_echoed_or_generated(client: TestClient):
    supplied = client.get("/healthz", headers={"X-Request-ID": "trace-123.abc"})
    unsafe = client.get("/healthz", headers={"X-Request-ID": "bad id\twith spaces"})
    generated = client.get("/healthz")

    assert supplied.headers["x-request-id"] == "trace-123.abc"
    assert unsafe.headers["x-request-id"] != "bad id\twith spaces"
    assert len(generated.headers["x-request-id"]) == 32


def test_error_bodies_carry_the_request_id(client: TestClient):
    response = client.get("/api/v1/auth/me", headers={"X-Request-ID": "trace-456"})

    assert response.json()["request_id"] == "trace-456"


def test_api_responses_are_not_cacheable(make_actor: ActorFactory):
    response = make_actor().get("/api/v1/organization")

    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
