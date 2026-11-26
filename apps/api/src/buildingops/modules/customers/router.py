from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.customers import service
from buildingops.modules.customers.schemas import (
    CustomerCreate,
    CustomerFilters,
    CustomerRead,
    CustomerUpdate,
)

router = APIRouter(prefix="/customers", tags=["customers"])

_Reader = Annotated[Context, Depends(require(Permission.CUSTOMERS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.CUSTOMERS_WRITE))]


@router.get("", summary="List customers")
def list_customers(
    filters: Annotated[CustomerFilters, Query()], ctx: _Reader
) -> Page[CustomerRead]:
    items, total = service.list_customers(ctx, filters)
    return Page[CustomerRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Add a customer")
def create_customer(payload: CustomerCreate, ctx: _Writer) -> CustomerRead:
    return service.create_customer(ctx, payload)


@router.get("/{customer_id}", summary="Get a customer")
def read_customer(customer_id: UUID, ctx: _Reader) -> CustomerRead:
    return service.get_customer(ctx, customer_id)


@router.patch("/{customer_id}", summary="Update a customer")
def update_customer(customer_id: UUID, payload: CustomerUpdate, ctx: _Writer) -> CustomerRead:
    return service.update_customer(ctx, customer_id, payload)


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive a customer",
    description="Refused while the customer has buildings, or contracts not yet terminated.",
)
def archive_customer(customer_id: UUID, ctx: _Writer) -> Response:
    service.archive_customer(ctx, customer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
