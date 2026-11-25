# 0001. Tenant isolation: shared schema with row-level security

## Context

Many companies share one deployment, and one company must never see another's records.
The usual options are a database per tenant, a schema per tenant, or shared tables with a
tenant column. Separate databases or schemas isolate strongly but make migrations,
connection pooling and cross-tenant operations (platform administration, analytics)
expensive. Shared tables are simple to operate, but isolation then depends on every query
remembering its `WHERE organization_id = ...`.

## Decision

Shared tables with an `organization_id`, and the database enforces the isolation:

- Every tenant table has row-level security with a `tenant_isolation` policy that compares
  `organization_id` to a transaction-local setting.
- The API connects as a role that is not a superuser, has no `BYPASSRLS` and owns no
  tables. A separate owner role runs migrations.
- Tenant tables reference each other through `(organization_id, id)`, so a foreign key
  cannot cross tenants.
- Schema tests fail the build if a table lacks the policy or the composite key.

## Consequences

- A forgotten filter in application code returns nothing instead of leaking data.
- Two database roles must exist; `infra/postgres/bootstrap.sh` creates them.
- The settings are trusted because the application sets them. Row-level security here
  protects against application bugs, not against a compromised application.
- Policies add a predicate to every query. They are written as scalar subqueries so the
  planner evaluates the setting once per statement, and `(organization_id, id)` indexes
  serve the lookups.
- A tenant that needs physical separation later can be moved to its own database: the
  model does not prevent it.
