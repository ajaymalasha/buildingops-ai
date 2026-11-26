"""Assembles the versioned API from each module's routers."""

from fastapi import APIRouter

from buildingops.core.errors import Problem
from buildingops.modules.audit.router import router as audit_router
from buildingops.modules.buildings.router import router as buildings_router
from buildingops.modules.contracts.router import router as contracts_router
from buildingops.modules.customers.router import router as customers_router
from buildingops.modules.identity.router import (
    auth_router,
    members_router,
    organization_router,
    platform_router,
)
from buildingops.modules.vendors.router import router as vendors_router
from buildingops.modules.workforce.router import employees_router, job_roles_router

# Documented once here so every operation advertises the shared error body.
_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    401: {"model": Problem, "description": "Not signed in, or the session has ended"},
    403: {"model": Problem, "description": "Signed in, but not allowed to do this"},
    404: {"model": Problem, "description": "Not found in the active organization"},
    409: {"model": Problem, "description": "Conflicts with existing data"},
    422: {"model": Problem, "description": "Validation failed"},
}

api_v1 = APIRouter(prefix="/api/v1", responses=_ERROR_RESPONSES)

for module_router in (
    auth_router,
    organization_router,
    members_router,
    audit_router,
    customers_router,
    buildings_router,
    vendors_router,
    job_roles_router,
    employees_router,
    contracts_router,
    platform_router,
):
    api_v1.include_router(module_router)
