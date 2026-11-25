# Working in this repository

BuildingOps AI is a monorepo: `apps/api` (FastAPI, Python 3.14, uv) and `apps/web`
(Next.js 16, pnpm). Start with `README.md`, then `docs/architecture.md` and
`docs/development.md`, which hold the conventions.

## Before you finish a change

```bash
make check                    # lint, types and tests for both apps
make api-types                # after any API change; commit the result
cd apps/web && pnpm e2e       # after changes to sign-in, navigation or permissions
```

## Rules that are easy to break

- Every table with `organization_id` needs row-level security in its migration, and every
  query is scoped to `ctx.organization_id`. See "Adding a tenant table" in
  `docs/development.md`.
- Services never commit. Every change writes an audit entry in the same transaction.
- Authorization is enforced in the API with `require(Permission.X)`. Hiding something in
  the web app is not a control.
- Money is `Decimal`, never a float. Model output never authorizes money, payroll or
  approvals: code validates it and a person approves it.
- A simulated integration is labelled as simulated, in the code and in the interface.
- Do not add navigation entries or screens for features that do not work yet.
- `apps/web/AGENTS.md` is maintained by Next.js. It says to read the bundled docs before
  using framework features, and it means it.

## Delivery

Work lands as small slices that each build, test and revert on their own. Keep `README.md`'s
status table accurate: it lists what works, what is simulated and what is only planned.
