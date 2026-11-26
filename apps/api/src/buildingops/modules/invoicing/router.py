from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.invoicing import service
from buildingops.modules.invoicing.schemas import InvoiceDetail, InvoiceFilters, InvoiceRead

# Read only. Generating invoices and recording payments belong to the billing module.
router = APIRouter(prefix="/invoices", tags=["invoices"])

_Reader = Annotated[Context, Depends(require(Permission.INVOICES_READ))]


@router.get("", summary="List invoices")
def list_invoices(filters: Annotated[InvoiceFilters, Query()], ctx: _Reader) -> Page[InvoiceRead]:
    items, total = service.list_invoices(ctx, filters)
    return Page[InvoiceRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.get("/{invoice_id}", summary="Get an invoice with its lines and payments")
def read_invoice(invoice_id: UUID, ctx: _Reader) -> InvoiceDetail:
    return service.get_invoice(ctx, invoice_id)
