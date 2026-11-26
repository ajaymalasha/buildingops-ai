"""The dashboard's figures, worked out from the records each time they are asked for.

Nothing here writes, and nothing is kept. `definitions.py` says which records each figure
counts, and this module has PostgreSQL add them up, a few statements to an endpoint. The
arithmetic done in Python is only what the figures are defined by: operating cost is
labor plus expenses, margin is revenue less cost, and a change is one period's figure
less the other's. It is done on the totals PostgreSQL returns, as decimals.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import (
    ColumnElement,
    FromClause,
    Row,
    SQLColumnExpression,
    Subquery,
    and_,
    func,
    literal,
    select,
    true,
    tuple_,
    union_all,
)

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.models import DecisionStatus
from buildingops.core.pagination import check_date_range
from buildingops.modules.analytics import definitions
from buildingops.modules.analytics.definitions import (
    HOURS,
    ZERO,
    Figure,
    Narrowing,
    month_of,
    total,
)
from buildingops.modules.analytics.periods import Period, months_to_date
from buildingops.modules.analytics.schemas import (
    MAX_PERIOD_DAYS,
    BuildingCost,
    BuildingsQuery,
    CategoryCount,
    ContractProfit,
    ContractsQuery,
    CostShare,
    CountFigure,
    DashboardBuildings,
    DashboardContracts,
    DashboardSummary,
    DashboardTrends,
    DashboardWorkOrders,
    InvoicesOwed,
    MoneyFigure,
    MonthTrend,
    PendingSpending,
    PendingTime,
    PeriodQuery,
    PeriodRead,
    PriorityCount,
    ProfitLine,
    RateFigure,
    RecordCount,
    StatusCount,
    SummaryQuery,
    SummaryScope,
    TrendsQuery,
    WorkOrdersQuery,
)
from buildingops.modules.buildings.models import Building, BuildingStatus
from buildingops.modules.buildings.schemas import BuildingSummary
from buildingops.modules.contracts.models import Contract
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.customers.models import Customer
from buildingops.modules.customers.schemas import CustomerSummary
from buildingops.modules.expenses.models import Expense, ExpenseCategory
from buildingops.modules.identity import organizations_service
from buildingops.modules.invoicing import service as invoices_service
from buildingops.modules.invoicing.models import Invoice
from buildingops.modules.invoicing.service import BALANCE_DUE
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.vendors.models import Vendor, VendorStatus
from buildingops.modules.workforce.models import Employee, EmployeeStatus
from buildingops.modules.workorders import service as work_orders_service
from buildingops.modules.workorders.models import (
    WorkOrder,
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderStatus,
)

# How many buildings the comparison of buildings returns: the costliest ones.
TOP_BUILDINGS = 50

# A row of whatever a statement selects, read by the names its columns were given.
type _AnyRow = Row[*tuple[Any, ...]]

_ONE_PLACE = Decimal("0.1")
# What a part of a combined statement puts in a column it has nothing to say about.
_NO_MONEY: ColumnElement[Any] = literal(ZERO)
_NO_COUNT: ColumnElement[Any] = literal(0)


def _percent(part: Decimal, whole: Decimal) -> Decimal | None:
    """`part` as a percentage of `whole`, to one decimal place, half up as money is
    rounded. None when `whole` is zero: there is no percentage of nothing."""
    if whole == 0:
        return None
    percent = (part * 100 / whole).quantize(_ONE_PLACE, rounding=ROUND_HALF_UP)
    # A share too small to show rounds to zero, and zero has no sign. Without this a loss
    # of a cent on a large contract would be reported as "-0.0".
    return abs(percent) if percent.is_zero() else percent


@dataclass(frozen=True, slots=True)
class _Ledger:
    """Revenue and the two kinds of cost of one thing: a period, a month, a contract.
    What follows from them is worked out the same way for each."""

    revenue: Decimal = ZERO
    labor_cost: Decimal = ZERO
    expense_cost: Decimal = ZERO

    @property
    def operating_cost(self) -> Decimal:
        return self.labor_cost + self.expense_cost

    @property
    def margin(self) -> Decimal:
        return self.revenue - self.operating_cost

    @property
    def margin_percent(self) -> Decimal | None:
        return _percent(self.margin, self.revenue)


@dataclass(frozen=True, slots=True)
class _PeriodTotals(_Ledger):
    collected: Decimal = ZERO
    work_orders_completed: int = 0


@dataclass(frozen=True, slots=True)
class _Setting:
    """Where the organization is, what day it is there, and what it counts money in."""

    zone: ZoneInfo
    today: date
    currency: str


def _setting(ctx: Context) -> _Setting:
    # Held on to while the zone and the day are asked for: the session then answers from
    # the row it has, instead of reading the organization again for each.
    organization = organizations_service.get_current(ctx)
    return _Setting(
        zone=organizations_service.time_zone(ctx),
        today=organizations_service.today(ctx),
        currency=organization.currency,
    )


def _period(query: PeriodQuery) -> Period:
    check_date_range(query.from_, query.to, max_days=MAX_PERIOD_DAYS)
    return Period(query.from_, query.to)


# --- summary -----------------------------------------------------------------------------


def summarize(ctx: Context, query: SummaryQuery) -> DashboardSummary:
    period = _period(query)
    previous = period.previous()
    setting = _setting(ctx)
    narrowing = Narrowing(building_id=query.building_id, customer_id=query.customer_id)

    now = _period_totals(ctx, narrowing, setting.zone, period)
    before = _period_totals(ctx, narrowing, setting.zone, previous)
    spent_on = _expenses_by_category(ctx, narrowing, period)
    standing = _standing(ctx, narrowing, setting.today)

    costs = [("labor", now.labor_cost)]
    costs += [(category, spent_on.get(category, ZERO)) for category in ExpenseCategory]
    return DashboardSummary(
        period=PeriodRead.model_validate(period),
        previous_period=PeriodRead.model_validate(previous),
        as_of=setting.today,
        currency=setting.currency,
        scope=_scope(narrowing),
        revenue=_money(now.revenue, before.revenue),
        labor_cost=_money(now.labor_cost, before.labor_cost),
        expense_cost=_money(now.expense_cost, before.expense_cost),
        operating_cost=_money(now.operating_cost, before.operating_cost),
        margin=_money(now.margin, before.margin),
        margin_percent=_rate(now.margin_percent, before.margin_percent),
        collected=_money(now.collected, before.collected),
        work_orders_completed=_count(now.work_orders_completed, before.work_orders_completed),
        cost_by_category=[
            CostShare(
                category=category,
                amount=amount,
                share_percent=_percent(amount, now.operating_cost),
            )
            for category, amount in costs
        ],
        invoices_outstanding=InvoicesOwed(
            count=standing.outstanding_count, amount=standing.outstanding_amount
        ),
        invoices_overdue=InvoicesOwed(count=standing.overdue_count, amount=standing.overdue_amount),
        work_orders_open=standing.work_orders_open,
        work_orders_overdue=standing.work_orders_overdue,
        timesheets_pending=PendingTime(
            count=standing.timesheets_pending, hours=standing.hours_pending
        ),
        expenses_pending=PendingSpending(
            count=standing.expenses_pending, amount=standing.amount_pending
        ),
        buildings=RecordCount(total=standing.buildings, active=standing.buildings_active),
        employees=RecordCount(total=standing.employees, active=standing.employees_active),
        vendors=RecordCount(total=standing.vendors, active=standing.vendors_active),
    )


def _period_totals(
    ctx: Context, narrowing: Narrowing, zone: ZoneInfo, period: Period
) -> _PeriodTotals:
    """Every figure that is counted over a period, for `period`. The period it is compared
    with is put through the same statement, so the two cannot be defined differently."""

    def over_period(figure: Figure) -> ColumnElement[Any]:
        return select(figure.adds_up).where(*figure.over(period)).scalar_subquery()

    revenue, labor_cost, expense_cost, collected, completed = ctx.db.execute(
        select(
            over_period(definitions.revenue(ctx, narrowing)),
            over_period(definitions.labor_cost(ctx, narrowing)),
            over_period(definitions.expense_cost(ctx, narrowing)),
            over_period(definitions.collected(ctx, narrowing)),
            over_period(definitions.work_orders_completed(ctx, narrowing, zone)),
        )
    ).one()
    return _PeriodTotals(revenue, labor_cost, expense_cost, collected, completed)


def _expenses_by_category(
    ctx: Context, narrowing: Narrowing, period: Period
) -> dict[ExpenseCategory, Decimal]:
    spending = definitions.expense_cost(ctx, narrowing)
    rows = ctx.db.execute(
        select(Expense.category, spending.adds_up)
        .where(*spending.over(period))
        .group_by(Expense.category)
    )
    return dict(rows.all())


def _standing(ctx: Context, narrowing: Narrowing, today: date) -> _AnyRow:
    """Where things stand today, whatever the period: one row, a few columns from each
    table. Every part is an aggregate with no grouping, so each yields exactly one row
    and joining them unconditionally yields one."""
    invoice_overdue = invoices_service.overdue(today)
    parts = [
        select(
            func.count().label("outstanding_count"),
            total(BALANCE_DUE).label("outstanding_amount"),
            func.count().filter(invoice_overdue).label("overdue_count"),
            func.coalesce(func.sum(BALANCE_DUE).filter(invoice_overdue), ZERO).label(
                "overdue_amount"
            ),
        )
        .select_from(Invoice)
        .where(*definitions.outstanding_invoices(ctx, narrowing)),
        select(
            func.count().label("work_orders_open"),
            func.count().filter(work_orders_service.overdue(today)).label("work_orders_overdue"),
        )
        .select_from(WorkOrder)
        .where(*definitions.open_work_orders(ctx, narrowing)),
        select(func.count().label("timesheets_pending"), total(HOURS).label("hours_pending"))
        .select_from(Timesheet)
        .where(*definitions.timesheets(ctx, narrowing, DecisionStatus.PENDING)),
        select(
            func.count().label("expenses_pending"), total(Expense.amount).label("amount_pending")
        )
        .select_from(Expense)
        .where(*definitions.expenses(ctx, narrowing, DecisionStatus.PENDING)),
        select(
            func.count().label("buildings"),
            func.count().filter(Building.status == BuildingStatus.ACTIVE).label("buildings_active"),
        )
        .select_from(Building)
        .where(*definitions.live_buildings(ctx, narrowing)),
        # Nothing ties an employee or a vendor to a building or a customer, so these two
        # are never narrowed. The response says so.
        select(
            func.count().label("employees"),
            func.count().filter(Employee.status == EmployeeStatus.ACTIVE).label("employees_active"),
        )
        .select_from(Employee)
        .where(crud.live(ctx, Employee)),
        select(
            func.count().label("vendors"),
            func.count().filter(Vendor.status == VendorStatus.ACTIVE).label("vendors_active"),
        )
        .select_from(Vendor)
        .where(crud.live(ctx, Vendor)),
    ]
    first, *rest = (part.subquery() for part in parts)
    joined: FromClause = first
    for part in rest:
        joined = joined.join(part, true())
    return ctx.db.execute(select(first, *rest).select_from(joined)).one()


def _scope(narrowing: Narrowing) -> SummaryScope:
    return SummaryScope(
        building_id=narrowing.building_id,
        customer_id=narrowing.customer_id,
        organization_wide=["employees", "vendors"] if narrowing.in_force else [],
        by_contract=(
            [
                "revenue",
                "margin",
                "margin_percent",
                "collected",
                "invoices_outstanding",
                "invoices_overdue",
            ]
            if narrowing.building_id is not None
            else []
        ),
    )


def _money(value: Decimal, previous: Decimal) -> MoneyFigure:
    change = value - previous
    return MoneyFigure(
        value=value,
        previous=previous,
        change=change,
        change_percent=_percent(change, abs(previous)),
    )


def _count(value: int, previous: int) -> CountFigure:
    change = value - previous
    return CountFigure(
        value=value,
        previous=previous,
        change=change,
        change_percent=_percent(Decimal(change), Decimal(previous)),
    )


def _rate(value: Decimal | None, previous: Decimal | None) -> RateFigure:
    change = None if value is None or previous is None else value - previous
    return RateFigure(value=value, previous=previous, change=change)


# --- one row for each month, contract or building ----------------------------------------


@dataclass(frozen=True, slots=True)
class _Part:
    """One kind of record added up by a key: timesheets by month, invoices by contract."""

    key: SQLColumnExpression[Any]
    measures: Mapping[str, ColumnElement[Any]]
    criteria: Sequence[ColumnElement[bool]]


def _side_by_side(columns: Mapping[str, ColumnElement[Any]], parts: Sequence[_Part]) -> Subquery:
    """One row for each key, with what every part adds up for it side by side.

    Labor comes from timesheets, revenue from invoices and so on, each grouped by the
    same key. The groups are stacked and added up once more by that key, in one
    statement. `columns` names every measure, and gives what stands in for it in the
    rows of a part that does not measure it: nothing, as money or as a count.
    """
    stacked = union_all(
        *(
            select(
                part.key.label("key"),
                *(
                    part.measures.get(name, nothing).label(name)
                    for name, nothing in columns.items()
                ),
            )
            .where(*part.criteria)
            .group_by(part.key)
            for part in parts
        )
    ).subquery()
    return (
        select(stacked.c.key, *(func.sum(stacked.c[name]).label(name) for name in columns))
        .group_by(stacked.c.key)
        .subquery()
    )


def _ledger(row: _AnyRow | None) -> _Ledger:
    if row is None:
        return _Ledger()
    return _Ledger(row.revenue, row.labor_cost, row.expense_cost)


# --- trends ------------------------------------------------------------------------------


def trends(ctx: Context, query: TrendsQuery) -> DashboardTrends:
    setting = _setting(ctx)
    narrowing = Narrowing(building_id=query.building_id, customer_id=query.customer_id)
    months = months_to_date(setting.today, query.months)
    window = Period(months[0].start, setting.today)

    figures = {
        "revenue": definitions.revenue(ctx, narrowing),
        "labor_cost": definitions.labor_cost(ctx, narrowing),
        "expense_cost": definitions.expense_cost(ctx, narrowing),
        "work_orders_opened": definitions.work_orders_opened(ctx, narrowing, setting.zone),
        "work_orders_completed": definitions.work_orders_completed(ctx, narrowing, setting.zone),
    }
    by_month = _side_by_side(
        {
            "revenue": _NO_MONEY,
            "labor_cost": _NO_MONEY,
            "expense_cost": _NO_MONEY,
            "work_orders_opened": _NO_COUNT,
            "work_orders_completed": _NO_COUNT,
        },
        [
            _Part(month_of(figure.day), {name: figure.adds_up}, figure.over(window))
            for name, figure in figures.items()
        ],
    )
    found = {row.key: row for row in ctx.db.execute(select(by_month))}

    def trend(month: Period) -> MonthTrend:
        row = found.get(month.start)
        return MonthTrend.from_record(
            _ledger(row),
            month=month.start,
            end=month.end,
            is_partial=month is months[-1],
            # A month in which nothing happened has no row, and so nothing of either.
            work_orders_opened=int(row.work_orders_opened) if row else 0,
            work_orders_completed=int(row.work_orders_completed) if row else 0,
        )

    return DashboardTrends(
        as_of=setting.today, currency=setting.currency, months=[trend(month) for month in months]
    )


# --- contracts ---------------------------------------------------------------------------


def contract_profitability(ctx: Context, query: ContractsQuery) -> DashboardContracts:
    period = _period(query)
    setting = _setting(ctx)
    narrowing = Narrowing(customer_id=query.customer_id)

    revenue = definitions.revenue(ctx, narrowing)
    labor_cost = definitions.labor_cost(ctx, narrowing)
    expense_cost = definitions.expense_cost(ctx, narrowing)
    by_contract = _side_by_side(
        {"revenue": _NO_MONEY, "labor_cost": _NO_MONEY, "expense_cost": _NO_MONEY},
        [
            _Part(Invoice.contract_id, {"revenue": revenue.adds_up}, revenue.over(period)),
            _Part(
                Timesheet.contract_id, {"labor_cost": labor_cost.adds_up}, labor_cost.over(period)
            ),
            _Part(
                Expense.contract_id,
                {"expense_cost": expense_cost.adds_up},
                expense_cost.over(period),
            ),
        ],
    )
    lines = by_contract.c
    margin = lines.revenue - lines.labor_cost - lines.expense_cost
    # Records that name no contract share one key, null, and so make one row with no
    # contract to go with it: the outer join keeps that row.
    rows = ctx.db.execute(
        select(Contract, Customer, by_contract)
        .select_from(by_contract)
        .outerjoin(
            Contract,
            and_(Contract.organization_id == ctx.organization_id, Contract.id == lines.key),
        )
        .outerjoin(
            Customer,
            and_(
                Customer.organization_id == ctx.organization_id,
                Customer.id == Contract.customer_id,
            ),
        )
        .order_by(margin.desc(), Contract.contract_number)
    ).all()
    totals = ctx.db.execute(
        select(
            total(lines.revenue).label("revenue"),
            total(lines.labor_cost).label("labor_cost"),
            total(lines.expense_cost).label("expense_cost"),
        )
    ).one()

    unattributed = next((row for row in rows if row.Contract is None), None)
    return DashboardContracts(
        period=PeriodRead.model_validate(period),
        currency=setting.currency,
        contracts=[
            ContractProfit.from_record(
                _ledger(row),
                contract=ContractRef.model_validate(row.Contract),
                customer=CustomerSummary.model_validate(row.Customer),
                billing_model=row.Contract.billing_model,
            )
            for row in rows
            if row.Contract is not None
        ],
        unattributed=ProfitLine.model_validate(_ledger(unattributed)),
        totals=ProfitLine.model_validate(_ledger(totals)),
    )


# --- buildings ---------------------------------------------------------------------------


def building_costs(ctx: Context, query: BuildingsQuery) -> DashboardBuildings:
    period = _period(query)
    setting = _setting(ctx)
    narrowing = Narrowing(customer_id=query.customer_id)

    labor_cost = definitions.labor_cost(ctx, narrowing)
    labor_hours = definitions.labor_hours(ctx, narrowing)
    expense_cost = definitions.expense_cost(ctx, narrowing)
    completed = definitions.work_orders_completed(ctx, narrowing, setting.zone)
    by_building = _side_by_side(
        {
            "labor_cost": _NO_MONEY,
            "labor_hours": _NO_MONEY,
            "expense_cost": _NO_MONEY,
            "work_orders_open": _NO_COUNT,
            "work_orders_completed": _NO_COUNT,
        },
        [
            _Part(
                Timesheet.building_id,
                {"labor_cost": labor_cost.adds_up, "labor_hours": labor_hours.adds_up},
                labor_cost.over(period),
            ),
            _Part(
                Expense.building_id,
                {"expense_cost": expense_cost.adds_up},
                expense_cost.over(period),
            ),
            _Part(
                WorkOrder.building_id,
                {"work_orders_open": func.count()},
                definitions.open_work_orders(ctx, narrowing),
            ),
            _Part(
                WorkOrder.building_id,
                {"work_orders_completed": completed.adds_up},
                completed.over(period),
            ),
        ],
    )
    lines = by_building.c
    # The joins do not ask for live rows. An archived building, or one whose customer has
    # been archived since, is still shown: what was spent there was spent. Expenses that
    # name no building share a key that matches none, and so are nobody's line.
    rows = ctx.db.execute(
        select(Building, Customer, by_building)
        .select_from(by_building)
        .join(
            Building,
            and_(Building.organization_id == ctx.organization_id, Building.id == lines.key),
        )
        .join(
            Customer,
            and_(
                Customer.organization_id == ctx.organization_id,
                Customer.id == Building.customer_id,
            ),
        )
        .order_by((lines.labor_cost + lines.expense_cost).desc(), Building.name, Building.id)
        .limit(TOP_BUILDINGS)
    ).all()

    return DashboardBuildings(
        period=PeriodRead.model_validate(period),
        as_of=setting.today,
        currency=setting.currency,
        buildings=[
            BuildingCost(
                building=BuildingSummary.model_validate(row.Building),
                customer=CustomerSummary.model_validate(row.Customer),
                labor_cost=row.labor_cost,
                expense_cost=row.expense_cost,
                operating_cost=row.labor_cost + row.expense_cost,
                labor_hours=row.labor_hours,
                work_orders_open=int(row.work_orders_open),
                work_orders_completed=int(row.work_orders_completed),
            )
            for row in rows
        ],
    )


# --- work orders -------------------------------------------------------------------------


def work_order_counts(ctx: Context, query: WorkOrdersQuery) -> DashboardWorkOrders:
    period = _period(query)
    setting = _setting(ctx)
    narrowing = Narrowing(building_id=query.building_id, customer_id=query.customer_id)

    standing: dict[WorkOrderStatus, int] = dict(
        ctx.db.execute(
            select(WorkOrder.status, func.count())
            .where(*definitions.work_orders(ctx, narrowing))
            .group_by(WorkOrder.status)
        ).all()
    )
    # Grouped three ways at once: by category, by priority, and not at all for the total.
    # In each row, whatever it was not grouped by is null.
    opened = definitions.work_orders_opened(ctx, narrowing, setting.zone)
    groups = ctx.db.execute(
        select(WorkOrder.category, WorkOrder.priority, opened.adds_up)
        .where(*opened.over(period))
        .group_by(
            func.grouping_sets(tuple_(WorkOrder.category), tuple_(WorkOrder.priority), tuple_())
        )
    ).all()
    by_category = {category: count for category, _, count in groups if category is not None}
    by_priority = {priority: count for _, priority, count in groups if priority is not None}
    (opened_in_all,) = (
        count for category, priority, count in groups if category is None and priority is None
    )

    return DashboardWorkOrders(
        period=PeriodRead.model_validate(period),
        as_of=setting.today,
        by_status=[
            StatusCount(status=status, count=standing.get(status, 0)) for status in WorkOrderStatus
        ],
        opened=opened_in_all,
        opened_by_category=[
            CategoryCount(category=category, count=by_category.get(category, 0))
            for category in WorkOrderCategory
        ],
        opened_by_priority=[
            PriorityCount(priority=priority, count=by_priority.get(priority, 0))
            for priority in WorkOrderPriority
        ],
    )
