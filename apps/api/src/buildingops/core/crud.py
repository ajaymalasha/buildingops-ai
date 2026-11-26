"""Mechanics shared by the services that manage tenant-owned records.

Finding a row inside the caller's organization, giving a new record its code, applying a
partial update, archiving, and writing the audit entry that goes with each change work the
same way for every resource. What differs stays in the resource's own service: validation,
read models, and which records stand in the way of an archive.

Two row locks keep "this row is live" true until the transaction ends. A row that a change
comes to depend on is read with a key-share lock (`get_referenced`), which leaves ordinary
updates to that row alone. A row about to be archived is locked for update before anything
looks for its dependants (`get_or_404(..., for_update=True)`). The two conflict, so
whichever comes second waits for the first to finish and then sees what it did.
"""

import uuid
from collections.abc import Collection, Mapping, Sequence
from datetime import datetime
from typing import Any, ClassVar, Protocol

from pydantic import BaseModel
from sqlalchemy import ColumnElement, Select, SQLColumnExpression, and_, inspect, or_, select
from sqlalchemy.orm import Mapped

from buildingops.core.context import Context
from buildingops.core.errors import (
    ConflictError,
    FieldProblem,
    NotFoundError,
    ValidationFailedError,
)
from buildingops.core.models import SoftDeleteMixin, utcnow
from buildingops.core.pagination import search_pattern
from buildingops.modules.audit import service as audit
from buildingops.modules.sequences.service import CodeSeries, next_code

# Columns that describe the row itself rather than the thing it records.
_BOOKKEEPING = frozenset({"id", "organization_id", "created_at", "updated_at", "deleted_at"})


class TenantRecord(Protocol):
    """What these helpers need from a model. `IdMixin` and `TenantMixin` provide it.

    The attributes are class variables because that is what a mapped attribute is: a
    descriptor on the class, read as a column there and as a value on an instance.
    """

    id: ClassVar[Mapped[uuid.UUID]]
    organization_id: ClassVar[Mapped[uuid.UUID]]


class ArchivableRecord(TenantRecord, Protocol):
    """A tenant record that also uses `SoftDeleteMixin`."""

    deleted_at: ClassVar[Mapped[datetime | None]]


# --- reading -----------------------------------------------------------------------------


def live(ctx: Context, model: type[TenantRecord]) -> ColumnElement[bool]:
    """Rows of `model` the caller can work with: their organization's, minus archived ones."""
    in_organization = model.organization_id == ctx.organization_id
    if issubclass(model, SoftDeleteMixin):
        return and_(in_organization, model.deleted_at.is_(None))
    return in_organization


def get_or_404[M: TenantRecord](
    ctx: Context, model: type[M], record_id: uuid.UUID, *, label: str, for_update: bool = False
) -> M:
    """The live row with this id in the caller's organization.

    Another organization's id, an archived row and an unknown id all get the same answer,
    so the response does not reveal which it was.
    """
    statement = select(model).where(model.id == record_id, live(ctx, model))
    if for_update:
        statement = _locked(statement, key_share=False)
    record = ctx.db.scalar(statement)
    if record is None:
        raise NotFoundError(f"{label} not found.")
    return record


def get_referenced[M: TenantRecord](
    ctx: Context,
    model: type[M],
    record_id: uuid.UUID,
    *,
    field: str,
    message: str,
    code: str = "not_found",
) -> M:
    """A live row that the request makes something depend on, such as a building's customer.

    If it is missing, the mistake is in the request field that led to it, so the answer is
    a 422 on `field` rather than a 404. The row is key-share locked: it cannot be archived
    before this transaction ends.
    """
    statement = select(model).where(model.id == record_id, live(ctx, model))
    record = ctx.db.scalar(_locked(statement, key_share=True))
    if record is None:
        raise ValidationFailedError.for_field(field, message, code)
    return record


