"""The authenticated principal and the per-request context handed to services."""

from dataclasses import dataclass, field
from uuid import UUID

import structlog
from sqlalchemy.orm import Session

from buildingops.core.errors import NoActiveOrganizationError
from buildingops.core.logging import get_logger
from buildingops.core.permissions import Permission, Role


@dataclass(frozen=True, slots=True)
class Principal:
    """Who is making the request and in which organization."""

    user_id: UUID
    email: str
    full_name: str
    is_platform_admin: bool
    session_id: UUID
    organization_id: UUID | None
    membership_id: UUID | None
    role: Role | None
    permissions: frozenset[Permission]

    def has(self, permission: Permission) -> bool:
        return permission in self.permissions


@dataclass(frozen=True, slots=True)
class RequestMeta:
    request_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None


@dataclass(slots=True)
class Context:
    """Everything a service needs: a database session, the principal, request metadata.

    Services never commit. The caller that created the session (the request dependency, a
    background task or a CLI command) owns the transaction boundary.
    """

    db: Session
    principal: Principal
    meta: RequestMeta = field(default_factory=RequestMeta)
    log: structlog.stdlib.BoundLogger = field(default_factory=lambda: get_logger("buildingops"))

    @property
    def organization_id(self) -> UUID:
        if self.principal.organization_id is None:
            raise NoActiveOrganizationError("Select an organization to continue.")
        return self.principal.organization_id
