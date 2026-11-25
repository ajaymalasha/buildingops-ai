"""Writing and reading the audit trail."""

import enum
import uuid
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from buildingops.core.context import Context
from buildingops.core.models import utcnow
from buildingops.core.pagination import paginate_scalars, search_pattern
from buildingops.modules.audit.models import AuditLog
from buildingops.modules.audit.schemas import AuditLogFilters

_FROM_CONTEXT: Any = object()


def to_jsonable(value: Any) -> Any:
    """Convert a column value into something JSON can hold without losing meaning."""
    if isinstance(value, enum.Enum):
        return value.value
    if isinstance(value, uuid.UUID | Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def changes_between(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, Any]:
    """Field-level diff: `{"role": {"from": "employee", "to": "supervisor"}}`."""
    return {
        key: {"from": to_jsonable(before.get(key)), "to": to_jsonable(value)}
        for key, value in after.items()
        if before.get(key) != value
    }


def record(
    ctx: Context,
    *,
    action: str,
    entity_type: str,
    summary: str,
    entity_id: uuid.UUID | None = None,
    changes: Mapping[str, Any] | None = None,
    organization_id: uuid.UUID | None = _FROM_CONTEXT,
) -> AuditLog:
    """Add an audit entry to the current transaction.

    The entry commits or rolls back together with the change it describes, so the trail
    never claims something that did not happen and never misses something that did.
    """
    principal = ctx.principal
    entry = AuditLog(
        organization_id=(
            principal.organization_id if organization_id is _FROM_CONTEXT else organization_id
        ),
        actor_user_id=principal.user_id,
        actor_name=principal.full_name,
        actor_role=principal.role.value if principal.role else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary[:400],
        changes=dict(changes) if changes else None,
        request_id=ctx.meta.request_id,
        ip=ctx.meta.ip,
        created_at=utcnow(),
    )
    ctx.db.add(entry)
    return entry


def list_audit_logs(ctx: Context, filters: AuditLogFilters) -> tuple[list[AuditLog], int]:
    statement = select(AuditLog).where(AuditLog.organization_id == ctx.organization_id)
    if filters.entity_type:
        statement = statement.where(AuditLog.entity_type == filters.entity_type)
    if filters.entity_id:
        statement = statement.where(AuditLog.entity_id == filters.entity_id)
    if filters.action:
        # "member" matches member.added, member.updated, ...; a full action matches itself.
        statement = statement.where(
            (AuditLog.action == filters.action) | AuditLog.action.like(f"{filters.action}.%")
        )
    if filters.actor_user_id:
        statement = statement.where(AuditLog.actor_user_id == filters.actor_user_id)
    if filters.since:
        statement = statement.where(AuditLog.created_at >= filters.since)
    if filters.until:
        statement = statement.where(AuditLog.created_at < filters.until)
    if filters.q:
        pattern = search_pattern(filters.q)
        statement = statement.where(
            AuditLog.summary.ilike(pattern, escape="\\")
            | AuditLog.actor_name.ilike(pattern, escape="\\")
        )
    statement = statement.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    items, total = paginate_scalars(ctx.db, statement, filters)
    return list(items), total
