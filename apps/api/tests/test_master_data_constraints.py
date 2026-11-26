"""What the database itself refuses, whatever the application does.

Every case writes as the owner role, which bypasses row-level security and never goes
through a service. The schema comparison in `test_schema_invariants.py` cannot see CHECK
constraints or the conditions on partial indexes, so each one is exercised here.
"""

from collections.abc import Callable
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError

from buildingops.core.db import Database
from buildingops.core.models import utcnow
from buildingops.core.permissions import Role
from buildingops.modules.contracts.models import BillingModel
from buildingops.modules.identity.models import Organization
from buildingops.modules.sequences.models import OrganizationSequence
from buildingops.modules.workforce.models import Employee
from tests.conftest import Factory

# Each writes a row in the first organization that points at a row in the second.
CROSS_ORGANIZATION_REFERENCES: dict[str, Callable[[Factory, Organization, Organization], object]]
CROSS_ORGANIZATION_REFERENCES = {
    "fk_buildings_organization_id_customer_id_customers": (
        lambda factory, here, there: factory.building(here, factory.customer(there))
    ),
    "fk_employees_organization_id_job_role_id_job_roles": (
        lambda factory, here, there: factory.employee(here, factory.job_role(there))
    ),
    "fk_employees_organization_id_supervisor_id_employees": (
        lambda factory, here, there: factory.employee(
            here, supervisor_id=factory.employee(there).id
        )
    ),
    "fk_employees_organization_id_membership_id_memberships": (
        lambda factory, here, there: factory.employee(
            here, membership_id=factory.member(there, Role.EMPLOYEE)[1].id
        )
    ),
    "fk_building_assignments_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.assignment(
            factory.employee(here), factory.building(there)
        )
    ),
    "fk_contracts_organization_id_customer_id_customers": (
        lambda factory, here, there: factory.contract(here, factory.customer(there))
    ),
    "fk_contract_buildings_organization_id_building_id_buildings": (
        lambda factory, here, there: factory.contract(here, buildings=[factory.building(there)])
    ),
}


def _same_open_assignment_twice(factory: Factory, organization: Organization) -> None:
    employee, building = factory.employee(organization), factory.building(organization)
    factory.assignment(employee, building)
    factory.assignment(employee, building)


def _two_open_primary_assignments(factory: Factory, organization: Organization) -> None:
    employee = factory.employee(organization)
    factory.assignment(employee, factory.building(organization), is_primary=True)
    factory.assignment(employee, factory.building(organization), is_primary=True)


def _one_login_for_two_employees(factory: Factory, organization: Organization) -> None:
    _, membership = factory.member(organization, Role.EMPLOYEE)
    factory.employee(organization, membership_id=membership.id)
    factory.employee(organization, membership_id=membership.id)


# Each breaks the rule its constraint is named for, inside one organization.
RULES: dict[str, Callable[[Factory, Organization], object]] = {
    # Uniqueness among live or open rows.
    "uq_customers_organization_id_code": lambda factory, organization: [
        factory.customer(organization, code="SAME") for _ in range(2)
    ],
    "uq_buildings_organization_id_code": lambda factory, organization: [
        factory.building(organization, code="SAME") for _ in range(2)
    ],
    "uq_vendors_organization_id_code": lambda factory, organization: [
        factory.vendor(organization, code="SAME") for _ in range(2)
    ],
    "uq_job_roles_organization_id_lower_name": lambda factory, organization: [
        factory.job_role(organization, name=name) for name in ("Porter", "PORTER")
    ],
    "uq_employees_organization_id_employee_number": lambda factory, organization: [
        factory.employee(organization, employee_number="SAME") for _ in range(2)
    ],
    "uq_employees_organization_id_email": lambda factory, organization: [
        factory.employee(organization, email=email)
        for email in ("sam@example.com", "Sam@Example.com")
    ],
    "uq_employees_membership_id": _one_login_for_two_employees,
    "uq_building_assignments_employee_id_building_id_open": _same_open_assignment_twice,
    "uq_building_assignments_employee_id_open_primary": _two_open_primary_assignments,
    "uq_contracts_organization_id_contract_number": lambda factory, organization: [
        factory.contract(organization, contract_number="SAME") for _ in range(2)
    ],
    "uq_contract_buildings_contract_id_building_id": lambda factory, organization: factory.contract(
        organization, buildings=[factory.building(organization)] * 2
    ),
    # Ranges and orderings.
    "ck_customers_payment_terms_days_range": lambda factory, organization: factory.customer(
        organization, payment_terms_days=181
    ),
    "ck_vendors_payment_terms_days_range": lambda factory, organization: factory.vendor(
        organization, payment_terms_days=-1
    ),
    "ck_buildings_square_feet_positive": lambda factory, organization: factory.building(
        organization, square_feet=0
    ),
    "ck_buildings_floors_positive": lambda factory, organization: factory.building(
        organization, floors=0
    ),
    "ck_job_roles_default_hourly_rate_not_negative": lambda factory, organization: factory.job_role(
        organization, default_hourly_rate=Decimal("-0.01")
    ),
    "ck_employees_hourly_rate_not_negative": lambda factory, organization: factory.employee(
        organization, hourly_rate=Decimal("-0.01")
    ),
    "ck_employees_termination_not_before_hire": lambda factory, organization: factory.employee(
        organization, hire_date=date(2026, 3, 2), termination_date=date(2026, 3, 1)
    ),
    "ck_building_assignments_ends_not_before_start": lambda factory, organization: (
        factory.assignment(
            factory.employee(organization),
            factory.building(organization),
            starts_on=date(2026, 3, 2),
            ends_on=date(2026, 3, 1),
        )
    ),
    "ck_contracts_end_not_before_start": lambda factory, organization: factory.contract(
        organization, start_date=date(2026, 3, 2), end_date=date(2026, 3, 1)
    ),
    "ck_contracts_markup_percent_range": lambda factory, organization: factory.contract(
        organization, markup_percent=Decimal("500.01")
    ),
    "ck_contracts_monthly_fee_not_negative": lambda factory, organization: factory.contract(
        organization, monthly_fee=Decimal("-0.01")
    ),
    "ck_contracts_payment_terms_days_range": lambda factory, organization: factory.contract(
        organization, payment_terms_days=181
    ),
    # Each billing model needs its figure.
    "ck_contracts_cost_plus_has_markup": lambda factory, organization: factory.contract(
        organization, billing_model=BillingModel.COST_PLUS
    ),
    "ck_contracts_fixed_fee_has_monthly_fee": lambda factory, organization: factory.contract(
        organization, billing_model=BillingModel.FIXED_FEE
    ),
}

