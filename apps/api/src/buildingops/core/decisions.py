"""Deciding on a record that waits for someone's approval.

A timesheet or an expense is entered as pending. Someone allowed to decide approves it, or
rejects it and says why, and either decision can be undone by reopening the record. While
it is pending it can be edited; once decided it cannot. Those rules, and the audit entry
for each move, are the same for every such record and live here. Who may decide, and on
what, is the business of the service that calls.

The columns are `DecisionMixin` in `core/models.py`.
"""

from typing import Annotated, Any, ClassVar, Protocol

from pydantic import Field, StringConstraints
from sqlalchemy.orm import Mapped

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import ConflictError
from buildingops.core.models import DecisionStatus, utcnow
from buildingops.core.schemas import RequestModel

_UNDECIDED: dict[str, Any] = {
    "status": DecisionStatus.PENDING,
    "decided_by_user_id": None,
    "decided_by_name": None,
    "decided_at": None,
    "rejection_reason": None,
}


class DecidableRecord(crud.TenantRecord, Protocol):
    """What these helpers need from a model. `DecisionMixin` provides it."""

    status: ClassVar[Mapped[DecisionStatus]]


class Rejection(RequestModel):
    reason: Annotated[str, StringConstraints(min_length=1, max_length=500)] = Field(
        description="Why it is rejected. Kept on the record for whoever entered it."
    )


def ensure_editable(record: DecidableRecord, *, entity_type: str) -> None:
    """Refuse (409) to change a record that has been decided.

    What was approved must stay what is on record. Reopening it first is a decision of
    its own, made by someone allowed to decide and written to the audit log.
    """
    if record.status is not DecisionStatus.PENDING:
        noun = _noun(entity_type)
        raise ConflictError(
            f"This {noun} has been {record.status.value}, and only a pending {noun} can be"
            " changed. Reopen it first."
        )


def approve(ctx: Context, record: DecidableRecord, *, entity_type: str, summary: str) -> None:
    """Approve a pending record and record `<entity_type>.approved`."""
    _ensure_undecided(record, entity_type)
    crud.transition(
        ctx,
        record,
        _decision(ctx, DecisionStatus.APPROVED),
        action="approved",
        entity_type=entity_type,
        summary=summary,
    )


def reject(
    ctx: Context, record: DecidableRecord, reason: str, *, entity_type: str, summary: str
) -> None:
    """Reject a pending record, keeping the reason, and record `<entity_type>.rejected`."""
    _ensure_undecided(record, entity_type)
    crud.transition(
        ctx,
        record,
        _decision(ctx, DecisionStatus.REJECTED, reason),
        action="rejected",
        entity_type=entity_type,
        summary=summary,
    )


def reopen(ctx: Context, record: DecidableRecord, *, entity_type: str, summary: str) -> None:
    """Return a decided record to pending and record `<entity_type>.reopened`.

    The decision is cleared from the record. The audit entry keeps what it was.
    """
    if record.status is DecisionStatus.PENDING:
        raise ConflictError(
            f"This {_noun(entity_type)} is still pending. There is no decision to reopen."
        )
    crud.transition(
        ctx, record, _UNDECIDED, action="reopened", entity_type=entity_type, summary=summary
    )


def _ensure_undecided(record: DecidableRecord, entity_type: str) -> None:
    if record.status is not DecisionStatus.PENDING:
        raise ConflictError(
            f"This {_noun(entity_type)} has already been {record.status.value}."
            " Reopen it to decide again."
        )


def _decision(ctx: Context, status: DecisionStatus, reason: str | None = None) -> dict[str, Any]:
    return {
        "status": status,
        "decided_by_user_id": ctx.principal.user_id,
        "decided_by_name": ctx.principal.full_name,
        "decided_at": utcnow(),
        "rejection_reason": reason,
    }


def _noun(entity_type: str) -> str:
    return entity_type.replace("_", " ")
