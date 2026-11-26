"""Contracts of the active organization and the buildings they cover."""

from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, func, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import FieldProblem, NotFoundError, ValidationFailedError
from buildingops.core.pagination import apply_sort, paginate_rows
from buildingops.modules.audit import service as audit
from buildingops.modules.buildings.models import Building
from buildingops.modules.buildings.schemas import BuildingSummary
from buildingops.modules.contracts.models import (
    BillingModel,
    Contract,
    ContractBuilding,
    ContractStatus,
)
from buildingops.modules.contracts.schemas import (
    ContractCreate,
    ContractCustomer,
    ContractDetail,
    ContractFilters,
    ContractRead,
    ContractUpdate,
)
from buildingops.modules.customers.models import Customer
from buildingops.modules.identity import organizations_service
from buildingops.modules.sequences.service import CodeSeries

CONTRACT_NUMBERS = CodeSeries("contract", "CTR")

_SORTABLE = {
    "name": Contract.name,
    "contract_number": Contract.contract_number,
    "start_date": Contract.start_date,
    "end_date": Contract.end_date,
    "created_at": Contract.created_at,
}

_TERMS = ("billing_model", "markup_percent", "monthly_fee", "start_date", "end_date")

_BUILDING_COUNT = (
    select(func.count())
    .select_from(ContractBuilding)
    .where(
        ContractBuilding.organization_id == Contract.organization_id,
        ContractBuilding.contract_id == Contract.id,
    )
    .correlate(Contract)
    .scalar_subquery()
)


def _contracts(ctx: Context) -> Select[Contract, Customer, int]:
    return (
        select(Contract, Customer, _BUILDING_COUNT.label("building_count"))
        .join(Customer, Customer.id == Contract.customer_id)
        .where(crud.live(ctx, Contract))
    )


def _to_read(contract: Contract, customer: Customer, building_count: int) -> ContractRead:
    return ContractRead.from_record(
        contract,
        customer=ContractCustomer.model_validate(customer),
        building_count=building_count,
    )


def _label(contract: Contract) -> str:
    return f"{contract.contract_number} ({contract.name})"


def list_contracts(ctx: Context, filters: ContractFilters) -> tuple[list[ContractRead], int]:
    statement = _contracts(ctx)
    if filters.status:
        statement = statement.where(Contract.status == filters.status)
    if filters.billing_model:
        statement = statement.where(Contract.billing_model == filters.billing_model)
    if filters.customer_id:
        statement = statement.where(Contract.customer_id == filters.customer_id)
    statement = crud.search(
        statement, filters.q, Contract.name, Contract.contract_number, Customer.name
    )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Contract.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [_to_read(contract, customer, count) for contract, customer, count in rows], total


def get_contract(ctx: Context, contract_id: UUID) -> ContractDetail:
    row = ctx.db.execute(_contracts(ctx).where(Contract.id == contract_id)).one_or_none()
    if row is None:
        raise NotFoundError("Contract not found.")
    contract, customer, building_count = row
    buildings = ctx.db.scalars(
        select(Building)
        .join(ContractBuilding, ContractBuilding.building_id == Building.id)
        .where(crud.live(ctx, ContractBuilding), ContractBuilding.contract_id == contract.id)
        .order_by(Building.name, Building.id)
    ).all()
    return ContractDetail(
        **_to_read(contract, customer, building_count).model_dump(),
        buildings=[BuildingSummary.model_validate(building) for building in buildings],
    )


def create_contract(ctx: Context, data: ContractCreate) -> ContractDetail:
    customer = crud.get_referenced(
        ctx, Customer, data.customer_id, field="customer_id", message="Customer not found."
    )
    values = data.model_dump(exclude={"building_ids"})
    _check_terms(values)
    building_ids = set(data.building_ids)
    _check_buildings(
        ctx, customer.id, building_ids, must_be_live=building_ids, field="building_ids"
    )
    values["contract_number"] = crud.assign_code(
        ctx,
        Contract,
        Contract.contract_number,
        data.contract_number,
        series=CONTRACT_NUMBERS,
        field="contract_number",
    )
    values["currency"] = data.currency or organizations_service.get_current(ctx).currency
    contract = Contract(organization_id=ctx.organization_id, **values)
    crud.create(
        ctx,
        contract,
        entity_type="contract",
        summary=f"Created contract {_label(contract)} for {customer.name}",
    )
    _set_buildings(ctx, contract, {}, building_ids)
    return get_contract(ctx, contract.id)


