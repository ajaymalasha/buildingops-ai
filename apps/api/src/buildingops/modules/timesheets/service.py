"""Timesheets of the active organization: entering time, and deciding on it.

A timesheet is priced when it is written. The hourly rate is copied from the employee, the
cost is worked out from it, and neither is ever taken from a request.
"""

from collections.abc import Mapping, Sequence
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select

from buildingops.core import crud, decisions
from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    PermissionDeniedError,
    ValidationFailedError,
)
from buildingops.core.models import DecisionStatus, utcnow
from buildingops.core.pagination import SortKey, apply_sort, between_dates, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts import service as contracts_service
from buildingops.modules.contracts.models import Contract
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.scheduling.models import Shift
from buildingops.modules.timesheets.costing import labor_cost
from buildingops.modules.timesheets.models import Timesheet
from buildingops.modules.timesheets.schemas import (
    TimesheetBulkApproval,
    TimesheetBulkApproved,
    TimesheetCreate,
    TimesheetFilters,
    TimesheetQuery,
    TimesheetRead,
    TimesheetSummary,
    TimesheetTotals,
    TimesheetUpdate,
)
from buildingops.modules.workforce import compensation
from buildingops.modules.workforce.models import Employee
from buildingops.modules.workforce.schemas import EmployeeSummary

_SORTABLE: dict[str, SortKey] = {
    "work_date": Timesheet.work_date,
    "employee": (Employee.last_name, Employee.first_name),
    "created_at": Timesheet.created_at,
}

_NO_HOURS = Decimal("0.00")
# How many timesheets a refusal of a bulk approval names before it starts counting.
_NAMED_IN_REFUSAL = 3


def _timesheets(ctx: Context) -> Select[Timesheet, Employee, Building, Contract]:
    """Each timesheet with its employee, building and contract, archived or not."""
    return (
        select(Timesheet, Employee, Building, Contract)
        .join(Employee, Employee.id == Timesheet.employee_id)
        .join(Building, Building.id == Timesheet.building_id)
        .outerjoin(Contract, Contract.id == Timesheet.contract_id)
        .where(crud.live(ctx, Timesheet))
    )


def _narrowed[*Ts](statement: Select[*Ts], query: TimesheetQuery) -> Select[*Ts]:
    if query.status:
        statement = statement.where(Timesheet.status == query.status)
    if query.building_id:
        statement = statement.where(Timesheet.building_id == query.building_id)
    if query.employee_id:
        statement = statement.where(Timesheet.employee_id == query.employee_id)
    if query.contract_id:
        statement = statement.where(Timesheet.contract_id == query.contract_id)
    return between_dates(statement, Timesheet.work_date, query.from_, query.to)


def _to_read(
    ctx: Context,
    timesheet: Timesheet,
    employee: Employee,
    building: Building,
    contract: Contract | None,
) -> TimesheetRead:
    return TimesheetRead.from_record(
        timesheet,
        employee=EmployeeSummary.model_validate(employee),
        building=BuildingRef.model_validate(building),
        contract=ContractRef.model_validate(contract) if contract else None,
        hourly_rate=compensation.visible(ctx, timesheet.hourly_rate),
        labor_cost=compensation.visible(ctx, timesheet.labor_cost),
    )


def _label(employee: Employee, building: Building, work_date: date) -> str:
    return f"the timesheet of {employee.full_name} for {work_date.isoformat()} at {building.name}"


def list_timesheets(ctx: Context, filters: TimesheetFilters) -> tuple[list[TimesheetRead], int]:
    statement = apply_sort(
        _narrowed(_timesheets(ctx), filters),
        filters.sort,
        allowed=_SORTABLE,
        default="-work_date",
        tiebreaker=Timesheet.id,
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(ctx, *row) for row in rows], total


def summarize_timesheets(ctx: Context, query: TimesheetQuery) -> TimesheetSummary:
    statement = _narrowed(
        select(
            Timesheet.status,
            func.count(),
            func.sum(Timesheet.hours_regular),
            func.sum(Timesheet.hours_overtime),
        )
        .where(crud.live(ctx, Timesheet))
        .group_by(Timesheet.status),
        query,
    )
    totals = {
        status: TimesheetTotals(
            count=0, hours_regular=_NO_HOURS, hours_overtime=_NO_HOURS, hours_total=_NO_HOURS
        )
        for status in DecisionStatus
    }
    for status, count, regular, overtime in ctx.db.execute(statement):
        totals[status] = TimesheetTotals(
            count=count,
            hours_regular=regular,
            hours_overtime=overtime,
            hours_total=regular + overtime,
        )
    return TimesheetSummary(
        pending=totals[DecisionStatus.PENDING],
        approved=totals[DecisionStatus.APPROVED],
        rejected=totals[DecisionStatus.REJECTED],
    )


def get_timesheet(ctx: Context, timesheet_id: UUID) -> TimesheetRead:
    row = ctx.db.execute(_timesheets(ctx).where(Timesheet.id == timesheet_id)).one_or_none()
    if row is None:
        raise NotFoundError("Timesheet not found.")
    return _to_read(ctx, *row)


