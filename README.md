# BuildingOps AI

An operations platform for commercial building services companies: the businesses that
clean, maintain and staff office buildings, and that today run on disconnected systems,
spreadsheets, PDFs and email.

BuildingOps AI is being built as one connected product rather than a set of separate
tools. The plan covers an operations data spine and executive dashboard, RFP automation,
a voice agent for time capture, cost-plus billing, customer and vendor portals, a
hire-to-pay workflow and a training content studio. They share one data model, one
permission system and one audit trail.

## Status

The project is delivered in slices, each of which works on its own. This table is kept
honest: nothing is listed as working unless it is implemented and tested.

| Area | State |
| --- | --- |
| Multi-tenant foundation: organizations, users, memberships, row-level security | **Working** |
| Sign-in, server-side sessions, sign-in throttling, role-based permissions | **Working** |
| Member management, organization settings, platform administration | **Working** |
| Append-only audit log with field-level change history | **Working** |
| Web app shell, design system, typed API client | **Working** |
| Master data API: customers, buildings, vendors, job roles, employees, building assignments, contracts | **Working** (API and demo data; screens come next) |
| Work orders and the other operational records | Planned next |
| Executive dashboard, data import, entity resolution | Planned |
| Workforce workflows, cost-plus billing | Planned |
| RFP automation, voice agent, training studio (Claude) | Planned |
| Customer and vendor portals, external system integrations | Planned |

No external service is connected yet, and nothing is simulated yet either. When simulated
integrations arrive (payroll, ERP, telephony), they will be labelled as simulated here and
in the product.

## Stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS 4, Auth.js, TanStack Query |
| API | Python 3.14, FastAPI, Pydantic 2, SQLAlchemy 2.1, Alembic |
| Data | PostgreSQL 16+ with row-level security |
| Tooling | uv, pnpm, Ruff, mypy (strict), pytest, Vitest, Playwright, GitHub Actions, Docker |

Redis, Celery, pandas, the Anthropic SDK and the document libraries are part of the plan and
are added by the slice that first needs them.

## Quick start

You need PostgreSQL 16 or newer running locally, [uv](https://docs.astral.sh/uv/) and
Node.js 20.9 or newer with [pnpm](https://pnpm.io/).

```bash
make setup   # .env, dependencies, database roles, migrations, demo data
make dev     # API on http://localhost:8000, web app on http://localhost:3000
```

Open <http://localhost:3000> and choose a demo account on the sign-in page. They all use
the password `BuildingOps-Demo-2026`.

| Account | Access |
| --- | --- |
| `dana.whitfield@meridianfs.example` | Company admin of two organizations (try the organization switcher) |
| `marcus.okafor@meridianfs.example` | Operations manager |
| `priya.raman@meridianfs.example` | Supervisor |
| `luis.ortega@meridianfs.example` | Employee |
| `platform.admin@buildingops.example` | Platform admin: manages every organization |

`make setup` creates two database roles and a `buildingops` database (plus
`buildingops_test`) on your local PostgreSQL, using your operating-system user as the
superuser. The interactive API reference is at <http://localhost:8000/api/docs>.

### With Docker instead

```bash
export AUTH_SECRET=$(openssl rand -base64 32)
docker compose up --build
```

This starts PostgreSQL, applies migrations, loads the demo data and runs both apps. The
images are built and smoke-tested in CI on every push.

## Everyday commands

```bash
make check       # everything CI runs: lint, types and tests for both apps
make test-api    # API tests (real PostgreSQL, row-level security included)
make test-web    # web unit and component tests
make api-types   # regenerate the OpenAPI document and the typed web client
make help        # the full list
```

End-to-end tests drive a real browser against the real stack on their own database:

```bash
(cd apps/web && pnpm exec playwright install chromium)   # once
make e2e
```

## How it is put together

```
apps/api    FastAPI service: business logic, authorization, data access
apps/web    Next.js app: interface, sign-in, authenticated proxy to the API
infra       Database bootstrap script
docs        Architecture, decisions, development guide
```

Three decisions shape everything else. Each has a short record under
[`docs/decisions`](docs/decisions).

1. **Tenant isolation is enforced by the database.** Every tenant table has a row-level
   security policy, the API connects as a role that cannot bypass it, and references
   between tenant tables carry the organization id so a row cannot point across tenants.
   A missing `WHERE` clause in application code cannot leak another company's data.
2. **Sessions live on the server.** The API issues an opaque session token and checks it
   on every request, so sign-out, suspension and role changes take effect immediately. The
   browser never holds the token: Auth.js keeps it in an encrypted, httpOnly cookie and the
   Next.js server attaches it when it calls the API.
3. **AI proposes, people and deterministic code decide.** Models will extract and draft.
   Money, payroll and approvals are computed and authorized by ordinary code and named
   people, and every change is written to the audit log.

Read [`docs/architecture.md`](docs/architecture.md) for the full picture and
[`docs/development.md`](docs/development.md) for conventions and how-to guides.