def update_contract(ctx: Context, contract_id: UUID, data: ContractUpdate) -> ContractDetail:
    # Locked, so that two requests replacing this contract's buildings apply in turn.
    contract = crud.get_or_404(ctx, Contract, contract_id, label="Contract", for_update=True)
    requested = crud.requested_changes(Contract, data)
    building_ids: list[UUID] | None = requested.pop("building_ids", None)

    def resulting(field: str) -> Any:
        return requested[field] if field in requested else getattr(contract, field)

    _check_terms({field: resulting(field) for field in _TERMS})
    if "contract_number" in requested:
        crud.ensure_unique(
            ctx,
            Contract,
            Contract.contract_number == requested["contract_number"],
            field="contract_number",
            message=f"{requested['contract_number']} is already in use.",
            excluding=contract.id,
        )

    status: ContractStatus = resulting("status")
    customer_id: UUID = resulting("customer_id")
    changes_customer = customer_id != contract.customer_id
    reopens = contract.status is ContractStatus.TERMINATED and status is not contract.status
    activates = status is ContractStatus.ACTIVE and status is not contract.status
    if changes_customer:
        crud.get_referenced(
            ctx, Customer, customer_id, field="customer_id", message="Customer not found."
        )
    elif reopens:
        # A customer can be archived once its contracts are terminated. Such a contract
        # must not come back into force behind it.
        crud.get_referenced(
            ctx,
            Customer,
            customer_id,
            field="status",
            message="This contract's customer has been archived, so it cannot be reopened.",
            code="customer_archived",
        )

    links = _links(ctx, contract)
    covered = set(building_ids) if building_ids is not None else set(links)
    # The buildings are checked again whenever what they were checked against changes: the
    # customer, the list itself, or the contract coming into force. A terminated contract
    # counts as out of force: while it is, its buildings may be archived or change hands.
    if changes_customer or reopens or activates or covered != set(links):
        if building_ids is not None:
            field = "building_ids"
        else:
            field = "customer_id" if changes_customer else "status"
        _check_buildings(
            ctx,
            customer_id,
            covered,
            # An archived building stays on a contract that is not active, as history. It
            # cannot be added in that state, and the contract cannot become active with it.
            must_be_live=covered if activates else covered - set(links),
            field=field,
        )

    crud.update(
        ctx,
        contract,
        requested,
        entity_type="contract",
        summary=f"Updated contract {_label(contract)}",
    )
    _set_buildings(ctx, contract, links, covered)
    return get_contract(ctx, contract.id)


def check_coverage(
    ctx: Context,
    values: Mapping[str, Any],
    *,
    building_id: UUID | None = None,
    contract_id: UUID | None = None,
) -> None:
    """A record booked to a contract must be for a building that contract covers.

    `values` is what a request sets on a work order, a timesheet or an expense, and
    `building_id` and `contract_id` are what the record held before, for an update. Only a
    pairing the request makes is checked, and it is reported on the field the request
    changed. What a contract is billed is worked out from the records booked to it, so a
    cost booked to a contract for some other building would be billed to the wrong customer.

    Whether a building the request names exists is the caller's to check, and to report.
    """
    resulting_building_id: UUID | None = values.get("building_id", building_id)
    resulting_contract_id: UUID | None = values.get("contract_id", contract_id)
    if resulting_contract_id is None or (
        (resulting_building_id, resulting_contract_id) == (building_id, contract_id)
    ):
        return
    changes_contract = resulting_contract_id != contract_id
    if changes_contract:
        crud.get_referenced(
            ctx, Contract, resulting_contract_id, field="contract_id", message="Contract not found."
        )
    if resulting_building_id is None:
        return
    # The building is not asked to be live. A record keeps its building after the building
    # is archived, and a contract that is not active keeps it on its list too.
    row = ctx.db.execute(
        select(Contract.contract_number, Building.name, ContractBuilding.id)
        .join(Building, Building.organization_id == Contract.organization_id)
        .outerjoin(
            ContractBuilding,
            and_(
                ContractBuilding.contract_id == Contract.id,
                ContractBuilding.building_id == Building.id,
            ),
        )
        .where(
            crud.live(ctx, Contract),
            Contract.id == resulting_contract_id,
            Building.id == resulting_building_id,
        )
    ).one_or_none()
    if row is None:
        return
    contract_number, building_name, link_id = row
    if link_id is None:
        raise ValidationFailedError.for_field(
            "contract_id" if changes_contract else "building_id",
            f"Contract {contract_number} does not cover {building_name}.",
            "contract_does_not_cover_building",
        )


