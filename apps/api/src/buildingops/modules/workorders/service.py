"""Work orders of the active organization, their statuses and their history."""

from collections.abc import Mapping, Sequence
from datetime import date
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, and_, case, func, not_, select
from sqlalchemy.orm import InstrumentedAttribute

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import ConflictError, FieldProblem, NotFoundError
from buildingops.core.models import utcnow
from buildingops.core.pagination import SortKey, apply_sort, paginate_rows
from buildingops.modules.audit import service as audit
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingRef
from buildingops.modules.contracts import service as contracts_service
from buildingops.modules.contracts.models import Contract
from buildingops.modules.contracts.schemas import ContractRef
from buildingops.modules.identity import organizations_service
from buildingops.modules.sequences.service import CodeSeries
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.vendors.schemas import VendorRef
from buildingops.modules.workforce.models import Employee
from buildingops.modules.workforce.schemas import EmployeeSummary
from buildingops.modules.workorders.models import (
    WorkOrder,
    WorkOrderActivity,
    WorkOrderActivityKind,
    WorkOrderPriority,
    WorkOrderStatus,
)
from buildingops.modules.workorders.schemas import (
    WorkOrderActivityRead,
    WorkOrderCommentCreate,
    WorkOrderCreate,
    WorkOrderDetail,
    WorkOrderFilters,
    WorkOrderRead,
    WorkOrderStatusChange,
    WorkOrderUpdate,
)

WORK_ORDER_NUMBERS = CodeSeries("work_order", "WO")

_S = WorkOrderStatus

# Where a work order can go from each status. Completed work can be reopened, and a
# cancelled order can be taken up again.
ALLOWED_MOVES: Mapping[WorkOrderStatus, tuple[WorkOrderStatus, ...]] = {
    _S.OPEN: (_S.SCHEDULED, _S.IN_PROGRESS, _S.ON_HOLD, _S.CANCELLED),
    _S.SCHEDULED: (_S.IN_PROGRESS, _S.ON_HOLD, _S.CANCELLED, _S.OPEN),
    _S.IN_PROGRESS: (_S.ON_HOLD, _S.COMPLETED, _S.CANCELLED),
    _S.ON_HOLD: (_S.OPEN, _S.SCHEDULED, _S.IN_PROGRESS, _S.CANCELLED),
    _S.COMPLETED: (_S.IN_PROGRESS,),
    _S.CANCELLED: (_S.OPEN,),
}

# Statuses in which no more work is expected, so a due date that has passed no longer matters.
_CLOSED = (_S.COMPLETED, _S.CANCELLED)

# How the history words a change of assignee or vendor: given, changed, taken away.
_ASSIGNEE_WORDING = (
    "Assigned to {after}.",
    "Reassigned from {before} to {after}.",
    "No longer assigned to {before}.",
)
_VENDOR_WORDING = (
    "Vendor set to {after}.",
    "Vendor changed from {before} to {after}.",
    "Vendor {before} removed.",
)


def _rank(column: InstrumentedAttribute[Any], members: Sequence[StrEnum]) -> ColumnElement[int]:
    """Sorts an enumeration in the order its members are declared in, which is the order
    they mean, rather than alphabetically."""
    return case({member: position for position, member in enumerate(members)}, value=column)


_SORTABLE: dict[str, SortKey] = {
    # Shorter numbers first, so that WO-10000 comes after WO-9999.
    "number": (func.length(WorkOrder.number), WorkOrder.number),
    "due_on": WorkOrder.due_on,
    "priority": _rank(WorkOrder.priority, tuple(WorkOrderPriority)),
    "created_at": WorkOrder.created_at,
    "status": _rank(WorkOrder.status, tuple(WorkOrderStatus)),
}


def _overdue(today: date) -> ColumnElement[bool]:
    """Due before `today` and still open in some way. Never null, so it can be negated: a
    work order with no due date is simply not overdue."""
    return and_(
        WorkOrder.due_on.is_not(None),
        WorkOrder.due_on < today,
        WorkOrder.status.not_in(_CLOSED),
    )


def _work_orders(
    ctx: Context, today: date
) -> Select[WorkOrder, Building, Contract, Employee, Vendor, bool]:
    """Each work order with what a list shows beside it, and whether it is overdue.

    The joins do not ask for live rows: a work order keeps showing the building, person or
    vendor it was for after they are archived.
    """
    return (
        select(WorkOrder, Building, Contract, Employee, Vendor, _overdue(today).label("is_overdue"))
        .join(Building, Building.id == WorkOrder.building_id)
        .outerjoin(Contract, Contract.id == WorkOrder.contract_id)
        .outerjoin(Employee, Employee.id == WorkOrder.assigned_employee_id)
        .outerjoin(Vendor, Vendor.id == WorkOrder.vendor_id)
        .where(crud.live(ctx, WorkOrder))
    )


