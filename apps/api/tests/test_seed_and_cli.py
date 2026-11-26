import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session, aliased

from buildingops import cli
from buildingops.core.config import Settings
from buildingops.core.db import Database
from buildingops.core.models import DecisionStatus
from buildingops.core.money import round_money
from buildingops.core.security import PasswordService
from buildingops.modules.buildings.models import Building, BuildingType
from buildingops.modules.contracts.models import (
    BillingModel,
    Contract,
    ContractBuilding,
    ContractStatus,
)
from buildingops.modules.expenses.models import Expense, ExpenseCategory
from buildingops.modules.identity.models import Membership, Organization, User
from buildingops.modules.invoicing.models import (
    Invoice,
    InvoiceLine,
    InvoiceLineKind,
    InvoiceStatus,
    Payment,
)
from buildingops.modules.scheduling.models import Shift, ShiftStatus
from buildingops.modules.timesheets.costing import labor_cost
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.workforce.models import (
    BuildingAssignment,
    Employee,
    EmployeeStatus,
    JobRole,
)
from buildingops.modules.workorders.models import (
    WorkOrder,
    WorkOrderActivity,
    WorkOrderActivityKind,
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderSource,
    WorkOrderStatus,
)
from buildingops.modules.workorders.service import ALLOWED_MOVES
from buildingops.seed import demo, master_data, operations
from buildingops.seed.operations.billing import OVERTIME_RATE, TIME_AND_MATERIALS_RATE
from tests.conftest import sign_in

DEMO_PASSWORD = "seeded-demo-password"
SEEDED = ("meridian", "northgate")
# The day the demo data is seeded as of. Its dates are laid out around it.
TODAY = date(2026, 11, 26)
YESTERDAY = TODAY - timedelta(days=1)
# The year of work starts on the first of the month, twelve months before the current one.
FIRST_DAY = date(2025, 11, 1)
# The tables the year of work is written to, a table after the tables it refers to.
OPERATIONS = (
    WorkOrder,
    WorkOrderActivity,
    Shift,
    Timesheet,
    Expense,
    Invoice,
    InvoiceLine,
    Payment,
)
PENDING, APPROVED, REJECTED = (
    DecisionStatus.PENDING,
    DecisionStatus.APPROVED,
    DecisionStatus.REJECTED,
)


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


# --- a year of work ----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class HistoryRuns:
    """The year of work seeded three times on top of the master data: a rehearsal that is
    rolled back, the run that is kept, and one more after it. Each with what it reported,
    and what the first two wrote."""

    rehearsal: list[operations.OperationsReport]
    rehearsed: dict[str, list[tuple]]
    first: list[operations.OperationsReport]
    written: dict[str, list[tuple]]
    second: list[operations.OperationsReport]


def _seeded_history(db: Session) -> dict[str, list[tuple]]:
    """Every row the seed wrote, table by table and in a fixed order, without the ids.
    Those are random. Everything else is meant to come out the same every time."""
    history = {}
    for model in OPERATIONS:
        columns = [
            column
            for column in model.__table__.columns
            if column.name != "id" and not column.name.endswith("_id")
        ]
        rows = db.execute(
            select(*columns)
            .join(Organization, Organization.id == model.organization_id)
            .where(Organization.slug.in_(SEEDED))
            .order_by(Organization.slug, *columns)
        )
        history[model.__tablename__] = [tuple(row) for row in rows]
    return history


@pytest.fixture(scope="module")
def history_runs(admin_database: Database, seed_runs: SeedRuns) -> HistoryRuns:
    with admin_database.session() as db:
        rehearsal = operations.seed_operations(db, TODAY)
        rehearsed = _seeded_history(db)
        db.rollback()
    with admin_database.session() as db:
        first = operations.seed_operations(db, TODAY)
        written = _seeded_history(db)
        db.commit()
    with admin_database.session() as db:
        second = operations.seed_operations(db, TODAY)
        db.commit()
    return HistoryRuns(rehearsal, rehearsed, first, written, second)


def _in_seeded_organizations(model):
    return model.organization_id.in_(select(Organization.id).where(Organization.slug.in_(SEEDED)))


def _midnight(timezone: str) -> datetime:
    """The moment the day of the seed began where an organization is. Nothing that has
    happened is dated later."""
    return datetime.combine(TODAY, time.min, ZoneInfo(timezone))