def lock_live(
    ctx: Context, model: type[TenantRecord], record_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these rows are live. Those that are get the lock `get_referenced` takes."""
    statement = select(model.id).where(model.id.in_(record_ids), live(ctx, model))
    return set(ctx.db.scalars(_locked(statement, key_share=True)))


def _locked[*Ts](statement: Select[*Ts], *, key_share: bool) -> Select[*Ts]:
    """Lock the rows the statement returns: FOR KEY SHARE, or else FOR UPDATE.

    The session also takes each row as it is now, not as it may have loaded it earlier.
    The point of waiting for a lock is to see what the transaction holding it left behind.
    """
    return statement.with_for_update(read=key_share, key_share=key_share).execution_options(
        populate_existing=True
    )


def search[*Ts](
    statement: Select[*Ts], text: str | None, *columns: SQLColumnExpression[Any]
) -> Select[*Ts]:
    """Keep the rows in which any of `columns` contains `text`, ignoring case."""
    if not text:
        return statement
    pattern = search_pattern(text)
    return statement.where(or_(*(column.ilike(pattern, escape="\\") for column in columns)))


# --- validating --------------------------------------------------------------------------


def requested_changes(model: type[TenantRecord], data: BaseModel) -> dict[str, Any]:
    """The fields a PATCH body actually sent.

    A field may be left out, but a column the table requires cannot be set to null.
    """
    requested = data.model_dump(exclude_unset=True)
    columns = inspect(model).columns
    problems = [
        FieldProblem(field=name, message="This field cannot be empty.", code="required")
        for name, value in requested.items()
        if value is None and name in columns and not columns[name].nullable
    ]
    if problems:
        raise ValidationFailedError("One or more fields cannot be empty.", errors=problems)
    return requested


def ensure_unique(
    ctx: Context,
    model: type[TenantRecord],
    *criteria: ColumnElement[bool],
    field: str,
    message: str,
    excluding: uuid.UUID | None = None,
) -> None:
    """Refuse (409, reported on `field`) if another live row already matches `criteria`.

    A precise answer for the usual case. The unique index remains the guarantee for two
    requests that race each other.
    """
    statement = select(model.id).where(live(ctx, model), *criteria)
    if excluding is not None:
        statement = statement.where(model.id != excluding)
    if ctx.db.scalar(statement.limit(1)) is not None:
        raise ConflictError(message, errors=[FieldProblem(field=field, message=message)])


def ensure_no_dependants(name: str, dependants: Sequence[tuple[str, str]]) -> None:
    """Refuse an archive (409) while live records depend on the row.

    Each item says what the row still has and what would free it:
    `("3 buildings", "archive them or move them to another customer")`.
    """
    if dependants:
        has = " and ".join(what for what, _ in dependants)
        first = " and ".join(remedy for _, remedy in dependants)
        raise ConflictError(f"{name} still has {has}. Before archiving, {first}.")


def assign_code(
    ctx: Context,
    model: type[TenantRecord],
    column: SQLColumnExpression[str],
    supplied: str | None,
    *,
    series: CodeSeries,
    field: str = "code",
) -> str:
    """The code for a new record: the one the caller chose, or the next in the series."""
    if supplied is not None:
        ensure_unique(
            ctx, model, column == supplied, field=field, message=f"{supplied} is already in use."
        )
        return supplied
    while True:
        code = next_code(ctx, series.name, series.prefix)
        # The sequence only knows the codes it issued. Someone may have typed this one in
        # by hand, on a row that is live or archived, so skip ahead until one is free.
        in_use = select(model.id).where(
            model.organization_id == ctx.organization_id, column == code
        )
        if ctx.db.scalar(in_use.limit(1)) is None:
            return code


# --- changing ----------------------------------------------------------------------------


def create(ctx: Context, record: TenantRecord, *, entity_type: str, summary: str) -> None:
    """Insert `record` and record `<entity_type>.created` with the values it starts with."""
    ctx.db.add(record)
    ctx.db.flush()
    values = {
        attribute.key: getattr(record, attribute.key)
        for attribute in inspect(type(record)).column_attrs
        if attribute.key not in _BOOKKEEPING
    }
    audit.record(
        ctx,
        action=f"{entity_type}.created",
        entity_type=entity_type,
        entity_id=record.id,
        summary=summary,
        changes=audit.changes_between({}, values),
    )


def update(
    ctx: Context,
    record: TenantRecord,
    requested: Mapping[str, Any],
    *,
    entity_type: str,
    summary: str,
) -> dict[str, Any]:
    """Apply the requested values that differ and record `<entity_type>.updated`.

    Returns the field-level diff. The audit summary is `summary` followed by the names of
    the fields that changed. A request that changes nothing writes and records nothing.
    """
    changes = _apply(record, requested)
    if changes:
        ctx.db.flush()
        audit.record(
            ctx,
            action=f"{entity_type}.updated",
            entity_type=entity_type,
            entity_id=record.id,
            summary=f"{summary}: {_field_names(changes)}",
            changes=changes,
        )
    return changes


def archive(
    ctx: Context,
    record: ArchivableRecord,
    *,
    entity_type: str,
    summary: str,
    releasing: Mapping[str, Any] | None = None,
) -> None:
    """Archive `record` and record `<entity_type>.archived`.

    The row stays for history and for the records that refer to it, and disappears from
    lists and lookups. `releasing` clears fields an archived row must not keep holding,
    such as a link that only one live row may have.
    """
    changes = _apply(record, {**(releasing or {}), "deleted_at": utcnow()})
    ctx.db.flush()
    audit.record(
        ctx,
        action=f"{entity_type}.archived",
        entity_type=entity_type,
        entity_id=record.id,
        summary=summary,
        changes=changes,
    )


def _apply(record: TenantRecord, values: Mapping[str, Any]) -> dict[str, Any]:
    """Set the values that differ from the record's own. Returns the field-level diff."""
    before = {field: getattr(record, field) for field in values}
    changes = audit.changes_between(before, values)
    for field in changes:
        setattr(record, field, values[field])
    return changes


# --- wording -----------------------------------------------------------------------------


def _field_names(changes: Mapping[str, Any]) -> str:
    """`{"job_role_id": ..., "hourly_rate": ...}` reads as "hourly rate, job role"."""
    return ", ".join(sorted(name.removesuffix("_id").replace("_", " ") for name in changes))


def counted(count: int, noun: str) -> str:
    """`counted(1, "building")` is "1 building"; `counted(3, "building")` is "3 buildings"."""
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"
