"""Expenses of the active organization: entering them, and deciding on them."""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select

from buildingops.core import crud, decisions
from buildingops.core.context import Context
from buildingops.core.errors import NotFoundError
from buildingops.core.pagination import apply_sort, between_dates, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts import service as contracts_service
from buildingops.modules.contracts.models import Contract
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.expenses.models import Expense
from buildingops.modules.expenses.schemas import (
    ExpenseCreate,
    ExpenseFilters,
    ExpenseRead,
    ExpenseUpdate,
)
from buildingops.modules.identity import organizations_service
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.vendors.schemas import VendorRef
from buildingops.modules.workorders.models import WorkOrder
from buildingops.modules.workorders.schemas import WorkOrderRef

_SORTABLE = {
    "incurred_on": Expense.incurred_on,
    "amount": Expense.amount,
    "created_at": Expense.created_at,
}


def _expenses(ctx: Context) -> Select[Expense, Building, Contract, Vendor, WorkOrder]:
    """Each expense with what it was for, where that is recorded, archived or not."""
    return (
        select(Expense, Building, Contract, Vendor, WorkOrder)
        .outerjoin(Building, Building.id == Expense.building_id)
        .outerjoin(Contract, Contract.id == Expense.contract_id)
        .outerjoin(Vendor, Vendor.id == Expense.vendor_id)
        .outerjoin(WorkOrder, WorkOrder.id == Expense.work_order_id)
        .where(crud.live(ctx, Expense))
    )


def _to_read(
    expense: Expense,
    building: Building | None,
    contract: Contract | None,
    vendor: Vendor | None,
    work_order: WorkOrder | None,
) -> ExpenseRead:
    return ExpenseRead.from_record(
        expense,
        building=BuildingRef.model_validate(building) if building else None,
        contract=ContractRef.model_validate(contract) if contract else None,
        vendor=VendorRef.model_validate(vendor) if vendor else None,
        work_order=WorkOrderRef.model_validate(work_order) if work_order else None,
    )


def _label(expense: Expense) -> str:
    return f"{expense.description} ({expense.amount} {expense.currency})"


def list_expenses(ctx: Context, filters: ExpenseFilters) -> tuple[list[ExpenseRead], int]:
    statement = _expenses(ctx)
    if filters.status:
        statement = statement.where(Expense.status == filters.status)
    if filters.category:
        statement = statement.where(Expense.category == filters.category)
    if filters.building_id:
        statement = statement.where(Expense.building_id == filters.building_id)
    if filters.contract_id:
        statement = statement.where(Expense.contract_id == filters.contract_id)
    if filters.vendor_id:
        statement = statement.where(Expense.vendor_id == filters.vendor_id)
    statement = between_dates(statement, Expense.incurred_on, filters.from_, filters.to)
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="-incurred_on", tiebreaker=Expense.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(*row) for row in rows], total


def get_expense(ctx: Context, expense_id: UUID) -> ExpenseRead:
    row = ctx.db.execute(_expenses(ctx).where(Expense.id == expense_id)).one_or_none()
    if row is None:
        raise NotFoundError("Expense not found.")
    return _to_read(*row)


def create_expense(ctx: Context, data: ExpenseCreate) -> ExpenseRead:
    values = data.model_dump()
    _check_references(ctx, values)
    values["currency"] = organizations_service.get_current(ctx).currency
    expense = Expense(organization_id=ctx.organization_id, **values)
    crud.create(ctx, expense, entity_type="expense", summary=f"Entered expense {_label(expense)}")
    return get_expense(ctx, expense.id)


def update_expense(ctx: Context, expense_id: UUID, data: ExpenseUpdate) -> ExpenseRead:
    # Locked, so that it cannot be approved half way through being changed.
    expense = crud.get_or_404(ctx, Expense, expense_id, label="Expense", for_update=True)
    decisions.ensure_editable(expense, entity_type="expense")
    requested = crud.requested_changes(Expense, data)
    _check_references(ctx, requested, expense)
    crud.update(
        ctx,
        expense,
        requested,
        entity_type="expense",
        summary=f"Updated expense {_label(expense)}",
    )
    return get_expense(ctx, expense.id)


def approve_expense(ctx: Context, expense_id: UUID) -> ExpenseRead:
    expense = _for_decision(ctx, expense_id)
    decisions.approve(
        ctx, expense, entity_type="expense", summary=f"Approved expense {_label(expense)}"
    )
    return get_expense(ctx, expense.id)


def reject_expense(ctx: Context, expense_id: UUID, data: decisions.Rejection) -> ExpenseRead:
    expense = _for_decision(ctx, expense_id)
    decisions.reject(
        ctx,
        expense,
        data.reason,
        entity_type="expense",
        summary=f"Rejected expense {_label(expense)}",
    )
    return get_expense(ctx, expense.id)


def reopen_expense(ctx: Context, expense_id: UUID) -> ExpenseRead:
    expense = _for_decision(ctx, expense_id)
    decisions.reopen(
        ctx, expense, entity_type="expense", summary=f"Reopened expense {_label(expense)}"
    )
    return get_expense(ctx, expense.id)


def _for_decision(ctx: Context, expense_id: UUID) -> Expense:
    """The expense, locked so that it is decided on as it stands."""
    return crud.get_or_404(ctx, Expense, expense_id, label="Expense", for_update=True)


def _check_references(
    ctx: Context, values: Mapping[str, Any], expense: Expense | None = None
) -> None:
    """Check the building, contract, vendor and work order that `values` ties the expense to.

    `expense` is the record being updated, or None for one about to be created.
    """
    crud.new_reference(
        ctx, Building, values, "building_id", message="Building not found.", record=expense
    )
    contracts_service.check_coverage(
        ctx,
        values,
        building_id=expense.building_id if expense else None,
        contract_id=expense.contract_id if expense else None,
    )
    crud.new_reference(
        ctx, Vendor, values, "vendor_id", message="Vendor not found.", record=expense
    )
    crud.new_reference(
        ctx, WorkOrder, values, "work_order_id", message="Work order not found.", record=expense
    )