def test_seed_gives_each_demo_organization_a_year_of_work_once(history_runs: HistoryRuns):
    meridian, northgate = history_runs.first

    assert (meridian.work_orders, meridian.expenses) == (600, 900)
    assert (northgate.work_orders, northgate.expenses) == (150, 200)
    # A year of working days for some seventy people, and for twenty.
    assert 15_000 < meridian.timesheets < 22_000
    assert 3_500 < northgate.timesheets < 6_000
    for report in (meridian, northgate):
        # Six weeks of schedule, a history behind every work order, and invoices with
        # their lines and payments.
        assert report.timesheets / 13 < report.shifts < report.timesheets / 6
        assert report.activities > 3 * report.work_orders
        assert report.invoice_lines > 2 * report.invoices > 0
        assert report.payments > 0
    # An organization that has work orders is left as it is.
    assert history_runs.second == [
        operations.OperationsReport("meridian"),
        operations.OperationsReport("northgate"),
    ]


def test_seed_writes_the_same_history_every_time(history_runs: HistoryRuns):
    assert history_runs.rehearsal == history_runs.first
    for table, rows in history_runs.written.items():
        assert rows, table
        assert history_runs.rehearsed[table] == rows, table


def test_seeded_time_is_priced_and_decided_as_the_api_would(
    admin_database: Database, history_runs: HistoryRuns
):
    with admin_database.session() as db:
        rows = db.execute(
            select(Timesheet, Employee, Membership.user_id, Organization.timezone)
            .join(Organization, Organization.id == Timesheet.organization_id)
            .join(Employee, Employee.id == Timesheet.employee_id)
            .outerjoin(Membership, Membership.id == Employee.membership_id)
            .where(Organization.slug.in_(SEEDED))
        ).all()
        booked_to_a_contract_for_another_building = db.scalar(
            select(func.count())
            .select_from(Timesheet)
            .outerjoin(
                ContractBuilding,
                and_(
                    ContractBuilding.contract_id == Timesheet.contract_id,
                    ContractBuilding.building_id == Timesheet.building_id,
                ),
            )
            .where(
                _in_seeded_organizations(Timesheet),
                Timesheet.contract_id.is_not(None),
                ContractBuilding.id.is_(None),
            )
        )
        worked_where_not_assigned = db.scalar(
            select(func.count())
            .select_from(Timesheet)
            .outerjoin(
                BuildingAssignment,
                and_(
                    BuildingAssignment.employee_id == Timesheet.employee_id,
                    BuildingAssignment.building_id == Timesheet.building_id,
                    BuildingAssignment.ends_on.is_(None),
                ),
            )
            .where(_in_seeded_organizations(Timesheet), BuildingAssignment.id.is_(None))
        )

    statuses: Counter[DecisionStatus] = Counter()
    for sheet, employee, own_user_id, timezone in rows:
        statuses[sheet.status] += 1
        # Priced by the function the service uses, at the rate the employee has.
        assert sheet.hourly_rate == employee.hourly_rate
        assert sheet.labor_cost == labor_cost(
            sheet.hours_regular, sheet.hours_overtime, sheet.hourly_rate, sheet.overtime_multiplier
        )
        assert employee.status is EmployeeStatus.ACTIVE
        assert FIRST_DAY <= sheet.work_date <= YESTERDAY
        assert sheet.submitted_at < _midnight(timezone)
        days_ago = (TODAY - sheet.work_date).days
        if days_ago > 14:
            assert sheet.status is not PENDING
        if days_ago <= 2:
            assert sheet.status is PENDING
        if sheet.status is PENDING:
            assert (sheet.decided_at, sheet.decided_by_name, sheet.rejection_reason) == (
                None,
                None,
                None,
            )
        else:
            assert sheet.submitted_at <= sheet.decided_at < _midnight(timezone)
            assert sheet.decided_by_name
            # Nobody approved their own time.
            assert own_user_id is None or sheet.decided_by_user_id != own_user_id
            assert (sheet.rejection_reason is not None) == (sheet.status is REJECTED)

    # From the first Monday of the year of work to yesterday.
    assert {sheet.work_date for sheet, *_ in rows} >= {date(2025, 11, 3), YESTERDAY}
    # Nearly everything is approved, a few are rejected, and a queue waits to be decided.
    assert statuses[APPROVED] > 0.95 * len(rows)
    assert 0 < statuses[REJECTED] < 0.03 * len(rows)
    assert statuses[PENDING] > 200
    assert booked_to_a_contract_for_another_building == 0
    assert worked_where_not_assigned == 0


