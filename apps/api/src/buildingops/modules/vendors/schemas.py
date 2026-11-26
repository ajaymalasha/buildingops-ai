from datetime import date, datetime
from uuid import UUID

from pydantic import Field

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    CountryCode,
    Notes,
    OptionalCode,
    OptionalEmail,
    OptionalText20,
    OptionalText40,
    OptionalText100,
    OptionalText200,
    PaymentTermsDays,
    RequestModel,
    ResponseModel,
    Text200,
)
from buildingops.modules.vendors.models import VendorCategory, VendorStatus


class VendorRef(ResponseModel):
    """A vendor as it appears inside another record."""

    id: UUID
    name: str


class VendorRead(VendorRef):
    code: str
    category: VendorCategory
    status: VendorStatus
    contact_name: str | None
    email: str | None
    phone: str | None
    address_line1: str | None
    address_line2: str | None
    city: str | None
    region: str | None
    postal_code: str | None
    country: str
    insurance_expires_on: date | None
    payment_terms_days: int
    notes: str | None
    created_at: datetime
    updated_at: datetime


class VendorCreate(RequestModel):
    name: Text200
    code: OptionalCode = Field(default=None, description="Generated (VEN-0001) when omitted.")
    category: VendorCategory
    status: VendorStatus = VendorStatus.ACTIVE
    contact_name: OptionalText200 = None
    email: OptionalEmail = None
    phone: OptionalText40 = None
    address_line1: OptionalText200 = None
    address_line2: OptionalText200 = None
    city: OptionalText100 = None
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode = "US"
    insurance_expires_on: date | None = None
    payment_terms_days: PaymentTermsDays = 30
    notes: Notes = None


class VendorUpdate(RequestModel):
    name: Text200 | None = None
    code: OptionalCode = None
    category: VendorCategory | None = None
    status: VendorStatus | None = None
    contact_name: OptionalText200 = None
    email: OptionalEmail = None
    phone: OptionalText40 = None
    address_line1: OptionalText200 = None
    address_line2: OptionalText200 = None
    city: OptionalText100 = None
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode | None = None
    insurance_expires_on: date | None = None
    payment_terms_days: PaymentTermsDays | None = None
    notes: Notes = None


class VendorFilters(PageParams):
    q: str | None = Field(
        default=None, max_length=200, description="Search name, code, contact and email."
    )
    status: VendorStatus | None = None
    category: VendorCategory | None = None
    sort: str | None = Field(
        default=None,
        description=(
            "One of name, code, insurance_expires_on, created_at. Prefix with - to reverse."
        ),
    )