def _to_read(
    work_order: WorkOrder,
    building: Building,
    contract: Contract | None,
    employee: Employee | None,
    vendor: Vendor | None,
    is_overdue: bool,
) -> WorkOrderRead:
    return WorkOrderRead.from_record(
        work_order,
        building=BuildingRef.model_validate(building),
        contract=ContractRef.model_validate(contract) if contract else None,
        assigned_employee=EmployeeSummary.model_validate(employee) if employee else None,
        vendor=VendorRef.model_validate(vendor) if vendor else None,
        is_overdue=is_overdue,
    )


def _label(work_order: WorkOrder) -> str:
    return f"{work_order.number} ({work_order.title})"


def _status_label(status: WorkOrderStatus) -> str:
    return status.value.replace("_", " ")


def list_work_orders(ctx: Context, filters: WorkOrderFilters) -> tuple[list[WorkOrderRead], int]:
    today = organizations_service.today(ctx)
    statement = _work_orders(ctx, today)
    if filters.status:
        statement = statement.where(WorkOrder.status.in_(filters.status))
    if filters.priority:
        statement = statement.where(WorkOrder.priority == filters.priority)
    if filters.category:
        statement = statement.where(WorkOrder.category == filters.category)
    if filters.building_id:
        statement = statement.where(WorkOrder.building_id == filters.building_id)
    if filters.assigned_employee_id:
        statement = statement.where(WorkOrder.assigned_employee_id == filters.assigned_employee_id)
    if filters.vendor_id:
        statement = statement.where(WorkOrder.vendor_id == filters.vendor_id)
    if filters.overdue is not None:
        statement = statement.where(_overdue(today) if filters.overdue else not_(_overdue(today)))
    statement = crud.search(statement, filters.q, WorkOrder.number, WorkOrder.title)
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="-created_at", tiebreaker=WorkOrder.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(*row) for row in rows], total


def get_work_order(ctx: Context, work_order_id: UUID) -> WorkOrderDetail:
    statement = _work_orders(ctx, organizations_service.today(ctx))
    row = ctx.db.execute(statement.where(WorkOrder.id == work_order_id)).one_or_none()
    if row is None:
        raise NotFoundError("Work order not found.")
    activities = ctx.db.scalars(
        select(WorkOrderActivity)
        .where(crud.live(ctx, WorkOrderActivity), WorkOrderActivity.work_order_id == work_order_id)
        .order_by(WorkOrderActivity.created_at, WorkOrderActivity.id)
    ).all()
    return WorkOrderDetail(
        **_to_read(*row).model_dump(),
        activities=[WorkOrderActivityRead.model_validate(activity) for activity in activities],
    )


def create_work_order(ctx: Context, data: WorkOrderCreate) -> WorkOrderDetail:
    values = data.model_dump()
    building = crud.get_referenced(
        ctx, Building, data.building_id, field="building_id", message="Building not found."
    )
    _check_references(ctx, values)
    values["number"] = crud.assign_code(
        ctx, WorkOrder, WorkOrder.number, None, series=WORK_ORDER_NUMBERS, field="number"
    )
    work_order = WorkOrder(organization_id=ctx.organization_id, **values)
    crud.create(
        ctx,
        work_order,
        entity_type="work_order",
        summary=f"Created work order {_label(work_order)} at {building.name}",
    )
    _record_assignments(ctx, work_order, previous_employee_id=None, previous_vendor_id=None)
    return get_work_order(ctx, work_order.id)


def update_work_order(ctx: Context, work_order_id: UUID, data: WorkOrderUpdate) -> WorkOrderDetail:
    # Locked, so that the history records reassignments in the order they were made.
    work_order = crud.get_or_404(ctx, WorkOrder, work_order_id, label="Work order", for_update=True)
    requested = crud.requested_changes(WorkOrder, data)
    crud.new_reference(
        ctx, Building, requested, "building_id", message="Building not found.", record=work_order
    )
    _check_references(ctx, requested, work_order)
    previous_employee_id, previous_vendor_id = work_order.assigned_employee_id, work_order.vendor_id
    crud.update(
        ctx,
        work_order,
        requested,
        entity_type="work_order",
        summary=f"Updated work order {_label(work_order)}",
    )
    _record_assignments(
        ctx,
        work_order,
        previous_employee_id=previous_employee_id,
        previous_vendor_id=previous_vendor_id,
    )
    return get_work_order(ctx, work_order.id)


def change_status(
    ctx: Context, work_order_id: UUID, data: WorkOrderStatusChange
) -> WorkOrderDetail:
    # Locked, so that of two moves made at once the second is judged against the status
    # the first one left.
    work_order = crud.get_or_404(ctx, WorkOrder, work_order_id, label="Work order", for_update=True)
    current, target = work_order.status, data.status
    if target not in ALLOWED_MOVES[current]:
        message = _refusal(current, target)
        raise ConflictError(message, errors=[FieldProblem(field="status", message=message)])

    values: dict[str, Any] = {"status": target}
    if target is _S.IN_PROGRESS and work_order.started_at is None:
        values["started_at"] = utcnow()
    if target is _S.COMPLETED:
        values["completed_at"] = utcnow()
    if current is _S.COMPLETED:
        values["completed_at"] = None
    crud.transition(
        ctx,
        work_order,
        values,
        action="status_changed",
        entity_type="work_order",
        summary=(
            f"Moved work order {_label(work_order)} from {_status_label(current)}"
            f" to {_status_label(target)}"
        ),
    )
    _add_activity(
        ctx,
        work_order,
        WorkOrderActivityKind.STATUS_CHANGE,
        data.comment,
        from_status=current,
        to_status=target,
    )
    return get_work_order(ctx, work_order.id)