def create_timesheet(ctx: Context, data: TimesheetCreate) -> TimesheetRead:
    values = data.model_dump()
    employee = crud.get_referenced(
        ctx, Employee, data.employee_id, field="employee_id", message="Employee not found."
    )
    values["hourly_rate"] = _rate_of(employee)
    building = crud.get_referenced(
        ctx, Building, data.building_id, field="building_id", message="Building not found."
    )
    contracts_service.check_coverage(ctx, values)
    _check_shift(ctx, values)
    _check_hours(data.hours_regular, data.hours_overtime)
    _ensure_only_one(ctx, employee, building, data.work_date)
    values["labor_cost"] = labor_cost(
        data.hours_regular, data.hours_overtime, values["hourly_rate"], data.overtime_multiplier
    )
    timesheet = Timesheet(organization_id=ctx.organization_id, submitted_at=utcnow(), **values)
    crud.create(
        ctx,
        timesheet,
        entity_type="timesheet",
        summary=f"Entered {_label(employee, building, timesheet.work_date)}",
    )
    return get_timesheet(ctx, timesheet.id)


def update_timesheet(ctx: Context, timesheet_id: UUID, data: TimesheetUpdate) -> TimesheetRead:
    # Locked, so that it cannot be approved half way through being changed.
    timesheet = crud.get_or_404(ctx, Timesheet, timesheet_id, label="Timesheet", for_update=True)
    decisions.ensure_editable(timesheet, entity_type="timesheet")
    requested = crud.requested_changes(Timesheet, data)

    def resulting(field: str) -> Any:
        return requested[field] if field in requested else getattr(timesheet, field)

    employee = crud.new_reference(
        ctx, Employee, requested, "employee_id", message="Employee not found.", record=timesheet
    )
    if employee is not None:
        # The time has become someone else's, so it is priced at their rate.
        requested["hourly_rate"] = _rate_of(employee)
    else:
        employee = crud.get_held(ctx, Employee, timesheet.employee_id)
    building = crud.new_reference(
        ctx, Building, requested, "building_id", message="Building not found.", record=timesheet
    ) or crud.get_held(ctx, Building, timesheet.building_id)
    contracts_service.check_coverage(
        ctx, requested, building_id=timesheet.building_id, contract_id=timesheet.contract_id
    )
    _check_shift(ctx, requested, timesheet)
    _check_hours(resulting("hours_regular"), resulting("hours_overtime"))
    work_date: date = resulting("work_date")
    if requested.keys() & {"employee_id", "building_id", "work_date"}:
        _ensure_only_one(ctx, employee, building, work_date, excluding=timesheet.id)
    requested["labor_cost"] = labor_cost(
        resulting("hours_regular"),
        resulting("hours_overtime"),
        resulting("hourly_rate"),
        resulting("overtime_multiplier"),
    )
    crud.update(
        ctx,
        timesheet,
        requested,
        entity_type="timesheet",
        summary=f"Updated {_label(employee, building, work_date)}",
    )
    return get_timesheet(ctx, timesheet.id)


# --- deciding ----------------------------------------------------------------------------


def approve_timesheet(ctx: Context, timesheet_id: UUID) -> TimesheetRead:
    timesheet, employee, building = _for_decision(ctx, timesheet_id)
    if _is_own(ctx, employee):
        raise PermissionDeniedError(
            "You cannot approve your own time. Someone else has to approve it."
        )
    decisions.approve(
        ctx,
        timesheet,
        entity_type="timesheet",
        summary=f"Approved {_label(employee, building, timesheet.work_date)}",
    )
    return get_timesheet(ctx, timesheet.id)


def approve_timesheets(ctx: Context, data: TimesheetBulkApproval) -> TimesheetBulkApproved:
    """Approve every timesheet named, or none of them.

    Everything is checked before anything is changed, so a refusal leaves each timesheet
    as it was and says what stood in the way.
    """
    ids = set(data.ids)
    # Locked in a fixed order, so that two overlapping requests cannot deadlock.
    rows = ctx.db.execute(
        _timesheets(ctx)
        .where(Timesheet.id.in_(ids))
        .order_by(Timesheet.id)
        .with_for_update(of=Timesheet)
        .execution_options(populate_existing=True)
    ).all()
    if len(rows) < len(ids):
        raise ValidationFailedError.for_field(
            "ids",
            f"{crud.counted(len(ids) - len(rows), 'timesheet')} could not be found."
            " Reload the list and try again. Nothing was approved.",
            "not_found",
        )
    own = [
        (employee, building, sheet)
        for sheet, employee, building, _ in rows
        if _is_own(ctx, employee)
    ]
    if own:
        raise PermissionDeniedError(
            f"You cannot approve your own time ({_named(own)})."
            " Leave it out for someone else to approve. Nothing was approved."
        )
    decided = [
        (employee, building, sheet)
        for sheet, employee, building, _ in rows
        if sheet.status is not DecisionStatus.PENDING
    ]
    if decided:
        message = (
            f"{crud.counted(len(decided), 'timesheet')} had already been decided"
            f" ({_named(decided)}). Nothing was approved."
        )
        raise ConflictError(message, errors=[FieldProblem(field="ids", message=message)])
    for timesheet, employee, building, _ in rows:
        decisions.approve(
            ctx,
            timesheet,
            entity_type="timesheet",
            summary=f"Approved {_label(employee, building, timesheet.work_date)}",
        )
    return TimesheetBulkApproved(approved=len(rows))


