from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.decisions import Rejection
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.timesheets import service
from buildingops.modules.timesheets.schemas import (
    TimesheetBulkApproval,
    TimesheetBulkApproved,
    TimesheetCreate,
    TimesheetFilters,
    TimesheetQuery,
    TimesheetRead,
    TimesheetSummary,
    TimesheetUpdate,
)

router = APIRouter(prefix="/timesheets", tags=["timesheets"])

_Reader = Annotated[Context, Depends(require(Permission.TIMESHEETS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.TIMESHEETS_WRITE))]
_Approver = Annotated[Context, Depends(require(Permission.TIMESHEETS_APPROVE))]


@router.get("", summary="List timesheets")
def list_timesheets(
    filters: Annotated[TimesheetFilters, Query()], ctx: _Reader
) -> Page[TimesheetRead]:
    items, total = service.list_timesheets(ctx, filters)
    return Page[TimesheetRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Enter a timesheet",
    description=(
        "It starts as pending. Its hourly rate is the employee's and its labor cost is worked"
        " out from the hours: neither can be sent."
    ),
)
def create_timesheet(payload: TimesheetCreate, ctx: _Writer) -> TimesheetRead:
    return service.create_timesheet(ctx, payload)


# Declared before the routes that take an id, which would otherwise read "summary" as one.
@router.get(
    "/summary",
    summary="Count timesheets and add up their hours, by status",
    description="Takes the same filters as the list.",
)
def summarize_timesheets(
    query: Annotated[TimesheetQuery, Query()], ctx: _Reader
) -> TimesheetSummary:
    return service.summarize_timesheets(ctx, query)


@router.post(
    "/approve",
    summary="Approve several timesheets at once",
    description=(
        "All of them or none: if one is missing, already decided or the caller's own, nothing"
        " is approved. At most 200 at a time."
    ),
)
def approve_timesheets(payload: TimesheetBulkApproval, ctx: _Approver) -> TimesheetBulkApproved:
    return service.approve_timesheets(ctx, payload)


@router.get("/{timesheet_id}", summary="Get a timesheet")
def read_timesheet(timesheet_id: UUID, ctx: _Reader) -> TimesheetRead:
    return service.get_timesheet(ctx, timesheet_id)


@router.patch(
    "/{timesheet_id}",
    summary="Update a pending timesheet",
    description="Refused with a 409 once the timesheet has been approved or rejected.",
)
def update_timesheet(timesheet_id: UUID, payload: TimesheetUpdate, ctx: _Writer) -> TimesheetRead:
    return service.update_timesheet(ctx, timesheet_id, payload)


@router.post(
    "/{timesheet_id}/approve",
    summary="Approve a timesheet",
    description="Nobody can approve their own time: that is a 403.",
)
def approve_timesheet(timesheet_id: UUID, ctx: _Approver) -> TimesheetRead:
    return service.approve_timesheet(ctx, timesheet_id)


@router.post("/{timesheet_id}/reject", summary="Reject a timesheet, with a reason")
def reject_timesheet(timesheet_id: UUID, payload: Rejection, ctx: _Approver) -> TimesheetRead:
    return service.reject_timesheet(ctx, timesheet_id, payload)


@router.post(
    "/{timesheet_id}/reopen",
    summary="Return a decided timesheet to pending",
    description="Clears the decision, so that the timesheet can be edited and decided again.",
)
def reopen_timesheet(timesheet_id: UUID, ctx: _Approver) -> TimesheetRead:
    return service.reopen_timesheet(ctx, timesheet_id)
