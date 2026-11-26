"""Employees of the active organization."""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, select
from sqlalchemy.orm import aliased

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import NotFoundError, ValidationFailedError
from buildingops.core.pagination import SortKey, apply_sort, count_rows, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.identity import organizations_service
from buildingops.modules.identity.models import Membership
from buildingops.modules.sequences.service import CodeSeries
from buildingops.modules.workforce import assignments_service, compensation
from buildingops.modules.workforce.models import (
    BuildingAssignment,
    Employee,
    EmployeeStatus,
    JobRole,
)
from buildingops.modules.workforce.schemas import (
    EmployeeCreate,
    EmployeeDetail,
    EmployeeFilters,
    EmployeeRead,
    EmployeeRef,
    EmployeeUpdate,
    JobRoleRef,
)

EMPLOYEE_NUMBERS = CodeSeries("employee", "EMP")

_Supervisor = aliased(Employee)
_PrimaryAssignment = aliased(BuildingAssignment)

_SORTABLE: dict[str, SortKey] = {
    "name": (Employee.last_name, Employee.first_name),
    "employee_number": Employee.employee_number,
    "hire_date": Employee.hire_date,
    "created_at": Employee.created_at,
}


def _employees(ctx: Context) -> Select[Employee, JobRole, Employee, Building]:
    """Each employee with their job role and, where they have them, their supervisor and
    the building of their open primary assignment."""
    return (
        select(Employee, JobRole, _Supervisor, Building)
        .join(JobRole, JobRole.id == Employee.job_role_id)
        .outerjoin(_Supervisor, _Supervisor.id == Employee.supervisor_id)
        .outerjoin(
            _PrimaryAssignment,
            and_(
                _PrimaryAssignment.employee_id == Employee.id,
                _PrimaryAssignment.is_primary,
                _PrimaryAssignment.ends_on.is_(None),
            ),
        )
        .outerjoin(Building, Building.id == _PrimaryAssignment.building_id)
        .where(crud.live(ctx, Employee))
    )


def _to_read(
    ctx: Context,
    employee: Employee,
    job_role: JobRole,
    supervisor: Employee | None,
    primary_building: Building | None,
) -> EmployeeRead:
    return EmployeeRead.from_record(
        employee,
        hourly_rate=compensation.visible(ctx, employee.hourly_rate),
        job_role=JobRoleRef.model_validate(job_role),
        supervisor=EmployeeRef.model_validate(supervisor) if supervisor else None,
        primary_building=(
            BuildingRef.model_validate(primary_building) if primary_building else None
        ),
    )


def _label(employee: Employee) -> str:
    return f"{employee.full_name} ({employee.employee_number})"


def list_employees(ctx: Context, filters: EmployeeFilters) -> tuple[list[EmployeeRead], int]:
    statement = _employees(ctx)
    if filters.status:
        statement = statement.where(Employee.status == filters.status)
    if filters.employment_type:
        statement = statement.where(Employee.employment_type == filters.employment_type)
    if filters.job_role_id:
        statement = statement.where(Employee.job_role_id == filters.job_role_id)
    if filters.building_id:
        statement = statement.where(
            select(BuildingAssignment.id)
            .where(
                BuildingAssignment.organization_id == Employee.organization_id,
                BuildingAssignment.employee_id == Employee.id,
                BuildingAssignment.building_id == filters.building_id,
                BuildingAssignment.ends_on.is_(None),
            )
            .exists()
        )
    if filters.supervisory is not None:
        statement = statement.where(JobRole.is_supervisory.is_(filters.supervisory))
    statement = crud.search(
        statement,
        filters.q,
        Employee.first_name + " " + Employee.last_name,
        Employee.employee_number,
        Employee.email,
    )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Employee.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [
        _to_read(ctx, employee, job_role, supervisor, primary_building)
        for employee, job_role, supervisor, primary_building in rows
    ], total


def get_employee(ctx: Context, employee_id: UUID) -> EmployeeDetail:
    row = ctx.db.execute(_employees(ctx).where(Employee.id == employee_id)).one_or_none()
    if row is None:
        raise NotFoundError("Employee not found.")
    employee, job_role, supervisor, primary_building = row
    return EmployeeDetail(
        **_to_read(ctx, employee, job_role, supervisor, primary_building).model_dump(),
        assignments=assignments_service.list_assignments(ctx, employee.id),
    )


def create_employee(ctx: Context, data: EmployeeCreate) -> EmployeeDetail:
    compensation.ensure_may_set(ctx, data, "hourly_rate")
    values = data.model_dump()
    _check_references(ctx, values)
    _check_dates(ctx, values)
    values["employee_number"] = crud.assign_code(
        ctx,
        Employee,
        Employee.employee_number,
        data.employee_number,
        series=EMPLOYEE_NUMBERS,
        field="employee_number",
    )
    employee = Employee(organization_id=ctx.organization_id, **values)
    crud.create(
        ctx, employee, entity_type="employee", summary=f"Created employee {_label(employee)}"
    )
    return get_employee(ctx, employee.id)


