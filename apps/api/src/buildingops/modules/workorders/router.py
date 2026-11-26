from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.workorders import service
from buildingops.modules.workorders.schemas import (
    WorkOrderActivityRead,
    WorkOrderCommentCreate,
    WorkOrderCreate,
    WorkOrderDetail,
    WorkOrderFilters,
    WorkOrderRead,
    WorkOrderStatusChange,
    WorkOrderUpdate,
)

router = APIRouter(prefix="/work-orders", tags=["work orders"])

_Reader = Annotated[Context, Depends(require(Permission.WORK_ORDERS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.WORK_ORDERS_WRITE))]


@router.get("", summary="List work orders")
def list_work_orders(
    filters: Annotated[WorkOrderFilters, Query()], ctx: _Reader
) -> Page[WorkOrderRead]:
    items, total = service.list_work_orders(ctx, filters)
    return Page[WorkOrderRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Add a work order",
    description="It starts as open and is given the next number (WO-0001).",
)
def create_work_order(payload: WorkOrderCreate, ctx: _Writer) -> WorkOrderDetail:
    return service.create_work_order(ctx, payload)


@router.get("/{work_order_id}", summary="Get a work order and its history")
def read_work_order(work_order_id: UUID, ctx: _Reader) -> WorkOrderDetail:
    return service.get_work_order(ctx, work_order_id)


@router.patch(
    "/{work_order_id}",
    summary="Update a work order",
    description="Changes its details and who it is assigned to. The status has its own endpoint.",
)
def update_work_order(
    work_order_id: UUID, payload: WorkOrderUpdate, ctx: _Writer
) -> WorkOrderDetail:
    return service.update_work_order(ctx, work_order_id, payload)


@router.post(
    "/{work_order_id}/status",
    summary="Move a work order to another status",
    description=(
        "Open goes to scheduled, in progress, on hold or cancelled. Scheduled goes to in"
        " progress, on hold, cancelled or back to open. In progress goes to on hold, completed"
        " or cancelled. On hold goes to open, scheduled, in progress or cancelled. Completed"
        " can be reopened as in progress, and cancelled as open. Any other move is a 409."
    ),
)
def change_work_order_status(
    work_order_id: UUID, payload: WorkOrderStatusChange, ctx: _Writer
) -> WorkOrderDetail:
    return service.change_status(ctx, work_order_id, payload)


@router.post(
    "/{work_order_id}/comments",
    status_code=status.HTTP_201_CREATED,
    summary="Comment on a work order",
)
def add_work_order_comment(
    work_order_id: UUID, payload: WorkOrderCommentCreate, ctx: _Writer
) -> WorkOrderActivityRead:
    return service.add_comment(ctx, work_order_id, payload)
