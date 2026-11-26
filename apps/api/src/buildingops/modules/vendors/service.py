"""Vendors of the active organization."""

from uuid import UUID

from sqlalchemy import select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.pagination import apply_sort, paginate_scalars
from buildingops.modules.sequences.service import CodeSeries
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.vendors.schemas import (
    VendorCreate,
    VendorFilters,
    VendorRead,
    VendorUpdate,
)

VENDOR_CODES = CodeSeries("vendor", "VEN")

_SORTABLE = {
    "name": Vendor.name,
    "code": Vendor.code,
    "insurance_expires_on": Vendor.insurance_expires_on,
    "created_at": Vendor.created_at,
}


def _label(vendor: Vendor) -> str:
    return f"{vendor.name} ({vendor.code})"


def list_vendors(ctx: Context, filters: VendorFilters) -> tuple[list[VendorRead], int]:
    statement = select(Vendor).where(crud.live(ctx, Vendor))
    if filters.status:
        statement = statement.where(Vendor.status == filters.status)
    if filters.category:
        statement = statement.where(Vendor.category == filters.category)
    statement = crud.search(
        statement, filters.q, Vendor.name, Vendor.code, Vendor.contact_name, Vendor.email
    )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Vendor.id
    )
    vendors, total = paginate_scalars(ctx.db, statement, filters)
    return [VendorRead.model_validate(vendor) for vendor in vendors], total


def get_vendor(ctx: Context, vendor_id: UUID) -> VendorRead:
    return VendorRead.model_validate(crud.get_or_404(ctx, Vendor, vendor_id, label="Vendor"))


def create_vendor(ctx: Context, data: VendorCreate) -> VendorRead:
    values = data.model_dump()
    values["code"] = crud.assign_code(ctx, Vendor, Vendor.code, data.code, series=VENDOR_CODES)
    vendor = Vendor(organization_id=ctx.organization_id, **values)
    crud.create(ctx, vendor, entity_type="vendor", summary=f"Created vendor {_label(vendor)}")
    return VendorRead.model_validate(vendor)


def update_vendor(ctx: Context, vendor_id: UUID, data: VendorUpdate) -> VendorRead:
    vendor = crud.get_or_404(ctx, Vendor, vendor_id, label="Vendor")
    requested = crud.requested_changes(Vendor, data)
    if "code" in requested:
        crud.ensure_unique(
            ctx,
            Vendor,
            Vendor.code == requested["code"],
            field="code",
            message=f"{requested['code']} is already in use.",
            excluding=vendor.id,
        )
    crud.update(
        ctx, vendor, requested, entity_type="vendor", summary=f"Updated vendor {_label(vendor)}"
    )
    return VendorRead.model_validate(vendor)


def archive_vendor(ctx: Context, vendor_id: UUID) -> None:
    # Work orders and expenses name vendors, and go on naming one after it is archived.
    # They are history rather than dependants, so nothing can stand in the way.
    vendor = crud.get_or_404(ctx, Vendor, vendor_id, label="Vendor")
    crud.archive(ctx, vendor, entity_type="vendor", summary=f"Archived vendor {_label(vendor)}")
