from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import Field

from buildingops.core.pagination import PageParams
from buildingops.core.schemas import ResponseModel


class AuditLogRead(ResponseModel):
    id: UUID
    created_at: datetime
    actor_user_id: UUID | None
    actor_name: str
    actor_role: str | None
    action: str
    entity_type: str
    entity_id: UUID | None
    summary: str
    changes: dict[str, Any] | None
    request_id: str | None


class AuditLogFilters(PageParams):
    entity_type: str | None = Field(default=None, max_length=60)
    entity_id: UUID | None = None
    action: str | None = Field(
        default=None,
        max_length=80,
        description="An exact action (`member.added`) or a prefix (`member`).",
    )
    actor_user_id: UUID | None = None
    since: datetime | None = None
    until: datetime | None = None
    q: str | None = Field(default=None, max_length=200, description="Search summary and actor.")
