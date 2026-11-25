"""Application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from buildingops import __version__
from buildingops.api.health import router as health_router
from buildingops.api.router import api_v1
from buildingops.core.config import Settings, get_settings
from buildingops.core.db import Database, check_runtime_role
from buildingops.core.errors import register_exception_handlers
from buildingops.core.logging import configure_logging, get_logger
from buildingops.core.middleware import RequestContextMiddleware
from buildingops.core.security import PasswordService
from buildingops.modules.identity.auth_service import AuthService

logger = get_logger(__name__)

_DESCRIPTION = """
Operations platform API for commercial building services companies.

**Authentication.** Sign in with `POST /api/v1/auth/login` and send the returned session
token as `Authorization: Bearer <token>`. Every request runs inside the signed-in user's
active organization; data belonging to other organizations is not reachable.

**Errors.** Failures return an RFC 9457 problem document with a stable `code`, and `errors`
for field-level problems.
"""


def _operation_id(route: APIRoute) -> str:
    """Use the endpoint function name, which reads well in generated clients."""
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_format)

    database = Database(
        settings.database_url,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        statement_timeout_ms=settings.database_statement_timeout_ms,
        application_name="buildingops-api",
    )
    passwords = PasswordService(
        time_cost=settings.password_hash_time_cost,
        memory_kib=settings.password_hash_memory_kib,
        min_length=settings.password_min_length,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        role = check_runtime_role(database.engine)
        if not role.enforces_rls:
            message = (
                f"Database role '{role.role}' is not subject to row-level security "
                "(superuser, BYPASSRLS or table owner). Connect the API as the app role."
            )
            if settings.is_production:
                raise RuntimeError(message)
            logger.warning("rls_not_enforced", detail=message)
        logger.info("startup", environment=settings.environment, database_role=role.role)
        yield
        database.dispose()

    app = FastAPI(
        title="BuildingOps AI API",
        version=__version__,
        description=_DESCRIPTION,
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
        docs_url="/api/docs" if settings.docs_enabled else None,
        redoc_url=None,
        swagger_ui_oauth2_redirect_url=None,
        openapi_url="/api/openapi.json" if settings.docs_enabled else None,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.passwords = passwords
    app.state.auth = AuthService(settings, passwords)

    if settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_allowed_origins,
            allow_methods=["*"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        )
    app.add_middleware(RequestContextMiddleware)

    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(api_v1)
    return app


def app_factory() -> FastAPI:
    """Entry point for `uvicorn buildingops.main:app_factory --factory`."""
    return create_app()
