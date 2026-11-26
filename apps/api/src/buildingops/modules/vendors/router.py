from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.vendors import service
from buildingops.modules.vendors.schemas import (
    VendorCreate,
    VendorFilters,
    VendorRead,
    VendorUpdate,
)

router = APIRouter(prefix="/vendors", tags=["vendors"])

_Reader = Annotated[Context, Depends(require(Permission.VENDORS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.VENDORS_WRITE))]


@router.get("", summary="List vendors")
def list_vendors(filters: Annotated[VendorFilters, Query()], ctx: _Reader) -> Page[VendorRead]:
    items, total = service.list_vendors(ctx, filters)
    return Page[VendorRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Add a vendor")
def create_vendor(payload: VendorCreate, ctx: _Writer) -> VendorRead:
    return service.create_vendor(ctx, payload)


@router.get("/{vendor_id}", summary="Get a vendor")
def read_vendor(vendor_id: UUID, ctx: _Reader) -> VendorRead:
    return service.get_vendor(ctx, vendor_id)


@router.patch("/{vendor_id}", summary="Update a vendor")
def update_vendor(vendor_id: UUID, payload: VendorUpdate, ctx: _Writer) -> VendorRead:
    return service.update_vendor(ctx, vendor_id, payload)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Archive a vendor")
def archive_vendor(vendor_id: UUID, ctx: _Writer) -> Response:
    service.archive_vendor(ctx, vendor_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
