from typing import Annotated

from fastapi import APIRouter, Depends, Query

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.permissions import Permission
from buildingops.modules.analytics import service
from buildingops.modules.analytics.schemas import (
    BuildingsQuery,
    ContractsQuery,
    DashboardBuildings,
    DashboardContracts,
    DashboardSummary,
    DashboardTrends,
    DashboardWorkOrders,
    SummaryQuery,
    TrendsQuery,
    WorkOrdersQuery,
)

# Read only, and worked out from the records on every request: nothing is stored.
router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_Reader = Annotated[Context, Depends(require(Permission.DASHBOARD_READ))]

_PERIOD = (
    "A period is a run of calendar days where the organization is, from `from` to `to`,"
    " both included, and at most three years long."
)


@router.get(
    "/summary",
    summary="What the business earned, spent and is waiting on",
    description=(
        f"{_PERIOD} Revenue, costs, margin, collections and completed work orders are for"
        " the period, each beside the same figure for the period of equal length just"
        " before it. Outstanding and overdue invoices, pending approvals, open and overdue"
        " work orders and the counts of buildings, employees and vendors are as of today."
    ),
)
def read_dashboard_summary(
    query: Annotated[SummaryQuery, Query()], ctx: _Reader
) -> DashboardSummary:
    return service.summarize(ctx, query)


@router.get(
    "/trends",
    summary="Revenue, costs and work orders, month by month",
    description=(
        "The last `months` calendar months, oldest first, ending with the month still"
        " running. That one is flagged, and stops at today."
    ),
)
def read_dashboard_trends(query: Annotated[TrendsQuery, Query()], ctx: _Reader) -> DashboardTrends:
    return service.trends(ctx, query)


@router.get(
    "/contracts",
    summary="What each contract earned and cost",
    description=(
        f"{_PERIOD} Invoices, time and expenses that name no contract are reported together"
        " on a line of their own, so that the lines come to the organization's totals."
    ),
)
def read_dashboard_contracts(
    query: Annotated[ContractsQuery, Query()], ctx: _Reader
) -> DashboardContracts:
    return service.contract_profitability(ctx, query)


@router.get(
    "/buildings",
    summary="What each building cost, and the work at it",
    description=f"{_PERIOD} The 50 costliest buildings, costliest first.",
)
def read_dashboard_buildings(
    query: Annotated[BuildingsQuery, Query()], ctx: _Reader
) -> DashboardBuildings:
    return service.building_costs(ctx, query)


@router.get(
    "/work-orders",
    summary="Work orders by status today, and those raised in a period",
    description=(
        f"{_PERIOD} The counts by status are of every work order as it stands today. The"
        " counts by category and by priority are of the work orders raised in the period."
    ),
)
def read_dashboard_work_orders(
    query: Annotated[WorkOrdersQuery, Query()], ctx: _Reader
) -> DashboardWorkOrders:
    return service.work_order_counts(ctx, query)
