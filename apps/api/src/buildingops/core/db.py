"""Database access and tenant context.

Tenant isolation is enforced twice. Services filter by organization explicitly, and
PostgreSQL row-level security filters again using settings that this module applies at the
start of every transaction. The settings are transaction-local (`set_config(..., true)`),
so they can never leak to another request through the connection pool, and a transaction
that has no context sees no tenant rows at all.
"""

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

_CONTEXT_KEY = "buildingops_db_context"

_APPLY_CONTEXT = text(
    "SELECT set_config('app.current_org_id', :org, true),"
    " set_config('app.current_user_id', :usr, true),"
    " set_config('app.platform_admin', :admin, true)"
)


@dataclass(frozen=True, slots=True)
class DbContext:
    """Who a transaction runs as, as seen by the row-level security policies."""

    organization_id: UUID | None = None
    user_id: UUID | None = None
    platform_admin: bool = False

    def as_params(self) -> dict[str, str]:
        return {
            "org": str(self.organization_id) if self.organization_id else "",
            "usr": str(self.user_id) if self.user_id else "",
            "admin": "true" if self.platform_admin else "false",
        }


def set_db_context(session: Session, context: DbContext) -> None:
    """Set the context for this session's current and future transactions."""
    session.info[_CONTEXT_KEY] = context
    if session.in_transaction():
        session.execute(_APPLY_CONTEXT, context.as_params())


def get_db_context(session: Session) -> DbContext | None:
    context: DbContext | None = session.info.get(_CONTEXT_KEY)
    return context


@event.listens_for(Session, "after_begin")
def _apply_context_on_begin(
    session: Session, transaction: SessionTransaction, connection: Connection
) -> None:
    context = get_db_context(session)
    if context is not None:
        connection.execute(_APPLY_CONTEXT, context.as_params())


class Database:
    """An engine plus a session factory. The API holds one for the app role."""

    def __init__(
        self,
        url: str,
        *,
        pool_size: int = 10,
        max_overflow: int = 10,
        statement_timeout_ms: int = 0,
        application_name: str = "buildingops",
    ) -> None:
        options = "-c timezone=UTC"
        if statement_timeout_ms:
            options += f" -c statement_timeout={statement_timeout_ms}"
        connect_args: dict[str, Any] = {"options": options, "application_name": application_name}
        self.engine: Engine = create_engine(
            url,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
            connect_args=connect_args,
        )
        self._factory = sessionmaker(bind=self.engine, expire_on_commit=False)

    def session(self, context: DbContext | None = None) -> Session:
        session = self._factory()
        if context is not None:
            session.info[_CONTEXT_KEY] = context
        return session

    def dispose(self) -> None:
        self.engine.dispose()


@dataclass(frozen=True, slots=True)
class RoleCheck:
    role: str
    is_superuser: bool
    bypasses_rls: bool
    owns_tables: bool

    @property
    def enforces_rls(self) -> bool:
        return not (self.is_superuser or self.bypasses_rls or self.owns_tables)


def check_runtime_role(engine: Engine) -> RoleCheck:
    """Report whether the connected role is actually subject to row-level security."""
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT current_user AS role, r.rolsuper, r.rolbypassrls,"
                " EXISTS (SELECT 1 FROM pg_tables t"
                "         WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owns"
                " FROM pg_roles r WHERE r.rolname = current_user"
            )
        ).one()
    return RoleCheck(
        role=row.role,
        is_superuser=row.rolsuper,
        bypasses_rls=row.rolbypassrls,
        owns_tables=row.owns,
    )
