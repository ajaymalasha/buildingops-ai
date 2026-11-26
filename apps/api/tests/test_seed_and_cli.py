import json
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from buildingops import cli
from buildingops.core.config import Settings
from buildingops.core.db import Database
from buildingops.core.security import PasswordService
from buildingops.modules.buildings.models import Building, BuildingType
from buildingops.modules.contracts.models import BillingModel, Contract, ContractBuilding
from buildingops.modules.identity.models import Membership, Organization, User
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.workforce.models import (
    BuildingAssignment,
    Employee,
    EmployeeStatus,
    JobRole,
)
from buildingops.seed import demo, master_data
from tests.conftest import sign_in

DEMO_PASSWORD = "seeded-demo-password"
SEEDED = ("meridian", "northgate")
# The day the master data is seeded as of. Its dates are laid out around it.
TODAY = date(2026, 11, 26)


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


@dataclass(frozen=True, slots=True)
class SeedRuns:
    """The master-data seed run three times: a rehearsal that is rolled back, the run that
    is kept, and one more after it. Each with what it reported, and what the first two wrote."""

    rehearsal: list[master_data.DirectoryReport]
    rehearsed: list[tuple]
    first: list[master_data.DirectoryReport]
    written: list[tuple]
    second: list[master_data.DirectoryReport]


def _seeded_people_and_places(db: Session) -> list[tuple]:
    """Where the seed left its random choices: who was hired, on what terms, to work where."""
    return [
        tuple(row)
        for row in db.execute(
            select(
                Organization.slug,
                Employee.employee_number,
                Employee.first_name,
                Employee.last_name,
                Employee.email,
                Employee.phone,
                Employee.status,
                Employee.employment_type,
                Employee.hire_date,
                Employee.termination_date,
                Employee.hourly_rate,
                Building.code,
                BuildingAssignment.is_primary,
                BuildingAssignment.starts_on,
            )
            .join(Organization, Organization.id == Employee.organization_id)
            .outerjoin(BuildingAssignment, BuildingAssignment.employee_id == Employee.id)
            .outerjoin(Building, Building.id == BuildingAssignment.building_id)
            .where(Organization.slug.in_(SEEDED))
            .order_by(Organization.slug, Employee.employee_number, Building.code)
        )
    ]


@pytest.fixture(scope="module")
def seed_runs(admin_database: Database, passwords: PasswordService) -> SeedRuns:
    _seed(admin_database, passwords)
    with admin_database.session() as db:
        rehearsal = master_data.seed_master_data(db, TODAY)
        rehearsed = _seeded_people_and_places(db)
        db.rollback()
    with admin_database.session() as db:
        first = master_data.seed_master_data(db, TODAY)
        written = _seeded_people_and_places(db)
        db.commit()
    with admin_database.session() as db:
        second = master_data.seed_master_data(db, TODAY)
        db.commit()
    return SeedRuns(rehearsal, rehearsed, first, written, second)


def test_seed_fills_each_demo_organization_with_master_data_once(seed_runs: SeedRuns):
    meridian, northgate = seed_runs.first

    def created(report: master_data.DirectoryReport) -> dict[str, int]:
        return {
            "customers": report.customers,
            "buildings": report.buildings,
            "vendors": report.vendors,
            "job roles": report.job_roles,
            "employees": report.employees,
            "contracts": report.contracts,
        }

    assert created(meridian) == {
        "customers": 12,
        "buildings": 30,
        "vendors": 14,
        "job roles": 10,
        "employees": 91,
        "contracts": 14,
    }
    assert created(northgate) == {
        "customers": 5,
        "buildings": 9,
        "vendors": 5,
        "job roles": 6,
        "employees": 24,
        "contracts": 5,
    }
    # Site supervisors cover several buildings, so there are more assignments than people.
    assert meridian.assignments > meridian.employees
    assert northgate.assignments > northgate.employees
    # An organization that has customers is left as it is.
    assert seed_runs.second == [
        master_data.DirectoryReport("meridian"),
        master_data.DirectoryReport("northgate"),
    ]


def test_seed_writes_the_same_master_data_every_time(seed_runs: SeedRuns):
    assert seed_runs.written
    assert seed_runs.rehearsal == seed_runs.first
    assert seed_runs.rehearsed == seed_runs.written