def test_the_seeded_schedule_matches_the_time_worked(
    admin_database: Database, history_runs: HistoryRuns
):
    with admin_database.session() as db:
        rows = db.execute(
            select(Shift, Timesheet, Organization.timezone)
            .join(Organization, Organization.id == Shift.organization_id)
            .outerjoin(Timesheet, Timesheet.shift_id == Shift.id)
            .where(Organization.slug.in_(SEEDED))
        ).all()
        recent_time_without_a_shift = db.scalar(
            select(func.count())
            .select_from(Timesheet)
            .where(
                _in_seeded_organizations(Timesheet),
                Timesheet.work_date >= TODAY - timedelta(days=28),
                Timesheet.shift_id.is_(None),
            )
        )

    statuses: Counter[ShiftStatus] = Counter()
    for shift, sheet, timezone in rows:
        statuses[shift.status] += 1
        day = shift.starts_at.astimezone(ZoneInfo(timezone)).date()
        # Four weeks back, two weeks ahead.
        assert TODAY - timedelta(days=28) <= day < TODAY + timedelta(days=14)
        if day >= TODAY:
            assert shift.status is ShiftStatus.SCHEDULED
        if shift.status is ShiftStatus.COMPLETED:
            # The time worked on it is on a timesheet for the same person, place and day.
            assert (sheet.employee_id, sheet.building_id, sheet.work_date) == (
                shift.employee_id,
                shift.building_id,
                day,
            )
            minutes_worked = int((sheet.hours_regular + sheet.hours_overtime) * 60)
            assert shift.ends_at - shift.starts_at == timedelta(
                minutes=minutes_worked + shift.break_minutes
            )
        else:
            assert sheet is None
            assert shift.status in (ShiftStatus.SCHEDULED, ShiftStatus.MISSED)

    assert statuses[ShiftStatus.COMPLETED] > statuses[ShiftStatus.SCHEDULED] > 500
    assert 0 < statuses[ShiftStatus.MISSED] < 0.03 * statuses[ShiftStatus.COMPLETED]
    assert recent_time_without_a_shift == 0


def test_seeded_work_orders_have_a_history_the_api_allows(
    admin_database: Database, history_runs: HistoryRuns
):
    with admin_database.session() as db:
        orders = db.execute(
            select(WorkOrder, Organization.slug, Organization.timezone)
            .join(Organization, Organization.id == WorkOrder.organization_id)
            .where(Organization.slug.in_(SEEDED))
            .order_by(Organization.slug, WorkOrder.created_at, WorkOrder.number)
        ).all()
        activities = db.scalars(
            select(WorkOrderActivity)
            .where(_in_seeded_organizations(WorkOrderActivity))
            .order_by(WorkOrderActivity.created_at, WorkOrderActivity.id)
        ).all()
    history = defaultdict(list)
    for activity in activities:
        history[activity.work_order_id].append(activity)

    closed = (WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED)
    standing: dict[str, Counter[WorkOrderStatus]] = {slug: Counter() for slug in SEEDED}
    overdue: Counter[str] = Counter()
    for order, slug, timezone in orders:
        standing[slug][order.status] += 1
        overdue[slug] += (
            order.due_on is not None and order.due_on < TODAY and order.status not in closed
        )
        # Replayed from the start, its history makes only moves the API allows, and leaves
        # it where it stands with the times the API would have set.
        status, started_at, completed_at = WorkOrderStatus.OPEN, None, None
        assert order.created_at < _midnight(timezone)
        for activity in history[order.id]:
            assert order.created_at <= activity.created_at < _midnight(timezone)
            assert activity.author_name
            if activity.kind is not WorkOrderActivityKind.STATUS_CHANGE:
                assert activity.body
                assert (activity.from_status, activity.to_status) == (None, None)
                continue
            assert activity.from_status == status.value
            target = WorkOrderStatus(activity.to_status)
            assert target in ALLOWED_MOVES[status]
            if target is WorkOrderStatus.IN_PROGRESS and started_at is None:
                started_at = activity.created_at
            completed_at = activity.created_at if target is WorkOrderStatus.COMPLETED else None
            status = target
        assert status is order.status
        assert (order.started_at, order.completed_at) == (started_at, completed_at)
        assigned = [
            activity.body
            for activity in history[order.id]
            if activity.kind is WorkOrderActivityKind.ASSIGNMENT
        ]
        assert len(assigned) == bool(order.assigned_employee_id) + bool(order.vendor_id)

    for slug in SEEDED:
        # Numbered in the order they were raised.
        numbers = [order.number for order, organization, _ in orders if organization == slug]
        assert numbers == [f"WO-{number:04d}" for number in range(1, len(numbers) + 1)]
        # Most are finished, every status of the backlog is there, and some of it is late.
        live = sum(count for status, count in standing[slug].items() if status not in closed)
        assert set(standing[slug]) == set(WorkOrderStatus)
        assert standing[slug][WorkOrderStatus.COMPLETED] > 0.85 * len(numbers)
        assert 0 < overdue[slug] < live
    meridian = [order for order, slug, _ in orders if slug == "meridian"]
    assert {order.category for order in meridian} == set(WorkOrderCategory)
    assert {order.priority for order in meridian} == set(WorkOrderPriority)
    assert {order.source for order in meridian} == set(WorkOrderSource)


