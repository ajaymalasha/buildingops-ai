"""What the dashboard endpoints take and return.

Amounts are decimals, written as strings to the cent. Percentages are worked out from
those amounts to one decimal place, and are null where there is nothing to divide by:
never an error, and never a zero that was not measured.
"""

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from buildingops.core.schemas import ResponseModel
from buildingops.modules.buildings.schemas import BuildingSummary
from buildingops.modules.contracts.models import BillingModel
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.customers.schemas import CustomerSummary
from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.workorders.models import (
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderStatus,
)

# Three years, the longest of which has a leap day in it.
MAX_PERIOD_DAYS = 3 * 365 + 1
MAX_TREND_MONTHS = 36
# Nothing on record is older than this, and a period cannot start so far back that
# there is no room before it for the period it is compared with.
EARLIEST_DAY = date(1900, 1, 1)

PeriodDay = Annotated[date, Field(ge=EARLIEST_DAY)]

# --- what is asked for -------------------------------------------------------------------


class _Query(BaseModel):
    """A parameter an endpoint does not take is refused rather than ignored: a filter
    that was sent must never look as though it was applied."""

    model_config = ConfigDict(extra="forbid")


class PeriodQuery(_Query):
    from_: PeriodDay = Field(
        alias="from", description="First day of the period, where the organization is."
    )
    to: PeriodDay = Field(
        description="Last day of the period, included. At most three years after the first."
    )


class SummaryQuery(PeriodQuery):
    building_id: UUID | None = Field(
        default=None,
        description=(
            "Narrows costs, approvals and work orders to this building, and invoices to"
            " those of the contracts that cover it."
        ),
    )
    customer_id: UUID | None = Field(
        default=None,
        description=(
            "Narrows costs, approvals and work orders to this customer's buildings, and"
            " invoices to this customer's."
        ),
    )


class TrendsQuery(_Query):
    months: int = Field(
        default=12,
        ge=1,
        le=MAX_TREND_MONTHS,
        description="How many calendar months, counting the one still running.",
    )
    building_id: UUID | None = None
    customer_id: UUID | None = None


class ContractsQuery(PeriodQuery):
    customer_id: UUID | None = None


class BuildingsQuery(PeriodQuery):
    customer_id: UUID | None = None


class WorkOrdersQuery(PeriodQuery):
    building_id: UUID | None = None
    customer_id: UUID | None = None


# --- figures -----------------------------------------------------------------------------


class PeriodRead(ResponseModel):
    start: date
    end: date
    days: int = Field(description="How many days it covers, both ends included.")


class MoneyFigure(ResponseModel):
    """An amount for the period, beside the same amount for the period before it."""

    value: Decimal
    previous: Decimal
    change: Decimal = Field(description="`value` less `previous`.")
    change_percent: Decimal | None = Field(
        description=(
            "The change as a percentage of the size of `previous`. Null when `previous` is zero."
        )
    )


class CountFigure(ResponseModel):
    """A count for the period, beside the same count for the period before it."""

    value: int
    previous: int
    change: int
    change_percent: Decimal | None = Field(description="Null when `previous` is zero.")


class RateFigure(ResponseModel):
    """A percentage for the period, beside the same percentage for the period before it."""

    value: Decimal | None
    previous: Decimal | None
    change: Decimal | None = Field(
        description="In percentage points. Null unless both periods have a percentage."
    )


class CostShare(ResponseModel):
    category: Literal["labor"] | ExpenseCategory
    amount: Decimal
    share_percent: Decimal | None = Field(
        description="Of operating cost. Null when nothing was spent."
    )


class InvoicesOwed(ResponseModel):
    count: int
    amount: Decimal = Field(description="What is still owed on them.")


class PendingTime(ResponseModel):
    count: int
    hours: Decimal = Field(description="Regular and overtime hours together.")


class PendingSpending(ResponseModel):
    count: int
    amount: Decimal


class RecordCount(ResponseModel):
    total: int = Field(description="Every one that is not archived.")
    active: int = Field(description="Those of them whose status is active.")


SummaryFigure = Literal[
    "revenue",
    "margin",
    "margin_percent",
    "collected",
    "invoices_outstanding",
    "invoices_overdue",
    "employees",
    "vendors",
]


class SummaryScope(ResponseModel):
    """What the figures were narrowed to, and which of them could not be."""

    building_id: UUID | None
    customer_id: UUID | None
    organization_wide: list[SummaryFigure] = Field(
        description=(
            "Figures the filters in force cannot narrow. They are for the whole organization."
        )
    )
    by_contract: list[SummaryFigure] = Field(
        description=(
            "Figures a building filter narrows only as far as the contracts that cover the"
            " building. An invoice is counted in full, though its contract may cover other"
            " buildings too."
        )
    )