def test_the_seeded_directory_hangs_together(admin_database: Database, seed_runs: SeedRuns):
    supervisor = aliased(Employee)
    with admin_database.session() as db:
        seeded = select(Organization.id).where(Organization.slug.in_(SEEDED))
        meridian = select(Organization.id).where(Organization.slug == "meridian")

        primaries_per_assigned_employee = db.scalars(
            select(func.count().filter(BuildingAssignment.is_primary))
            .where(
                BuildingAssignment.organization_id.in_(seeded),
                BuildingAssignment.ends_on.is_(None),
            )
            .group_by(BuildingAssignment.employee_id)
        ).all()
        supervisors_outside_supervisory_roles = db.scalar(
            select(func.count())
            .select_from(Employee)
            .join(supervisor, supervisor.id == Employee.supervisor_id)
            .join(JobRole, JobRole.id == supervisor.job_role_id)
            .where(Employee.organization_id.in_(seeded), JobRole.is_supervisory.is_(False))
        )
        buildings_on_another_customers_contract = db.scalar(
            select(func.count())
            .select_from(ContractBuilding)
            .join(Contract, Contract.id == ContractBuilding.contract_id)
            .join(Building, Building.id == ContractBuilding.building_id)
            .where(
                Contract.organization_id.in_(seeded), Building.customer_id != Contract.customer_id
            )
        )
        employee_statuses = Counter(
            db.scalars(select(Employee.status).where(Employee.organization_id.in_(meridian)))
        )
        hire_dates = db.scalars(
            select(Employee.hire_date).where(Employee.organization_id.in_(meridian))
        ).all()
        insurance = db.scalars(
            select(Vendor.insurance_expires_on).where(
                Vendor.organization_id.in_(meridian), Vendor.insurance_expires_on.is_not(None)
            )
        ).all()
        building_types = set(
            db.scalars(select(Building.building_type).where(Building.organization_id.in_(meridian)))
        )
        billing_models = set(
            db.scalars(select(Contract.billing_model).where(Contract.organization_id.in_(meridian)))
        )

    # Everyone with a building to go to has exactly one primary building.
    assert len(primaries_per_assigned_employee) > 80
    assert set(primaries_per_assigned_employee) == {1}
    assert supervisors_outside_supervisory_roles == 0
    assert buildings_on_another_customers_contract == 0
    # Mostly active, with a few people new, away or gone.
    assert employee_statuses == {
        EmployeeStatus.ACTIVE: 79,
        EmployeeStatus.ONBOARDING: 4,
        EmployeeStatus.ON_LEAVE: 3,
        EmployeeStatus.TERMINATED: 5,
    }
    assert min(hire_dates) < TODAY - timedelta(days=5 * 365)
    assert min(hire_dates) >= TODAY - timedelta(days=6 * 365)
    # Some insurance has lapsed and some is about to.
    assert any(expires < TODAY for expires in insurance)
    assert any(TODAY <= expires <= TODAY + timedelta(days=30) for expires in insurance)
    assert building_types == set(BuildingType)
    assert billing_models == set(BillingModel)


def test_the_seeded_accounts_find_themselves_in_the_directory(
    client: TestClient, seed_runs: SeedRuns
):
    def signed_in(email: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {sign_in(client, email, DEMO_PASSWORD)}"}

    dana = signed_in("dana.whitfield@meridianfs.example")
    priya = signed_in("priya.raman@meridianfs.example")

    everyone = client.get("/api/v1/employees", headers=dana, params={"page_size": 200}).json()
    (herself,) = client.get("/api/v1/employees", headers=priya, params={"q": "priya raman"}).json()[
        "items"
    ]
    next_customer = client.post(
        "/api/v1/customers", headers=dana, json={"name": "Signed after the seed"}
    )

    assert everyone["total"] == 91
    assert {
        (employee["full_name"], employee["job_role"]["name"])
        for employee in everyone["items"]
        if employee["membership_id"]
    } == {
        ("Marcus Okafor", "Operations Manager"),
        ("Priya Raman", "Site Supervisor"),
        ("Luis Ortega", "Maintenance Technician"),
    }
    assert herself["job_role"]["name"] == "Site Supervisor"
    assert herself["primary_building"] is not None
    assert herself["hourly_rate"] is None  # supervisors do not see pay rates, their own included
    # The API carries on numbering where the seed stopped.
    assert next_customer.json()["code"] == "CUS-0013"


def test_seed_command_can_be_run_again(
    seed_runs: SeedRuns, settings: Settings, monkeypatch, capsys
):
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    assert cli.main(["seed"]) == 0

    output = capsys.readouterr().out
    assert "Seed complete: 0 organizations, 0 users, 0 memberships created." in output
    assert "meridian: 0 customers, 0 buildings, 0 vendors, 0 job roles, 0 employees" in output
    assert "northgate: 0 customers, 0 buildings, 0 vendors, 0 job roles, 0 employees" in output


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
