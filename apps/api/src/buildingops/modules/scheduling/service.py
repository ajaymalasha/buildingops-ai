"""Shifts of the active organization.

An employee cannot have two shifts that overlap, cancelled ones aside. The service checks
that first, so that it can say which shift is in the way. The exclusion constraint on the
table is the guarantee: it also stops two requests that pass the check at the same moment.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    ValidationFailedError,
)
from buildingops.core.pagination import apply_sort, check_date_range, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.identity import organizations_service
from buildingops.modules.scheduling.models import NO_OVERLAP_CONSTRAINT, Shift, ShiftStatus
from buildingops.modules.scheduling.schemas import (
    ShiftCreate,
    ShiftFilters,
    ShiftRead,
    ShiftUpdate,
)
from buildingops.modules.workforce.models import Employee
from buildingops.modules.workforce.schemas import EmployeeSummary

# The longest stretch one request can ask for: two months of a calendar.
MAX_RANGE_DAYS = 62
_LONGEST_SHIFT = timedelta(hours=24)

_SORTABLE = {"starts_at": Shift.starts_at}


def _shifts(ctx: Context) -> Select[Shift, Employee, Building]:
    """Each shift with its employee and building, whether or not they have been archived."""
    return (
        select(Shift, Employee, Building)
        .join(Employee, Employee.id == Shift.employee_id)
        .join(Building, Building.id == Shift.building_id)
        .where(crud.live(ctx, Shift))
    )


def _to_read(shift: Shift, employee: Employee, building: Building) -> ShiftRead:
    return ShiftRead.from_record(
        shift,
        employee=EmployeeSummary.model_validate(employee),
        building=BuildingRef.model_validate(building),
    )


def _day(zone: ZoneInfo, moment: datetime) -> str:
    """The calendar day a moment falls on where the organization works."""
    return moment.astimezone(zone).date().isoformat()


def _span(zone: ZoneInfo, starts_at: datetime, ends_at: datetime) -> str:
    """`2026-11-26 09:00 to 17:00`, as clocks where the organization works show it. The
    end carries its own date when the shift runs past midnight."""
    start, end = starts_at.astimezone(zone), ends_at.astimezone(zone)
    until = f"{end:%H:%M}" if end.date() == start.date() else f"{end:%Y-%m-%d %H:%M}"
    return f"{start:%Y-%m-%d %H:%M} to {until}"


def list_shifts(ctx: Context, filters: ShiftFilters) -> tuple[list[ShiftRead], int]:
    check_date_range(filters.from_, filters.to, max_days=MAX_RANGE_DAYS)
    # A day is the organization's day: from its midnight to its next midnight.
    zone = organizations_service.time_zone(ctx)
    first_moment = datetime.combine(filters.from_, time.min, zone)
    end_moment = datetime.combine(filters.to + timedelta(days=1), time.min, zone)
    statement = _shifts(ctx).where(Shift.starts_at >= first_moment, Shift.starts_at < end_moment)
    if filters.building_id:
        statement = statement.where(Shift.building_id == filters.building_id)
    if filters.employee_id:
        statement = statement.where(Shift.employee_id == filters.employee_id)
    if filters.status:
        statement = statement.where(Shift.status == filters.status)
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="starts_at", tiebreaker=Shift.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(*row) for row in rows], total


def get_shift(ctx: Context, shift_id: UUID) -> ShiftRead:
    row = ctx.db.execute(_shifts(ctx).where(Shift.id == shift_id)).one_or_none()
    if row is None:
        raise NotFoundError("Shift not found.")
    return _to_read(*row)


def create_shift(ctx: Context, data: ShiftCreate) -> ShiftRead:
    employee = crud.get_referenced(
        ctx, Employee, data.employee_id, field="employee_id", message="Employee not found."
    )
    building = crud.get_referenced(
        ctx, Building, data.building_id, field="building_id", message="Building not found."
    )
    _check_times(data.starts_at, data.ends_at)
    zone = organizations_service.time_zone(ctx)
    _ensure_free(ctx, zone, employee, data.starts_at, data.ends_at)
    shift = Shift(organization_id=ctx.organization_id, **data.model_dump())
    with _overlap_refused(employee):
        crud.create(
            ctx,
            shift,
            entity_type="shift",
            summary=(
                f"Scheduled {employee.full_name} at {building.name}"
                f" on {_day(zone, shift.starts_at)}"
            ),
        )
    return get_shift(ctx, shift.id)


def update_shift(ctx: Context, shift_id: UUID, data: ShiftUpdate) -> ShiftRead:
    shift = crud.get_or_404(ctx, Shift, shift_id, label="Shift", for_update=True)
    if shift.status is ShiftStatus.CANCELLED:
        raise ConflictError("A cancelled shift cannot be changed. Schedule a new one instead.")
    requested = crud.requested_changes(Shift, data)
    if requested.get("status") is ShiftStatus.CANCELLED:
        raise ValidationFailedError.for_field(
            "status", "To cancel a shift, use its cancel action.", "use_cancel"
        )
    employee = crud.new_reference(
        ctx, Employee, requested, "employee_id", message="Employee not found.", record=shift
    ) or crud.get_held(ctx, Employee, shift.employee_id)
    crud.new_reference(
        ctx, Building, requested, "building_id", message="Building not found.", record=shift
    )
    starts_at: datetime = requested.get("starts_at", shift.starts_at)
    ends_at: datetime = requested.get("ends_at", shift.ends_at)
    _check_times(starts_at, ends_at)
    zone = organizations_service.time_zone(ctx)
    if requested.keys() & {"employee_id", "starts_at", "ends_at"}:
        _ensure_free(ctx, zone, employee, starts_at, ends_at, excluding=shift.id)
    with _overlap_refused(employee):
        crud.update(
            ctx,
            shift,
            requested,
            entity_type="shift",
            summary=f"Updated the shift of {employee.full_name} on {_day(zone, starts_at)}",
        )
    return get_shift(ctx, shift.id)


def cancel_shift(ctx: Context, shift_id: UUID) -> ShiftRead:
    shift = crud.get_or_404(ctx, Shift, shift_id, label="Shift", for_update=True)
    if shift.status is not ShiftStatus.SCHEDULED:
        raise ConflictError(
            f"Only a scheduled shift can be cancelled. This one is {shift.status.value}."
        )
    employee = crud.get_held(ctx, Employee, shift.employee_id)
    building = crud.get_held(ctx, Building, shift.building_id)
    zone = organizations_service.time_zone(ctx)
    crud.transition(
        ctx,
        shift,
        {"status": ShiftStatus.CANCELLED},
        action="cancelled",
        entity_type="shift",
        summary=(
            f"Cancelled the shift of {employee.full_name} at {building.name}"
            f" on {_day(zone, shift.starts_at)}"
        ),
    )
    return get_shift(ctx, shift.id)


# --- validation --------------------------------------------------------------------------


def _check_times(starts_at: datetime, ends_at: datetime) -> None:
    """The database holds the same rules. Checking here names the field that is wrong."""
    if ends_at <= starts_at:
        raise ValidationFailedError.for_field(
            "ends_at", "A shift has to end after it starts.", "ends_before_start"
        )
    if ends_at - starts_at > _LONGEST_SHIFT:
        raise ValidationFailedError.for_field(
            "ends_at", "A shift cannot be longer than 24 hours.", "shift_too_long"
        )


def _ensure_free(
    ctx: Context,
    zone: ZoneInfo,
    employee: Employee,
    starts_at: datetime,
    ends_at: datetime,
    *,
    excluding: UUID | None = None,
) -> None:
    """Refuse (409, reported on `starts_at`) a shift that overlaps another of the employee's.

    Times are compared as the constraint compares them: a shift covers its start and not
    its end, so one may begin the moment another ends.
    """
    overlapping = (
        select(Shift, Building)
        .join(Building, Building.id == Shift.building_id)
        .where(
            crud.live(ctx, Shift),
            Shift.employee_id == employee.id,
            Shift.status != ShiftStatus.CANCELLED,
            Shift.starts_at < ends_at,
            Shift.ends_at > starts_at,
        )
    )
    if excluding is not None:
        overlapping = overlapping.where(Shift.id != excluding)
    # The earliest one, so that the answer is the same every time.
    earliest = overlapping.order_by(Shift.starts_at, Shift.id).limit(1)
    row = ctx.db.execute(earliest).one_or_none()
    if row is None:
        return
    other, building = row
    message = (
        f"{employee.full_name} already has a shift at {building.name} that overlaps this one"
        f" ({_span(zone, other.starts_at, other.ends_at)})."
    )
    raise ConflictError(message, errors=[FieldProblem(field="starts_at", message=message)])


@contextmanager
def _overlap_refused(employee: Employee) -> Iterator[None]:
    """Answer a violation of the exclusion constraint as the check before it would have.

    `_ensure_free` sees committed shifts only. Two requests for overlapping shifts can both
    pass it, and the constraint then refuses whichever writes second. By then the
    transaction has failed and cannot be asked which shift got in the way, so the answer
    does not say. Nor can it be asked for the employee's name, which is why that is read
    before the write.
    """
    message = (
        f"{employee.full_name} has just been given another shift that overlaps this one."
        " Reload the schedule and try again."
    )
    try:
        yield
    except IntegrityError as error:
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
        if constraint != NO_OVERLAP_CONSTRAINT:
            raise
        raise ConflictError(
            message, errors=[FieldProblem(field="starts_at", message=message)]
        ) from error
