"""What each figure on the dashboard means: which records count, and what is added up.

Every figure is added up by PostgreSQL from the records themselves, and none of them is
stored. Each is defined here once, so that a total, its breakdown by contract or building
and its trend by month cannot disagree about what they include. `service.py` asks the
questions; this module says what the words in them mean.

Each set of conditions starts with the caller's organization. Row-level security would
hide another organization's rows as well, but it is the second check, not the one these
rely on.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    ColumnElement,
    Date,
    DateTime,
    SQLColumnExpression,
    cast,
    func,
    literal_column,
    select,
)

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.models import DecisionStatus
from buildingops.modules.analytics.periods import Period
from buildingops.modules.buildings.models import Building
from buildingops.modules.contracts.models import ContractBuilding
from buildingops.modules.expenses.models import Expense
from buildingops.modules.invoicing.models import Invoice, InvoiceStatus, Payment
from buildingops.modules.invoicing.service import BALANCE_DUE
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.workorders.models import WorkOrder, WorkOrderStatus

ZERO = Decimal("0.00")

# An invoice counts as revenue once it has gone to the customer. A draft has not, and a
# void one has been taken back.
BILLED_STATUSES = (InvoiceStatus.ISSUED, InvoiceStatus.PAID)

# The statuses in which work is still expected: all but completed and cancelled.
OPEN_STATUSES = (
    WorkOrderStatus.OPEN,
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.ON_HOLD,
)

# The time on a timesheet, regular and overtime together.
HOURS = Timesheet.hours_regular + Timesheet.hours_overtime


@dataclass(frozen=True, slots=True)
class Narrowing:
    """What a request narrows its figures to: one building, one customer, both or neither."""

    building_id: UUID | None = None
    customer_id: UUID | None = None

    @property
    def in_force(self) -> bool:
        return self.building_id is not None or self.customer_id is not None


@dataclass(frozen=True, slots=True)
class Figure:
    """A figure that is counted over a period: what is added up, the day on which each
    record counts, and which records count at all."""

    adds_up: ColumnElement[Any]
    day: SQLColumnExpression[Any]
    records: tuple[ColumnElement[bool], ...]

    def over(self, period: Period) -> tuple[ColumnElement[bool], ...]:
        """The conditions a record meets to count in `period`."""
        return (*self.records, within(self.day, period))


# --- building blocks ---------------------------------------------------------------------


def total(amount: SQLColumnExpression[Any]) -> ColumnElement[Decimal]:
    """The sum of `amount`, and 0.00 rather than null where there is nothing to add."""
    return func.coalesce(func.sum(amount), ZERO)


def within(day: SQLColumnExpression[Any], period: Period) -> ColumnElement[bool]:
    """Whether a calendar day falls in `period`, both of its ends included."""
    return day.between(period.start, period.end)


def local_day(moment: SQLColumnExpression[Any], zone: ZoneInfo) -> ColumnElement[date]:
    """The calendar day a moment fell on where the organization is.

    Moments are stored in UTC, and near midnight the day in UTC is not the organization's
    day. PostgreSQL does the conversion, with the rules for that zone on that date, so
    the day it compares and groups by is the one people there saw on the calendar.
    """
    local_time: ColumnElement[datetime] = func.timezone(zone.key, moment)
    return cast(local_time, Date)


def month_of(day: SQLColumnExpression[Any]) -> ColumnElement[date]:
    """The first day of the month a calendar day is in."""
    # Truncated as a time without a zone, so that no session setting can move the result.
    # The unit is written into the statement: as a parameter it would be a different one
    # in the select list and in GROUP BY, and PostgreSQL would not see the same expression.
    month_start = func.date_trunc(literal_column("'month'"), cast(day, DateTime(timezone=False)))
    return cast(month_start, Date)


def _at_buildings(
    ctx: Context, narrowing: Narrowing, building_id: SQLColumnExpression[Any]
) -> list[ColumnElement[bool]]:
    """Narrows records that belong to a building: to the building asked for, and to the
    buildings of the customer asked for. An archived building still counts: what was
    spent there was spent."""
    criteria: list[ColumnElement[bool]] = []
    if narrowing.building_id is not None:
        criteria.append(building_id == narrowing.building_id)
    if narrowing.customer_id is not None:
        criteria.append(
            building_id.in_(
                select(Building.id).where(
                    Building.organization_id == ctx.organization_id,
                    Building.customer_id == narrowing.customer_id,
                )
            )
        )
    return criteria


def _for_customer_or_contracts(ctx: Context, narrowing: Narrowing) -> list[ColumnElement[bool]]:
    """Narrows invoices: to the customer asked for, and to the contracts that cover the
    building asked for. An invoice is for a contract, not for a building, so that is as
    far as a building can narrow it."""
    criteria: list[ColumnElement[bool]] = []
    if narrowing.customer_id is not None:
        criteria.append(Invoice.customer_id == narrowing.customer_id)
    if narrowing.building_id is not None:
        criteria.append(
            select(ContractBuilding.id)
            .where(
                ContractBuilding.organization_id == ctx.organization_id,
                ContractBuilding.contract_id == Invoice.contract_id,
                ContractBuilding.building_id == narrowing.building_id,
            )
            .exists()
        )
    return criteria


# --- which records -----------------------------------------------------------------------


def timesheets(
    ctx: Context, narrowing: Narrowing, status: DecisionStatus
) -> tuple[ColumnElement[bool], ...]:
    return (
        crud.live(ctx, Timesheet),
        Timesheet.status == status,
        *_at_buildings(ctx, narrowing, Timesheet.building_id),
    )


def expenses(
    ctx: Context, narrowing: Narrowing, status: DecisionStatus
) -> tuple[ColumnElement[bool], ...]:
    """An expense that names no building belongs to no building, and so to no customer's
    buildings either: a narrowed figure leaves it out."""
    return (
        crud.live(ctx, Expense),
        Expense.status == status,
        *_at_buildings(ctx, narrowing, Expense.building_id),
    )


def billed_invoices(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    return (
        crud.live(ctx, Invoice),
        Invoice.status.in_(BILLED_STATUSES),
        *_for_customer_or_contracts(ctx, narrowing),
    )


def outstanding_invoices(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    """Invoices out with the customer on which something is still owed."""
    return (
        crud.live(ctx, Invoice),
        Invoice.status == InvoiceStatus.ISSUED,
        BALANCE_DUE > 0,
        *_for_customer_or_contracts(ctx, narrowing),
    )


def payments(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    """Payments, on whatever invoice they were made. Narrowed as their invoices are."""
    of_invoices = _for_customer_or_contracts(ctx, narrowing)
    if not of_invoices:
        return (crud.live(ctx, Payment),)
    return (
        crud.live(ctx, Payment),
        Payment.invoice_id.in_(select(Invoice.id).where(crud.live(ctx, Invoice), *of_invoices)),
    )


def work_orders(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    return (crud.live(ctx, WorkOrder), *_at_buildings(ctx, narrowing, WorkOrder.building_id))


def open_work_orders(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    return (*work_orders(ctx, narrowing), WorkOrder.status.in_(OPEN_STATUSES))


def live_buildings(ctx: Context, narrowing: Narrowing) -> tuple[ColumnElement[bool], ...]:
    """The buildings that are not archived: the one asked for, or the customer's."""
    criteria = [crud.live(ctx, Building)]
    if narrowing.building_id is not None:
        criteria.append(Building.id == narrowing.building_id)
    if narrowing.customer_id is not None:
        criteria.append(Building.customer_id == narrowing.customer_id)
    return tuple(criteria)


