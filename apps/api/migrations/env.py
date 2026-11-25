"""Alembic environment.

Migrations run as the owner role (`DATABASE_ADMIN_URL`). After every run the runtime role
is granted data access to all tables, so a new table can never be forgotten. The runtime
role gets no DDL rights and is not the owner, which is what keeps it subject to row-level
security.
"""

from alembic import context
from sqlalchemy import Connection, create_engine, text

import buildingops.models  # noqa: F401 - registers every table on Base.metadata
from buildingops.core.config import get_settings
from buildingops.core.models import Base

config = context.config
target_metadata = Base.metadata


def _settings_value(key: str, default: str) -> str:
    """Tests pass explicit values through `Config.attributes`; otherwise use the environment."""
    value = config.attributes.get(key)
    return str(value) if value else default


def _database_url() -> str:
    return _settings_value("database_admin_url", get_settings().database_admin_url)


def _app_role() -> str:
    return _settings_value("database_app_role", get_settings().database_app_role)


def _grant_runtime_access(connection: Connection, app_role: str) -> None:
    owner_role = connection.scalar(text("SELECT current_user"))
    if not app_role or app_role == owner_role:
        return
    if (
        connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": app_role})
        is None
    ):
        raise RuntimeError(
            f"Runtime role '{app_role}' does not exist. Run infra/postgres/bootstrap.sh first."
        )
    role = connection.dialect.identifier_preparer.quote(app_role)
    connection.execute(text(f"GRANT USAGE ON SCHEMA public TO {role}"))
    connection.execute(
        text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}")
    )
    connection.execute(text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}"))
    # Migration state is not the application's business.
    connection.execute(text(f"REVOKE ALL ON TABLE alembic_version FROM {role}"))


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection, target_metadata=target_metadata, compare_type=True
            )
            with context.begin_transaction():
                context.run_migrations()
                _grant_runtime_access(connection, _app_role())
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
