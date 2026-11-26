"""Which buildings an employee works at, and which of them is their primary one.

An assignment is open until it is given an end date. An employee has at most one open
assignment per building, and at most one of their open assignments is primary. Ended
assignments stay as history.
"""

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, and_, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    ValidationFailedError,
)
from buildingops.modules.audit import service as audit
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.workforce.models import BuildingAssignment, Employee
from buildingops.modules.workforce.schemas import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentUpdate,
)


def _to_read(assignment: BuildingAssignment, building: Building) -> AssignmentRead:
    return AssignmentRead.from_record(assignment, building=BuildingRef.model_validate(building))


def _open_assignments(ctx: Context, employee_id: UUID) -> ColumnElement[bool]:
    return and_(
        crud.live(ctx, BuildingAssignment),
        BuildingAssignment.employee_id == employee_id,
        BuildingAssignment.ends_on.is_(None),
    )


def list_assignments(ctx: Context, employee_id: UUID) -> list[AssignmentRead]:
    """An employee's assignments: open ones first, then past ones, newest first."""
    rows = ctx.db.execute(
        select(BuildingAssignment, Building)
        .join(Building, Building.id == BuildingAssignment.building_id)
        .where(crud.live(ctx, BuildingAssignment), BuildingAssignment.employee_id == employee_id)
        .order_by(
            BuildingAssignment.ends_on.is_not(None),
            BuildingAssignment.starts_on.desc(),
            BuildingAssignment.id,
        )
    ).all()
    return [_to_read(assignment, building) for assignment, building in rows]


def create_assignment(ctx: Context, employee_id: UUID, data: AssignmentCreate) -> AssignmentRead:
    employee = _lock_employee(ctx, employee_id)
    building = crud.get_referenced(
        ctx, Building, data.building_id, field="building_id", message="Building not found."
    )
    duplicate = ctx.db.scalar(
        select(BuildingAssignment.id).where(
            _open_assignments(ctx, employee.id), BuildingAssignment.building_id == building.id
        )
    )
    if duplicate is not None:
        message = f"{employee.full_name} already has an open assignment at {building.name}."
        raise ConflictError(message, errors=[FieldProblem(field="building_id", message=message)])

    summary = f"Assigned {employee.full_name} to {building.name}"
    changes = audit.changes_between({}, {"building_id": building.id, "starts_on": data.starts_on})
    if data.is_primary:
        summary += " as their primary building"
        changes |= _primary_building_change(_clear_primary(ctx, employee), building.id)

    assignment = BuildingAssignment(
        organization_id=ctx.organization_id,
        employee_id=employee.id,
        building_id=building.id,
        is_primary=data.is_primary,
        starts_on=data.starts_on,
    )
    ctx.db.add(assignment)
    ctx.db.flush()
    audit.record(
        ctx,
        action="employee.assigned",
        entity_type="employee",
        entity_id=employee.id,
        summary=summary,
        changes=changes,
    )
    return _to_read(assignment, building)


def update_assignment(
    ctx: Context, employee_id: UUID, assignment_id: UUID, data: AssignmentUpdate
) -> AssignmentRead:
    employee = _lock_employee(ctx, employee_id)
    row = ctx.db.execute(
        select(BuildingAssignment, Building)
        .join(Building, Building.id == BuildingAssignment.building_id)
        .where(
            crud.live(ctx, BuildingAssignment),
            BuildingAssignment.id == assignment_id,
            BuildingAssignment.employee_id == employee.id,
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Assignment not found.")
    assignment, building = row

    requested = crud.requested_changes(BuildingAssignment, data)
    ends_on: date | None = requested.get("ends_on", assignment.ends_on)
    is_primary: bool = requested.get("is_primary", assignment.is_primary)
    _check_change(assignment, ends_on=ends_on, is_primary=is_primary)

    if is_primary != assignment.is_primary:
        _set_primary(ctx, employee, assignment, building, is_primary=is_primary)
    if ends_on is not None and ends_on != assignment.ends_on:
        _set_end(ctx, employee, assignment, building, ends_on)
    return _to_read(assignment, building)


def _lock_employee(ctx: Context, employee_id: UUID) -> Employee:
    """Changes to one person's assignments are applied one after another, so that each
    sees the primary assignment the previous one left."""
    return crud.get_or_404(ctx, Employee, employee_id, label="Employee", for_update=True)


def _check_change(
    assignment: BuildingAssignment, *, ends_on: date | None, is_primary: bool
) -> None:
    if assignment.ends_on is not None and ends_on is None:
        raise ValidationFailedError.for_field(
            "ends_on",
            "An assignment that has ended cannot be reopened. Add a new one instead.",
            "assignment_ended",
        )
    if ends_on is not None and ends_on < assignment.starts_on:
        raise ValidationFailedError.for_field(
            "ends_on",
            f"The end date cannot be before the start date ({assignment.starts_on.isoformat()}).",
            "ends_before_start",
        )
    if is_primary != assignment.is_primary and ends_on is not None:
        raise ValidationFailedError.for_field(
            "is_primary",
            "Only an open assignment can change whether it is the primary one.",
            "assignment_ended",
        )


def _set_primary(
    ctx: Context,
    employee: Employee,
    assignment: BuildingAssignment,
    building: Building,
    *,
    is_primary: bool,
) -> None:
    if is_primary:
        change = _primary_building_change(_clear_primary(ctx, employee), building.id)
        summary = f"Made {building.name} the primary building of {employee.full_name}"
    else:
        change = _primary_building_change(building.id, None)
        summary = f"{building.name} is no longer the primary building of {employee.full_name}"
    assignment.is_primary = is_primary
    ctx.db.flush()
    audit.record(
        ctx,
        action="employee.updated",
        entity_type="employee",
        entity_id=employee.id,
        summary=summary,
        changes=change,
    )


def _set_end(
    ctx: Context,
    employee: Employee,
    assignment: BuildingAssignment,
    building: Building,
    ends_on: date,
) -> None:
    changes = audit.changes_between({"ends_on": assignment.ends_on}, {"ends_on": ends_on})
    if assignment.ends_on is None:
        summary = f"Ended the assignment of {employee.full_name} to {building.name}"
        if assignment.is_primary:
            changes |= _primary_building_change(building.id, None)
    else:
        summary = f"Corrected the end of the assignment of {employee.full_name} to {building.name}"
    assignment.ends_on = ends_on
    ctx.db.flush()
    audit.record(
        ctx,
        action="employee.assignment_ended",
        entity_type="employee",
        entity_id=employee.id,
        summary=summary,
        changes=changes,
    )


def _clear_primary(ctx: Context, employee: Employee) -> UUID | None:
    """Take the primary flag off the employee's open primary assignment, if they have one.

    Returns the building it was for. Flushed straight away: the database allows one open
    primary assignment per employee, so the old one has to give way before a new one is
    written.
    """
    current = ctx.db.scalar(
        select(BuildingAssignment).where(
            _open_assignments(ctx, employee.id), BuildingAssignment.is_primary
        )
    )
    if current is None:
        return None
    current.is_primary = False
    ctx.db.flush()
    return current.building_id


def _primary_building_change(before: UUID | None, after: UUID | None) -> dict[str, Any]:
    return audit.changes_between({"primary_building_id": before}, {"primary_building_id": after})
