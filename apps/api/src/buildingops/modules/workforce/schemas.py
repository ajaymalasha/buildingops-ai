from datetime import date, datetime
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, Field, StringConstraints

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import (
    Notes,
    OptionalCode,
    OptionalEmail,
    OptionalText40,
    RequestModel,
    ResponseModel,
    Text100,
    two_decimal_places,
)
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.workforce.models import EmployeeStatus, EmploymentType

JobRoleName = Annotated[str, StringConstraints(min_length=1, max_length=120)]
HourlyRate = Annotated[
    Decimal,
    Field(ge=0, max_digits=10, decimal_places=2),
    AfterValidator(two_decimal_places),
]

_RATE_VISIBILITY = "Null for callers who may not see compensation."

# --- job roles -------------------------------------------------------------------------


class JobRoleRef(ResponseModel):
    """A job role as it appears inside another record."""

    id: UUID
    name: str


class JobRoleRead(JobRoleRef):
    description: str | None
    default_hourly_rate: Decimal | None = Field(description=_RATE_VISIBILITY)
    is_supervisory: bool
    employee_count: int = Field(description="Employees in this role who are not archived.")
    created_at: datetime
    updated_at: datetime


class JobRoleCreate(RequestModel):
    name: JobRoleName
    description: Notes = None
    default_hourly_rate: HourlyRate | None = None
    is_supervisory: bool = False


class JobRoleUpdate(RequestModel):
    name: JobRoleName | None = None
    description: Notes = None
    default_hourly_rate: HourlyRate | None = None
    is_supervisory: bool | None = None


class JobRoleFilters(PageParams):
    q: str | None = Field(default=None, max_length=200, description="Search the name.")
    sort: str | None = Field(default=None, description="name, or -name to reverse.")


# --- employees -------------------------------------------------------------------------


class EmployeeRef(ResponseModel):
    """An employee as they appear inside another record."""

    id: UUID
    full_name: str


class AssignmentRead(ResponseModel):
    id: UUID
    building: BuildingRef
    is_primary: bool
    starts_on: date
    ends_on: date | None = Field(description="Null while the assignment is open.")


class EmployeeRead(ResponseModel):
    id: UUID
    employee_number: str
    first_name: str
    last_name: str
    full_name: str
    email: str | None
    phone: str | None
    employment_type: EmploymentType
    status: EmployeeStatus
    hire_date: date | None
    termination_date: date | None
    hourly_rate: Decimal | None = Field(description=_RATE_VISIBILITY)
    notes: str | None
    job_role: JobRoleRef
    supervisor: EmployeeRef | None
    primary_building: BuildingRef | None = Field(
        description="The building of their open primary assignment."
    )
    membership_id: UUID | None = Field(description="Their login, when they have one.")
    created_at: datetime
    updated_at: datetime


class EmployeeDetail(EmployeeRead):
    assignments: list[AssignmentRead] = Field(description="Open assignments first, then past.")


class EmployeeCreate(RequestModel):
    employee_number: OptionalCode = Field(
        default=None, description="Generated (EMP-0001) when omitted."
    )
    first_name: Text100
    last_name: Text100
    email: OptionalEmail = None
    phone: OptionalText40 = None
    job_role_id: UUID
    supervisor_id: UUID | None = None
    membership_id: UUID | None = None
    employment_type: EmploymentType
    status: EmployeeStatus = EmployeeStatus.ACTIVE
    hire_date: date | None = None
    termination_date: date | None = Field(
        default=None, description="Today when omitted for a terminated employee."
    )
    hourly_rate: HourlyRate | None = None
    notes: Notes = None


class EmployeeUpdate(RequestModel):
    employee_number: OptionalCode = None
    first_name: Text100 | None = None
    last_name: Text100 | None = None
    email: OptionalEmail = None
    phone: OptionalText40 = None
    job_role_id: UUID | None = None
    supervisor_id: UUID | None = None
    membership_id: UUID | None = None
    employment_type: EmploymentType | None = None
    status: EmployeeStatus | None = None
    hire_date: date | None = None
    termination_date: date | None = None
    hourly_rate: HourlyRate | None = None
    notes: Notes = None


class EmployeeFilters(PageParams):
    q: str | None = Field(
        default=None, max_length=200, description="Search name, employee number and email."
    )
    status: EmployeeStatus | None = None
    employment_type: EmploymentType | None = None
    job_role_id: UUID | None = None
    building_id: UUID | None = Field(
        default=None, description="Employees with an open assignment at this building."
    )
    supervisory: bool | None = Field(
        default=None,
        description="True for employees whose job role is supervisory, false for the rest.",
    )
    sort: str | None = Field(
        default=None,
        description=(
            "One of name (last, first), employee_number, hire_date, created_at."
            " Prefix with - to reverse."
        ),
    )


# --- building assignments --------------------------------------------------------------


class AssignmentCreate(RequestModel):
    building_id: UUID
    is_primary: bool = Field(
        default=False, description="Takes the place of the employee's current primary building."
    )
    starts_on: date


class AssignmentUpdate(RequestModel):
    ends_on: date | None = Field(default=None, description="Ends the assignment.")
    is_primary: bool | None = None
