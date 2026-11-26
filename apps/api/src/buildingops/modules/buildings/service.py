"""Buildings of the active organization."""

from uuid import UUID

from sqlalchemy import Select, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import NotFoundError, ValidationFailedError
from buildingops.core.pagination import apply_sort, count_rows, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import (
    BuildingCreate,
    BuildingFilters,
    BuildingRead,
    BuildingUpdate,
)
from buildingops.modules.contracts.models import Contract, ContractBuilding, ContractStatus
from buildingops.modules.customers.models import Customer
from buildingops.modules.customers.schemas import CustomerSummary
from buildingops.modules.sequences.service import CodeSeries
from buildingops.modules.workforce.models import BuildingAssignment

BUILDING_CODES = CodeSeries("building", "BLD")

_SORTABLE = {
    "name": Building.name,
    "code": Building.code,
    "city": Building.city,
    "square_feet": Building.square_feet,
    "created_at": Building.created_at,
}


def _buildings(ctx: Context) -> Select[Building, Customer]:
    return (
        select(Building, Customer)
        .join(Customer, Customer.id == Building.customer_id)
        .where(crud.live(ctx, Building))
    )


def _to_read(building: Building, customer: Customer) -> BuildingRead:
    return BuildingRead.from_record(building, customer=CustomerSummary.model_validate(customer))


def _label(building: Building) -> str:
    return f"{building.name} ({building.code})"


def list_buildings(ctx: Context, filters: BuildingFilters) -> tuple[list[BuildingRead], int]:
    statement = _buildings(ctx)
    if filters.status:
        statement = statement.where(Building.status == filters.status)
    if filters.building_type:
        statement = statement.where(Building.building_type == filters.building_type)
    if filters.customer_id:
        statement = statement.where(Building.customer_id == filters.customer_id)
    statement = crud.search(
        statement,
        filters.q,
        Building.name,
        Building.code,
        Building.address_line1,
        Building.city,
        Customer.name,
    )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Building.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(building, customer) for building, customer in rows], total


def get_building(ctx: Context, building_id: UUID) -> BuildingRead:
    row = ctx.db.execute(_buildings(ctx).where(Building.id == building_id)).one_or_none()
    if row is None:
        raise NotFoundError("Building not found.")
    building, customer = row
    return _to_read(building, customer)


def create_building(ctx: Context, data: BuildingCreate) -> BuildingRead:
    customer = crud.get_referenced(
        ctx, Customer, data.customer_id, field="customer_id", message="Customer not found."
    )
    values = data.model_dump()
    values["code"] = crud.assign_code(
        ctx, Building, Building.code, data.code, series=BUILDING_CODES
    )
    building = Building(organization_id=ctx.organization_id, **values)
    crud.create(
        ctx,
        building,
        entity_type="building",
        summary=f"Created building {_label(building)} for {customer.name}",
    )
    return get_building(ctx, building.id)


def update_building(ctx: Context, building_id: UUID, data: BuildingUpdate) -> BuildingRead:
    # Contracts rely on a building staying with its customer, so a request that may move it
    # takes the same lock as an archive would. See `core/crud.py`.
    may_move = "customer_id" in data.model_fields_set
    building = crud.get_or_404(ctx, Building, building_id, label="Building", for_update=may_move)
    requested = crud.requested_changes(Building, data)
    if "code" in requested:
        crud.ensure_unique(
            ctx,
            Building,
            Building.code == requested["code"],
            field="code",
            message=f"{requested['code']} is already in use.",
            excluding=building.id,
        )
    if "customer_id" in requested and requested["customer_id"] != building.customer_id:
        _ensure_not_under_contract(ctx, building)
        crud.get_referenced(
            ctx,
            Customer,
            requested["customer_id"],
            field="customer_id",
            message="Customer not found.",
        )
    crud.update(
        ctx,
        building,
        requested,
        entity_type="building",
        summary=f"Updated building {_label(building)}",
    )
    return get_building(ctx, building.id)


def _ensure_not_under_contract(ctx: Context, building: Building) -> None:
    """A contract covers buildings of its own customer only, so a building on a contract
    that is still in force cannot be handed to another customer."""
    numbers = ctx.db.scalars(
        select(Contract.contract_number)
        .join(ContractBuilding, ContractBuilding.contract_id == Contract.id)
        .where(
            crud.live(ctx, Contract),
            ContractBuilding.building_id == building.id,
            Contract.status != ContractStatus.TERMINATED,
        )
        .order_by(Contract.contract_number)
    ).all()
    if numbers:
        raise ValidationFailedError.for_field(
            "customer_id",
            f"{building.name} is on {crud.counted(len(numbers), 'contract')} of its current"
            f" customer ({', '.join(numbers)}). Take it off before moving it to another customer.",
            "building_under_contract",
        )


def archive_building(ctx: Context, building_id: UUID) -> None:
    building = crud.get_or_404(ctx, Building, building_id, label="Building", for_update=True)
    assignments = count_rows(
        ctx.db,
        select(BuildingAssignment.id).where(
            crud.live(ctx, BuildingAssignment),
            BuildingAssignment.building_id == building.id,
            BuildingAssignment.ends_on.is_(None),
        ),
    )
    contracts = count_rows(
        ctx.db,
        select(ContractBuilding.id)
        .join(Contract, Contract.id == ContractBuilding.contract_id)
        .where(
            crud.live(ctx, ContractBuilding),
            ContractBuilding.building_id == building.id,
            Contract.status == ContractStatus.ACTIVE,
        ),
    )
    dependants = []
    if assignments:
        dependants.append((crud.counted(assignments, "open assignment"), "end its assignments"))
    if contracts:
        dependants.append(
            (crud.counted(contracts, "active contract"), "take it off its active contracts")
        )
    crud.ensure_no_dependants(building.name, dependants)
    crud.archive(
        ctx, building, entity_type="building", summary=f"Archived building {_label(building)}"
    )
