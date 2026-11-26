from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.scheduling import service
from buildingops.modules.scheduling.schemas import (
    ShiftCreate,
    ShiftFilters,
    ShiftRead,
    ShiftUpdate,
)

router = APIRouter(prefix="/shifts", tags=["shifts"])

_Reader = Annotated[Context, Depends(require(Permission.SCHEDULE_READ))]
_Writer = Annotated[Context, Depends(require(Permission.SCHEDULE_WRITE))]


@router.get(
    "",
    summary="List the shifts that start within a range of days",
    description="Both `from` and `to` are required, and may be at most 62 days apart.",
)
def list_shifts(filters: Annotated[ShiftFilters, Query()], ctx: _Reader) -> Page[ShiftRead]:
    items, total = service.list_shifts(ctx, filters)
    return Page[ShiftRead](items=items, total=total, page=filters.page, page_size=filters.page_size)


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a shift",
    description="Refused with a 409 if it overlaps another shift of the same employee.",
)
def create_shift(payload: ShiftCreate, ctx: _Writer) -> ShiftRead:
    return service.create_shift(ctx, payload)


@router.get("/{shift_id}", summary="Get a shift")
def read_shift(shift_id: UUID, ctx: _Reader) -> ShiftRead:
    return service.get_shift(ctx, shift_id)


@router.patch(
    "/{shift_id}",
    summary="Update a shift",
    description="Moves it, or marks it completed or missed. A cancelled shift cannot be changed.",
)
def update_shift(shift_id: UUID, payload: ShiftUpdate, ctx: _Writer) -> ShiftRead:
    return service.update_shift(ctx, shift_id, payload)


@router.post(
    "/{shift_id}/cancel",
    summary="Cancel a scheduled shift",
    description="The shift stays on record, and no longer counts when looking for overlaps.",
)
def cancel_shift(shift_id: UUID, ctx: _Writer) -> ShiftRead:
    return service.cancel_shift(ctx, shift_id)
