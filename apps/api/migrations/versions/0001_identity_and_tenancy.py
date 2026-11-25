"""Identity and tenancy: organizations, users, memberships, sessions, audit log.

Also installs the row-level security foundation every later migration builds on:
the `app_current_*` context functions, the policies for the identity tables, and the
append-only guard for the audit log.

Revision ID: 0001
Revises:
Create Date: 2026-11-25 22:16:40.782696+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Scalar subqueries let the planner evaluate each function once per statement.
_ORG = "(SELECT app_current_org_id())"
_USER = "(SELECT app_current_user_id())"
_PLATFORM_ADMIN = "(SELECT app_is_platform_admin())"


def _create_context_functions() -> None:
    """Read the transaction-local settings applied by `buildingops.core.db`.

    An unset setting resolves to NULL, so a transaction with no context matches no rows.
    """
    op.execute(
        """
        CREATE FUNCTION app_current_org_id() RETURNS uuid
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_current_user_id() RETURNS uuid
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION app_is_platform_admin() RETURNS boolean
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$
            SELECT COALESCE(
                NULLIF(current_setting('app.platform_admin', true), ''), 'false'
            )::boolean
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION prevent_row_mutation() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
        END
        $$
        """
    )


def _secure_identity_tables() -> None:
    for table in ("organizations", "memberships", "audit_logs"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    # Organizations: readable by their members and by platform administrators. Only a
    # platform administrator can create one. No DELETE policy exists, so none can be deleted.
    op.execute(
        f"""
        CREATE POLICY organizations_select ON organizations FOR SELECT USING (
            id = {_ORG}
            OR {_PLATFORM_ADMIN}
            OR EXISTS (
                SELECT 1 FROM memberships m
                WHERE m.organization_id = organizations.id AND m.user_id = {_USER}
            )
        )
        """
    )
    op.execute(
        f"""
        CREATE POLICY organizations_update ON organizations FOR UPDATE
        USING (id = {_ORG} OR {_PLATFORM_ADMIN})
        WITH CHECK (id = {_ORG} OR {_PLATFORM_ADMIN})
        """
    )
    op.execute(
        f"CREATE POLICY organizations_insert ON organizations FOR INSERT"
        f" WITH CHECK ({_PLATFORM_ADMIN})"
    )

    # Memberships: the active organization's rows, plus a user's own memberships in any
    # organization (needed to sign in and to list the organizations they can switch to).
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON memberships
        USING (organization_id = {_ORG} OR {_PLATFORM_ADMIN})
        WITH CHECK (organization_id = {_ORG} OR {_PLATFORM_ADMIN})
        """
    )
    op.execute(f"CREATE POLICY memberships_own ON memberships FOR SELECT USING (user_id = {_USER})")

    # Audit log: read and append within the active organization. There are no UPDATE or
    # DELETE policies, and the triggers below block those for every role, owner included.
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON audit_logs FOR SELECT
        USING (organization_id = {_ORG} OR {_PLATFORM_ADMIN})
        """
    )
    op.execute(
        f"""
        CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
        WITH CHECK (organization_id = {_ORG} OR {_PLATFORM_ADMIN})
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_row_mutation()
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
        FOR EACH STATEMENT EXECUTE FUNCTION prevent_row_mutation()
        """
    )


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    _create_context_functions()

    op.create_table(
        "login_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_login_attempts")),
    )
    op.create_index(
        "ix_login_attempts_email_created_at",
        "login_attempts",
        ["email", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_login_attempts_ip_created_at", "login_attempts", ["ip", "created_at"], unique=False
    )
    op.create_table(
        "organizations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("legal_name", sa.String(length=200), nullable=True),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "suspended",
                name="organizationstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
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
            "currency ~ '^[A-Z]{3}$'", name=op.f("ck_organizations_currency_iso4217")
        ),
        sa.CheckConstraint(
            "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f("ck_organizations_slug_format")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organizations")),
        sa.UniqueConstraint("slug", name=op.f("uq_organizations_slug")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("full_name", sa.String(length=200), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "is_platform_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_name", sa.String(length=200), nullable=False),
        sa.Column("actor_role", sa.String(length=40), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=60), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=True),
        sa.Column("summary", sa.String(length=400), nullable=False),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_audit_logs_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_audit_logs_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_logs")),
    )
    op.create_index(
        "ix_audit_logs_entity",
        "audit_logs",
        ["organization_id", "entity_type", "entity_id"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_organization_created",
        "audit_logs",
        ["organization_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("active_organization_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.ForeignKeyConstraint(
            ["active_organization_id"],
            ["organizations.id"],
            name=op.f("fk_auth_sessions_active_organization_id_organizations"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_sessions_token_hash")),
    )
    op.create_index(op.f("ix_auth_sessions_user_id"), "auth_sessions", ["user_id"], unique=False)
    op.create_table(
        "memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "platform_admin",
                "company_admin",
                "operations_manager",
                "supervisor",
                "employee",
                "customer",
                "vendor",
                name="role",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "suspended",
                name="membershipstatus",
                native_enum=False,
                create_constraint=True,
                length=40,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=120), nullable=True),
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
        sa.CheckConstraint("role <> 'platform_admin'", name=op.f("ck_memberships_role_assignable")),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_memberships_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_memberships_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_memberships")),
        sa.UniqueConstraint(
            "organization_id", "id", name=op.f("uq_memberships_organization_id_id")
        ),
        sa.UniqueConstraint(
            "organization_id", "user_id", name=op.f("uq_memberships_organization_id_user_id")
        ),
    )
    op.create_index(op.f("ix_memberships_user_id"), "memberships", ["user_id"], unique=False)

    _secure_identity_tables()


def downgrade() -> None:
    # Dropping a table drops its own policies and triggers. This policy lives on
    # organizations but reads memberships, so it has to go before memberships can.
    op.execute("DROP POLICY organizations_select ON organizations")
    op.drop_index(op.f("ix_memberships_user_id"), table_name="memberships")
    op.drop_table("memberships")
    op.drop_index(op.f("ix_auth_sessions_user_id"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_audit_logs_organization_created", table_name="audit_logs")
    op.drop_index("ix_audit_logs_entity", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_table("users")
    op.drop_table("organizations")
    op.drop_index("ix_login_attempts_ip_created_at", table_name="login_attempts")
    op.drop_index("ix_login_attempts_email_created_at", table_name="login_attempts")
    op.drop_table("login_attempts")

    op.execute("DROP FUNCTION prevent_row_mutation()")
    op.execute("DROP FUNCTION app_is_platform_admin()")
    op.execute("DROP FUNCTION app_current_user_id()")
    op.execute("DROP FUNCTION app_current_org_id()")
    op.execute("DROP EXTENSION citext")
