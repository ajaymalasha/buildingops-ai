"""Builds each organization's year of work and writes it.

Tens of thousands of rows go in, so they are built as plain dictionaries and inserted in
bulk, a table at a time, rather than as one object after another.
"""

from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from buildingops.core.models import Base
from buildingops.modules.expenses.models import Expense
from buildingops.modules.identity.models import Organization
from buildingops.modules.invoicing.models import Invoice, InvoiceLine, Payment
from buildingops.modules.invoicing.service import INVOICE_NUMBERS
from buildingops.modules.scheduling.models import Shift
from buildingops.modules.sequences.service import CodeSeries, allocate_codes
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.workorders.models import WorkOrder, WorkOrderActivity
from buildingops.modules.workorders.service import WORK_ORDER_NUMBERS
from buildingops.seed.catalog import DIRECTORIES
from buildingops.seed.operations.billing import Ledger
from buildingops.seed.operations.expenses import build_expenses
from buildingops.seed.operations.invoices import build_invoices
from buildingops.seed.operations.setting import Row, Setting, load_setting
from buildingops.seed.operations.timekeeping import build_time
from buildingops.seed.operations.work_orders import build_jobs


@dataclass(slots=True)
class OperationsReport:
    """What one run created for an organization. All zeros if it already had work orders."""

    organization_slug: str
    work_orders: int = 0
    activities: int = 0
    shifts: int = 0
    timesheets: int = 0
    expenses: int = 0
    invoices: int = 0
    invoice_lines: int = 0
    payments: int = 0


def seed_operations(db: Session, today: date | None = None) -> list[OperationsReport]:
    """Give each demo organization its year of work, unless it already has work orders.

    `today` anchors the dates. It defaults to the current date where the organization is.
    """
    reports = []
    for spec in DIRECTORIES:
        organization = db.scalars(
            select(Organization).where(Organization.slug == spec.organization_slug)
        ).one()
        report = OperationsReport(spec.organization_slug)
        any_work_order = db.scalar(
            select(WorkOrder.id).where(WorkOrder.organization_id == organization.id).limit(1)
        )
        if any_work_order is None:
            anchor = today or datetime.now(ZoneInfo(organization.timezone)).date()
            setting = load_setting(db, organization, spec, anchor)
            # An organization with no buildings has nowhere for any of this to happen.
            if setting.sites:
                _seed(db, setting, report)
        reports.append(report)
    return reports


def _seed(db: Session, setting: Setting, report: OperationsReport) -> None:
    # Time and expenses are booked to the ledger as they are built, and the invoices are
    # then worked out from it. That order is what makes them add up.
    ledger = Ledger()
    shifts, timesheets = build_time(setting, ledger)
    jobs = build_jobs(setting)
    expenses = build_expenses(setting, ledger, jobs)
    invoices, invoice_lines, payments = build_invoices(setting, ledger)

    work_orders = [job.row for job in jobs]
    activities = [activity for job in jobs for activity in job.activities]
    # Numbered in the order they were raised or drawn up, from the sequences the API
    # uses, so that it carries on from here.
    _number(db, setting, WORK_ORDER_NUMBERS, work_orders)
    _number(db, setting, INVOICE_NUMBERS, invoices)

    # A table after the tables its rows point at.
    _insert(db, WorkOrder, work_orders)
    _insert(db, WorkOrderActivity, activities)
    _insert(db, Shift, shifts)
    _insert(db, Timesheet, timesheets)
    _insert(db, Expense, expenses)
    _insert(db, Invoice, invoices)
    _insert(db, InvoiceLine, invoice_lines)
    _insert(db, Payment, payments)

    report.work_orders = len(work_orders)
    report.activities = len(activities)
    report.shifts = len(shifts)
    report.timesheets = len(timesheets)
    report.expenses = len(expenses)
    report.invoices = len(invoices)
    report.invoice_lines = len(invoice_lines)
    report.payments = len(payments)


def _number(db: Session, setting: Setting, series: CodeSeries, rows: list[Row]) -> None:
    numbers = allocate_codes(
        db, setting.organization.id, series.name, series.prefix, count=len(rows)
    )
    for row, number in zip(rows, numbers, strict=True):
        row["number"] = number


def _insert(db: Session, model: type[Base], rows: list[Row]) -> None:
    """Insert `rows` in as few statements as the driver allows.

    Left to itself, a bulk insert leaves a column out of a row whose value for it is None,
    so that a server default can apply. Rows with different columns cannot share a
    statement, and a table where most rows have some empty column would go in a few rows
    at a time. Writing the nulls out keeps every row the same shape.
    """
    if rows:
        db.execute(insert(model), rows, execution_options={"render_nulls": True})
