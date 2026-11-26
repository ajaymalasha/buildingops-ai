from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.buildings import service
from buildingops.modules.buildings.schemas import (
    BuildingCreate,
    BuildingFilters,
    BuildingRead,
    BuildingUpdate,
)

router = APIRouter(prefix="/buildings", tags=["buildings"])

_Reader = Annotated[Context, Depends(require(Permission.BUILDINGS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.BUILDINGS_WRITE))]


@router.get("", summary="List buildings")
def list_buildings(
    filters: Annotated[BuildingFilters, Query()], ctx: _Reader
) -> Page[BuildingRead]:
    items, total = service.list_buildings(ctx, filters)
    return Page[BuildingRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Add a building")
def create_building(payload: BuildingCreate, ctx: _Writer) -> BuildingRead:
    return service.create_building(ctx, payload)


@router.get("/{building_id}", summary="Get a building")
def read_building(building_id: UUID, ctx: _Reader) -> BuildingRead:
    return service.get_building(ctx, building_id)


@router.patch("/{building_id}", summary="Update a building")
def update_building(building_id: UUID, payload: BuildingUpdate, ctx: _Writer) -> BuildingRead:
    return service.update_building(ctx, building_id, payload)


@router.delete(
    "/{building_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archive a building",
    description="Refused while employees are assigned to it or it is on an active contract.",
)
def archive_building(building_id: UUID, ctx: _Writer) -> Response:
    service.archive_building(ctx, building_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
