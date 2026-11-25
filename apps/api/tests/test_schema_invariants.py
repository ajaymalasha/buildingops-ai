"""Rules the whole schema must satisfy, checked against the migrated database.

These are what stop a future migration from quietly adding a tenant table without
isolation, or the models and migrations from drifting apart.
"""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import text

import buildingops.models  # noqa: F401 - registers every table
from buildingops.core.config import Settings
from buildingops.core.db import Database, check_runtime_role
from buildingops.core.models import Base
from buildingops.core.rls import TABLES_WITHOUT_RLS, TENANT_POLICY_NAME


def _rows(database: Database, sql: str, **params: str) -> list[tuple]:
    with database.engine.connect() as connection:
        return [tuple(row) for row in connection.execute(text(sql), params)]


def test_models_and_migrations_describe_the_same_schema(admin_database: Database):
    with admin_database.engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        differences = compare_metadata(context, Base.metadata)

    assert differences == [], "Models changed without a migration (or the reverse)"


def test_every_table_is_either_row_level_secured_or_explicitly_exempt(admin_database: Database):
    rows = _rows(
        admin_database,
        "SELECT c.relname, c.relrowsecurity FROM pg_class c"
        " JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = 'public' AND c.relkind = 'r'",
    )
    unsecured = {name for name, secured in rows if not secured}

    assert unsecured == TABLES_WITHOUT_RLS


def test_every_tenant_table_has_the_isolation_policy(admin_database: Database):
    tenant_tables = {
        name
        for (name,) in _rows(
            admin_database,
            "SELECT table_name FROM information_schema.columns"
            " WHERE table_schema = 'public' AND column_name = 'organization_id'",
        )
    }
    with_policy = {
        name
        for (name,) in _rows(
            admin_database,
            "SELECT tablename FROM pg_policies"
            " WHERE schemaname = 'public' AND policyname = :policy",
            policy=TENANT_POLICY_NAME,
        )
    }

    assert tenant_tables, "expected at least one tenant table"
    assert tenant_tables - with_policy == set()


def test_tenant_tables_expose_a_composite_key_for_tenant_safe_references(admin_database: Database):
    """`(organization_id, id)` must be unique so other tables can reference the pair."""
    tenant_tables = {
        table.name
        for table in Base.metadata.tables.values()
        if "organization_id" in table.c and not table.c.organization_id.nullable
    }
    with_key = {
        name
        for (name,) in _rows(
            admin_database,
            "SELECT conrelid::regclass::text FROM pg_constraint"
            " WHERE contype = 'u' AND conname LIKE 'uq_%_organization_id_id'",
        )
    }

    assert tenant_tables - with_key == set()


def test_the_app_role_is_subject_to_row_level_security(app_database: Database):
    role = check_runtime_role(app_database.engine)

    assert role.enforces_rls
    assert not role.is_superuser
    assert not role.bypasses_rls
    assert not role.owns_tables


def test_the_owner_role_is_reported_as_bypassing_row_level_security(admin_database: Database):
    assert not check_runtime_role(admin_database.engine).enforces_rls


def test_the_app_role_has_data_access_but_cannot_change_the_schema(
    admin_database: Database, settings: Settings
):
    role = settings.database_app_role
    (can_create,) = _rows(
        admin_database, "SELECT has_schema_privilege(:role, 'public', 'CREATE')", role=role
    )[0]
    (can_read_migrations,) = _rows(
        admin_database, "SELECT has_table_privilege(:role, 'alembic_version', 'SELECT')", role=role
    )[0]
    grants = _rows(
        admin_database,
        "SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type)"
        " FROM information_schema.role_table_grants WHERE grantee = :role GROUP BY 1",
        role=role,
    )

    assert not can_create
    assert not can_read_migrations
    assert dict(grants) == dict.fromkeys(set(Base.metadata.tables), "DELETE,INSERT,SELECT,UPDATE")
