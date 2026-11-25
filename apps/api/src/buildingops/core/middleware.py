"""Request middleware: request ids, access logging and baseline response headers."""

import re
import uuid
from time import perf_counter

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from buildingops.core.errors import internal_error_response
from buildingops.core.logging import get_logger

logger = get_logger("buildingops.request")

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_QUIET_PATHS = frozenset({"/healthz", "/readyz"})


class RequestContextMiddleware:
    """Assigns a request id, logs one line per request and sets safe default headers.

    It also turns any exception nothing else handled into the standard 500 problem
    document. Doing that here, rather than in Starlette's outermost error layer, means the
    500 response gets the same request id and headers as every other response.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).get("x-request-id", "")
        request_id = supplied if _REQUEST_ID_PATTERN.match(supplied) else uuid.uuid4().hex
        state = scope.setdefault("state", {})
        state["request_id"] = request_id

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        path: str = scope["path"]
        started = perf_counter()
        status = 500
        response_started = False

        async def send_with_headers(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers.setdefault("X-Content-Type-Options", "nosniff")
                if path.startswith("/api/"):
                    # Responses carry tenant data: never let a shared cache store them.
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception as exc:
            logger.error("unhandled_exception", method=scope["method"], path=path, exc_info=exc)
            if response_started:
                raise  # too late to change the response; let the server drop the connection
            await internal_error_response()(scope, receive, send_with_headers)
        finally:
            if path not in _QUIET_PATHS:
                logger.info(
                    "request",
                    method=scope["method"],
                    path=path,
                    status=status,
                    duration_ms=round((perf_counter() - started) * 1000, 1),
                    user_id=state.get("user_id"),
                    organization_id=state.get("organization_id"),
                )
