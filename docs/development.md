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

### Adding a figure to the dashboard

`modules/analytics` reads and never writes. `definitions.py` says which records a figure
counts and on which day, `service.py` asks PostgreSQL to add them up, and
`docs/architecture.md` states each definition in words. Change all three together.

- **Define it once.** A figure counted over a period is a `Figure`: what is added up, the
  day a record counts on, and the conditions a record meets. The summary, the months, the
  contracts and the buildings all build on the same `Figure`, which is what keeps a total
  equal to the sum of its breakdown. Start the conditions with `crud.live(ctx, Model)`.
- **Add up in SQL.** Never load rows to add them in Python. To put several figures side
  by side for each month, contract or building, give `_side_by_side` one part per table:
  it is one statement however many figures there are. Keep to a handful of statements an
  endpoint: `test_each_endpoint_asks_the_database_a_handful_of_questions` counts them.
- **Days.** Compare a date column with the period directly. Turn a timestamp into the
  organization's day with `definitions.local_day` first, in SQL, never after loading.
- **Arithmetic.** Sums come back as `Decimal`, and `total(...)` makes an empty sum
  `0.00`, not null. Take a percentage with `_percent`: one decimal place, half up, and
  `None` when there is nothing to take it of. Never return a made-up zero.
- **Narrowing.** Decide what a building and a customer mean for the new figure, and if
  either cannot narrow it exactly, add it to `scope` in the summary so that the screen
  can say so.
- **Prove it.** Add records to the `books` fixture in `tests/test_dashboard.py` that
  count and records that must not (the wrong status, a day outside the period, another
  organization), work the expected figure out by hand in a comment, and assert it
  exactly. Then check it against the demo data in `tests/test_seed_and_cli.py`, where the
  API's figure is compared with a sum taken straight from the table.
- **One condition for a count and its list.** If a list can be filtered to the records a
  figure counts, use the list's own condition, as overdue invoices and overdue work
  orders do, and link the figure to that list in the web app.

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
  `formatMoney` and `formatPercent` to show one. Never call `Number()` on money. The one
  exception is drawing: `lib/chart.ts` turns an amount into a number to say how long a
  bar is, or which of two is the longer, and nothing that comes out of it is ever shown
  as a figure.
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

### The dashboard

`features/dashboard` is a report, not a list, and is laid out as one: bands of figures
between rules, sections told apart by rules and space (`ReportSection`), no cards.

- **Figures are the API's.** Show the decimal strings it sends with `formatMoney`,
  `formatPercentPoint` and, on a chart's axis only, `formatMoneyTick` (`$250K`). Do not
  add, subtract or divide them in the browser, even to "just show the difference": ask
  the API for the figure. Read a sign off the string (`isNegative`), not off a number.
- **The period.** `dashboard-period.ts` turns the URL into a pair of days and back, and
  holds the presets. They are worked out from `todayInZone(organization.timezone)`. Month,
  quarter and year arithmetic is in `lib/dates.ts`.
- **Links.** A figure that counts records links to the list that shows exactly those
  records, through `figureLinks`. If the list cannot be narrowed the way the dashboard
  is, return `null` and the figure is shown without a link. When a list gains a filter,
  give the dashboard the link, and add the pair to the end-to-end test that follows each
  count to its list and compares the two numbers.
- **Charts.** Use `BarChart` (`components/ui/bar-chart.tsx`): give it the series, a number
  for each bar, and the same figures as text for the tooltip and the table. Pine is for
  what comes in, graphite and the quiet tone for costs, and the critical colour only for
  a loss or something overdue. Mark what is not final as `partial`. A bar in a table row
  is a `ShareBar` or a `BalanceBar` (`components/ui/bars.tsx`). There is no charting
  library, on purpose: see [decision 0004](decisions/0004-dashboard-charts.md).
- **Widths.** Inside the dashboard use container variants (`@4xl:grid-cols-4`,
  `@max-2xl:hidden`), not window breakpoints (`lg:`): the page is much narrower than the
  window when the sidebar is beside it. `ReportSection` is a container, so what is inside
  one answers to the width of its section. When a table has to lose a column, move what
  was in it under another cell rather than dropping it or scrolling sideways, as the
  contracts table does, and the buildings with their hours. A chart's columns are
  containers too: under columns narrower than a label, every other label is left out,
  never the last. Jsdom lays nothing out, so a component test can only check the class
  that does this. The end-to-end test that loads the dashboard from 320 to 1280 pixels
  wide is what checks that nothing is cut, overlaps or scrolls sideways: add to it when
  something new has to fit.
- **Sizes that follow the figures.** The four amounts at the top are set in one size,
  made smaller together when the longest would not fit its cell (`amountSize`). A screen
  reader's table sits in an `sr-only` wrapper, never on the table itself: a table cannot
  be clipped, and one left off-screen makes a phone scroll sideways.
- **States.** Each part has its own request, a placeholder in its own shape while that
  loads (`…Skeleton`), and `SectionError` if it fails, so one failure never blanks the
  page. Keep the last figures on screen, dimmed, while a new period loads
  (`placeholderData: keepPreviousData`).
- **Labels without forms.** Take the names of expense categories and billing models from
  `expense-categories.ts` and `billing-models.ts`, not from the form schemas beside them,
  which bring the validation library with them. The dashboard is the first page people
  see, and loads neither forms nor their validation.

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

A test takes one with `shot(page, name)` from `e2e/support.ts`. For a page taller than the
window pass `{ wholePage: true }`, which makes the window as tall as the page for the
picture, so that the sidebar and the header are drawn where they belong. For a page that
is still waiting for an answer pass `{ whileLoading: true }`.

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