def test_seeded_expenses_are_tied_to_what_they_were_for(
    admin_database: Database, history_runs: HistoryRuns
):
    with admin_database.session() as db:
        rows = db.execute(
            select(Expense, WorkOrder, Organization.timezone)
            .join(Organization, Organization.id == Expense.organization_id)
            .outerjoin(WorkOrder, WorkOrder.id == Expense.work_order_id)
            .where(Organization.slug.in_(SEEDED))
        ).all()
        booked_to_a_contract_for_another_building = db.scalar(
            select(func.count())
            .select_from(Expense)
            .outerjoin(
                ContractBuilding,
                and_(
                    ContractBuilding.contract_id == Expense.contract_id,
                    ContractBuilding.building_id == Expense.building_id,
                ),
            )
            .where(
                _in_seeded_organizations(Expense),
                Expense.contract_id.is_not(None),
                ContractBuilding.id.is_(None),
            )
        )

    statuses: Counter[DecisionStatus] = Counter()
    for_work_orders = 0
    for expense, work_order, timezone in rows:
        statuses[expense.status] += 1
        assert FIRST_DAY <= expense.incurred_on <= YESTERDAY
        assert expense.created_at < _midnight(timezone)
        assert expense.amount == round_money(expense.amount) > 0
        days_ago = (TODAY - expense.incurred_on).days
        if days_ago > 18:
            assert expense.status is not PENDING
        if days_ago <= 2:
            assert expense.status is PENDING
        if expense.status is not PENDING:
            assert expense.created_at <= expense.decided_at < _midnight(timezone)
            assert (expense.rejection_reason is not None) == (expense.status is REJECTED)
        if work_order is not None:
            # A cost of finished work, at the building and under the contract it was for.
            for_work_orders += 1
            assert work_order.status is WorkOrderStatus.COMPLETED
            assert (expense.building_id, expense.contract_id, expense.billable) == (
                work_order.building_id,
                work_order.contract_id,
                work_order.billable,
            )
            completed_on = work_order.completed_at.astimezone(ZoneInfo(timezone)).date()
            assert expense.incurred_on == completed_on
            if expense.category is ExpenseCategory.SUBCONTRACTOR:
                assert expense.vendor_id == work_order.vendor_id

    assert {expense.category for expense, *_ in rows} == {
        ExpenseCategory.MATERIALS,
        ExpenseCategory.SUPPLIES,
        ExpenseCategory.SUBCONTRACTOR,
        ExpenseCategory.EQUIPMENT,
    }
    assert statuses[APPROVED] > 0.9 * len(rows)
    assert statuses[PENDING] > 20
    assert statuses[REJECTED] > 0
    assert for_work_orders > 100
    assert booked_to_a_contract_for_another_building == 0