# Enumerations are stored as text with a CHECK constraint. The ORM refuses an unknown value
# before it reaches the database, so these go in as plain SQL.
ENUMERATIONS = {
    "ck_customers_customerstatus": "UPDATE customers SET status = 'vip'",
    "ck_buildings_buildingtype": "UPDATE buildings SET building_type = 'castle'",
    "ck_buildings_buildingstatus": "UPDATE buildings SET status = 'condemned'",
    "ck_vendors_vendorcategory": "UPDATE vendors SET category = 'catering'",
    "ck_vendors_vendorstatus": "UPDATE vendors SET status = 'preferred'",
    "ck_employees_employmenttype": "UPDATE employees SET employment_type = 'volunteer'",
    "ck_employees_employeestatus": "UPDATE employees SET status = 'retired'",
    "ck_contracts_contractstatus": "UPDATE contracts SET status = 'pending'",
    "ck_contracts_billingmodel": "UPDATE contracts SET billing_model = 'barter'",
}


@pytest.mark.parametrize("constraint", CROSS_ORGANIZATION_REFERENCES)
def test_a_row_cannot_refer_to_a_row_in_another_organization(factory: Factory, constraint: str):
    """The composite foreign keys hold even for a role that row-level security does not bind."""
    here, there = factory.organization(), factory.organization()

    with pytest.raises(IntegrityError, match=constraint):
        CROSS_ORGANIZATION_REFERENCES[constraint](factory, here, there)


@pytest.mark.parametrize("constraint", RULES)
def test_the_database_enforces_each_rule(factory: Factory, constraint: str):
    organization = factory.organization()

    with pytest.raises(IntegrityError, match=constraint):
        RULES[constraint](factory, organization)


@pytest.mark.parametrize("constraint", ENUMERATIONS)
def test_the_database_accepts_only_the_listed_values(
    admin_database: Database, factory: Factory, constraint: str
):
    organization = factory.organization()
    factory.contract(organization, buildings=[factory.building(organization)])
    factory.employee(organization)
    factory.vendor(organization)

    with admin_database.session() as db, pytest.raises(IntegrityError, match=constraint):
        db.execute(
            text(f"{ENUMERATIONS[constraint]} WHERE organization_id = :organization"),
            {"organization": organization.id},
        )


def test_an_employee_cannot_be_their_own_supervisor(admin_database: Database, factory: Factory):
    employee = factory.employee(factory.organization())

    with (
        admin_database.session() as db,
        pytest.raises(IntegrityError, match="ck_employees_not_own_supervisor"),
    ):
        db.execute(
            update(Employee).where(Employee.id == employee.id).values(supervisor_id=employee.id)
        )


def test_a_sequence_cannot_fall_to_zero(admin_database: Database, factory: Factory):
    organization = factory.organization()

    with admin_database.session() as db:
        db.add(OrganizationSequence(organization_id=organization.id, name="x", next_value=0))
        with pytest.raises(IntegrityError, match="ck_organization_sequences_next_value_positive"):
            db.flush()


def test_archived_and_ended_rows_do_not_count_towards_uniqueness(factory: Factory):
    """The other half of the partial indexes: what they leave alone."""
    organization = factory.organization()
    employee, building = factory.employee(organization), factory.building(organization)

    factory.customer(organization, code="SAME", deleted_at=utcnow())
    factory.customer(organization, code="SAME")
    factory.job_role(organization, name="Porter", deleted_at=utcnow())
    factory.job_role(organization, name="porter")
    factory.employee(organization, employee_number="SAME", email="a@b.co", deleted_at=utcnow())
    factory.employee(organization, employee_number="SAME", email="a@b.co")
    factory.assignment(employee, building, is_primary=True, ends_on=date(2026, 6, 30))
    factory.assignment(employee, building, is_primary=True)
    # Nor does the same code in another organization.
    factory.customer(factory.organization(), code="SAME")
