"""What the database itself refuses of operational records, whatever the application does.

As in `test_master_data_constraints.py`, every case writes as the owner role, which
bypasses row-level security and never goes through a service. The schema comparison in
`test_schema_invariants.py` sees neither CHECK constraints nor exclusion constraints, so
each one is exercised here.
"""

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from buildingops.core.db import Database
from buildingops.core.models import DecisionStatus, utcnow
from buildingops.modules.identity.models import Organization
from buildingops.modules.invoicing.models import InvoiceLine
from buildingops.modules.scheduling.models import ShiftStatus
from buildingops.modules.workorders.models import WorkOrderActivity
from tests.conftest import Factory

START = datetime(2026, 3, 2, 14, tzinfo=UTC)


def _hours(count: float) -> timedelta:
    return timedelta(hours=count)


# Each writes a row in the first organization that points at a row in the second.
CROSS_ORGANIZATION_REFERENCES: dict[str, Callable[[Factory, Organization, Organization], object]]
CROSS_ORGANIZATION_REFERENCES = {
    "fk_work_orders_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.work_order(here, factory.building(there))
    ),
    "fk_work_orders_organization_id_contract_id_contracts": (
        lambda factory, here, there: factory.work_order(
            here, contract_id=factory.contract(there).id
        )
    ),
    "fk_work_orders_organization_id_assigned_employee_id_employees": (
        lambda factory, here, there: factory.work_order(
            here, assigned_employee_id=factory.employee(there).id
        )
    ),
    "fk_work_orders_organization_id_vendor_id_vendors": (
        lambda factory, here, there: factory.work_order(here, vendor_id=factory.vendor(there).id)
    ),
    "fk_work_order_activities_work_order_id_work_orders": (
        lambda factory, here, there: factory.work_order_activity(
            factory.work_order(there), organization=here
        )
    ),
    "fk_shifts_organization_id_employee_id_employees": (
        lambda factory, here, there: factory.shift(
            factory.employee(there), factory.building(here), organization=here
        )
    ),
    "fk_shifts_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.shift(factory.employee(here), factory.building(there))
    ),
    "fk_timesheets_organization_id_employee_id_employees": (
        lambda factory, here, there: factory.timesheet(
            factory.employee(there), factory.building(here), organization=here
        )
    ),
    "fk_timesheets_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.timesheet(
            factory.employee(here), factory.building(there)
        )
    ),
    "fk_timesheets_organization_id_contract_id_contracts": (
        lambda factory, here, there: factory.timesheet(
            factory.employee(here), factory.building(here), contract_id=factory.contract(there).id
        )
    ),
    "fk_timesheets_organization_id_shift_id_shifts": (
        lambda factory, here, there: factory.timesheet(
            factory.employee(here),
            factory.building(here),
            shift_id=factory.shift(factory.employee(there), factory.building(there)).id,
        )
    ),
    "fk_expenses_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.expense(here, building_id=factory.building(there).id)
    ),
    "fk_expenses_organization_id_contract_id_contracts": (
        lambda factory, here, there: factory.expense(here, contract_id=factory.contract(there).id)
    ),
    "fk_expenses_organization_id_vendor_id_vendors": (
        lambda factory, here, there: factory.expense(here, vendor_id=factory.vendor(there).id)
    ),
    "fk_expenses_organization_id_work_order_id_work_orders": (
        lambda factory, here, there: factory.expense(
            here, work_order_id=factory.work_order(there).id
        )
    ),
    "fk_invoices_organization_id_customer_id_customers": (
        lambda factory, here, there: factory.invoice(here, factory.customer(there))
    ),
    "fk_invoices_organization_id_contract_id_contracts": (
        lambda factory, here, there: factory.invoice(here, contract_id=factory.contract(there).id)
    ),
    "fk_invoice_lines_organization_id_invoice_id_invoices": (
        lambda factory, here, there: factory.invoice_line(factory.invoice(there), organization=here)
    ),
    "fk_payments_organization_id_invoice_id_invoices": (
        lambda factory, here, there: factory.payment(factory.invoice(there), organization=here)
    ),
}


