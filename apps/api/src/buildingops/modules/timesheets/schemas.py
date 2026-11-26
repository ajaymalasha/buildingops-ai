from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field

from buildingops.core.models import DecisionStatus
from buildingops.core.pagination import PageParams
from buildingops.core.schemas import Notes, RequestModel, ResponseModel, two_decimal_places
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.timesheets.models import TimesheetSource
from buildingops.modules.workforce.schemas import EmployeeSummary

Hours = Annotated[
    Decimal,
    Field(ge=0, le=24, max_digits=4, decimal_places=2),
    AfterValidator(two_decimal_places),
]
OvertimeMultiplier = Annotated[
    Decimal,
    Field(ge=1, le=3, max_digits=3, decimal_places=2),
    AfterValidator(two_decimal_places),
]

_COST_VISIBILITY = "Null for callers who may not see compensation."


class TimesheetRead(ResponseModel):
    id: UUID
    employee: EmployeeSummary
    building: BuildingRef
    contract: ContractRef | None
    shift_id: UUID | None
    work_date: date
    hours_regular: Decimal
    hours_overtime: Decimal
    overtime_multiplier: Decimal
    hourly_rate: Decimal | None = Field(
        description=f"The employee's rate when the time was entered. {_COST_VISIBILITY}"
    )
    labor_cost: Decimal | None = Field(
        description=f"Worked out from the hours and the rate. {_COST_VISIBILITY}"
    )
    status: DecisionStatus
    source: TimesheetSource
    notes: str | None
    submitted_at: datetime
    decided_by_name: str | None
    decided_at: datetime | None
    rejection_reason: str | None
    created_at: datetime
    updated_at: datetime


class TimesheetCreate(RequestModel):
    employee_id: UUID = Field(description="They must have an hourly rate: it prices the time.")
    building_id: UUID
    contract_id: UUID | None = Field(default=None, description="It must cover the building.")
    shift_id: UUID | None = Field(
        default=None, description="A shift of the same employee at the same building."
    )
    work_date: date
    hours_regular: Hours
    hours_overtime: Hours = Decimal("0.00")
    overtime_multiplier: OvertimeMultiplier = Decimal("1.50")
    notes: Notes = None


class TimesheetUpdate(RequestModel):
    employee_id: UUID | None = None
    building_id: UUID | None = None
    contract_id: UUID | None = None
    shift_id: UUID | None = None
    work_date: date | None = None
    hours_regular: Hours | None = None
    hours_overtime: Hours | None = None
    overtime_multiplier: OvertimeMultiplier | None = None
    notes: Notes = None


class TimesheetBulkApproval(RequestModel):
    ids: Annotated[list[UUID], Field(min_length=1, max_length=200)]


class TimesheetBulkApproved(ResponseModel):
    approved: int = Field(description="How many timesheets were approved: all of them.")


class TimesheetQuery(BaseModel):
    """What narrows a list of timesheets. The summary takes the same parameters."""

    status: DecisionStatus | None = None
    building_id: UUID | None = None
    employee_id: UUID | None = None
    contract_id: UUID | None = None
    from_: date | None = Field(
        default=None, alias="from", description="Work date on or after this day."
    )
    to: date | None = Field(default=None, description="Work date on or before this day.")


class TimesheetFilters(TimesheetQuery, PageParams):
    sort: str | None = Field(
        default=None,
        description=(
            "One of work_date, employee (last name, first name), created_at. Prefix with - to"
            " reverse. Latest work date first when omitted."
        ),
    )


class TimesheetTotals(ResponseModel):
    count: int
    hours_regular: Decimal
    hours_overtime: Decimal
    hours_total: Decimal


class TimesheetSummary(ResponseModel):
    """Counts and hours for each status, over the timesheets the filters select."""

    pending: TimesheetTotals
    approved: TimesheetTotals
    rejected: TimesheetTotals
