from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import Field

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import Moment, Notes, RequestModel, ResponseModel
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.scheduling.models import ShiftStatus
from buildingops.modules.workforce.schemas import EmployeeSummary

BreakMinutes = Annotated[int, Field(ge=0, le=240)]


class ShiftRead(ResponseModel):
    id: UUID
    employee: EmployeeSummary
    building: BuildingRef
    starts_at: datetime
    ends_at: datetime
    break_minutes: int
    status: ShiftStatus
    notes: str | None
    created_at: datetime
    updated_at: datetime


class ShiftCreate(RequestModel):
    employee_id: UUID
    building_id: UUID
    starts_at: Moment
    ends_at: Moment = Field(description="After the start, and at most 24 hours after it.")
    break_minutes: BreakMinutes = 0
    notes: Notes = None


class ShiftUpdate(RequestModel):
    employee_id: UUID | None = None
    building_id: UUID | None = None
    starts_at: Moment | None = None
    ends_at: Moment | None = None
    break_minutes: BreakMinutes | None = None
    status: ShiftStatus | None = Field(
        default=None,
        description="Scheduled, completed or missed. Cancelling a shift has its own endpoint.",
    )
    notes: Notes = None


class ShiftFilters(PageParams):
    from_: date = Field(
        alias="from",
        description="Shifts starting on or after this day, in the organization's time zone.",
    )
    to: date = Field(
        description="Shifts starting on or before this day. At most 62 days, both ends included."
    )
    building_id: UUID | None = None
    employee_id: UUID | None = None
    status: ShiftStatus | None = None
    sort: str | None = Field(default=None, description="starts_at, or -starts_at to reverse.")
