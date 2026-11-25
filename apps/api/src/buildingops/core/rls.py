"""Row-level security contract shared by application code and schema tests.

The policies themselves live in the migrations as literal SQL, so that a migration never
changes meaning after it has been applied. This module records the conventions they follow:

* Three transaction-local settings identify the caller: `app.current_org_id`,
  `app.current_user_id` and `app.platform_admin`. `buildingops.core.db` applies them at the
  start of every transaction.
* Every table with an `organization_id` column has row-level security enabled and a policy
  named `tenant_isolation` restricting it to the active organization.
* Unset settings resolve to NULL, so a transaction without context matches no rows.

`tests/test_schema_invariants.py` checks these rules against the real database, which is
what catches a migration that adds a tenant table and forgets its policy.
"""

TENANT_POLICY_NAME = "tenant_isolation"

# Global identity tables. They hold no tenant business data, are only touched by the
# identity module, and must be readable before any organization context exists (sign-in).
TABLES_WITHOUT_RLS: frozenset[str] = frozenset(
    {"alembic_version", "users", "auth_sessions", "login_attempts"}
)