# --- validation --------------------------------------------------------------------------


def _check_terms(terms: Mapping[str, Any]) -> None:
    """Each billing model needs the figure it bills from, and the dates must be in order.

    The database holds the same rules. Checking here names the field that is wrong.
    """
    problems = []
    if terms["billing_model"] is BillingModel.COST_PLUS and terms["markup_percent"] is None:
        problems.append(
            FieldProblem(
                field="markup_percent",
                message="A cost-plus contract needs a markup percentage.",
                code="required",
            )
        )
    if terms["billing_model"] is BillingModel.FIXED_FEE and terms["monthly_fee"] is None:
        problems.append(
            FieldProblem(
                field="monthly_fee",
                message="A fixed-fee contract needs a monthly fee.",
                code="required",
            )
        )
    if terms["end_date"] is not None and terms["end_date"] < terms["start_date"]:
        problems.append(
            FieldProblem(
                field="end_date",
                message=(
                    "The end date cannot be before the start date"
                    f" ({terms['start_date'].isoformat()})."
                ),
                code="ends_before_start",
            )
        )
    if problems:
        raise ValidationFailedError("The contract's terms are not valid.", errors=problems)


def _check_buildings(
    ctx: Context,
    customer_id: UUID,
    building_ids: set[UUID],
    *,
    must_be_live: set[UUID],
    field: str,
) -> None:
    """A contract covers buildings of its own customer, and only live ones can join it."""
    if not building_ids:
        return
    # Locked before they are read, like any row a change comes to rely on (see
    # `core/crud.py`): a building being archived or handed to another customer at this
    # moment is seen as it ends up.
    live = crud.lock_live(ctx, Building, building_ids)
    buildings = {
        building_id: (name, owner_id)
        for building_id, name, owner_id in ctx.db.execute(
            select(Building.id, Building.name, Building.customer_id).where(
                Building.organization_id == ctx.organization_id, Building.id.in_(building_ids)
            )
        )
    }
    messages = set()
    for building_id in building_ids:
        if building_id not in buildings:
            messages.add("Building not found.")
            continue
        name, owner_id = buildings[building_id]
        if building_id in must_be_live and building_id not in live:
            messages.add(f"{name} has been archived.")
        elif owner_id != customer_id:
            messages.add(f"{name} belongs to another customer.")
    if messages:
        raise ValidationFailedError(
            "One or more buildings cannot be on this contract.",
            errors=[FieldProblem(field=field, message=message) for message in sorted(messages)],
        )


# --- the buildings a contract covers -----------------------------------------------------


def _links(ctx: Context, contract: Contract) -> dict[UUID, ContractBuilding]:
    links = ctx.db.scalars(
        select(ContractBuilding).where(
            crud.live(ctx, ContractBuilding), ContractBuilding.contract_id == contract.id
        )
    )
    return {link.building_id: link for link in links}


def _set_buildings(
    ctx: Context, contract: Contract, links: Mapping[UUID, ContractBuilding], covered: set[UUID]
) -> None:
    """Make `covered` the buildings on the contract, and record what was added or removed."""
    added = covered - links.keys()
    removed = links.keys() - covered
    if not added and not removed:
        return
    for building_id in removed:
        ctx.db.delete(links[building_id])
    ctx.db.add_all(
        ContractBuilding(
            organization_id=ctx.organization_id, contract_id=contract.id, building_id=building_id
        )
        for building_id in added
    )
    # The buildings are part of the contract, so changing them counts as updating it.
    contract.updated_at = func.now()
    ctx.db.flush()

    names = dict(
        ctx.db.execute(
            select(Building.id, Building.name).where(
                Building.organization_id == ctx.organization_id,
                Building.id.in_(added | removed),
            )
        ).all()
    )
    parts = [
        f"{verb} {_name_list([names[building_id] for building_id in building_ids])}"
        for verb, building_ids in (("added", added), ("removed", removed))
        if building_ids
    ]
    audit.record(
        ctx,
        action="contract.buildings_changed",
        entity_type="contract",
        entity_id=contract.id,
        summary=f"Changed the buildings on contract {_label(contract)}: {'; '.join(parts)}",
        changes=audit.changes_between(
            {"building_ids": sorted(str(building_id) for building_id in links)},
            {"building_ids": sorted(str(building_id) for building_id in covered)},
        ),
    )


def _name_list(names: list[str]) -> str:
    """A few names in full, more as a count: the summary has to stay one readable line."""
    if len(names) > 3:
        return crud.counted(len(names), "building")
    return ", ".join(sorted(names))
