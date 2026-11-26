from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, Field, StringConstraints

from buildingops.core.models import DecisionStatus
from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    OptionalText100,
    RequestModel,
    ResponseModel,
    two_decimal_places,
)
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.vendors.schemas import VendorRef
from buildingops.modules.workorders.schemas import WorkOrderRef

Description = Annotated[str, StringConstraints(min_length=1, max_length=300)]
Amount = Annotated[
    Decimal,
    Field(gt=0, max_digits=12, decimal_places=2),
    AfterValidator(two_decimal_places),
]


class ExpenseRead(ResponseModel):
    id: UUID
    category: ExpenseCategory
    description: str
    amount: Decimal
    currency: str
    incurred_on: date
    building: BuildingRef | None
    contract: ContractRef | None
    vendor: VendorRef | None
    work_order: WorkOrderRef | None
    billable: bool
    reference: str | None = Field(description="A receipt or vendor invoice number.")
    status: DecisionStatus
    decided_by_name: str | None
    decided_at: datetime | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime


class ExpenseCreate(RequestModel):
    category: ExpenseCategory
    description: Description
    amount: Amount = Field(description="In the organization's currency.")
    incurred_on: date
    building_id: UUID | None = None
    contract_id: UUID | None = Field(
        default=None, description="It must cover the building, when both are given."
    )
    vendor_id: UUID | None = None
    work_order_id: UUID | None = None
    billable: bool = True
    reference: OptionalText100 = None


class ExpenseUpdate(RequestModel):
    category: ExpenseCategory | None = None
    description: Description | None = None
    amount: Amount | None = None
    incurred_on: date | None = None
    building_id: UUID | None = None
    contract_id: UUID | None = None
    vendor_id: UUID | None = None
    work_order_id: UUID | None = None
    billable: bool | None = None
    reference: OptionalText100 = None


class ExpenseFilters(PageParams):
    status: DecisionStatus | None = None
    category: ExpenseCategory | None = None
    building_id: UUID | None = None
    contract_id: UUID | None = None
    vendor_id: UUID | None = None
    from_: date | None = Field(
        default=None, alias="from", description="Incurred on or after this day."
    )
    to: date | None = Field(default=None, description="Incurred on or before this day.")
    sort: str | None = Field(
        default=None,
        description=(
            "One of incurred_on, amount, created_at. Prefix with - to reverse."
            " Most recently incurred first when omitted."
        ),
    )
