from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    CountryCode,
    Notes,
    OptionalCode,
    OptionalText20,
    OptionalText100,
    OptionalText200,
    RequestModel,
    ResponseModel,
    Text100,
    Text200,
)
from buildingops.modules.buildings.models import BuildingStatus, BuildingType
from buildingops.modules.customers.schemas import CustomerSummary

# Upper limits far beyond any real building, there so that a typing slip is an error here
# rather than an overflow in the database.
SquareFeet = Annotated[int, Field(gt=0, le=100_000_000)]
Floors = Annotated[int, Field(gt=0, le=500)]


class BuildingRef(ResponseModel):
    """A building as it appears inside another record."""

    id: UUID
    name: str


class BuildingSummary(BuildingRef):
    code: str


class BuildingRead(BuildingSummary):
    building_type: BuildingType
    status: BuildingStatus
    address_line1: str
    address_line2: str | None
    city: str
    region: str | None
    postal_code: str | None
    country: str
    square_feet: int | None
    floors: int | None
    notes: str | None
    customer: CustomerSummary
    created_at: datetime
    updated_at: datetime


class BuildingCreate(RequestModel):
    customer_id: UUID
    name: Text200
    code: OptionalCode = Field(default=None, description="Generated (BLD-0001) when omitted.")
    building_type: BuildingType
    status: BuildingStatus = BuildingStatus.ACTIVE
    address_line1: Text200
    address_line2: OptionalText200 = None
    city: Text100
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode = "US"
    square_feet: SquareFeet | None = None
    floors: Floors | None = None
    notes: Notes = None


class BuildingUpdate(RequestModel):
    customer_id: UUID | None = None
    name: Text200 | None = None
    code: OptionalCode = None
    building_type: BuildingType | None = None
    status: BuildingStatus | None = None
    address_line1: Text200 | None = None
    address_line2: OptionalText200 = None
    city: Text100 | None = None
    region: OptionalText100 = None
    postal_code: OptionalText20 = None
    country: CountryCode | None = None
    square_feet: SquareFeet | None = None
    floors: Floors | None = None
    notes: Notes = None


class BuildingFilters(PageParams):
    q: str | None = Field(
        default=None, max_length=200, description="Search name, code, address and customer."
    )
    status: BuildingStatus | None = None
    building_type: BuildingType | None = None
    customer_id: UUID | None = None
    sort: str | None = Field(
        default=None,
        description="One of name, code, city, square_feet, created_at. Prefix with - to reverse.",
    )
