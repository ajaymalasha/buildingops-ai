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
5. `make seed` loads the demo organizations and accounts, gives each organization its
   master data (customers, buildings, vendors, employees and contracts), and then a year
   of work on top of it: timesheets, shifts, work orders, expenses, invoices and payments,
   dated relative to the day it runs. It is safe to run again: an organization that
   already has customers keeps its master data, and one that already has work orders
   keeps its year of work.

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
  Arithmetic that can leave more than two decimal places ends with
  `core.money.round_money`, which rounds half up to cents, and nothing else rounds money.
  An amount worked out by the API, such as a timesheet's labor cost, is never accepted
  from a client.
- A time in a request is a `Moment` (`core/schemas.py`): it must carry its UTC offset and
  is kept in UTC. A day that depends on where the organization is, such as "today", comes
  from `organizations_service.today`.
- A service for a tenant-owned record builds on `core/crud.py`. Look a record up with
  `get_or_404` when the path names it and with `get_referenced` when the body does, lock it
  (`for_update=True`) before checking what depends on it, and let `create`, `update` and
  `archive` write the audit entry. `modules/customers` is a short, complete example.
- Operational records build on the same helpers, and three more. A change with a name of
  its own (an approval, a cancellation, a status move) goes through `crud.transition`,
  which records `<entity>.<action>`. On an update, check a reference with
  `crud.new_reference`, which leaves alone one the record already has, and read a row a
  record already points at with `crud.get_held`: either may have been archived since, and
  the record keeps it. A record that waits for approval uses `DecisionMixin` and
  `core/decisions.py`. `modules/expenses` is the short example, `modules/timesheets` the
  full one.
- A list of dated records filters with `from` and `to` through
  `pagination.between_dates`.

### Adding a tenant table

1. Define the model with `TenantMixin`. Reference other tenant tables with `tenant_fk`. If
   the name that gives a foreign key would be longer than the 63 characters PostgreSQL
   keeps, pass `tenant_fk` a shorter `name`.
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
6. That comparison does not see CHECK constraints, exclusion constraints or the condition
   of a partial index. Autogenerate writes them out for a new table and never notices
   one that is added or changed later, so read what it wrote, and give each one a case
   that breaks it, as `test_master_data_constraints.py` and
   `test_operational_constraints.py` do. An exclusion constraint is declared on the model
   (`sqlalchemy.dialects.postgresql.ExcludeConstraint`), and the extension it needs is
   created by hand in the migration: see `0003_operational_records.py`.

### Web (`apps/web`)

- `src/features/<area>` holds pages and their dialogs; `src/components/ui` holds shared
  components; `src/components/forms` holds groups of fields that several forms share;
  `src/lib` holds everything without JSX.
- Call the API with `$api.useQuery` / `$api.useMutation` from `src/lib/api/client.ts`.
  Types come from the OpenAPI document. Run `make api-types` after changing the API.
- Keep list state in the URL with `useListParams`. A parameter that chooses what the page
  shows rather than narrows it (the tab that is open, the week on show) is named in its
  `view` option: it is then not counted as a filter, and "Clear filters" leaves it alone.
- Show API errors with `applyProblem` (forms) or `problemMessage` (everything else).
- Gate what is shown with `useCan`, and remember that it only decides what is shown.
- A page in the navigation must work. Do not add placeholders for modules that do not
  exist yet.
- Read the bundled Next.js docs in `node_modules/next/dist/docs` before using a framework
  feature: this version differs from older ones in ways that matter.

### Adding a list page and its form

`src/features/customers` is a short, complete example. `features/contracts` shows a form
whose fields depend on each other, and `features/employees` a drawer that saves each change
as it is made.

- **The page.** A toolbar of `SearchInput` and `FilterSelect`s, a `DataTable` with a
  `sortKey` on every column the API can sort by, and `Pagination`. Give `EmptyState`
  different words with and without filters. Put row actions in `RowActions`, and add that
  column only for people who may change the record.
- **Cells.** A code goes under the name in `NameCell`. A secondary detail goes under its
  value in `StackedCell` rather than in a column of its own. Numbers are right-aligned
  (`align: "end"`). Status is a `Badge` with a dot. Record ids are never shown.
- **The form.** One component adds and edits. Its zod schema, its starting values and the
  request body it sends live beside it in `<record>-form-schema.ts`, where they can be
  tested without rendering anything. Take field shapes from `lib/form-fields.ts`. They
  check what a browser can know and nothing else: a rule about what is acceptable belongs
  to the API, and `applyProblem` puts its answer on the field.