def test_seeded_invoices_add_up_to_the_seeded_costs(
    admin_database: Database, history_runs: HistoryRuns
):
    """Every invoice is recomputed here from the timesheets and expenses in the database,
    not from what the seed remembers of them, and has to match to the cent."""
    with admin_database.session() as db:
        invoices = db.execute(
            select(Invoice, Contract)
            .join(Contract, Contract.id == Invoice.contract_id)
            .where(_in_seeded_organizations(Invoice))
        ).all()
        lines = db.scalars(select(InvoiceLine).where(_in_seeded_organizations(InvoiceLine))).all()
        time_worked = db.execute(
            select(
                Timesheet.contract_id,
                Timesheet.work_date,
                Timesheet.hours_regular,
                Timesheet.hours_overtime,
                Timesheet.labor_cost,
            ).where(
                _in_seeded_organizations(Timesheet),
                Timesheet.status == APPROVED,
                Timesheet.contract_id.is_not(None),
            )
        ).all()
        spending = db.execute(
            select(Expense.contract_id, Expense.incurred_on, Expense.amount).where(
                _in_seeded_organizations(Expense),
                Expense.status == APPROVED,
                Expense.billable,
                Expense.contract_id.is_not(None),
            )
        ).all()

    nothing = Decimal("0.00")
    labor: defaultdict[tuple, Decimal] = defaultdict(lambda: nothing)
    regular: defaultdict[tuple, Decimal] = defaultdict(lambda: nothing)
    overtime: defaultdict[tuple, Decimal] = defaultdict(lambda: nothing)
    spent: defaultdict[tuple, Decimal] = defaultdict(lambda: nothing)
    for contract_id, work_date, hours_regular, hours_overtime, cost in time_worked:
        month = (contract_id, work_date.replace(day=1))
        labor[month] += cost
        regular[month] += hours_regular
        overtime[month] += hours_overtime
    for contract_id, incurred_on, amount in spending:
        spent[(contract_id, incurred_on.replace(day=1))] += amount
    lines_of = defaultdict(list)
    for line in lines:
        lines_of[line.invoice_id].append(line)

    billed: Counter[BillingModel] = Counter()
    for invoice, contract in invoices:
        billed[contract.billing_model] += 1
        month = (contract.id, invoice.period_start)
        assert invoice.period_start.day == 1
        assert invoice.tax_amount == nothing
        own_lines = sorted(lines_of[invoice.id], key=lambda line: line.position)
        assert [line.position for line in own_lines] == list(range(1, len(own_lines) + 1))
        assert sum(line.amount for line in own_lines) == invoice.total
        for line in own_lines:
            assert line.amount == round_money(line.quantity * line.unit_price)
        markup_lines = [line for line in own_lines if line.kind is InvoiceLineKind.MARKUP]

        if contract.billing_model is BillingModel.COST_PLUS:
            # Approved labor and approved billable expenses, and the markup on their sum.
            cost = labor[month] + spent[month]
            markup = round_money(cost * contract.markup_percent / 100)
            assert (invoice.subtotal, invoice.markup_amount) == (cost, markup)
            assert invoice.total == cost + markup
            assert [line.amount for line in markup_lines] == [markup]
        elif contract.billing_model is BillingModel.FIXED_FEE:
            assert invoice.subtotal == invoice.total == contract.monthly_fee
            assert markup_lines == []
        else:
            hours = round_money(regular[month] * TIME_AND_MATERIALS_RATE) + round_money(
                overtime[month] * OVERTIME_RATE
            )
            assert invoice.subtotal == invoice.total == hours + spent[month]
            assert markup_lines == []

    assert billed[BillingModel.COST_PLUS] > 40
    assert billed[BillingModel.FIXED_FEE] > 40
    assert billed[BillingModel.TIME_AND_MATERIALS] > 10


