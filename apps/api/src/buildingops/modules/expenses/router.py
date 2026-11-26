from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.decisions import Rejection
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.expenses import service
from buildingops.modules.expenses.schemas import (
    ExpenseCreate,
    ExpenseFilters,
    ExpenseRead,
    ExpenseUpdate,
)

router = APIRouter(prefix="/expenses", tags=["expenses"])

_Reader = Annotated[Context, Depends(require(Permission.EXPENSES_READ))]
_Writer = Annotated[Context, Depends(require(Permission.EXPENSES_WRITE))]
_Approver = Annotated[Context, Depends(require(Permission.EXPENSES_APPROVE))]


@router.get("", summary="List expenses")
def list_expenses(filters: Annotated[ExpenseFilters, Query()], ctx: _Reader) -> Page[ExpenseRead]:
    items, total = service.list_expenses(ctx, filters)
    return Page[ExpenseRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Enter an expense",
    description="It starts as pending, in the organization's currency.",
)
def create_expense(payload: ExpenseCreate, ctx: _Writer) -> ExpenseRead:
    return service.create_expense(ctx, payload)


@router.get("/{expense_id}", summary="Get an expense")
def read_expense(expense_id: UUID, ctx: _Reader) -> ExpenseRead:
    return service.get_expense(ctx, expense_id)


@router.patch(
    "/{expense_id}",
    summary="Update a pending expense",
    description="Refused with a 409 once the expense has been approved or rejected.",
)
def update_expense(expense_id: UUID, payload: ExpenseUpdate, ctx: _Writer) -> ExpenseRead:
    return service.update_expense(ctx, expense_id, payload)


@router.post("/{expense_id}/approve", summary="Approve an expense")
def approve_expense(expense_id: UUID, ctx: _Approver) -> ExpenseRead:
    return service.approve_expense(ctx, expense_id)


@router.post("/{expense_id}/reject", summary="Reject an expense, with a reason")
def reject_expense(expense_id: UUID, payload: Rejection, ctx: _Approver) -> ExpenseRead:
    return service.reject_expense(ctx, expense_id, payload)


@router.post(
    "/{expense_id}/reopen",
    summary="Return a decided expense to pending",
    description="Clears the decision, so that the expense can be edited and decided again.",
)
def reopen_expense(expense_id: UUID, ctx: _Approver) -> ExpenseRead:
    return service.reopen_expense(ctx, expense_id)
