"""Customers of the active organization."""

from uuid import UUID

from sqlalchemy import Select, func, select

from buildingops.core import crud
from buildingops.core.context import Context
from buildingops.core.errors import NotFoundError
from buildingops.core.pagination import apply_sort, count_rows, paginate_rows
from buildingops.modules.buildings.models import Building
from buildingops.modules.contracts.models import Contract, ContractStatus
from buildingops.modules.customers.models import Customer
from buildingops.modules.customers.schemas import (
    CustomerCreate,
    CustomerFilters,
    CustomerRead,
    CustomerUpdate,
)
from buildingops.modules.sequences.service import CodeSeries

CUSTOMER_CODES = CodeSeries("customer", "CUS")

_SORTABLE = {"name": Customer.name, "code": Customer.code, "created_at": Customer.created_at}

# The customer's buildings, archived ones left out.
_BUILDING_COUNT = (
    select(func.count())
    .select_from(Building)
    .where(
        Building.organization_id == Customer.organization_id,
        Building.customer_id == Customer.id,
        Building.deleted_at.is_(None),
    )
    .correlate(Customer)
    .scalar_subquery()
)


def _customers(ctx: Context) -> Select[Customer, int]:
    return select(Customer, _BUILDING_COUNT.label("building_count")).where(crud.live(ctx, Customer))


def _label(customer: Customer) -> str:
    return f"{customer.name} ({customer.code})"


def list_customers(ctx: Context, filters: CustomerFilters) -> tuple[list[CustomerRead], int]:
    statement = _customers(ctx)
    if filters.status:
        statement = statement.where(Customer.status == filters.status)
    statement = crud.search(
        statement, filters.q, Customer.name, Customer.code, Customer.contact_name, Customer.email
    )
    statement = apply_sort(
        statement, filters.sort, allowed=_SORTABLE, default="name", tiebreaker=Customer.id
    )
    rows, total = paginate_rows(ctx.db, statement, filters)
    return [
        CustomerRead.from_record(customer, building_count=count) for customer, count in rows
    ], total


def get_customer(ctx: Context, customer_id: UUID) -> CustomerRead:
    row = ctx.db.execute(_customers(ctx).where(Customer.id == customer_id)).one_or_none()
    if row is None:
        raise NotFoundError("Customer not found.")
    customer, building_count = row
    return CustomerRead.from_record(customer, building_count=building_count)


def create_customer(ctx: Context, data: CustomerCreate) -> CustomerRead:
    values = data.model_dump()
    values["code"] = crud.assign_code(
        ctx, Customer, Customer.code, data.code, series=CUSTOMER_CODES
    )
    customer = Customer(organization_id=ctx.organization_id, **values)
    crud.create(
        ctx, customer, entity_type="customer", summary=f"Created customer {_label(customer)}"
    )
    return get_customer(ctx, customer.id)


def update_customer(ctx: Context, customer_id: UUID, data: CustomerUpdate) -> CustomerRead:
    customer = crud.get_or_404(ctx, Customer, customer_id, label="Customer")
    requested = crud.requested_changes(Customer, data)
    if "code" in requested:
        crud.ensure_unique(
            ctx,
            Customer,
            Customer.code == requested["code"],
            field="code",
            message=f"{requested['code']} is already in use.",
            excluding=customer.id,
        )
    crud.update(
        ctx,
        customer,
        requested,
        entity_type="customer",
        summary=f"Updated customer {_label(customer)}",
    )
    return get_customer(ctx, customer.id)


def archive_customer(ctx: Context, customer_id: UUID) -> None:
    customer = crud.get_or_404(ctx, Customer, customer_id, label="Customer", for_update=True)
    buildings = count_rows(
        ctx.db,
        select(Building.id).where(crud.live(ctx, Building), Building.customer_id == customer.id),
    )
    contracts = count_rows(
        ctx.db,
        select(Contract.id).where(
            crud.live(ctx, Contract),
            Contract.customer_id == customer.id,
            Contract.status != ContractStatus.TERMINATED,
        ),
    )
    dependants = []
    if buildings:
        dependants.append(
            (
                crud.counted(buildings, "building"),
                "archive its buildings or move them to another customer",
            )
        )
    if contracts:
        dependants.append(
            (
                f"{crud.counted(contracts, 'contract')} not yet terminated",
                "terminate its contracts",
            )
        )
    crud.ensure_no_dependants(customer.name, dependants)
    crud.archive(
        ctx, customer, entity_type="customer", summary=f"Archived customer {_label(customer)}"
    )