def _shift(factory: Factory, organization: Organization, **fields: object) -> None:
    factory.shift(factory.employee(organization), factory.building(organization), **fields)


def _two_shifts_at_once(factory: Factory, organization: Organization) -> None:
    employee = factory.employee(organization)
    factory.shift(
        employee, factory.building(organization), starts_at=START, ends_at=START + _hours(8)
    )
    factory.shift(
        employee,
        factory.building(organization),
        starts_at=START + _hours(7),
        ends_at=START + _hours(15),
    )


def _timesheet(factory: Factory, organization: Organization, **fields: object) -> None:
    factory.timesheet(factory.employee(organization), factory.building(organization), **fields)


def _same_timesheet_twice(factory: Factory, organization: Organization) -> None:
    employee, building = factory.employee(organization), factory.building(organization)
    factory.timesheet(employee, building)
    factory.timesheet(employee, building)


# Each breaks the rule its constraint is named for, and no other, inside one organization.
RULES: dict[str, Callable[[Factory, Organization], object]] = {
    # Uniqueness.
    "uq_work_orders_organization_id_number": lambda factory, organization: [
        factory.work_order(organization, number="SAME") for _ in range(2)
    ],
    "uq_timesheets_employee_id_work_date_building_id": _same_timesheet_twice,
    "uq_invoices_organization_id_number": lambda factory, organization: [
        factory.invoice(organization, number="SAME") for _ in range(2)
    ],
    "uq_invoice_lines_invoice_id_position": lambda factory, organization: factory.invoice(
        organization, lines=[{"position": 1}, {"position": 1}]
    ),
    # Work orders.
    "ck_work_orders_completed_not_before_started": lambda factory, organization: factory.work_order(
        organization, started_at=START, completed_at=START - _hours(1)
    ),
    # Shifts.
    "ex_shifts_employee_id_no_overlap": _two_shifts_at_once,
    "ck_shifts_ends_after_start": lambda factory, organization: _shift(
        factory, organization, starts_at=START, ends_at=START
    ),
    "ck_shifts_at_most_24_hours": lambda factory, organization: _shift(
        factory, organization, starts_at=START, ends_at=START + timedelta(hours=24, seconds=1)
    ),
    "ck_shifts_break_minutes_range": lambda factory, organization: _shift(
        factory, organization, break_minutes=241
    ),
    # Timesheets. The cost is given, so that only the figure under test is out of line.
    "ck_timesheets_hours_regular_range": lambda factory, organization: _timesheet(
        factory,
        organization,
        hours_regular=Decimal("-1.00"),
        hours_overtime=Decimal("2.00"),
        labor_cost=Decimal("0.00"),
    ),
    "ck_timesheets_hours_overtime_range": lambda factory, organization: _timesheet(
        factory, organization, hours_overtime=Decimal("-1.00"), labor_cost=Decimal("0.00")
    ),
    "ck_timesheets_total_hours_range": lambda factory, organization: _timesheet(
        factory, organization, hours_regular=Decimal("13.00"), hours_overtime=Decimal("11.01")
    ),
    "ck_timesheets_hourly_rate_not_negative": lambda factory, organization: _timesheet(
        factory, organization, hourly_rate=Decimal("-0.01"), labor_cost=Decimal("0.00")
    ),
    "ck_timesheets_overtime_multiplier_range": lambda factory, organization: _timesheet(
        factory, organization, overtime_multiplier=Decimal("0.99")
    ),
    "ck_timesheets_labor_cost_not_negative": lambda factory, organization: _timesheet(
        factory, organization, labor_cost=Decimal("-0.01")
    ),
    "ck_timesheets_decided_unless_pending": lambda factory, organization: _timesheet(
        factory, organization, status=DecisionStatus.APPROVED, decided_at=None
    ),
    # Expenses.
    "ck_expenses_amount_positive": lambda factory, organization: factory.expense(
        organization, amount=Decimal("0.00")
    ),
    "ck_expenses_decided_unless_pending": lambda factory, organization: factory.expense(
        organization, decided_at=utcnow()
    ),
    # Invoices and payments.
    "ck_invoices_period_end_not_before_start": lambda factory, organization: factory.invoice(
        organization, period_start=date(2026, 3, 1), period_end=date(2026, 2, 28)
    ),
    "ck_invoices_total_adds_up": lambda factory, organization: factory.invoice(
        organization,
        subtotal=Decimal("1000.00"),
        markup_amount=Decimal("125.00"),
        total=Decimal("1125.01"),
    ),
    "ck_invoices_amounts_not_negative": lambda factory, organization: factory.invoice(
        organization, tax_amount=Decimal("-1.00")
    ),
    "ck_invoices_amount_paid_within_total": lambda factory, organization: factory.invoice(
        organization, amount_paid=Decimal("1000.01")
    ),
    "ck_payments_amount_positive": lambda factory, organization: factory.payment(
        factory.invoice(organization), amount=Decimal("0.00")
    ),
}

