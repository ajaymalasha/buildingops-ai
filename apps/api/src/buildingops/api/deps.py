"""Request dependencies: the database session, the authenticated context, permissions."""

from collections.abc import Callable, Iterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from buildingops.core.context import Context, RequestMeta
from buildingops.core.db import Database
from buildingops.core.errors import AuthenticationError, PermissionDeniedError
from buildingops.core.logging import get_logger
from buildingops.core.permissions import Permission
from buildingops.core.security import PasswordService
from buildingops.modules.identity.auth_service import AuthService

logger = get_logger("buildingops")

_bearer = HTTPBearer(
    auto_error=False,
    description="Session token returned by `POST /api/v1/auth/login`.",
)


def get_db(request: Request) -> Iterator[Session]:
    """One session and one transaction per request.

    Commits when the endpoint returns and rolls back when it raises. The dependency is used
    with `scope="function"`, so the commit happens before the response is sent: a client
    never receives a success for a transaction that then failed to commit.
    """
    database: Database = request.app.state.database
    session = database.session()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


DbSession = Annotated[Session, Depends(get_db, scope="function")]


def get_request_meta(request: Request) -> RequestMeta:
    return RequestMeta(
        request_id=getattr(request.state, "request_id", None),
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


Meta = Annotated[RequestMeta, Depends(get_request_meta)]


def get_auth_service(request: Request) -> AuthService:
    service: AuthService = request.app.state.auth
    return service


Auth = Annotated[AuthService, Depends(get_auth_service)]


def get_password_service(request: Request) -> PasswordService:
    service: PasswordService = request.app.state.passwords
    return service


Passwords = Annotated[PasswordService, Depends(get_password_service)]


def get_context(
    request: Request,
    db: DbSession,
    meta: Meta,
    auth: Auth,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Context:
    """Authenticate the bearer token and bind the database session to the caller's tenant."""
    if credentials is None:
        raise AuthenticationError("Sign in to continue.")
    principal = auth.authenticate(db, credentials.credentials)

    # Read by the access-log middleware once the response is on its way.
    request.state.user_id = str(principal.user_id)
    request.state.organization_id = (
        str(principal.organization_id) if principal.organization_id else None
    )
    return Context(
        db=db,
        principal=principal,
        meta=meta,
        log=logger.bind(
            user_id=request.state.user_id, organization_id=request.state.organization_id
        ),
    )


CurrentContext = Annotated[Context, Depends(get_context)]


def require(*permissions: Permission) -> Callable[[Context], Context]:
    """Dependency factory: the caller must hold every listed permission."""

    def dependency(ctx: CurrentContext) -> Context:
        missing = [permission for permission in permissions if not ctx.principal.has(permission)]
        if missing:
            ctx.log.warning(
                "permission_denied", missing=[permission.value for permission in missing]
            )
            raise PermissionDeniedError()
        return ctx

    return dependency
