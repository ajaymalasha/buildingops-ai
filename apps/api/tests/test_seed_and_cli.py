import json
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from buildingops import cli
from buildingops.core.config import Settings
from buildingops.core.db import Database
from buildingops.core.security import PasswordService
from buildingops.modules.identity.models import Membership, Organization, User
from buildingops.seed import demo
from tests.conftest import sign_in

DEMO_PASSWORD = "seeded-demo-password"


def _seed(admin_database: Database, passwords: PasswordService) -> demo.SeedReport:
    with admin_database.session() as db:
        report = demo.seed_identity(db, passwords, DEMO_PASSWORD)
        db.commit()
    return report


def test_seed_creates_the_demo_organizations_and_accounts_once(
    admin_database: Database, passwords: PasswordService, client: TestClient
):
    first = _seed(admin_database, passwords)
    second = _seed(admin_database, passwords)

    assert (first.organizations_created, first.users_created) == (
        len(demo.ORGANIZATIONS),
        len(demo.ACCOUNTS),
    )
    assert first.memberships_created == sum(len(a.memberships) for a in demo.ACCOUNTS)
    # Running it again changes nothing.
    assert (second.organizations_created, second.users_created, second.memberships_created) == (
        0,
        0,
        0,
    )

    slugs = [organization.slug for organization in demo.ORGANIZATIONS]
    with admin_database.session() as db:
        seeded_orgs = db.scalar(
            select(func.count()).select_from(Organization).where(Organization.slug.in_(slugs))
        )
        dana = db.scalar(select(User).where(User.email == "dana.whitfield@meridianfs.example"))
        dana_memberships = db.scalar(
            select(func.count()).select_from(Membership).where(Membership.user_id == dana.id)
        )
    assert seeded_orgs == 2
    assert dana_memberships == 2

    # A seeded account can sign in and lands in its organization.
    token = sign_in(client, "marcus.okafor@meridianfs.example", DEMO_PASSWORD)
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["organization"]["slug"] == "meridian"
    assert me["role"] == "operations_manager"


def test_every_demo_role_is_represented():
    roles = {role for account in demo.ACCOUNTS for _, role, _ in account.memberships}

    assert {role.value for role in roles} == {
        "company_admin",
        "operations_manager",
        "supervisor",
        "employee",
    }
    assert sum(account.is_platform_admin for account in demo.ACCOUNTS) == 1


def test_openapi_command_writes_the_api_document(tmp_path: Path, admin_database: Database):
    output = tmp_path / "openapi.json"

    assert cli.main(["openapi", "--output", str(output)]) == 0

    document = json.loads(output.read_text())
    assert "/api/v1/auth/login" in document["paths"]
    assert document["paths"]["/api/v1/members"]["get"]["operationId"] == "list_members"


def test_seed_command_refuses_to_run_in_production(monkeypatch, capsys):
    production = Settings(
        _env_file=None,
        environment="production",
        database_url="postgresql+psycopg://app:long-app-secret@db:5432/buildingops",
        database_admin_url="postgresql+psycopg://owner:long-owner-secret@db:5432/buildingops",
    )
    monkeypatch.setattr(cli, "get_settings", lambda: production)

    assert cli.main(["seed"]) == 2
    assert "Refusing to seed" in capsys.readouterr().out
