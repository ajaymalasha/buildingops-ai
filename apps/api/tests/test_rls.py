"""Tenant isolation at the database level.

These tests bypass the API and its services entirely and talk to PostgreSQL as the app
role. They prove that even application code with a missing `WHERE organization_id = ...`
could not read or write another organization's rows.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError, ProgrammingError

from buildingops.core.db import Database, DbContext
from buildingops.core.models import utcnow
from buildingops.core.permissions import Role
from buildingops.modules.audit.models import AuditLog
from buildingops.modules.buildings.models import Building
from buildingops.modules.contracts.models import Contract, ContractBuilding
from buildingops.modules.customers.models import Customer
from buildingops.modules.expenses.models import Expense, ExpenseCategory
from buildingops.modules.identity.models import Membership, MembershipStatus, Organization
from buildingops.modules.invoicing.models import Invoice, InvoiceLine, Payment
from buildingops.modules.scheduling.models import Shift
from buildingops.modules.sequences import service as sequences
from buildingops.modules.sequences.models import OrganizationSequence
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.workforce.models import BuildingAssignment, Employee, JobRole
from buildingops.modules.workorders.models import WorkOrder, WorkOrderActivity
from tests.conftest import Factory, make_settings


def _audit_entry(organization_id: uuid.UUID | None) -> AuditLog:
    return AuditLog(
        organization_id=organization_id,
        actor_name="Test",
        action="test.created",
        entity_type="test",
        summary="created by a test",
        created_at=utcnow(),
    )


@pytest.fixture
def two_orgs(factory: Factory, admin_database: Database):
    alpha, bravo = factory.organization(), factory.organization()
    alpha_user, alpha_membership = factory.member(alpha, Role.COMPANY_ADMIN)
    bravo_user, bravo_membership = factory.member(bravo, Role.COMPANY_ADMIN)
    with admin_database.session() as db:
        db.add_all([_audit_entry(alpha.id), _audit_entry(bravo.id)])
        db.commit()
    return alpha, bravo, alpha_user, bravo_user, alpha_membership, bravo_membership


def test_without_context_no_tenant_rows_are_visible(app_database: Database, two_orgs):
    with app_database.session() as db:
        assert db.scalar(select(func.count()).select_from(Organization)) == 0
        assert db.scalar(select(func.count()).select_from(Membership)) == 0
        assert db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_organization_context_limits_every_table_to_that_organization(
    app_database: Database, two_orgs
):
    alpha, bravo, *_ = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        assert db.scalars(select(Organization.id)).all() == [alpha.id]
        assert set(db.scalars(select(Membership.organization_id))) == {alpha.id}
        assert set(db.scalars(select(AuditLog.organization_id))) == {alpha.id}
        # Asking for the other organization's rows by id finds nothing.
        assert db.get(Organization, bravo.id) is None


def test_a_user_can_see_their_own_memberships_before_choosing_an_organization(
    app_database: Database, factory: Factory
):
    alpha, bravo, other = (factory.organization() for _ in range(3))
    user = factory.user()
    factory.membership(alpha, user, Role.EMPLOYEE)
    factory.membership(bravo, user, Role.SUPERVISOR)
    factory.member(other, Role.COMPANY_ADMIN)

    with app_database.session(DbContext(user_id=user.id)) as db:
        assert set(db.scalars(select(Membership.organization_id))) == {alpha.id, bravo.id}
        assert set(db.scalars(select(Organization.id))) == {alpha.id, bravo.id}


def test_cannot_insert_a_row_for_another_organization(app_database: Database, two_orgs):
    alpha, bravo, alpha_user, *_ = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        db.add(
            Membership(
                organization_id=bravo.id,
                user_id=alpha_user.id,
                role=Role.COMPANY_ADMIN,
                status=MembershipStatus.ACTIVE,
            )
        )
        with pytest.raises(ProgrammingError, match="row-level security"):
            db.flush()


def test_cannot_move_a_row_into_another_organization(app_database: Database, two_orgs):
    alpha, bravo, _, _, alpha_membership, _ = two_orgs

    with (
        app_database.session(DbContext(organization_id=alpha.id)) as db,
        pytest.raises(ProgrammingError, match="row-level security"),
    ):
        db.execute(
            update(Membership)
            .where(Membership.id == alpha_membership.id)
            .values(organization_id=bravo.id)
        )


def test_updates_and_deletes_cannot_reach_another_organization(app_database: Database, two_orgs):
    alpha, _, _, _, _, bravo_membership = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        updated = db.execute(
            update(Membership).where(Membership.id == bravo_membership.id).values(title="Hijacked")
        )
        deleted = db.execute(
            text("DELETE FROM memberships WHERE id = :id"), {"id": bravo_membership.id}
        )
        db.commit()

    assert updated.rowcount == 0
    assert deleted.rowcount == 0


def test_only_a_platform_admin_can_create_an_organization(app_database: Database, two_orgs):
    alpha, *_ = two_orgs

    def new_organization() -> Organization:
        suffix = uuid.uuid4().hex[:12]
        return Organization(name=f"Created {suffix}", slug=f"created-{suffix}")

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        db.add(new_organization())
        with pytest.raises(ProgrammingError, match="row-level security"):
            db.flush()

    with app_database.session(DbContext(platform_admin=True)) as db:
        db.add(new_organization())
        db.flush()


def test_organizations_cannot_be_deleted_by_the_app_role(app_database: Database, two_orgs):
    alpha, *_ = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id, platform_admin=True)) as db:
        result = db.execute(text("DELETE FROM organizations WHERE id = :id"), {"id": alpha.id})

    assert result.rowcount == 0  # no DELETE policy exists, so no row qualifies


def test_context_does_not_leak_between_transactions_on_a_pooled_connection(
    admin_database: Database, two_orgs
):
    alpha, *_ = two_orgs
    # One connection only, so the second session is certain to reuse the first one's.
    single = Database(make_settings().database_url, pool_size=1, max_overflow=0)
    try:
        with single.session(DbContext(organization_id=alpha.id)) as db:
            assert db.scalar(select(func.count()).select_from(Membership)) == 1
            db.commit()

        with single.session() as db:
            assert db.scalar(select(func.count()).select_from(Membership)) == 0
    finally:
        single.dispose()


def test_context_is_reapplied_after_a_commit_within_one_session(app_database: Database, two_orgs):
    alpha, *_ = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        assert db.scalar(select(func.count()).select_from(Membership)) == 1
        db.commit()  # ends the transaction the settings were local to
        assert db.scalar(select(func.count()).select_from(Membership)) == 1


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_logs SET summary = 'rewritten' WHERE organization_id = :org",
        "DELETE FROM audit_logs WHERE organization_id = :org",
        "TRUNCATE audit_logs",
    ],
)
def test_the_audit_log_is_append_only_even_for_the_owner(
    admin_database: Database, two_orgs, statement: str
):
    alpha, *_ = two_orgs

    with admin_database.session() as db, pytest.raises(DBAPIError, match="append-only"):
        db.execute(text(statement), {"org": alpha.id} if ":org" in statement else {})


def test_the_app_role_cannot_change_audit_entries(app_database: Database, two_orgs):
    alpha, *_ = two_orgs

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        result = db.execute(text("UPDATE audit_logs SET summary = 'rewritten'"))

    assert result.rowcount == 0  # no UPDATE policy: the rows are not even candidates


# --- master data and operational records -------------------------------------------------

TENANT_RECORDS = (
    OrganizationSequence,
    Customer,
    Building,
    Vendor,
    JobRole,
    Employee,
    BuildingAssignment,
    Contract,
    ContractBuilding,
    WorkOrder,
    WorkOrderActivity,
    Shift,
    Timesheet,
    Expense,
    Invoice,
    InvoiceLine,
    Payment,
)


@pytest.fixture
def two_directories(factory: Factory, admin_database: Database):
    """Two organizations with at least one row each in every one of those tables."""
    alpha, bravo = factory.organization(), factory.organization()
    for organization in (alpha, bravo):
        customer = factory.customer(organization)
        building = factory.building(organization, customer)
        employee = factory.employee(organization)
        factory.assignment(employee, building)
        factory.contract(organization, customer, buildings=[building])
        factory.vendor(organization)
        factory.work_order_activity(factory.work_order(organization, building))
        factory.shift(employee, building)
        factory.timesheet(employee, building)
        factory.expense(organization)
        factory.invoice(organization, customer, lines=[{}], payments=[{"amount": Decimal("10.00")}])
        with admin_database.session() as db:
            sequences.allocate_code(db, organization.id, "customer", "CUS")
            db.commit()
    return alpha, bravo


def test_tenant_records_are_visible_only_inside_their_organization(
    app_database: Database, two_directories
):
    alpha, _ = two_directories

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        for model in TENANT_RECORDS:
            assert set(db.scalars(select(model.organization_id))) == {alpha.id}, model

    # Without an organization there is nothing to see, platform administrator or not.
    for outside in (DbContext(), DbContext(platform_admin=True)):
        with app_database.session(outside) as db:
            for model in TENANT_RECORDS:
                assert db.scalar(select(func.count()).select_from(model)) == 0, model


def test_tenant_records_of_another_organization_cannot_be_written(
    app_database: Database, two_directories
):
    alpha, bravo = two_directories

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        for model in TENANT_RECORDS:
            touched = db.execute(
                update(model).where(model.organization_id == bravo.id).values(updated_at=func.now())
            )
            assert touched.rowcount == 0, model

        db.add(Customer(organization_id=bravo.id, name="Planted", code="PLANTED"))
        with pytest.raises(ProgrammingError, match="row-level security"):
            db.flush()


def test_an_operational_record_cannot_be_planted_in_another_organization(
    app_database: Database, two_directories
):
    alpha, bravo = two_directories

    with app_database.session(DbContext(organization_id=alpha.id)) as db:
        db.add(
            Expense(
                organization_id=bravo.id,
                category=ExpenseCategory.OTHER,
                description="Planted",
                amount=Decimal("1.00"),
                currency="USD",
                incurred_on=date(2026, 3, 2),
            )
        )
        with pytest.raises(ProgrammingError, match="row-level security"):
            db.flush()
