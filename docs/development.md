# Development guide

## Setup

`make setup` does everything below; the steps are listed so you can run them one at a time.

1. `make env` creates `.env` from `.env.example` with a generated `AUTH_SECRET`, and links
   it into the web app as `apps/web/.env.local`. Both apps read the same file.
2. `make install` installs API dependencies with uv and web dependencies with pnpm.
3. `make db-bootstrap` creates two PostgreSQL roles and the `buildingops` and
   `buildingops_test` databases. It needs a superuser: by default your operating-system
   user on a local server. Override with the standard `PGHOST`, `PGUSER`, `PGPASSWORD`.
4. `make migrate` applies migrations as the owner role and grants the app role data access.
5. `make seed` loads the demo organizations and accounts, and gives each organization its
   master data: customers, buildings, vendors, employees and contracts. It is safe to run
   again: an organization that already has customers is left as it is.

## Conventions

### API (`apps/api`)

- One package per module under `src/buildingops/modules`: `models.py`, `schemas.py`,
  a service, a router. Routers stay thin; rules live in services.
- Services take a `Context` (database session, principal, request metadata) and never
  commit. The request dependency commits when the endpoint returns and rolls back if it
  raises.
- Scope every query to `ctx.organization_id`, even though row-level security would also
  catch it. Look rows up by id *and* organization, and answer 404 for another tenant's id.
- Protect endpoints with `Depends(require(Permission.X))`. Add new permissions to
  `core/permissions.py`; the web app's types follow after `make api-types`.
- Record every change with `audit.record(...)` in the same transaction, passing a
  field-level diff from `audit.changes_between`.
- Raise the errors in `core/errors.py`. They become problem documents with stable codes.
- Money is `Decimal` in Python and `NUMERIC` in the database. It is never a float.
- A service for a tenant-owned record builds on `core/crud.py`. Look a record up with
  `get_or_404` when the path names it and with `get_referenced` when the body does, lock it
  (`for_update=True`) before checking what depends on it, and let `create`, `update` and
  `archive` write the audit entry. `modules/customers` is a short, complete example.

### Adding a tenant table

1. Define the model with `TenantMixin`. Reference other tenant tables with `tenant_fk`.
2. Register the module's models in `src/buildingops/models.py`.
3. `uv run alembic revision --autogenerate -m "..." --rev-id NNNN`
4. In the migration, enable row-level security for the table. Copy the policy statements
   from an earlier migration: migrations carry their own SQL so they never change meaning.

   ```python
   op.execute("ALTER TABLE buildings ENABLE ROW LEVEL SECURITY")
   op.execute(
       "CREATE POLICY tenant_isolation ON buildings"
       " USING (organization_id = (SELECT app_current_org_id()))"
       " WITH CHECK (organization_id = (SELECT app_current_org_id()))"
   )
   ```
5. Run the tests. `test_schema_invariants.py` fails if the policy or the composite key is
   missing, or if the models and migrations disagree. Every migration is also run down and
   up again, so write the downgrade.
6. That comparison does not see CHECK constraints or the condition of a partial index.
   Give each one a case that breaks it, as `test_master_data_constraints.py` does.

### Web (`apps/web`)

- `src/features/<area>` holds pages and their dialogs; `src/components/ui` holds shared
  components; `src/lib` holds everything without JSX.
- Call the API with `$api.useQuery` / `$api.useMutation` from `src/lib/api/client.ts`.
  Types come from the OpenAPI document. Run `make api-types` after changing the API.
- Keep list state in the URL with `useListParams`.
- Show API errors with `applyProblem` (forms) or `problemMessage` (everything else).
- Gate what is shown with `useCan`, and remember that it only decides what is shown.
- A page in the navigation must work. Do not add placeholders for modules that do not
  exist yet.
- Read the bundled Next.js docs in `node_modules/next/dist/docs` before using a framework
  feature: this version differs from older ones in ways that matter.

## Tests

```bash
make test-api                 # needs the roles from `make db-bootstrap`
make test-web
make e2e                      # install the browser once: see README
```

API tests run against real PostgreSQL as the app role. Each test creates its own
organization, so tests do not interfere and nothing needs cleaning up. The end-to-end suite
rebuilds its own database (`buildingops_e2e`) on every run and uses ports 3100 and 8100.

To save screenshots while the end-to-end tests run:

```bash
E2E_SCREENSHOT_DIR=/tmp/buildingops-screens pnpm e2e
```

## Troubleshooting

- **Styles look stale in development.** Stop the web server, delete `apps/web/.next/dev`
  and start it again.
- **`permission denied` or empty results from the API.** The request has no organization
  context, or the role is wrong. Check that `DATABASE_URL` uses the app role and
  `DATABASE_ADMIN_URL` the owner role.
- **The API logs `rls_not_enforced` at startup.** It is connected as a superuser or as the
  table owner. Fix `DATABASE_URL`. In production it refuses to start in this state.
