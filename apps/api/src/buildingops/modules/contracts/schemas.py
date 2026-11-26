from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, Field, StringConstraints

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    BlankAsNone,
    Notes,
    PaymentTermsDays,
    RequestModel,
    ResponseModel,
    Text200,
    two_decimal_places,
)
from buildingops.modules.buildings.schemas import BuildingSummary
from buildingops.modules.contracts.models import BillingModel, ContractStatus
from buildingops.modules.identity.schemas import Currency

ContractNumber = Annotated[str, StringConstraints(min_length=1, max_length=30, to_upper=True)]
OptionalContractNumber = Annotated[ContractNumber | None, BlankAsNone]
MarkupPercent = Annotated[
    Decimal,
    Field(ge=0, le=500, max_digits=5, decimal_places=2),
    AfterValidator(two_decimal_places),
]
MonthlyFee = Annotated[
    Decimal,
    Field(ge=0, max_digits=12, decimal_places=2),
    AfterValidator(two_decimal_places),
]
# More than any one contract covers. Bounds the work a single request can ask for.
BuildingIds = Annotated[list[UUID], Field(max_length=500)]


class ContractCustomer(ResponseModel):
    id: UUID
    name: str


class ContractRef(ResponseModel):
    """A contract as it appears inside another record: what it is called, not its terms."""

    id: UUID
    contract_number: str
    name: str


class ContractRead(ResponseModel):
    id: UUID
    contract_number: str
    name: str
    status: ContractStatus
    billing_model: BillingModel
    start_date: date
    end_date: date | None
    markup_percent: Decimal | None
    monthly_fee: Decimal | None
    currency: str
    payment_terms_days: int
    notes: str | None
    customer: ContractCustomer
    building_count: int
    created_at: datetime
    updated_at: datetime


class ContractDetail(ContractRead):
    buildings: list[BuildingSummary]


class ContractCreate(RequestModel):
    customer_id: UUID
    contract_number: OptionalContractNumber = Field(
        default=None, description="Generated (CTR-0001) when omitted."
    )
    name: Text200
    status: ContractStatus = ContractStatus.DRAFT
    billing_model: BillingModel
    start_date: date
    end_date: date | None = None
    markup_percent: MarkupPercent | None = Field(
        default=None, description="Required for a cost-plus contract."
    )
    monthly_fee: MonthlyFee | None = Field(
        default=None, description="Required for a fixed-fee contract."
    )
    currency: Currency | None = Field(
        default=None, description="The organization's currency when omitted."
    )
    payment_terms_days: PaymentTermsDays = 30
    notes: Notes = None
    building_ids: BuildingIds = Field(
        default_factory=list, description="Buildings covered. They must belong to the customer."
    )


class ContractUpdate(RequestModel):
    customer_id: UUID | None = None
    contract_number: OptionalContractNumber = None
    name: Text200 | None = None
    status: ContractStatus | None = None
    billing_model: BillingModel | None = None
    start_date: date | None = None
    end_date: date | None = None
    markup_percent: MarkupPercent | None = None
    monthly_fee: MonthlyFee | None = None
    currency: Currency | None = None
    payment_terms_days: PaymentTermsDays | None = None
    notes: Notes = None
    building_ids: BuildingIds | None = Field(
        default=None, description="Replaces the buildings covered. Omit to leave them as they are."
    )


class ContractFilters(PageParams):
    q: str | None = Field(
        default=None, max_length=200, description="Search name, contract number and customer."
    )
    status: ContractStatus | None = None
    billing_model: BillingModel | None = None
    customer_id: UUID | None = None
    sort: str | None = Field(
        default=None,
        description=(
            "One of name, contract_number, start_date, end_date, created_at."
            " Prefix with - to reverse."
        ),
    )
