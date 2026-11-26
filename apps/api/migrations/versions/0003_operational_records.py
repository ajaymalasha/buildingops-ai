"""Operational records: work orders, shifts, timesheets, expenses, invoices, payments.

The transactional records that dashboards, approvals and billing compute from. Every table
here is tenant-owned and gets the standard isolation policy. Shifts also get an exclusion
constraint, so that the database itself refuses to put one person in two places at once.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-26 02:55:55.557526+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The tables this migration creates, in the order it creates them. All are tenant-owned.
_TENANT_TABLES = (
    "work_orders",
    "work_order_activities",
    "shifts",
    "timesheets",
    "expenses",
    "invoices",
    "invoice_lines",
    "payments",
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
    # The exclusion constraint on shifts compares employee ids for equality inside a GiST
    # index, which needs this extension's operator classes. It is a trusted extension, so
    # the database owner can create it without being a superuser.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "work_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=True),
        sa.Column(
            "category",
            sa.Enum(
                "cleaning",
                "maintenance",
                "repair",
                "inspection",
                "hvac",
                "electrical",
                "plumbing",
                "landscaping",
                "security",
                "other",
                name="workordercategory",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "priority",
            sa.Enum(
                "low",
                "normal",
                "high",
                "urgent",
                name="workorderpriority",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "open",
                "scheduled",
                "in_progress",
                "on_hold",
                "completed",
                "cancelled",
                name="workorderstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum(
                "internal",
                "customer_request",
                "inspection",
                "preventive",
                name="workordersource",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("assigned_employee_id", sa.Uuid(), nullable=True),
        sa.Column("vendor_id", sa.Uuid(), nullable=True),
        sa.Column("requested_by", sa.String(length=200), nullable=True),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("billable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
            "completed_at >= started_at", name=op.f("ck_work_orders_completed_not_before_started")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "assigned_employee_id"],
            ["employees.organization_id", "employees.id"],
            name=op.f("fk_work_orders_organization_id_assigned_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_work_orders_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "contract_id"],
            ["contracts.organization_id", "contracts.id"],
            name=op.f("fk_work_orders_organization_id_contract_id_contracts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "vendor_id"],
            ["vendors.organization_id", "vendors.id"],
            name=op.f("fk_work_orders_organization_id_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_work_orders_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_orders")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_work_orders_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id", "number", name=op.f("uq_work_orders_organization_id_number")
        ),
    )
    op.create_index(
        "ix_work_orders_organization_id_assigned_employee_id",
        "work_orders",
        ["organization_id", "assigned_employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_work_orders_organization_id_building_id",
        "work_orders",
        ["organization_id", "building_id"],
        unique=False,
    )
    op.create_index(
        "ix_work_orders_organization_id_due_on",
        "work_orders",
        ["organization_id", "due_on"],
        unique=False,
    )
    op.create_index(
        "ix_work_orders_organization_id_status",
        "work_orders",
        ["organization_id", "status"],
        unique=False,
    )
    op.create_table(
        "work_order_activities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("work_order_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "comment",
                "status_change",
                "assignment",
                name="workorderactivitykind",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=True),
        sa.Column("author_user_id", sa.Uuid(), nullable=True),
        sa.Column("author_name", sa.String(length=200), nullable=False),
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
            ["author_user_id"],
            ["users.id"],
            name=op.f("fk_work_order_activities_author_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "work_order_id"],
            ["work_orders.organization_id", "work_orders.id"],
            name="fk_work_order_activities_work_order_id_work_orders",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_work_order_activities_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_order_activities")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_work_order_activities_organization_id_id")
        ),
    )
    op.create_index(
        "ix_work_order_activities_work_order_id_created_at",
        "work_order_activities",
        ["work_order_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "shifts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("break_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "scheduled",
                "completed",
                "missed",
                "cancelled",
                name="shiftstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
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
        # No two shifts of one employee overlap, cancelled ones aside. A range covers its
        # start and not its end, so one shift may begin the moment another ends.
        postgresql.ExcludeConstraint(
            (sa.column("employee_id"), "="),
            (sa.text("tstzrange(starts_at, ends_at)"), "&&"),
            where=sa.text("status <> 'cancelled'"),
            using="gist",
            name="ex_shifts_employee_id_no_overlap",
        ),
        sa.CheckConstraint(
            "ends_at <= starts_at + interval '24 hours'", name=op.f("ck_shifts_at_most_24_hours")
        ),
        sa.CheckConstraint(
            "break_minutes BETWEEN 0 AND 240", name=op.f("ck_shifts_break_minutes_range")
        ),
        sa.CheckConstraint("ends_at > starts_at", name=op.f("ck_shifts_ends_after_start")),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_shifts_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "employee_id"],
            ["employees.organization_id", "employees.id"],
            name=op.f("fk_shifts_organization_id_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_shifts_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shifts")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_shifts_organization_id_id")),
    )
    op.create_index(
        "ix_shifts_organization_id_building_id_starts_at",
        "shifts",
        ["organization_id", "building_id", "starts_at"],
        unique=False,
    )
    op.create_index(
        "ix_shifts_organization_id_employee_id_starts_at",
        "shifts",
        ["organization_id", "employee_id", "starts_at"],
        unique=False,
    )
    op.create_table(
        "timesheets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("building_id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=True),
        sa.Column("shift_id", sa.Uuid(), nullable=True),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("hours_regular", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("hours_overtime", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("hourly_rate", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("overtime_multiplier", sa.Numeric(precision=3, scale=2), nullable=False),
        sa.Column("labor_cost", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "source",
            sa.Enum(
                "manual",
                "schedule",
                "voice",
                "import",
                name="timesheetsource",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "approved",
                "rejected",
                name="decisionstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_by_name", sa.String(length=200), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.String(length=500), nullable=True),
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
            "(status = 'pending') = (decided_at IS NULL)",
            name=op.f("ck_timesheets_decided_unless_pending"),
        ),
        sa.CheckConstraint("hourly_rate >= 0", name=op.f("ck_timesheets_hourly_rate_not_negative")),
        sa.CheckConstraint(
            "hours_overtime BETWEEN 0 AND 24", name=op.f("ck_timesheets_hours_overtime_range")
        ),
        sa.CheckConstraint(
            "hours_regular + hours_overtime > 0 AND hours_regular + hours_overtime <= 24",
            name=op.f("ck_timesheets_total_hours_range"),
        ),
        sa.CheckConstraint(
            "hours_regular BETWEEN 0 AND 24", name=op.f("ck_timesheets_hours_regular_range")
        ),
        sa.CheckConstraint("labor_cost >= 0", name=op.f("ck_timesheets_labor_cost_not_negative")),
        sa.CheckConstraint(
            "overtime_multiplier BETWEEN 1 AND 3",
            name=op.f("ck_timesheets_overtime_multiplier_range"),
        ),
        sa.ForeignKeyConstraint(
            ["decided_by_user_id"],
            ["users.id"],
            name=op.f("fk_timesheets_decided_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_timesheets_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "contract_id"],
            ["contracts.organization_id", "contracts.id"],
            name=op.f("fk_timesheets_organization_id_contract_id_contracts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "employee_id"],
            ["employees.organization_id", "employees.id"],
            name=op.f("fk_timesheets_organization_id_employee_id_employees"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "shift_id"],
            ["shifts.organization_id", "shifts.id"],
            name=op.f("fk_timesheets_organization_id_shift_id_shifts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_timesheets_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_timesheets")),
        sa.UniqueConstraint(
            "employee_id",
            "work_date",
            "building_id",
            name=op.f("uq_timesheets_employee_id_work_date_building_id"),
        ),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_timesheets_organization_id_id")),
    )
    op.create_index(
        "ix_timesheets_organization_id_building_id_work_date",
        "timesheets",
        ["organization_id", "building_id", "work_date"],
        unique=False,
    )
    op.create_index(
        "ix_timesheets_organization_id_contract_id_work_date",
        "timesheets",
        ["organization_id", "contract_id", "work_date"],
        unique=False,
    )
    op.create_index(
        "ix_timesheets_organization_id_status_work_date",
        "timesheets",
        ["organization_id", "status", "work_date"],
        unique=False,
    )
    op.create_table(
        "expenses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "materials",
                "equipment",
                "subcontractor",
                "supplies",
                "travel",
                "other",
                name="expensecategory",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("incurred_on", sa.Date(), nullable=False),
        sa.Column("building_id", sa.Uuid(), nullable=True),
        sa.Column("contract_id", sa.Uuid(), nullable=True),
        sa.Column("vendor_id", sa.Uuid(), nullable=True),
        sa.Column("work_order_id", sa.Uuid(), nullable=True),
        sa.Column("billable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("reference", sa.String(length=100), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "approved",
                "rejected",
                name="decisionstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("decided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("decided_by_name", sa.String(length=200), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.String(length=500), nullable=True),
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
            "(status = 'pending') = (decided_at IS NULL)",
            name=op.f("ck_expenses_decided_unless_pending"),
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_expenses_amount_positive")),
        sa.ForeignKeyConstraint(
            ["decided_by_user_id"],
            ["users.id"],
            name=op.f("fk_expenses_decided_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "building_id"],
            ["buildings.organization_id", "buildings.id"],
            name=op.f("fk_expenses_organization_id_building_id_buildings"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "contract_id"],
            ["contracts.organization_id", "contracts.id"],
            name=op.f("fk_expenses_organization_id_contract_id_contracts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "vendor_id"],
            ["vendors.organization_id", "vendors.id"],
            name=op.f("fk_expenses_organization_id_vendor_id_vendors"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "work_order_id"],
            ["work_orders.organization_id", "work_orders.id"],
            name=op.f("fk_expenses_organization_id_work_order_id_work_orders"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_expenses_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_expenses")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_expenses_organization_id_id")),
    )
    op.create_index(
        "ix_expenses_organization_id_contract_id_incurred_on",
        "expenses",
        ["organization_id", "contract_id", "incurred_on"],
        unique=False,
    )
    op.create_index(
        "ix_expenses_organization_id_status_incurred_on",
        "expenses",
        ["organization_id", "status", "incurred_on"],
        unique=False,
    )
    op.create_table(
        "invoices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(length=20), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "issued",
                "paid",
                "void",
                name="invoicestatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("markup_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
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
            "amount_paid >= 0 AND amount_paid <= total",
            name=op.f("ck_invoices_amount_paid_within_total"),
        ),
        sa.CheckConstraint(
            "period_end >= period_start", name=op.f("ck_invoices_period_end_not_before_start")
        ),
        sa.CheckConstraint(
            "subtotal >= 0 AND markup_amount >= 0 AND tax_amount >= 0 AND total >= 0",
            name=op.f("ck_invoices_amounts_not_negative"),
        ),
        sa.CheckConstraint(
            "total = subtotal + markup_amount + tax_amount", name=op.f("ck_invoices_total_adds_up")
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "contract_id"],
            ["contracts.organization_id", "contracts.id"],
            name=op.f("fk_invoices_organization_id_contract_id_contracts"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id", "customer_id"],
            ["customers.organization_id", "customers.id"],
            name=op.f("fk_invoices_organization_id_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_invoices_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoices")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_invoices_organization_id_id")),
        sa.UniqueConstraint(
            "organization_id", "number", name=op.f("uq_invoices_organization_id_number")
        ),
    )
    op.create_index(
        "ix_invoices_organization_id_contract_id_period_start",
        "invoices",
        ["organization_id", "contract_id", "period_start"],
        unique=False,
    )
    op.create_index(
        "ix_invoices_organization_id_customer_id",
        "invoices",
        ["organization_id", "customer_id"],
        unique=False,
    )
    op.create_index(
        "ix_invoices_organization_id_status_due_date",
        "invoices",
        ["organization_id", "status", "due_date"],
        unique=False,
    )
    op.create_table(
        "invoice_lines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "labor",
                "materials",
                "equipment",
                "subcontractor",
                "fee",
                "markup",
                "other",
                name="invoicelinekind",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
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
            ["organization_id", "invoice_id"],
            ["invoices.organization_id", "invoices.id"],
            name=op.f("fk_invoice_lines_organization_id_invoice_id_invoices"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_invoice_lines_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_invoice_lines")),
        sa.UniqueConstraint(
            "invoice_id", "position", name=op.f("uq_invoice_lines_invoice_id_position")
        ),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_invoice_lines_organization_id_id")
        ),
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("invoice_id", sa.Uuid(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column(
            "method",
            sa.Enum(
                "ach",
                "check",
                "card",
                "wire",
                "other",
                name="paymentmethod",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("reference", sa.String(length=100), nullable=True),
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
        sa.CheckConstraint("amount > 0", name=op.f("ck_payments_amount_positive")),
        sa.ForeignKeyConstraint(
            ["organization_id", "invoice_id"],
            ["invoices.organization_id", "invoices.id"],
            name=op.f("fk_payments_organization_id_invoice_id_invoices"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_payments_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payments")),
        sa.UniqueConstraint("organization_id", "id", name=op.f("uq_payments_organization_id_id")),
    )
    op.create_index(
        "ix_payments_organization_id_received_on",
        "payments",
        ["organization_id", "received_on"],
        unique=False,
    )

    _secure_tenant_tables()


def downgrade() -> None:
    # Dropping a table drops its indexes, its constraints and its policy with it. Tables go
    # in the reverse of the order they were created in, so nothing is dropped while still
    # referenced. The extension goes last: the constraint on shifts depends on it.
    op.drop_table("payments")
    op.drop_table("invoice_lines")
    op.drop_table("invoices")
    op.drop_table("expenses")
    op.drop_table("timesheets")
    op.drop_table("shifts")
    op.drop_table("work_order_activities")
    op.drop_table("work_orders")
    op.execute("DROP EXTENSION btree_gist")
