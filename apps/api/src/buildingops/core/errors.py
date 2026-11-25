"""Application errors and their HTTP representation.

Every error response is an RFC 9457 problem document (`application/problem+json`) with two
extensions: a stable machine-readable `code`, and `errors` for field-level problems.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Self

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from buildingops.core.logging import get_logger

logger = get_logger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"


class FieldProblem(BaseModel):
    field: str
    message: str
    code: str | None = None


class Problem(BaseModel):
    """Error body returned by every failing endpoint."""

    type: str = "about:blank"
    title: str
    status: int
    code: str
    detail: str | None = None
    errors: list[FieldProblem] | None = None
    request_id: str | None = None


class AppError(Exception):
    """Base class for errors that map to a specific HTTP response."""

    status_code: int = 500
    code: str = "internal_error"
    title: str = "Internal error"

    def __init__(
        self,
        detail: str | None = None,
        *,
        errors: Sequence[FieldProblem] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(detail or self.title)
        self.detail = detail
        self.errors = list(errors) if errors else None
        self.headers = dict(headers) if headers else None


class AuthenticationError(AppError):
    status_code = 401
    code = "unauthenticated"
    title = "Authentication required"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(detail, headers={"WWW-Authenticate": "Bearer"})


class InvalidCredentialsError(AppError):
    status_code = 401
    code = "invalid_credentials"
    title = "Invalid email or password"


class PermissionDeniedError(AppError):
    status_code = 403
    code = "permission_denied"
    title = "You do not have permission to do this"


class NoActiveOrganizationError(AppError):
    status_code = 403
    code = "no_active_organization"
    title = "No active organization"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    title = "Not found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"
    title = "Conflict"


class ValidationFailedError(AppError):
    """A request that parsed correctly but breaks a business rule."""

    status_code = 422
    code = "validation_error"
    title = "Validation failed"

    @classmethod
    def for_field(cls, field: str, message: str, code: str | None = None) -> Self:
        return cls(message, errors=[FieldProblem(field=field, message=message, code=code)])


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"
    title = "Too many attempts"

    def __init__(self, detail: str | None = None, *, retry_after_seconds: int) -> None:
        super().__init__(detail, headers={"Retry-After": str(retry_after_seconds)})


def _request_id() -> str | None:
    value = structlog.contextvars.get_contextvars().get("request_id")
    return str(value) if value else None


def problem_response(
    *,
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    errors: Sequence[FieldProblem] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    problem = Problem(
        title=title,
        status=status,
        code=code,
        detail=detail,
        errors=list(errors) if errors else None,
        request_id=_request_id(),
    )
    return JSONResponse(
        problem.model_dump(exclude_none=True),
        status_code=status,
        media_type=PROBLEM_MEDIA_TYPE,
        headers=dict(headers) if headers else None,
    )


def internal_error_response() -> JSONResponse:
    """The answer to an unexpected exception. Says nothing about what went wrong inside."""
    return problem_response(
        status=500,
        code="internal_error",
        title="Internal error",
        detail="Something went wrong on our side. The error has been logged.",
    )


def _field_path(location: Sequence[Any]) -> str:
    """`("body", "address", "city")` -> `address.city`; query/path names stay as they are."""
    parts = [str(part) for part in location]
    if parts and parts[0] in {"body", "query", "path", "header", "cookie"}:
        parts = parts[1:]
    return ".".join(parts) or "body"


_STATUS_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "permission_denied",
    404: "not_found",
    405: "method_not_allowed",
    413: "payload_too_large",
    415: "unsupported_media_type",
}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return problem_response(
            status=exc.status_code,
            code=exc.code,
            title=exc.title,
            detail=exc.detail,
            errors=exc.errors,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            FieldProblem(
                field=_field_path(error.get("loc", ())),
                message=str(error.get("msg", "Invalid value")).removeprefix("Value error, "),
                code=str(error.get("type")) if error.get("type") else None,
            )
            for error in exc.errors()
        ]
        return problem_response(
            status=422,
            code="validation_error",
            title="Validation failed",
            detail="One or more fields are invalid.",
            errors=errors,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem_response(
            status=exc.status_code,
            code=_STATUS_CODES.get(exc.status_code, "http_error"),
            title=str(exc.detail) if exc.detail else "Request failed",
            headers=exc.headers,
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
        # Services check uniqueness and references up front and raise precise errors. This
        # handler is the safety net for races between that check and the write.
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        logger.warning("integrity_error", constraint=constraint, error=str(exc.orig))
        return problem_response(
            status=409,
            code="conflict",
            title="Conflict",
            detail="The change conflicts with existing data. Reload and try again.",
        )