def add_comment(
    ctx: Context, work_order_id: UUID, data: WorkOrderCommentCreate
) -> WorkOrderActivityRead:
    work_order = crud.get_or_404(ctx, WorkOrder, work_order_id, label="Work order")
    activity = _add_activity(ctx, work_order, WorkOrderActivityKind.COMMENT, data.body)
    audit.record(
        ctx,
        action="work_order.commented",
        entity_type="work_order",
        entity_id=work_order.id,
        summary=f"Commented on work order {_label(work_order)}",
        changes=audit.changes_between({}, {"comment": data.body}),
    )
    return WorkOrderActivityRead.model_validate(activity)


# --- validation --------------------------------------------------------------------------


def _check_references(
    ctx: Context, values: Mapping[str, Any], work_order: WorkOrder | None = None
) -> None:
    """Check the contract, the person and the vendor that `values` gives the work order.

    `work_order` is the record being updated, or None for one about to be created.
    """
    contracts_service.check_coverage(
        ctx,
        values,
        building_id=work_order.building_id if work_order else None,
        contract_id=work_order.contract_id if work_order else None,
    )
    crud.new_reference(
        ctx,
        Employee,
        values,
        "assigned_employee_id",
        message="Employee not found.",
        record=work_order,
    )
    crud.new_reference(
        ctx, Vendor, values, "vendor_id", message="Vendor not found.", record=work_order
    )


def _refusal(current: WorkOrderStatus, target: WorkOrderStatus) -> str:
    allowed = [_status_label(status) for status in ALLOWED_MOVES[current]]
    moves = " or ".join(filter(None, (", ".join(allowed[:-1]), allowed[-1])))
    if target is current:
        return f"This work order is already {_status_label(current)}. It can move to {moves}."
    return (
        f"A work order that is {_status_label(current)} cannot move to {_status_label(target)}."
        f" It can move to {moves}."
    )


# --- history -----------------------------------------------------------------------------


def _add_activity(
    ctx: Context,
    work_order: WorkOrder,
    kind: WorkOrderActivityKind,
    body: str | None,
    *,
    from_status: WorkOrderStatus | None = None,
    to_status: WorkOrderStatus | None = None,
) -> WorkOrderActivity:
    activity = WorkOrderActivity(
        organization_id=ctx.organization_id,
        work_order_id=work_order.id,
        kind=kind,
        body=body,
        from_status=from_status.value if from_status else None,
        to_status=to_status.value if to_status else None,
        author_user_id=ctx.principal.user_id,
        author_name=ctx.principal.full_name,
    )
    ctx.db.add(activity)
    ctx.db.flush()
    return activity


def _record_assignments(
    ctx: Context,
    work_order: WorkOrder,
    *,
    previous_employee_id: UUID | None,
    previous_vendor_id: UUID | None,
) -> None:
    """Add a history entry for the assignee, and one for the vendor, if they have changed.

    The entry carries the names, so it reads the same after a rename.
    """
    if work_order.assigned_employee_id != previous_employee_id:
        note = assignee_note(
            _employee_name(ctx, previous_employee_id),
            _employee_name(ctx, work_order.assigned_employee_id),
        )
        _add_activity(ctx, work_order, WorkOrderActivityKind.ASSIGNMENT, note)
    if work_order.vendor_id != previous_vendor_id:
        note = vendor_note(
            _vendor_name(ctx, previous_vendor_id), _vendor_name(ctx, work_order.vendor_id)
        )
        _add_activity(ctx, work_order, WorkOrderActivityKind.ASSIGNMENT, note)


def _employee_name(ctx: Context, employee_id: UUID | None) -> str | None:
    return crud.get_held(ctx, Employee, employee_id).full_name if employee_id else None


def _vendor_name(ctx: Context, vendor_id: UUID | None) -> str | None:
    return crud.get_held(ctx, Vendor, vendor_id).name if vendor_id else None


def assignee_note(before: str | None, after: str | None) -> str:
    """How the history words a change of assignee, from one name to another."""
    return _handover(_ASSIGNEE_WORDING, before, after)


def vendor_note(before: str | None, after: str | None) -> str:
    """How the history words a change of vendor, from one name to another."""
    return _handover(_VENDOR_WORDING, before, after)


def _handover(wording: tuple[str, str, str], before: str | None, after: str | None) -> str:
    given, changed, removed = wording
    sentence = given if before is None else removed if after is None else changed
    return sentence.format(before=before, after=after)
