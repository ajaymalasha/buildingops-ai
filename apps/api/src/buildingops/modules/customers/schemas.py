from datetime import datetime
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
from buildingops.modules.customers.models import CustomerStatus


class CustomerSummary(ResponseModel):
    """A customer as it appears inside another record."""

    id: UUID
    name: str
    code: str


class CustomerRead(CustomerSummary):
    status: CustomerStatus
    contact_name: str | None
    email: str | None
    phone: str | None
    address_line1: str | None
    address_line2: str | None
    city: str | None
    region: str | None
    postal_code: str | None
    country: str
    payment_terms_days: int
    notes: str | None
    building_count: int = Field(description="Buildings of this customer that are not archived.")
    created_at: datetime
    updated_at: datetime


class CustomerCreate(RequestModel):
    name: Text200
    code: OptionalCode = Field(default=None, description="Generated (CUS-0001) when omitted.")
    status: CustomerStatus = CustomerStatus.ACTIVE
    contact_name: OptionalText200 = None
    email: OptionalEmail = None
    phone: OptionalText40 = None
    address_line1: OptionalText200 = None
    address_line2: OptionalText200 = None
    city: OptionalText100 = None
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode = "US"
    payment_terms_days: PaymentTermsDays = 30
    notes: Notes = None


class CustomerUpdate(RequestModel):
    name: Text200 | None = None
    code: OptionalCode = None
    status: CustomerStatus | None = None
    contact_name: OptionalText200 = None
    email: OptionalEmail = None
    phone: OptionalText40 = None
    address_line1: OptionalText200 = None
    address_line2: OptionalText200 = None
    city: OptionalText100 = None
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode | None = None
    payment_terms_days: PaymentTermsDays | None = None
    notes: Notes = None


class CustomerFilters(PageParams):
    q: str | None = Field(
        default=None, max_length=200, description="Search name, code, contact and email."
    )
    status: CustomerStatus | None = None
    sort: str | None = Field(
        default=None, description="One of name, code, created_at. Prefix with - to reverse."
    )