def test_seeded_invoices_run_from_paid_through_overdue_to_draft(
    admin_database: Database, history_runs: HistoryRuns
):
    with admin_database.session() as db:
        invoices = db.execute(
            select(Invoice, Contract, Organization.slug)
            .join(Organization, Organization.id == Invoice.organization_id)
            .join(Contract, Contract.id == Invoice.contract_id)
            .where(Organization.slug.in_(SEEDED))
            .order_by(Organization.slug, Invoice.period_start, Contract.contract_number)
        ).all()
        payments = db.scalars(select(Payment).where(_in_seeded_organizations(Payment))).all()
    received = defaultdict(list)
    for payment in payments:
        received[payment.invoice_id].append(payment)

    this_month = TODAY.replace(day=1)
    statuses: dict[str, Counter[InvoiceStatus]] = {slug: Counter() for slug in SEEDED}
    overdue: Counter[str] = Counter()
    in_two_parts = 0
    for invoice, contract, slug in invoices:
        statuses[slug][invoice.status] += 1
        assert contract.status is ContractStatus.ACTIVE
        assert (invoice.customer_id, invoice.currency) == (contract.customer_id, contract.currency)
        assert FIRST_DAY <= invoice.period_start <= this_month
        assert invoice.amount_paid == sum(payment.amount for payment in received[invoice.id])
        if invoice.status is InvoiceStatus.DRAFT:
            # The month still running is not billed yet.
            assert invoice.period_start == this_month
            assert (invoice.issue_date, invoice.due_date, invoice.amount_paid) == (None, None, 0)
            continue
        assert invoice.period_end < invoice.issue_date < TODAY
        assert invoice.due_date == invoice.issue_date + timedelta(days=contract.payment_terms_days)
        for payment in received[invoice.id]:
            assert invoice.issue_date <= payment.received_on < TODAY
        if invoice.status is InvoiceStatus.PAID:
            assert invoice.amount_paid == invoice.total
            in_two_parts += len(received[invoice.id]) == 2
        else:
            assert invoice.status is InvoiceStatus.ISSUED
            assert invoice.amount_paid < invoice.total
            overdue[slug] += invoice.due_date < TODAY

    for slug in SEEDED:
        own = [
            (invoice, contract)
            for invoice, contract, organization in invoices
            if organization == slug
        ]
        # One for a contract and a month, numbered in the order of the months.
        assert len({(contract.id, invoice.period_start) for invoice, contract in own}) == len(own)
        assert [invoice.number for invoice, _ in own] == [
            f"INV-{number:04d}" for number in range(1, len(own) + 1)
        ]
        counts = statuses[slug]
        assert counts[InvoiceStatus.PAID] > counts[InvoiceStatus.ISSUED] > overdue[slug] > 0
        assert counts[InvoiceStatus.DRAFT] > 0
        assert counts[InvoiceStatus.VOID] == 0
    assert in_two_parts > 5


