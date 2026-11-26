"""Job roles: the positions employees hold, with a default pay rate for each."""

from uuid import UUID

from sqlalchemy import Select, func, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.pagination import apply_sort, count_rows, paginate_rows
from buildingops.modules.workforce import compensation
from buildingops.modules.workforce.models import Employee, JobRole
from buildingops.modules.workforce.schemas import (
    JobRoleCreate,
    JobRoleFilters,
    JobRoleRead,
    JobRoleUpdate,
)

_SORTABLE = {"name": JobRole.name}

# Employees in the role, archived ones left out.
_EMPLOYEE_COUNT = (
    select(func.count())
    .select_from(Employee)
    .where(
        Employee.organization_id == JobRole.organization_id,
        Employee.job_role_id == JobRole.id,
        Employee.deleted_at.is_(None),
    )
    .correlate(JobRole)
    .scalar_subquery()
)


def _job_roles(ctx: Context) -> Select[JobRole, int]:
    return select(JobRole, _EMPLOYEE_COUNT.label("employee_count")).where(crud.live(ctx, JobRole))


def _to_read(ctx: Context, job_role: JobRole, employee_count: int) -> JobRoleRead:
    return JobRoleRead.from_record(
        job_role,
        default_hourly_rate=compensation.visible(ctx, job_role.default_hourly_rate),
        employee_count=employee_count,
    )


def _read(ctx: Context, job_role: JobRole) -> JobRoleRead:
    _, employee_count = ctx.db.execute(_job_roles(ctx).where(JobRole.id == job_role.id)).one()
    return _to_read(ctx, job_role, employee_count)


def _ensure_name_is_free(ctx: Context, name: str, *, excluding: UUID | None = None) -> None:
    crud.ensure_unique(
        ctx,
        JobRole,
        func.lower(JobRole.name) == name.lower(),
        field="name",
        message=f"A job role named {name} already exists.",
        excluding=excluding,
    )


def list_job_roles(ctx: Context, filters: JobRoleFilters) -> tuple[list[JobRoleRead], int]:
    statement = crud.search(_job_roles(ctx), filters.q, JobRole.name)
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=JobRole.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(ctx, job_role, count) for job_role, count in rows], total


def create_job_role(ctx: Context, data: JobRoleCreate) -> JobRoleRead:
    compensation.ensure_may_set(ctx, data, "default_hourly_rate")
    _ensure_name_is_free(ctx, data.name)
    job_role = JobRole(organization_id=ctx.organization_id, **data.model_dump())
    crud.create(ctx, job_role, entity_type="job_role", summary=f"Created job role {job_role.name}")
    return _read(ctx, job_role)


def update_job_role(ctx: Context, job_role_id: UUID, data: JobRoleUpdate) -> JobRoleRead:
    job_role = crud.get_or_404(ctx, JobRole, job_role_id, label="Job role")
    compensation.ensure_may_set(ctx, data, "default_hourly_rate")
    requested = crud.requested_changes(JobRole, data)
    if "name" in requested:
        _ensure_name_is_free(ctx, requested["name"], excluding=job_role.id)
    crud.update(
        ctx,
        job_role,
        requested,
        entity_type="job_role",
        summary=f"Updated job role {job_role.name}",
    )
    return _read(ctx, job_role)


def archive_job_role(ctx: Context, job_role_id: UUID) -> None:
    job_role = crud.get_or_404(ctx, JobRole, job_role_id, label="Job role", for_update=True)
    employees = count_rows(
        ctx.db,
        select(Employee.id).where(crud.live(ctx, Employee), Employee.job_role_id == job_role.id),
    )
    dependants = []
    if employees:
        dependants.append((crud.counted(employees, "employee"), "give them another job role"))
    crud.ensure_no_dependants(job_role.name, dependants)
    crud.archive(
        ctx, job_role, entity_type="job_role", summary=f"Archived job role {job_role.name}"
    )