- **Where the form opens.** A `Dialog` for a handful of fields, a `Sheet` for more, with
  the fields grouped in `FormSection`s. A form that needs choices from another list (a
  building's customer) waits for them with `SheetLoading`, using a hook from
  `hooks/use-options.ts` so that it shares the request with the list's filter.
- **Codes.** `code`, `employee_number` and `contract_number` may be left blank when adding:
  send `null` and the API issues the next one. Say so in the field's hint.
- **Money.** An amount is a decimal string in the form and in the request. Use
  `formatMoney` and `formatPercent` to show one. Never call `Number()` on money.
- **Pay rates.** Leave the field out of the form, and out of the request, for someone
  without `employees:read_compensation`. The API refuses a request that mentions a rate
  from them, even a blank one, because it would erase a figure they cannot see.
- **Archiving.** Ask with `ConfirmDialog`, say what archiving means for that record, and
  pass it the mutation's `error`: a 409 is shown as the refusal it is.
- **After a change.** Call `invalidate` with every endpoint the change shows up in, not
  only the one written to. A new building changes its customer's building count.

### Operational records on screen

`features/work-orders`, `features/schedule`, `features/timesheets`, `features/expenses` and
`features/invoices` build on the list page above. What they add is shared, and worth
reusing before writing anything new.

- **Views and on-off filters.** `SegmentedControl` switches between the views of a list
  (backlog, completed, all) and can carry a count on each. `FilterToggle` is a filter
  that is either on or off ("Overdue only"), and `DateRangeFilter` one for records dated
  between two days. All three take their state from the URL.
- **Opening a record.** A record that is read more than it is edited opens in a drawer:
  `SheetContent` with `reading`, so that focus does not jump to a field further down.
  Give its row a button with `NameCell`'s `onOpen` (for the keyboard and screen readers)
  and the table `onRowClick` (for the pointer). Show its facts in a `DetailList` and its
  history in a `Timeline`. Changes made in such a drawer are saved as they are made and
  announced from inside it, as in the building-assignments drawer.
- **Status moves.** Offer a button for each move the API allows and no other. Keep the
  table of moves beside the feature, with a test that writes the API's table out again
  and checks the two agree. Nothing reads the API's table itself, so when it changes,
  change both.
- **Deciding.** Approve, reject and reopen are row actions. Rejecting asks why with
  `ReasonDialog`. The words and colours for pending, approved and rejected are in
  `lib/decisions.ts`. To act on several rows, give `DataTable` a `selection`, and send
  only what `keepSelected` leaves: what is on screen now and can still be acted on.
- **A week.** `WeekGrid` lays out a row for each person and a column for each day. Week
  arithmetic (`startOfWeek`, `weekDays`, `addDays`) is in `lib/dates.ts`: a week runs
  from Monday to Sunday.
- **Times.** The API takes instants with an offset. A form holds a day and a clock time
  where the organization is, as its inputs give them. Turn them into an instant with
  `instantInZone` (or `fromDateTimeInput`) and back with `zonedDateTime` (or
  `toDateTimeInput`), always passing the organization's time zone, never the browser's.
  Send a time only when the form's value for it changed: read back from a clock, a time
  loses its seconds, and on the night the clocks go back it can land an hour away.
- **Contracts.** A record booked to a contract must be for a building it covers, so the
  form offers only those: `ContractField`, in `components/forms`. Clear its value when
  the building changes. Leave it out, and `contract_id` out of the request, for someone
  without `contracts:read`. The same goes for any choice from a list the person may not
  read.
- **Adding up.** Hours and money arrive as decimal strings. To add them, use
  `sumDecimals`, never `Number()`. Do not work out a cost in the browser at all: a
  timesheet's rate, multiplier and labor cost are the API's, and its form sends none of
  them.
- **Nothing that does nothing.** Invoices can only be read, so their page has no button
  that creates, issues, edits or records anything. Keep it that way until the API can.

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

In end-to-end tests, find things by role (`getByRole`, or the helpers in `e2e/support.ts`).
The framework keeps pages visited earlier mounted but hidden, so `getByLabel` and
`getByText` on the whole page can match a filter or a heading on a page that is not on
screen. Queries by role skip what is hidden. Inside a dialog or a drawer that has been found
by role, any query is safe. While one is open, the page behind it is hidden from queries
by role too, so read what a test needs from the list before opening a row.

The demo data is dated from the day the seed runs, where each organization is. A test
that needs "today" or "tomorrow" for a due date, a shift or a timesheet takes it from
`organizationDay` in `e2e/support.ts`, not from the clock of the machine it runs on.

## Troubleshooting

- **Styles look stale in development.** Stop the web server, delete `apps/web/.next/dev`
  and start it again.
- **`permission denied` or empty results from the API.** The request has no organization
  context, or the role is wrong. Check that `DATABASE_URL` uses the app role and
  `DATABASE_ADMIN_URL` the owner role.
- **The API logs `rls_not_enforced` at startup.** It is connected as a superuser or as the
  table owner. Fix `DATABASE_URL`. In production it refuses to start in this state.