# Enumerations are stored as text with a CHECK constraint. The ORM refuses an unknown value
# before it reaches the database, so these go in as plain SQL.
ENUMERATIONS = {
    "ck_work_orders_workordercategory": "UPDATE work_orders SET category = 'painting'",
    "ck_work_orders_workorderpriority": "UPDATE work_orders SET priority = 'asap'",
    "ck_work_orders_workorderstatus": "UPDATE work_orders SET status = 'lost'",
    "ck_work_orders_workordersource": "UPDATE work_orders SET source = 'rumour'",
    "ck_work_order_activities_workorderactivitykind": (
        "UPDATE work_order_activities SET kind = 'retraction'"
    ),
    "ck_shifts_shiftstatus": "UPDATE shifts SET status = 'swapped'",
    "ck_timesheets_timesheetsource": "UPDATE timesheets SET source = 'guess'",
    "ck_timesheets_decisionstatus": "UPDATE timesheets SET status = 'waived'",
    "ck_expenses_expensecategory": "UPDATE expenses SET category = 'gifts'",
    "ck_expenses_decisionstatus": "UPDATE expenses SET status = 'waived'",
    "ck_invoices_invoicestatus": "UPDATE invoices SET status = 'disputed'",
    "ck_invoice_lines_invoicelinekind": "UPDATE invoice_lines SET kind = 'discount'",
    "ck_payments_paymentmethod": "UPDATE payments SET method = 'barter'",
}


@pytest.mark.parametrize("constraint", CROSS_ORGANIZATION_REFERENCES)
def test_a_record_cannot_refer_to_a_row_in_another_organization(factory: Factory, constraint: str):
    """The composite foreign keys hold even for a role that row-level security does not bind."""
    here, there = factory.organization(), factory.organization()

    with pytest.raises(IntegrityError, match=constraint):
        CROSS_ORGANIZATION_REFERENCES[constraint](factory, here, there)


@pytest.mark.parametrize("constraint", RULES)
def test_the_database_enforces_each_rule(factory: Factory, constraint: str):
    organization = factory.organization()

    with pytest.raises(IntegrityError, match=constraint):
        RULES[constraint](factory, organization)


@pytest.mark.parametrize("constraint", ENUMERATIONS)
def test_the_database_accepts_only_the_listed_values(
    admin_database: Database, factory: Factory, constraint: str
):
    organization = factory.organization()
    factory.work_order_activity(factory.work_order(organization))
    employee, building = factory.employee(organization), factory.building(organization)
    factory.shift(employee, building)
    # Decided ones, so that an unknown status breaks this rule and not the one about decisions.
    factory.timesheet(employee, building, status=DecisionStatus.APPROVED)
    factory.expense(organization, status=DecisionStatus.APPROVED)
    factory.invoice(organization, lines=[{}], payments=[{"amount": Decimal("10.00")}])

    with admin_database.session() as db, pytest.raises(IntegrityError, match=constraint):
        db.execute(
            text(f"{ENUMERATIONS[constraint]} WHERE organization_id = :organization"),
            {"organization": organization.id},
        )


