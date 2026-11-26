from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.workforce import (
    assignments_service,
    employees_service,
    job_roles_service,
)
from buildingops.modules.workforce.schemas import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentUpdate,
    EmployeeCreate,
    EmployeeDetail,
    EmployeeFilters,
    EmployeeRead,
    EmployeeUpdate,
    JobRoleCreate,
    JobRoleFilters,
    JobRoleRead,
    JobRoleUpdate,
)

# Job roles and building assignments are part of managing employees, and share its permissions.
_Reader = Annotated[Context, Depends(require(Permission.EMPLOYEES_READ))]
_Writer = Annotated[Context, Depends(require(Permission.EMPLOYEES_WRITE))]

# --- job roles ---------------------------------------------------------------------------

job_roles_router = APIRouter(prefix="/job-roles", tags=["job roles"])


@job_roles_router.get("", summary="List job roles")
def list_job_roles(filters: Annotated[JobRoleFilters, Query()], ctx: _Reader) -> Page[JobRoleRead]:
    items, total = job_roles_service.list_job_roles(ctx, filters)
    return Page[JobRoleRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@job_roles_router.post("", status_code=status.HTTP_201_CREATED, summary="Add a job role")
def create_job_role(payload: JobRoleCreate, ctx: _Writer) -> JobRoleRead:
    return job_roles_service.create_job_role(ctx, payload)


@job_roles_router.patch("/{job_role_id}", summary="Update a job role")
def update_job_role(job_role_id: UUID, payload: JobRoleUpdate, ctx: _Writer) -> JobRoleRead:
    return job_roles_service.update_job_role(ctx, job_role_id, payload)


@job_roles_router.delete(
    "/{job_role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive a job role",
    description="Refused while employees hold the role.",
)
def archive_job_role(job_role_id: UUID, ctx: _Writer) -> Response:
    job_roles_service.archive_job_role(ctx, job_role_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- employees ---------------------------------------------------------------------------

employees_router = APIRouter(prefix="/employees", tags=["employees"])


@employees_router.get("", summary="List employees")
def list_employees(
    filters: Annotated[EmployeeFilters, Query()], ctx: _Reader
) -> Page[EmployeeRead]:
    items, total = employees_service.list_employees(ctx, filters)
    return Page[EmployeeRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@employees_router.post("", status_code=status.HTTP_201_CREATED, summary="Add an employee")
def create_employee(payload: EmployeeCreate, ctx: _Writer) -> EmployeeDetail:
    return employees_service.create_employee(ctx, payload)


@employees_router.get("/{employee_id}", summary="Get an employee and their assignments")
def read_employee(employee_id: UUID, ctx: _Reader) -> EmployeeDetail:
    return employees_service.get_employee(ctx, employee_id)


@employees_router.patch("/{employee_id}", summary="Update an employee")
def update_employee(employee_id: UUID, payload: EmployeeUpdate, ctx: _Writer) -> EmployeeDetail:
    return employees_service.update_employee(ctx, employee_id, payload)


@employees_router.delete(
    "/{employee_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive an employee",
    description="Refused while they supervise other employees or have open assignments.",
)
def archive_employee(employee_id: UUID, ctx: _Writer) -> Response:
    employees_service.archive_employee(ctx, employee_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@employees_router.post(
    "/{employee_id}/assignments",
    status_code=status.HTTP_201_CREATED,
    summary="Assign an employee to a building",
)
def create_assignment(employee_id: UUID, payload: AssignmentCreate, ctx: _Writer) -> AssignmentRead:
    return assignments_service.create_assignment(ctx, employee_id, payload)


@employees_router.patch(
    "/{employee_id}/assignments/{assignment_id}",
    summary="End an assignment, or change whether it is the primary one",
)
def update_assignment(
    employee_id: UUID, assignment_id: UUID, payload: AssignmentUpdate, ctx: _Writer
) -> AssignmentRead:
    return assignments_service.update_assignment(ctx, employee_id, assignment_id, payload)
