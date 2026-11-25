"""Test fixtures.

Tests run against a real PostgreSQL database with the same two roles as production. The
schema is rebuilt from the migrations once per run as the owner role, and the application
under test connects as the app role, so row-level security is exercised for real.

Isolation between tests comes from tenancy itself: each test creates its own organizations
and users with unique names and emails, so nothing has to be cleaned up afterwards.
"""

import os
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx2 import Response
from sqlalchemy import text
from sqlalchemy.engine import make_url

from buildingops.core.config import Settings
from buildingops.core.db import Database
from buildingops.core.permissions import Role
from buildingops.core.security import PasswordService
from buildingops.main import create_app
from buildingops.modules.identity.models import (
    Membership,
    MembershipStatus,
    Organization,
    OrganizationStatus,
    User,
)

API_ROOT = Path(__file__).resolve().parents[1]
PASSWORD = "correct-horse-battery"

_TEST_ADMIN_URL = os.environ.get(
    "TEST_DATABASE_ADMIN_URL",
    "postgresql+psycopg://buildingops_owner:buildingops_owner@localhost:5432/buildingops_test",
)
_TEST_APP_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg://buildingops_app:buildingops_app@localhost:5432/buildingops_test",
)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "log_level": "WARNING",
        "database_url": _TEST_APP_URL,
        "database_admin_url": _TEST_ADMIN_URL,
        "database_pool_size": 5,
        "password_hash_time_cost": 1,
        "password_hash_memory_kib": 64,
        # Every test signs in from the same address; the per-address limit is tested separately.
        "login_max_failures_per_ip": 100_000,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture(scope="session")
def settings() -> Settings:
    return make_settings()


def alembic_config(settings: Settings) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.attributes["database_admin_url"] = settings.database_admin_url
    config.attributes["database_app_role"] = settings.database_app_role
    return config


@pytest.fixture(scope="session")
def admin_database(settings: Settings) -> Iterator[Database]:
    """The owner-role connection. Rebuilds the schema from migrations for this run."""
    name = make_url(settings.database_admin_url).database or ""
    if not name.endswith("_test"):
        raise RuntimeError(f"Refusing to rebuild '{name}': the test database must end in _test")

    database = Database(
        settings.database_admin_url,
        pool_size=2,
        max_overflow=2,
        application_name="buildingops-tests-owner",
    )
    try:
        with database.engine.begin() as connection:
            connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))

        config = alembic_config(settings)
        command.upgrade(config, "head")
        # Every migration's downgrade has to work, so run the whole chain down and up again.
        command.downgrade(config, "base")
        command.upgrade(config, "head")

        yield database
    finally:
        database.dispose()


@pytest.fixture(scope="session")
def app_database(settings: Settings, admin_database: Database) -> Iterator[Database]:
    """An app-role connection for tests that talk to the database directly."""
    database = Database(
        settings.database_url, pool_size=2, max_overflow=2, application_name="buildingops-tests-app"
    )
    yield database
    database.dispose()


@pytest.fixture(scope="session")
def passwords(settings: Settings) -> PasswordService:
    return PasswordService(
        time_cost=settings.password_hash_time_cost,
        memory_kib=settings.password_hash_memory_kib,
        min_length=settings.password_min_length,
    )


@pytest.fixture(scope="session")
def app(settings: Settings, admin_database: Database) -> FastAPI:
    return create_app(settings)


@pytest.fixture(scope="session")
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


class Factory:
    """Creates rows as the owner role, bypassing row-level security on purpose."""

    def __init__(self, database: Database, passwords: PasswordService) -> None:
        self._database = database
        self._password_hash = passwords.hash(PASSWORD)

    def organization(
        self,
        *,
        name: str | None = None,
        status: OrganizationStatus = OrganizationStatus.ACTIVE,
    ) -> Organization:
        suffix = uuid.uuid4().hex[:12]
        organization = Organization(
            name=name or f"Test Org {suffix}",
            slug=f"test-{suffix}",
            timezone="America/New_York",
            currency="USD",
            status=status,
        )
        return self._save(organization)

    def user(
        self,
        *,
        full_name: str | None = None,
        email: str | None = None,
        is_platform_admin: bool = False,
        is_active: bool = True,
    ) -> User:
        suffix = uuid.uuid4().hex[:12]
        user = User(
            email=email or f"user-{suffix}@buildingops.example",
            full_name=full_name or f"Test User {suffix}",
            password_hash=self._password_hash,
            is_platform_admin=is_platform_admin,
            is_active=is_active,
        )
        return self._save(user)

    def membership(
        self,
        organization: Organization,
        user: User,
        role: Role = Role.COMPANY_ADMIN,
        *,
        status: MembershipStatus = MembershipStatus.ACTIVE,
        title: str | None = None,
    ) -> Membership:
        membership = Membership(
            organization_id=organization.id, user_id=user.id, role=role, status=status, title=title
        )
        return self._save(membership)

    def member(
        self, organization: Organization, role: Role = Role.EMPLOYEE, **user_fields: Any
    ) -> tuple[User, Membership]:
        user = self.user(**user_fields)
        return user, self.membership(organization, user, role)

    def _save[M](self, instance: M) -> M:
        with self._database.session() as db:
            db.add(instance)
            db.commit()
        return instance


@pytest.fixture(scope="session")
def factory(admin_database: Database, passwords: PasswordService) -> Factory:
    return Factory(admin_database, passwords)


def sign_in(client: TestClient, email: str, password: str = PASSWORD) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    token: str = response.json()["session_token"]
    return token


@dataclass(slots=True)
class Actor:
    """A signed-in user making API calls."""

    client: TestClient
    token: str
    user: User
    organization: Organization | None
    membership: Membership | None

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def get(self, path: str, **kwargs: Any) -> Response:
        return self.client.get(path, headers=self.headers, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Response:
        return self.client.post(path, headers=self.headers, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Response:
        return self.client.patch(path, headers=self.headers, **kwargs)


ActorFactory = Callable[..., Actor]


@pytest.fixture
def make_actor(client: TestClient, factory: Factory) -> ActorFactory:
    """Create a user with a role in an organization (a new one by default) and sign them in."""

    def _make(
        role: Role = Role.COMPANY_ADMIN,
        *,
        organization: Organization | None = None,
        platform_admin: bool = False,
    ) -> Actor:
        user = factory.user(is_platform_admin=platform_admin)
        membership = None
        if not platform_admin:
            organization = organization or factory.organization()
            membership = factory.membership(organization, user, role)
        return Actor(
            client=client,
            token=sign_in(client, user.email),
            user=user,
            organization=organization,
            membership=membership,
        )

    return _make


def problem(response: Response) -> dict[str, Any]:
    """Assert the response is a problem document and return it without the request id."""
    assert response.headers["content-type"].startswith("application/problem+json"), response.text
    body: dict[str, Any] = response.json()
    assert body["status"] == response.status_code
    body.pop("request_id", None)
    return body
