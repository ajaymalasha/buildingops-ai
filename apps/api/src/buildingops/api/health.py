"""Liveness and readiness probes. Unversioned and unauthenticated."""

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from buildingops import __version__
from buildingops.core.db import Database
from buildingops.core.logging import get_logger

router = APIRouter(tags=["health"])
logger = get_logger(__name__)


class Health(BaseModel):
    status: str
    version: str


class Readiness(BaseModel):
    status: str
    database: str


@router.get("/healthz", summary="Liveness: the process is running")
def healthz() -> Health:
    return Health(status="ok", version=__version__)


@router.get("/readyz", summary="Readiness: dependencies are reachable")
def readyz(request: Request, response: Response) -> Readiness:
    database: Database = request.app.state.database
    try:
        with database.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error("readiness_check_failed", error=str(exc))
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return Readiness(status="unavailable", database="unreachable")
    return Readiness(status="ok", database="ok")