def test_a_pending_record_cannot_carry_a_decision(factory: Factory):
    """The other direction of `decided_unless_pending`."""
    organization = factory.organization()

    with pytest.raises(IntegrityError, match="ck_timesheets_decided_unless_pending"):
        _timesheet(factory, organization, decided_at=utcnow())


def test_shifts_that_do_not_overlap_are_left_alone(factory: Factory):
    """What the exclusion constraint does not refuse: back-to-back shifts, cancelled ones,
    and other people's."""
    organization = factory.organization()
    employee, colleague = factory.employee(organization), factory.employee(organization)
    building = factory.building(organization)

    factory.shift(employee, building, starts_at=START, ends_at=START + _hours(8))
    factory.shift(employee, building, starts_at=START + _hours(8), ends_at=START + _hours(12))
    factory.shift(employee, building, starts_at=START - _hours(4), ends_at=START)
    factory.shift(
        employee,
        building,
        starts_at=START + _hours(1),
        ends_at=START + _hours(2),
        status=ShiftStatus.CANCELLED,
    )
    factory.shift(colleague, building, starts_at=START, ends_at=START + _hours(8))


def test_a_cancelled_shift_cannot_come_back_over_another(
    admin_database: Database, factory: Factory
):
    organization = factory.organization()
    employee, building = factory.employee(organization), factory.building(organization)
    cancelled = factory.shift(employee, building, status=ShiftStatus.CANCELLED)
    factory.shift(employee, building)

    with (
        admin_database.session() as db,
        pytest.raises(IntegrityError, match="ex_shifts_employee_id_no_overlap"),
    ):
        db.execute(
            text("UPDATE shifts SET status = 'scheduled' WHERE id = :id"), {"id": cancelled.id}
        )


def test_a_full_day_and_its_limits_are_accepted(factory: Factory):
    """The edges the range checks include: a 24-hour shift with the longest break, a
    24-hour day, time that costs nothing, a one-cent expense, and invoices paid in full
    or for nothing at all."""
    organization = factory.organization()

    _shift(factory, organization, starts_at=START, ends_at=START + _hours(24), break_minutes=240)
    _timesheet(factory, organization, hours_regular=Decimal("24.00"))
    _timesheet(
        factory,
        organization,
        hours_regular=Decimal("0.00"),
        hours_overtime=Decimal("0.25"),
        overtime_multiplier=Decimal("3.00"),
        hourly_rate=Decimal("0.00"),
    )
    factory.expense(organization, amount=Decimal("0.01"))
    factory.invoice(organization, amount_paid=Decimal("1000.00"))
    factory.invoice(organization, subtotal=Decimal("0.00"))


def test_deleting_a_record_takes_its_parts_but_not_its_payments(
    admin_database: Database, factory: Factory
):
    """Activities and invoice lines are parts of their parent and go with it. A payment is
    money received, and holds its invoice in place."""
    organization = factory.organization()
    work_order = factory.work_order(organization)
    factory.work_order_activity(work_order)
    invoice = factory.invoice(organization, lines=[{}])
    paid = factory.invoice(organization, lines=[{}], payments=[{"amount": Decimal("10.00")}])

    with admin_database.session() as db:
        db.execute(text("DELETE FROM work_orders WHERE id = :id"), {"id": work_order.id})
        db.execute(text("DELETE FROM invoices WHERE id = :id"), {"id": invoice.id})
        activities = db.scalar(
            select(func.count())
            .select_from(WorkOrderActivity)
            .where(WorkOrderActivity.work_order_id == work_order.id)
        )
        lines = db.scalar(
            select(func.count())
            .select_from(InvoiceLine)
            .where(InvoiceLine.invoice_id == invoice.id)
        )
        db.commit()
    assert (activities, lines) == (0, 0)

    with (
        admin_database.session() as db,
        pytest.raises(IntegrityError, match="fk_payments_organization_id_invoice_id_invoices"),
    ):
        db.execute(text("DELETE FROM invoices WHERE id = :id"), {"id": paid.id})
