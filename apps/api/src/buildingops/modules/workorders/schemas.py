from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field, StringConstraints

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    Moment,
    Notes,
    OptionalText200,
    RequestModel,
    ResponseModel,
    Text200,
)
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.vendors.schemas import VendorRef
from buildingops.modules.workforce.schemas import EmployeeSummary
from buildingops.modules.workorders.models import (
    WorkOrderActivityKind,
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderSource,
    WorkOrderStatus,
)

CommentBody = Annotated[str, StringConstraints(min_length=1, max_length=5000)]


class WorkOrderRef(ResponseModel):
    """A work order as it appears inside another record."""

    id: UUID
    number: str
    title: str


class WorkOrderActivityRead(ResponseModel):
    id: UUID
    kind: WorkOrderActivityKind
    body: str | None = Field(
        description="The comment, the note given with a status change, or who was assigned."
    )
    from_status: WorkOrderStatus | None = Field(description="Set for a status change.")
    to_status: WorkOrderStatus | None = Field(description="Set for a status change.")
    author_name: str
    created_at: datetime


class WorkOrderRead(WorkOrderRef):
    description: str | None
    category: WorkOrderCategory
    priority: WorkOrderPriority
    status: WorkOrderStatus
    source: WorkOrderSource
    building: BuildingRef
    contract: ContractRef | None
    assigned_employee: EmployeeSummary | None
    vendor: VendorRef | None
    requested_by: str | None
    due_on: date | None
    scheduled_for: datetime | None
    started_at: datetime | None = Field(description="Set when work first starts.")
    completed_at: datetime | None = Field(description="Set on completion, cleared on reopening.")
    billable: bool
    is_overdue: bool = Field(
        description=(
            "Due before today, in the organization's time zone, and neither completed nor"
            " cancelled."
        )
    )
    created_at: datetime
    updated_at: datetime


class WorkOrderDetail(WorkOrderRead):
    activities: list[WorkOrderActivityRead] = Field(description="Oldest first.")


class WorkOrderCreate(RequestModel):
    title: Text200
    description: Notes = None
    building_id: UUID
    contract_id: UUID | None = Field(default=None, description="It must cover the building.")
    category: WorkOrderCategory
    priority: WorkOrderPriority = WorkOrderPriority.NORMAL
    source: WorkOrderSource = WorkOrderSource.INTERNAL
    assigned_employee_id: UUID | None = None
    vendor_id: UUID | None = None
    requested_by: OptionalText200 = None
    due_on: date | None = None
    scheduled_for: Moment | None = None
    billable: bool = True


class WorkOrderUpdate(RequestModel):
    title: Text200 | None = None
    description: Notes = None
    building_id: UUID | None = None
    contract_id: UUID | None = None
    category: WorkOrderCategory | None = None
    priority: WorkOrderPriority | None = None
    source: WorkOrderSource | None = None
    assigned_employee_id: UUID | None = None
    vendor_id: UUID | None = None
    requested_by: OptionalText200 = None
    due_on: date | None = None
    scheduled_for: Moment | None = None
    billable: bool | None = None


class WorkOrderStatusChange(RequestModel):
    status: WorkOrderStatus
    comment: Notes = Field(default=None, description="Kept with the change in the history.")


class WorkOrderCommentCreate(RequestModel):
    body: CommentBody


class WorkOrderFilters(PageParams):
    q: str | None = Field(default=None, max_length=200, description="Search number and title.")
    status: list[WorkOrderStatus] | None = Field(
        default=None, description="Repeat the parameter to ask for several statuses."
    )
    priority: WorkOrderPriority | None = None
    category: WorkOrderCategory | None = None
    building_id: UUID | None = None
    assigned_employee_id: UUID | None = None
    vendor_id: UUID | None = None
    overdue: bool | None = Field(
        default=None,
        description=(
            "True for work orders due before today that are neither completed nor cancelled,"
            " false for the rest."
        ),
    )
    sort: str | None = Field(
        default=None,
        description=(
            "One of number, due_on, priority, created_at, status. Prefix with - to reverse."
            " Newest first when omitted."
        ),
    )