# --- the figures counted over a period ---------------------------------------------------


def labor_cost(ctx: Context, narrowing: Narrowing) -> Figure:
    """What approved time cost, on the day it was worked."""
    return Figure(
        total(Timesheet.labor_cost),
        Timesheet.work_date,
        timesheets(ctx, narrowing, DecisionStatus.APPROVED),
    )


def labor_hours(ctx: Context, narrowing: Narrowing) -> Figure:
    """The approved hours behind the labor cost."""
    return Figure(
        total(HOURS), Timesheet.work_date, timesheets(ctx, narrowing, DecisionStatus.APPROVED)
    )


def expense_cost(ctx: Context, narrowing: Narrowing) -> Figure:
    """What approved expenses came to, on the day each was incurred."""
    return Figure(
        total(Expense.amount),
        Expense.incurred_on,
        expenses(ctx, narrowing, DecisionStatus.APPROVED),
    )


def revenue(ctx: Context, narrowing: Narrowing) -> Figure:
    """What was invoiced, on the day each invoice was issued."""
    return Figure(total(Invoice.total), Invoice.issue_date, billed_invoices(ctx, narrowing))


def collected(ctx: Context, narrowing: Narrowing) -> Figure:
    """What customers paid, on the day each payment was received."""
    return Figure(total(Payment.amount), Payment.received_on, payments(ctx, narrowing))


def work_orders_opened(ctx: Context, narrowing: Narrowing, zone: ZoneInfo) -> Figure:
    """Work orders raised, on the day it was where the organization is."""
    return Figure(func.count(), local_day(WorkOrder.created_at, zone), work_orders(ctx, narrowing))


def work_orders_completed(ctx: Context, narrowing: Narrowing, zone: ZoneInfo) -> Figure:
    """Work orders finished, on the day it was where the organization is. Reopening a work
    order clears the time it was finished, so it counts again only when it is finished
    again."""
    return Figure(
        func.count(), local_day(WorkOrder.completed_at, zone), work_orders(ctx, narrowing)
    )
