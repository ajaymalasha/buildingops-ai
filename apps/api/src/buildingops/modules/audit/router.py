from typing import Annotated

from fastapi import APIRouter, Depends, Query

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.audit import service
from buildingops.modules.audit.schemas import AuditLogFilters, AuditLogRead

router = APIRouter(prefix="/audit-logs", tags=["audit"])


@router.get("", summary="List audit log entries for the active organization, newest first")
def list_audit_logs(
    filters: Annotated[AuditLogFilters, Query()],
    ctx: Annotated[Context, Depends(require(Permission.AUDIT_READ))],
) -> Page[AuditLogRead]:
    items, total = service.list_audit_logs(ctx, filters)
    return Page[AuditLogRead](
        items=[AuditLogRead.model_validate(item) for item in items],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
    )