def update_employee(ctx: Context, employee_id: UUID, data: EmployeeUpdate) -> EmployeeDetail:
    employee = crud.get_or_404(ctx, Employee, employee_id, label="Employee")
    compensation.ensure_may_set(ctx, data, "hourly_rate")
    requested = crud.requested_changes(Employee, data)
    if "employee_number" in requested:
        crud.ensure_unique(
            ctx,
            Employee,
            Employee.employee_number == requested["employee_number"],
            field="employee_number",
            message=f"{requested['employee_number']} is already in use.",
            excluding=employee.id,
        )
    _check_references(ctx, requested, employee)
    _check_dates(ctx, requested, employee)
    crud.update(
        ctx,
        employee,
        requested,
        entity_type="employee",
        summary=f"Updated employee {_label(employee)}",
    )
    return get_employee(ctx, employee.id)


def archive_employee(ctx: Context, employee_id: UUID) -> None:
    employee = crud.get_or_404(ctx, Employee, employee_id, label="Employee", for_update=True)
    reports = count_rows(
        ctx.db,
        select(Employee.id).where(crud.live(ctx, Employee), Employee.supervisor_id == employee.id),
    )
    assignments = count_rows(
        ctx.db,
        select(BuildingAssignment.id).where(
            crud.live(ctx, BuildingAssignment),
            BuildingAssignment.employee_id == employee.id,
            BuildingAssignment.ends_on.is_(None),
        ),
    )
    dependants = []
    if reports:
        dependants.append((crud.counted(reports, "direct report"), "give them another supervisor"))
    if assignments:
        dependants.append((crud.counted(assignments, "open assignment"), "end the assignments"))
    crud.ensure_no_dependants(employee.full_name, dependants)
    crud.archive(
        ctx,
        employee,
        entity_type="employee",
        summary=f"Archived employee {_label(employee)}",
        # A login can be linked to one employee record. An archived one must not keep it.
        releasing={"membership_id": None},
    )


# --- validation --------------------------------------------------------------------------


def _check_references(
    ctx: Context, values: Mapping[str, Any], employee: Employee | None = None
) -> None:
    """Check what `values` points the employee at: job role, supervisor, login, email.

    `employee` is the record being updated, or None for one about to be created.
    """
    own_id = employee.id if employee else None
    if "job_role_id" in values:
        crud.get_referenced(
            ctx, JobRole, values["job_role_id"], field="job_role_id", message="Job role not found."
        )
    if values.get("supervisor_id") is not None:
        _check_supervisor(ctx, values["supervisor_id"], employee)
    if values.get("membership_id") is not None:
        crud.get_referenced(
            ctx,
            Membership,
            values["membership_id"],
            field="membership_id",
            message="Member not found.",
        )
        crud.ensure_unique(
            ctx,
            Employee,
            Employee.membership_id == values["membership_id"],
            field="membership_id",
            message="This login is already linked to another employee.",
            excluding=own_id,
        )
    if values.get("email") is not None:
        crud.ensure_unique(
            ctx,
            Employee,
            Employee.email == values["email"],
            field="email",
            message="Another employee already has this email address.",
            excluding=own_id,
        )


def _check_supervisor(ctx: Context, supervisor_id: UUID, employee: Employee | None) -> None:
    if employee is not None and supervisor_id == employee.id:
        raise ValidationFailedError.for_field(
            "supervisor_id", "An employee cannot be their own supervisor.", "own_supervisor"
        )
    supervisor = crud.get_referenced(
        ctx, Employee, supervisor_id, field="supervisor_id", message="Supervisor not found."
    )
    if employee is not None and _reports_to(ctx, supervisor, employee):
        raise ValidationFailedError.for_field(
            "supervisor_id",
            f"{supervisor.full_name} reports to {employee.full_name},"
            " so cannot also be their supervisor.",
            "supervision_loop",
        )


def _reports_to(ctx: Context, employee: Employee, manager: Employee) -> bool:
    """Whether `manager` is above `employee`, directly or through other supervisors."""
    seen: set[UUID] = set()
    supervisor_id = employee.supervisor_id
    # `seen` ends the walk even if the data already holds a loop.
    while supervisor_id is not None and supervisor_id not in seen:
        if supervisor_id == manager.id:
            return True
        seen.add(supervisor_id)
        supervisor_id = ctx.db.scalar(
            select(Employee.supervisor_id).where(
                Employee.organization_id == ctx.organization_id, Employee.id == supervisor_id
            )
        )
    return False


def _check_dates(ctx: Context, values: dict[str, Any], employee: Employee | None = None) -> None:
    """Check hire and termination dates against the record as it will be.

    Adds today's date to `values` when the change terminates an employee without saying
    when.
    """

    def resulting(field: str) -> Any:
        if field in values or employee is None:
            return values.get(field)
        return getattr(employee, field)

    hire_date = resulting("hire_date")
    termination_date = resulting("termination_date")
    if resulting("status") is EmployeeStatus.TERMINATED and termination_date is None:
        if employee is not None and employee.status is EmployeeStatus.TERMINATED:
            raise ValidationFailedError.for_field(
                "termination_date", "A terminated employee needs a termination date.", "required"
            )
        termination_date = values["termination_date"] = organizations_service.today(ctx)
    if hire_date is not None and termination_date is not None and termination_date < hire_date:
        raise ValidationFailedError.for_field(
            "termination_date",
            f"The termination date cannot be before the hire date ({hire_date.isoformat()}).",
            "terminated_before_hired",
        )
