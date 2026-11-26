from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from buildingops.api.deps import require
from buildingops.core.context import Context
from buildingops.core.pagination import Page
from buildingops.core.permissions import Permission
from buildingops.modules.contracts import service
from buildingops.modules.contracts.schemas import (
    ContractCreate,
    ContractDetail,
    ContractFilters,
    ContractRead,
    ContractUpdate,
)

router = APIRouter(prefix="/contracts", tags=["contracts"])

_Reader = Annotated[Context, Depends(require(Permission.CONTRACTS_READ))]
_Writer = Annotated[Context, Depends(require(Permission.CONTRACTS_WRITE))]


@router.get("", summary="List contracts")
def list_contracts(
    filters: Annotated[ContractFilters, Query()], ctx: _Reader
) -> Page[ContractRead]:
    items, total = service.list_contracts(ctx, filters)
    return Page[ContractRead](
        items=items, total=total, page=filters.page, page_size=filters.page_size
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Add a contract")
def create_contract(payload: ContractCreate, ctx: _Writer) -> ContractDetail:
    return service.create_contract(ctx, payload)


@router.get("/{contract_id}", summary="Get a contract and the buildings it covers")
def read_contract(contract_id: UUID, ctx: _Reader) -> ContractDetail:
    return service.get_contract(ctx, contract_id)


@router.patch(
    "/{contract_id}",
    summary="Update a contract",
    description="A contract is never deleted. It ends by moving to expired or terminated.",
)
def update_contract(contract_id: UUID, payload: ContractUpdate, ctx: _Writer) -> ContractDetail:
    return service.update_contract(ctx, contract_id, payload)