def reject_timesheet(ctx: Context, timesheet_id: UUID, data: decisions.Rejection) -> TimesheetRead:
    timesheet, employee, building = _for_decision(ctx, timesheet_id)
    decisions.reject(
        ctx,
        timesheet,
        data.reason,
        entity_type="timesheet",
        summary=f"Rejected {_label(employee, building, timesheet.work_date)}",
    )
    return get_timesheet(ctx, timesheet.id)


def reopen_timesheet(ctx: Context, timesheet_id: UUID) -> TimesheetRead:
    timesheet, employee, building = _for_decision(ctx, timesheet_id)
    decisions.reopen(
        ctx,
        timesheet,
        entity_type="timesheet",
        summary=f"Reopened {_label(employee, building, timesheet.work_date)}",
    )
    return get_timesheet(ctx, timesheet.id)


def _for_decision(ctx: Context, timesheet_id: UUID) -> tuple[Timesheet, Employee, Building]:
    """The timesheet, locked so that it is decided on as it stands, and who and where it
    is for."""
    timesheet = crud.get_or_404(ctx, Timesheet, timesheet_id, label="Timesheet", for_update=True)
    return (
        timesheet,
        crud.get_held(ctx, Employee, timesheet.employee_id),
        crud.get_held(ctx, Building, timesheet.building_id),
    )


def _is_own(ctx: Context, employee: Employee) -> bool:
    """Whether the employee is the person making the request, through their login."""
    membership_id = ctx.principal.membership_id
    return membership_id is not None and employee.membership_id == membership_id


def _named(timesheets: Sequence[tuple[Employee, Building, Timesheet]]) -> str:
    """A few timesheets by name and the rest as a count, to keep a refusal readable."""
    names = [
        f"{employee.full_name} on {timesheet.work_date.isoformat()} at {building.name}"
        for employee, building, timesheet in timesheets[:_NAMED_IN_REFUSAL]
    ]
    if len(timesheets) > _NAMED_IN_REFUSAL:
        names.append(f"{len(timesheets) - _NAMED_IN_REFUSAL} more")
    return ", ".join(names)


# --- validation --------------------------------------------------------------------------


def _rate_of(employee: Employee) -> Decimal:
    """The rate the employee's time is priced at. Without one it cannot be entered."""
    if employee.hourly_rate is None:
        raise ValidationFailedError.for_field(
            "employee_id",
            f"{employee.full_name} has no hourly rate, so their time cannot be priced."
            " Give them a rate first.",
            "no_hourly_rate",
        )
    return employee.hourly_rate


def _check_hours(hours_regular: Decimal, hours_overtime: Decimal) -> None:
    """The database holds the same rules. Checking here names the field that is wrong."""
    total = hours_regular + hours_overtime
    if total <= 0:
        raise ValidationFailedError.for_field(
            "hours_regular", "Enter the hours worked. They cannot all be zero.", "no_hours"
        )
    if total > 24:
        raise ValidationFailedError.for_field(
            "hours_overtime",
            f"Regular and overtime hours cannot come to more than 24 in a day ({total}).",
            "too_many_hours",
        )


def _check_shift(
    ctx: Context, values: Mapping[str, Any], timesheet: Timesheet | None = None
) -> None:
    """A timesheet can be tied only to a shift of its own employee at its own building.

    `timesheet` is the record being updated, or None for one about to be created.
    """
    if not values.keys() & {"shift_id", "employee_id", "building_id"}:
        return

    def resulting(field: str) -> Any:
        if field in values or timesheet is None:
            return values.get(field)
        return getattr(timesheet, field)

    shift_id: UUID | None = resulting("shift_id")
    if shift_id is None:
        return
    shift = crud.new_reference(
        ctx, Shift, values, "shift_id", message="Shift not found.", record=timesheet
    ) or crud.get_held(ctx, Shift, shift_id)
    if shift.employee_id != resulting("employee_id"):
        raise ValidationFailedError.for_field(
            "shift_id", "This shift belongs to another employee.", "shift_of_another_employee"
        )
    if shift.building_id != resulting("building_id"):
        raise ValidationFailedError.for_field(
            "shift_id", "This shift is at another building.", "shift_at_another_building"
        )


def _ensure_only_one(
    ctx: Context,
    employee: Employee,
    building: Building,
    work_date: date,
    *,
    excluding: UUID | None = None,
) -> None:
    crud.ensure_unique(
        ctx,
        Timesheet,
        Timesheet.employee_id == employee.id,
        Timesheet.work_date == work_date,
        Timesheet.building_id == building.id,
        field="work_date",
        message=(
            f"{employee.full_name} already has a timesheet for {work_date.isoformat()}"
            f" at {building.name}."
        ),
        excluding=excluding,
    )