class DashboardSummary(ResponseModel):
    period: PeriodRead
    previous_period: PeriodRead = Field(
        description="The period of the same length that ends the day before `period` starts."
    )
    as_of: date = Field(description="Today, where the organization is.")
    currency: str
    scope: SummaryScope

    # For the period, each beside the period before it.
    revenue: MoneyFigure = Field(
        description="Totals of invoices that are issued or paid, by the day they were issued."
    )
    labor_cost: MoneyFigure = Field(
        description="Labor cost of approved timesheets, by the day worked."
    )
    expense_cost: MoneyFigure = Field(
        description="Amounts of approved expenses, by the day incurred."
    )
    operating_cost: MoneyFigure = Field(description="Labor cost and expense cost together.")
    margin: MoneyFigure = Field(description="Revenue less operating cost.")
    margin_percent: RateFigure = Field(description="Margin as a percentage of revenue.")
    collected: MoneyFigure = Field(description="Payments, by the day they were received.")
    work_orders_completed: CountFigure
    cost_by_category: list[CostShare] = Field(
        description="Operating cost for the period: labor, then each kind of expense."
    )

    # As of today, whatever the period.
    invoices_outstanding: InvoicesOwed = Field(description="Issued, with a balance due.")
    invoices_overdue: InvoicesOwed = Field(
        description="Those of the outstanding invoices that were due before today."
    )
    work_orders_open: int = Field(description="Open, scheduled, in progress or on hold.")
    work_orders_overdue: int = Field(description="Those of the open ones due before today.")
    timesheets_pending: PendingTime
    expenses_pending: PendingSpending
    buildings: RecordCount
    employees: RecordCount
    vendors: RecordCount


# --- trends ------------------------------------------------------------------------------


class MonthTrend(ResponseModel):
    month: date = Field(description="Its first day.")
    end: date = Field(description="The last day counted: today, for the month still running.")
    is_partial: bool = Field(description="True for the month still running.")
    revenue: Decimal
    labor_cost: Decimal
    expense_cost: Decimal
    operating_cost: Decimal
    margin: Decimal
    margin_percent: Decimal | None
    work_orders_opened: int
    work_orders_completed: int


class DashboardTrends(ResponseModel):
    as_of: date
    currency: str
    months: list[MonthTrend] = Field(description="Oldest first.")


# --- contracts ---------------------------------------------------------------------------


class ProfitLine(ResponseModel):
    revenue: Decimal
    labor_cost: Decimal
    expense_cost: Decimal
    operating_cost: Decimal
    margin: Decimal
    margin_percent: Decimal | None = Field(description="Null when there is no revenue.")


class ContractProfit(ProfitLine):
    contract: ContractRef
    customer: CustomerSummary
    billing_model: BillingModel


class DashboardContracts(ResponseModel):
    period: PeriodRead
    currency: str
    contracts: list[ContractProfit] = Field(
        description="Contracts with revenue or costs in the period, largest margin first."
    )
    unattributed: ProfitLine = Field(
        description="Invoices, time and expenses in the period that name no contract."
    )
    totals: ProfitLine = Field(
        description=(
            "Every line above together. They come to the summary's figures for the same"
            " period and customer."
        )
    )


# --- buildings ---------------------------------------------------------------------------


class BuildingCost(ResponseModel):
    building: BuildingSummary
    customer: CustomerSummary
    labor_cost: Decimal
    expense_cost: Decimal
    operating_cost: Decimal
    labor_hours: Decimal = Field(description="Approved regular and overtime hours.")
    work_orders_open: int = Field(description="As of today.")
    work_orders_completed: int = Field(description="In the period.")


class DashboardBuildings(ResponseModel):
    period: PeriodRead
    as_of: date
    currency: str
    buildings: list[BuildingCost] = Field(
        description=(
            "Buildings with costs, hours or work orders to show, costliest first. At most 50."
        )
    )


# --- work orders -------------------------------------------------------------------------


class StatusCount(ResponseModel):
    status: WorkOrderStatus
    count: int


class CategoryCount(ResponseModel):
    category: WorkOrderCategory
    count: int


class PriorityCount(ResponseModel):
    priority: WorkOrderPriority
    count: int


class DashboardWorkOrders(ResponseModel):
    period: PeriodRead
    as_of: date
    by_status: list[StatusCount] = Field(
        description="Every work order as it stands today, whatever the period."
    )
    opened: int = Field(description="Raised in the period.")
    opened_by_category: list[CategoryCount]
    opened_by_priority: list[PriorityCount]
