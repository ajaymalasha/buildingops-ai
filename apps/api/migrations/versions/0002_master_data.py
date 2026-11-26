"""Master data: customers, buildings, vendors, job roles, employees, assignments, contracts.

The shared records every later module refers to, and the per-organization counters that
number them. Every table here is tenant-owned and gets the standard isolation policy.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-25 23:46:49.893279+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The tables this migration creates, in the order it creates them. All are tenant-owned.
_TENANT_TABLES = (
    "organization_sequences",
    "customers",
    "buildings",
    "vendors",
    "job_roles",
    "employees",
    "building_assignments",
    "contracts",
    "contract_buildings",
)

# A scalar subquery lets the planner evaluate the function once per statement.
_ORG = "(SELECT app_current_org_id())"


def _secure_tenant_tables() -> None:
    """Rows are visible and writable only inside the organization they belong to."""
    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table}"
            f" USING (organization_id = {_ORG})"
            f" WITH CHECK (organization_id = {_ORG})"
        )


def upgrade() -> None:
    op.create_table(
        "organization_sequences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "next_value > 0", name=op.f("ck_organization_sequences_next_value_positive")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_organization_sequences_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organization_sequences")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_organization_sequences_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id", "name", name=op.f("uq_organization_sequences_organization_id_name")
        ),
    )
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "prospect",
                "active",
                "inactive",
                name="customerstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("contact_name", sa.String(length=200), nullable=True),
        sa.Column("email", postgresql.CITEXT(), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("address_line1", sa.String(length=200), nullable=True),
        sa.Column("address_line2", sa.String(length=200), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("region", sa.String(length=100), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "payment_terms_days BETWEEN 0 AND 180",
            name=op.f("ck_customers_payment_terms_days_range"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_customers_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_customers_organization_id_id")),
    )
    op.create_index(
        "uq_customers_organization_id_code",
        "customers",
        ["organization_id", "code"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "buildings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column(
            "building_type",
            sa.Enum(
                "office",
                "retail",
                "industrial",
                "medical",
                "education",
                "residential",
                "mixed_use",
                "other",
                name="buildingtype",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "onboarding",
                "active",
                "inactive",
                name="buildingstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("address_line1", sa.String(length=200), nullable=False),
        sa.Column("address_line2", sa.String(length=200), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("region", sa.String(length=100), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("square_feet", sa.Integer(), nullable=True),
        sa.Column("floors", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("floors > 0", name=op.f("ck_buildings_floors_positive")),
        sa.CheckConstraint("square_feet > 0", name=op.f("ck_buildings_square_feet_positive")),
        sa.ForeignKeyConstraint(
            ["organization_id", "customer_id"],
            ["customers.organization_id", "customers.id"],
            name=op.f("fk_buildings_organization_id_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_buildings_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_buildings")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_buildings_organization_id_id")),
    )
    op.create_index(
        "ix_buildings_organization_id_customer_id",
        "buildings",
        ["organization_id", "customer_id"],
        unique=False,
    )
    op.create_index(
        "uq_buildings_organization_id_code",
        "buildings",
        ["organization_id", "code"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "vendors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "janitorial",
                "hvac",
                "electrical",
                "plumbing",
                "landscaping",
                "security",
                "elevator",
                "pest_control",
                "waste",
                "supplies",
                "other",
                name="vendorcategory",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending_compliance",
                "active",
                "inactive",
                name="vendorstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("contact_name", sa.String(length=200), nullable=True),
        sa.Column("email", postgresql.CITEXT(), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("address_line1", sa.String(length=200), nullable=True),
        sa.Column("address_line2", sa.String(length=200), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("region", sa.String(length=100), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("insurance_expires_on", sa.Date(), nullable=True),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "payment_terms_days BETWEEN 0 AND 180", name=op.f("ck_vendors_payment_terms_days_range")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_vendors_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendors")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_vendors_organization_id_id")),
    )
    op.create_index(
        "uq_vendors_organization_id_code",
        "vendors",
        ["organization_id", "code"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "job_roles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("default_hourly_rate", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("is_supervisory", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "default_hourly_rate >= 0", name=op.f("ck_job_roles_default_hourly_rate_not_negative")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_job_roles_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_job_roles")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_job_roles_organization_id_id")),
    )
    op.create_index(
        "uq_job_roles_organization_id_lower_name",
        "job_roles",
        ["organization_id", sa.literal_column("lower(name)")],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "employees",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("employee_number", sa.String(length=20), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("job_role_id", sa.Uuid(), nullable=False),
        sa.Column("supervisor_id", sa.Uuid(), nullable=True),
        sa.Column("membership_id", sa.Uuid(), nullable=True),
        sa.Column(
            "employment_type",
            sa.Enum(
                "full_time",
                "part_time",
                "contractor",
                "temporary",
                name="employmenttype",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "onboarding",
                "active",
                "on_leave",
                "terminated",
                name="employeestatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("hire_date", sa.Date(), nullable=True),
        sa.Column("termination_date", sa.Date(), nullable=True),
        sa.Column("hourly_rate", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("hourly_rate >= 0", name=op.f("ck_employees_hourly_rate_not_negative")),
        sa.CheckConstraint("supervisor_id <> id", name=op.f("ck_employees_not_own_supervisor")),
        sa.CheckConstraint(
            "termination_date >= hire_date", name=op.f("ck_employees_termination_not_before_hire")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "job_role_id"],
            ["job_roles.organization_id", "job_roles.id"],
            name=op.f("fk_employees_organization_id_job_role_id_job_roles"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "membership_id"],
            ["memberships.organization_id", "memberships.id"],
            name=op.f("fk_employees_organization_id_membership_id_memberships"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "supervisor_id"],
            ["employees.organization_id", "employees.id"],
            name=op.f("fk_employees_organization_id_supervisor_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_employees_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employees")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_employees_organization_id_id")),
    )
    op.create_index(
        "ix_employees_organization_id_job_role_id",
        "employees",
        ["organization_id", "job_role_id"],
        unique=False,
    )
    op.create_index(
        "ix_employees_organization_id_status",
        "employees",
        ["organization_id", "status"],
        unique=False,
    )
    op.create_index(
        "uq_employees_membership_id",
        "employees",
        ["membership_id"],
        unique=True,
        postgresql_where=sa.text("membership_id IS NOT NULL"),
    )
    op.create_index(
        "uq_employees_organization_id_email",
        "employees",
        ["organization_id", "email"],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_employees_organization_id_employee_number",
        "employees",
        ["organization_id", "employee_number"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_table(
        "building_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "ends_on >= starts_on", name=op.f("ck_building_assignments_ends_not_before_start")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_building_assignments_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "employee_id"],
            ["employees.organization_id", "employees.id"],
            name=op.f("fk_building_assignments_organization_id_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_building_assignments_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_building_assignments")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_building_assignments_organization_id_id")
        ),
    )
    op.create_index(
        "uq_building_assignments_employee_id_building_id_open",
        "building_assignments",
        ["employee_id", "building_id"],
        unique=True,
        postgresql_where=sa.text("ends_on IS NULL"),
    )
    op.create_index(
        "uq_building_assignments_employee_id_open_primary",
        "building_assignments",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("is_primary AND ends_on IS NULL"),
    )
    op.create_table(
        "contracts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("contract_number", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "active",
                "expired",
                "terminated",
                name="contractstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "billing_model",
            sa.Enum(
                "cost_plus",
                "fixed_fee",
                "time_and_materials",
                name="billingmodel",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("markup_percent", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("monthly_fee", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("payment_terms_days", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "billing_model <> 'cost_plus' OR markup_percent IS NOT NULL",
            name=op.f("ck_contracts_cost_plus_has_markup"),
        ),
        sa.CheckConstraint(
            "billing_model <> 'fixed_fee' OR monthly_fee IS NOT NULL",
            name=op.f("ck_contracts_fixed_fee_has_monthly_fee"),
        ),
        sa.CheckConstraint(
            "end_date >= start_date", name=op.f("ck_contracts_end_not_before_start")
        ),
        sa.CheckConstraint(
            "markup_percent BETWEEN 0 AND 500", name=op.f("ck_contracts_markup_percent_range")
        ),
        sa.CheckConstraint("monthly_fee >= 0", name=op.f("ck_contracts_monthly_fee_not_negative")),
        sa.CheckConstraint(
            "payment_terms_days BETWEEN 0 AND 180",
            name=op.f("ck_contracts_payment_terms_days_range"),
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "customer_id"],
            ["customers.organization_id", "customers.id"],
            name=op.f("fk_contracts_organization_id_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_contracts_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contracts")),
        sa.UniqueConstraint(
            "organization_id",
            "contract_number",
            name=op.f("uq_contracts_organization_id_contract_number"),
        ),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_contracts_organization_id_id")),
    )
    op.create_table(
        "contract_buildings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=False),
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_contract_buildings_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "contract_id"],
            ["contracts.organization_id", "contracts.id"],
            name=op.f("fk_contract_buildings_organization_id_contract_id_contracts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_contract_buildings_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_contract_buildings")),
        sa.UniqueConstraint(
            "contract_id", "building_id", name=op.f("uq_contract_buildings_contract_id_building_id")
        ),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_contract_buildings_organization_id_id")
        ),
    )

    _secure_tenant_tables()


def downgrade() -> None:
    # Dropping a table drops its indexes and its policy with it. Tables go in the reverse
    # of the order they were created in, so nothing is dropped while still referenced.
    op.drop_table("contract_buildings")
    op.drop_table("contracts")
    op.drop_table("building_assignments")
    op.drop_table("employees")
    op.drop_table("job_roles")
    op.drop_table("vendors")
    op.drop_table("buildings")
    op.drop_table("customers")
    op.drop_table("organization_sequences")