def test_the_seeded_history_is_there_to_work_with(client: TestClient, history_runs: HistoryRuns):
    def signed_in(email: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {sign_in(client, email, DEMO_PASSWORD)}"}

    def get(path: str, headers: dict[str, str], **params):
        response = client.get(f"/api/v1{path}", headers=headers, params=params)
        assert response.status_code == 200, response.text
        return response.json()

    dana = signed_in("dana.whitfield@meridianfs.example")
    priya = signed_in("priya.raman@meridianfs.example")
    luis = signed_in("luis.ortega@meridianfs.example")

    # A supervisor has a queue of time to approve, without seeing what it costs.
    (herself,) = get("/employees", priya, q="priya raman")["items"]
    queue = get("/timesheets", priya, status="pending", page_size=200)
    assert queue["total"] == get("/timesheets/summary", priya)["pending"]["count"] > 200
    assert {sheet["labor_cost"] for sheet in queue["items"]} == {None}
    own = get("/timesheets", priya, status="pending", employee_id=herself["id"])["items"]
    someone_elses = next(
        sheet for sheet in queue["items"] if sheet["employee"]["id"] != herself["id"]
    )
    assert own  # she works too, and her own time waits for someone else

    def approve(sheet: dict) -> int:
        url = f"/api/v1/timesheets/{sheet['id']}/approve"
        return client.post(url, headers=priya).status_code

    assert approve(own[0]) == 403
    assert approve(someone_elses) == 200

    # The backlog has work in every state, some of it overdue.
    backlog = get(
        "/work-orders",
        dana,
        status=["open", "scheduled", "in_progress", "on_hold"],
        page_size=200,
    )
    assert {order["status"] for order in backlog["items"]} == {
        "open",
        "scheduled",
        "in_progress",
        "on_hold",
    }
    assert 0 < get("/work-orders", dana, overdue="true")["total"] < backlog["total"]
    newest = get(f"/work-orders/{backlog['items'][0]['id']}", dana)
    assert newest["building"]["name"]
    # The API carries on numbering where the seed stopped.
    raised = client.post(
        "/api/v1/work-orders",
        headers=dana,
        json={
            "title": "Raised after the seed",
            "category": "other",
            "building_id": newest["building"]["id"],
        },
    )
    assert raised.json()["number"] == "WO-0601"

    # Invoices are for managers. Some are owed past their due date, with lines to show.
    assert client.get("/api/v1/invoices", headers=priya).status_code == 403
    owed = get("/invoices", dana, overdue="true")
    assert owed["total"] > 0
    invoice = get(f"/invoices/{owed['items'][0]['id']}", dana)
    assert Decimal(invoice["balance_due"]) > 0
    assert sum(Decimal(line["amount"]) for line in invoice["lines"]) == Decimal(invoice["total"])
    assert get("/expenses", dana, status="pending")["total"] > 20
    upcoming = get(
        "/shifts",
        dana,
        **{"from": TODAY.isoformat(), "to": (TODAY + timedelta(days=13)).isoformat()},
    )
    assert upcoming["total"] > 500

    # None of this is open to an employee yet.
    assert client.get("/api/v1/work-orders", headers=luis).status_code == 403


@pytest.mark.parametrize(
    "day",
    [
        date(2026, 11, 1),  # the clocks go back, and the master data is from later in the month
        date(2026, 12, 1),  # the first of a month: last month is not billed yet
        date(2027, 1, 1),
        date(2027, 3, 14),  # the clocks go forward
        date(2027, 3, 31),
        date(2028, 2, 29),
    ],
)
def test_the_history_can_be_built_as_of_any_day(
    admin_database: Database, history_runs: HistoryRuns, day: date
):
    """The seed runs on whatever day it is run. Here one organization's year is thrown
    away and built again as of another day, in a transaction that is then rolled back.
    The database's own constraints do most of the checking."""
    with admin_database.session() as db:
        northgate = db.scalar(select(Organization.id).where(Organization.slug == "northgate"))
        for model in reversed(OPERATIONS):
            db.execute(delete(model).where(model.organization_id == northgate))

        meridian, report = operations.seed_operations(db, day)

        days_worked = db.execute(
            select(func.min(Timesheet.work_date), func.max(Timesheet.work_date)).where(
                Timesheet.organization_id == northgate
            )
        ).one()
        days_scheduled = db.execute(
            select(func.min(Shift.starts_at), func.max(Shift.starts_at)).where(
                Shift.organization_id == northgate
            )
        ).one()
        statuses = set(
            db.scalars(
                select(Invoice.status).where(Invoice.organization_id == northgate).distinct()
            )
        )
        db.rollback()

    assert meridian == operations.OperationsReport("meridian")  # it has its year already
    assert (report.work_orders, report.expenses) == (150, 200)
    assert report.timesheets > 3_000
    first_day, last_day = days_worked
    assert first_day >= (day.replace(day=1) - timedelta(days=366)).replace(day=1)
    assert day - timedelta(days=4) <= last_day < day
    first_shift, last_shift = days_scheduled
    assert first_shift.date() >= day - timedelta(days=29)
    assert day + timedelta(days=10) <= last_shift.date() <= day + timedelta(days=14)
    assert {InvoiceStatus.PAID, InvoiceStatus.DRAFT} <= statuses


def test_seed_command_can_be_run_again(
    history_runs: HistoryRuns, settings: Settings, monkeypatch, capsys
):
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    assert cli.main(["seed"]) == 0

    output = capsys.readouterr().out
    assert "Seed complete: 0 organizations, 0 users, 0 memberships created." in output
    assert "meridian: 0 customers, 0 buildings, 0 vendors, 0 job roles, 0 employees" in output
    assert "northgate: 0 customers, 0 buildings, 0 vendors, 0 job roles, 0 employees" in output
    nothing_more = (
        "0 work orders, 0 history entries, 0 shifts, 0 timesheets, 0 expenses,"
        " 0 invoices, 0 invoice lines, 0 payments created."
    )
    assert f"meridian: {nothing_more}" in output
    assert f"northgate: {nothing_more}" in output


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
