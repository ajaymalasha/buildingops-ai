import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  appReady,
  filter,
  mainNavigation,
  openPage,
  organizationDay,
  segment,
  shot,
  signIn,
  toggle,
} from "./support";

/** One of the four figures for the period, found by the name it has for a screen reader. */
function figure(page: Page, name: string): Locator {
  return page.getByRole("group", { name, exact: true });
}

/** One of the counts of what needs attention today, where it leads to the records counted. */
function attention(page: Page, name: string): Locator {
  return page.getByRole("link", { name: new RegExp(`^${name}`) });
}

/** The count such a link shows: the number after its label. */
async function countOf(link: Locator): Promise<number> {
  const text = (await link.textContent()) ?? "";
  return Number(/\s([\d,]+)(\s|$)/.exec(text)?.[1]?.replace(/,/g, ""));
}

/** The list on show has exactly `count` records, by the line under it: "1–25 of 32 invoices". */
async function expectListed(page: Page, noun: string, count: number): Promise<void> {
  const line = page.getByText(new RegExp(`(of [\\d,]+|^No) ${noun}$`)).filter({ visible: true });
  await expect(line).toHaveText(
    count === 0 ? `No ${noun}` : new RegExp(`of ${count.toLocaleString("en-US")} ${noun}$`),
  );
}

/** "$351,024.60", as the dashboard writes an amount the API sent as "351024.60". */
function dollars(amount: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
    .format(Number(amount))
    .replace("-", "\u2212");
}

/** The first day of the month a number of months from this one, where the organization is. */
function monthStart(months = 0): string {
  const [year, month] = organizationDay().split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1 + months, 1)).toISOString().slice(0, 10);
}

/** "Nov": what is written under the column of the month a number of months from this one. */
function monthName(months = 0): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(`${monthStart(months)}T00:00:00Z`),
  );
}

/** The day before a day. */
function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The month before this one, first day to last: what the dashboard opens on. */
function lastMonth(): { from: string; to: string } {
  return { from: monthStart(-1), to: dayBefore(monthStart()) };
}

/** What the API answers for a period, asked by the test as the page asks it. */
async function fromApi(page: Page, endpoint: string, query: Record<string, string>) {
  const response = await page.request.get(
    `/api/v1/dashboard/${endpoint}?${new URLSearchParams(query).toString()}`,
  );
  expect(response.status(), endpoint).toBe(200);
  return response.json();
}

/** The whole page, and then each screenful of it at full size, to be looked at closely. */
async function shots(page: Page, name: string): Promise<void> {
  if (!process.env.E2E_SCREENSHOT_DIR) return;
  // The pointer is parked in the corner of the window: left where it last clicked, it
  // would point at whatever scrolls under it, and a chart would show a month's figures.
  await page.mouse.move(0, 0);
  await shot(page, name, { wholePage: true });
  const height = page.viewportSize()!.height;
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  // Each screenful starts a little before the last one ended: the header covers the top.
  for (let top = 0, part = 0; top < total - 80; top += height - 80, part += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), top);
    await shot(page, `${name}-${String.fromCharCode(97 + part)}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** How much wider the page is than the window: what would scroll sideways. */
async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * How far the text in each of these runs past the right edge of its own box, in pixels.
 * An amount too long for its cell is drawn over the cell beside it, and the page is no
 * wider for it: only measuring the text shows it.
 */
async function overrun(cells: Locator): Promise<number[]> {
  return cells.evaluateAll((elements) =>
    elements.map((element) => {
      const edge = element.getBoundingClientRect().right;
      let furthest = edge;
      const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        // What is there for a screen reader alone takes no room on the screen.
        if (text.parentElement?.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        furthest = Math.max(furthest, range.getBoundingClientRect().right);
      }
      return Math.round(furthest - edge);
    }),
  );
}

test.describe("the dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  test("shows a company admin what the business earned, spent and is waiting on", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
    // It opens on the last month that is over, compared with the days just before it.
    await expect(segment(page, "Last month")).toBeChecked();
    const period = lastMonth();
    const summary = await fromApi(page, "summary", period);
    expect(summary.period).toMatchObject({ start: period.from, end: period.to });
    expect(summary.previous_period.end).toBe(dayBefore(period.from));

    // --- the four figures are the API's, to the cent, with how each moved ---
    await expect(figure(page, "Revenue")).toContainText(dollars(summary.revenue.value));
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(summary.operating_cost.value),
    );
    await expect(figure(page, "Margin")).toContainText(dollars(summary.margin.value));
    await expect(figure(page, "Margin")).toContainText(
      `${summary.margin_percent.value.replace("-", "\u2212")}% of revenue`,
    );
    await expect(figure(page, "Collected")).toContainText(dollars(summary.collected.value));
    await expect(figure(page, "Revenue")).toContainText(/(Up|Down) [\d,.]+%/);
    await expect(figure(page, "Revenue")).toContainText(
      `from ${dollars(summary.revenue.previous)}`,
    );
    // The demo organization has a real month behind it, not a row of zeros.
    expect(Number(summary.revenue.value)).toBeGreaterThan(100_000);
    expect(Number(summary.operating_cost.value)).toBeGreaterThan(100_000);

    // --- what needs attention is as of today, whatever the period ---
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    expect(await countOf(attention(page, "Outstanding invoices"))).toBe(
      summary.invoices_outstanding.count,
    );
    await expect(attention(page, "Outstanding invoices")).toContainText(
      `${dollars(summary.invoices_outstanding.amount)} owed`,
    );
    expect(await countOf(attention(page, "Overdue invoices"))).toBe(summary.invoices_overdue.count);
    await expect(attention(page, "Overdue invoices")).toContainText(
      `${dollars(summary.invoices_overdue.amount)} past due`,
    );
    expect(await countOf(attention(page, "Pending timesheets"))).toBe(
      summary.timesheets_pending.count,
    );
    expect(await countOf(attention(page, "Pending expenses"))).toBe(summary.expenses_pending.count);
    await expect(attention(page, "Pending expenses")).toContainText(
      dollars(summary.expenses_pending.amount),
    );
    expect(await countOf(attention(page, "Open work orders"))).toBe(summary.work_orders_open);
    expect(await countOf(attention(page, "Overdue work orders"))).toBe(summary.work_orders_overdue);
    expect(summary.invoices_overdue.count).toBeGreaterThan(0);
    expect(summary.work_orders_overdue).toBeGreaterThan(0);

    // --- twelve months of revenue against cost, the one still running among them ---
    const chart = page.getByRole("img", { name: /^Revenue and operating cost by month/ });
    await expect(chart).toBeVisible();
    // The same in a table, for those who cannot see the drawing.
    const months = page.getByRole("table", {
      name: "Revenue and operating cost by month",
      exact: true,
    });
    await expect(months.getByRole("row")).toHaveCount(13);
    await expect(months.getByRole("row").last()).toContainText(/, to [A-Z][a-z]{2} \d+/);
    const trends = await fromApi(page, "trends", {});
    expect(trends.months).toHaveLength(12);
    expect(trends.months[10].month).toBe(period.from);
    // Last month's bar is the month in the figures above it.
    expect(trends.months[10].revenue).toBe(summary.revenue.value);
    expect(trends.months[10].operating_cost).toBe(summary.operating_cost.value);
    await expect(months.getByRole("row").nth(11)).toContainText(dollars(summary.revenue.value));

    // --- the contracts come to a total, and the total is the figures at the top ---
    const profitability = await fromApi(page, "contracts", period);
    const contracts = page.getByRole("table", { name: /^Contract profitability/ });
    await expect(contracts.getByRole("row")).toHaveCount(profitability.contracts.length + 3);
    expect(profitability.contracts.length).toBeGreaterThan(8);
    // The largest margin comes first.
    await expect(contracts.getByRole("row").nth(1)).toContainText(
      profitability.contracts[0].contract.contract_number,
    );
    await expect(contracts.getByRole("row").nth(1)).toContainText(
      dollars(profitability.contracts[0].margin),
    );
    await expect(
      contracts.getByRole("row", { name: /^Not attributed to a contract/ }),
    ).toContainText(dollars(profitability.unattributed.operating_cost));
    const total = contracts.getByRole("row", { name: /^Total/ });
    await expect(total).toContainText(dollars(summary.revenue.value));
    await expect(total).toContainText(dollars(summary.operating_cost.value));
    await expect(total).toContainText(dollars(summary.margin.value));

    // --- where the cost goes comes to the operating cost too ---
    const costs = page.getByRole("table", { name: "Operating cost by category" });
    await expect(costs.getByRole("row", { name: /^Labor/ })).toContainText(
      dollars(summary.labor_cost.value),
    );
    await expect(costs.getByRole("row", { name: /^Operating cost/ })).toContainText(
      dollars(summary.operating_cost.value),
    );
    const costliest = page.getByRole("table", { name: "Costliest buildings" });
    await expect(costliest.getByRole("row")).toHaveCount(6);
    // With room for it, the hours worked at each have a column of their own.
    await expect(costliest.getByRole("columnheader", { name: "Hours" })).toBeVisible();
    await expect(costliest.getByText(/^[\d,.]+ hours$/).first()).toBeHidden();
    const comparison = await fromApi(page, "buildings", period);
    await expect(costliest.getByRole("row").nth(1)).toContainText(
      comparison.buildings[0].building.name,
    );
    await expect(costliest.getByRole("row").nth(1)).toContainText(
      dollars(comparison.buildings[0].operating_cost),
    );

    // --- the work: what is open today, and what was opened and finished each month ---
    const backlog = page.getByRole("table", { name: "Open work orders by status, as of today" });
    await expect(backlog.getByRole("row", { name: /^Open work orders/ })).toContainText(
      `${summary.work_orders_overdue} overdue`,
    );
    await expect(
      backlog.getByRole("row", { name: /^Open work orders/ }).getByRole("cell"),
    ).toHaveText(String(summary.work_orders_open));
    await expect(
      page.getByRole("img", { name: /^Work orders opened and completed by month/ }),
    ).toBeVisible();
    await expect(page.getByText("How these figures are counted")).toBeVisible();
    await shots(page, "90-dashboard");

    // --- pointing at a month shows its figures: the ones in the table ---
    await chart.scrollIntoViewIfNeeded();
    await chart.locator("[data-point]").nth(6).hover();
    const pointedAt = months.getByRole("row").nth(7);
    await expect(chart).toContainText((await pointedAt.getByRole("rowheader").textContent())!);
    for (const cell of await pointedAt.getByRole("cell").allTextContents()) {
      await expect(chart).toContainText(cell);
    }
    await expect(chart.getByText("Operating cost")).toBeVisible();
    await shot(page, "91-figures-of-a-month");
  });

  test("follows a change of period, of customer and of building in its address", async ({
    page,
  }) => {
    const revenue = figure(page, "Revenue");
    await expect(revenue).toContainText("$");
    const lastMonths = (await revenue.textContent())!;
    const today = organizationDay();
    const year = today.slice(0, 4);
    const month = Number(today.slice(5, 7));

    // --- each period: the address says which, and the figures are the API's for it ---
    await segment(page, "This month").click();
    await expect(page).toHaveURL(/\/\?period=this_month$/);
    await expect(segment(page, "This month")).toBeChecked();
    await expect(revenue).not.toHaveText(lastMonths);
    const thisMonth = await fromApi(page, "summary", { from: monthStart(), to: today });
    await expect(revenue).toContainText(dollars(thisMonth.revenue.value));
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(thisMonth.operating_cost.value),
    );
    await shot(page, "92-this-month", { wholePage: true });

    await segment(page, "This quarter").click();
    await expect(page).toHaveURL(/\/\?period=this_quarter$/);
    const thisQuarter = await fromApi(page, "summary", {
      from: monthStart(-((month - 1) % 3)),
      to: today,
    });
    await expect(revenue).toContainText(dollars(thisQuarter.revenue.value));
    await expect(figure(page, "Margin")).toContainText(dollars(thisQuarter.margin.value));
    await shot(page, "93-this-quarter", { wholePage: true });

    await segment(page, "Year to date").click();
    await expect(page).toHaveURL(/\/\?period=year_to_date$/);
    const yearToDate = await fromApi(page, "summary", { from: `${year}-01-01`, to: today });
    await expect(revenue).toContainText(dollars(yearToDate.revenue.value));
    await expect(figure(page, "Margin")).toContainText(dollars(yearToDate.margin.value));
    await shot(page, "94-year-to-date", { wholePage: true });

    // This month so far and the eleven before it: the twelve months of the chart.
    await segment(page, "Last 12 months").click();
    await expect(page).toHaveURL(/\/\?period=last_12_months$/);
    const twelveMonths = await fromApi(page, "summary", { from: monthStart(-11), to: today });
    await expect(revenue).toContainText(dollars(twelveMonths.revenue.value));
    await expect(figure(page, "Collected")).toContainText(dollars(twelveMonths.collected.value));
    await shot(page, "95-last-12-months", { wholePage: true });

    // --- a range of one's own starts as the days on show ---
    await segment(page, "Custom range").click();
    await expect(page).toHaveURL(
      new RegExp(`\\?period=custom&from=${monthStart(-11)}&to=${today}$`),
    );
    const rangeFrom = page.getByLabel("Range from");
    const rangeTo = page.getByLabel("Range to");
    await expect(rangeFrom).toHaveValue(monthStart(-11));
    await expect(rangeTo).toHaveValue(today);
    // The three months before this one.
    const range = { from: monthStart(-3), to: dayBefore(monthStart()) };
    await rangeTo.fill(range.to);
    await rangeFrom.fill(range.from);
    await expect(page).toHaveURL(new RegExp(`&from=${range.from}&to=${range.to}$`));
    const custom = await fromApi(page, "summary", range);
    await expect(revenue).toContainText(dollars(custom.revenue.value));
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(custom.operating_cost.value),
    );
    // It is compared with as many days just before it.
    expect(custom.previous_period.days).toBe(custom.period.days);
    await shot(page, "96-custom-range", { wholePage: true });
    // A start moved past the end takes the end along: the range never runs backwards.
    await rangeFrom.fill(today);
    await expect(rangeTo).toHaveValue(today);
    await expect(page).toHaveURL(new RegExp(`&from=${today}&to=${today}$`));

    // The default leaves nothing in the address.
    await segment(page, "Last month").click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(revenue).toHaveText(lastMonths);

    // --- one customer ---
    await filter(page, "Filter by customer").selectOption({ label: "Calloway Property Group" });
    await expect(page).toHaveURL(/\/\?customer_id=[0-9a-f-]{36}$/);
    const customerId = new URL(page.url()).searchParams.get("customer_id")!;
    const period = lastMonth();
    const customers = await fromApi(page, "summary", { ...period, customer_id: customerId });
    await expect(revenue).toContainText(dollars(customers.revenue.value));
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(customers.operating_cost.value),
    );
    await expect(revenue).not.toHaveText(lastMonths);
    expect(Number(customers.revenue.value)).toBeGreaterThan(0);
    await expect(
      page.getByText("Employees and vendors are counted for the whole organization."),
    ).toBeVisible();
    // Only this customer's contracts are in the table, and they still come to the total.
    const contracts = page.getByRole("table", { name: /^Contract profitability/ });
    await expect(contracts.getByRole("row", { name: /Calloway Property Group/ })).toHaveCount(2);
    await expect(contracts.getByRole("row", { name: /Janitorial Services Agreement/ })).toHaveCount(
      1,
    );
    await expect(contracts.getByRole("row", { name: /^Total/ })).toContainText(
      dollars(customers.revenue.value),
    );
    // Invoices are listed by customer, so those counts still lead somewhere. Work orders
    // and approvals are listed by building, so theirs are figures and nothing more.
    await expect(attention(page, "Outstanding invoices")).toHaveAttribute(
      "href",
      `/invoices?status=issued&customer_id=${customerId}`,
    );
    await expect(attention(page, "Open work orders")).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: /^Open work orders/ })).toContainText(
      String(customers.work_orders_open),
    );
    await shot(page, "97-one-customer", { wholePage: true });

    // --- one of that customer's buildings ---
    const buildings = filter(page, "Filter by building");
    await expect(buildings.getByRole("option")).toHaveText([
      "All buildings",
      "Calloway Annex",
      "Calloway Tower",
      "Marlow Place Offices",
      "One Granite Plaza",
    ]);
    await buildings.selectOption({ label: "Calloway Tower" });
    await expect(page).toHaveURL(/\/\?customer_id=[0-9a-f-]{36}&building_id=[0-9a-f-]{36}$/);
    const buildingId = new URL(page.url()).searchParams.get("building_id")!;
    const towers = await fromApi(page, "summary", {
      ...period,
      customer_id: customerId,
      building_id: buildingId,
    });
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(towers.operating_cost.value),
    );
    expect(Number(towers.operating_cost.value)).toBeGreaterThan(0);
    expect(Number(towers.operating_cost.value)).toBeLessThan(
      Number(customers.operating_cost.value),
    );
    // Revenue cannot be narrowed to a building, only to the contracts that cover it. The
    // page says so rather than pass one off as the other.
    expect(towers.scope.by_contract).toContain("revenue");
    await expect(
      page.getByText(/are those of the contracts that cover Calloway Tower, in full/),
    ).toBeVisible();
    await expect(
      page.getByText(/not narrowed to Calloway Tower$/).filter({ visible: true }),
    ).toHaveCount(2);
    // The building is the customer's, so its work orders are a list that can be shown.
    await expect(attention(page, "Open work orders")).toHaveAttribute(
      "href",
      `/work-orders?building_id=${buildingId}`,
    );
    expect(await countOf(attention(page, "Open work orders"))).toBe(towers.work_orders_open);
    await expect(attention(page, "Outstanding invoices")).toHaveCount(0);
    await shot(page, "97a-one-building", { wholePage: true });

    // The count leads to exactly that building's backlog.
    await attention(page, "Open work orders").click();
    await expect(page).toHaveURL(new RegExp(`/work-orders\\?building_id=${buildingId}$`));
    await expect(filter(page, "Filter by building").locator("option:checked")).toHaveText(
      "Calloway Tower",
    );
    await expectListed(page, "work orders", towers.work_orders_open);
    await page.goBack();
    await expect(figure(page, "Operating cost")).toContainText(
      dollars(towers.operating_cost.value),
    );

    // --- a customer with nothing on the books: no buildings, and a contract still in draft ---
    await filter(page, "Filter by customer").selectOption({ label: "Thornbury Civic Foundation" });
    await expect(
      page.getByRole("heading", { name: "Nothing recorded for this selection" }),
    ).toBeVisible();
    // Not four zeros and an empty chart. The filters stay, to be changed or cleared.
    await expect(page.getByRole("group", { name: "Revenue" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /by month/ })).toHaveCount(0);
    await expect(filter(page, "Filter by customer").locator("option:checked")).toHaveText(
      "Thornbury Civic Foundation",
    );
    await expect(segment(page, "Last month")).toBeChecked();
    await shot(page, "97b-nothing-for-this-selection");

    // Another customer's buildings are other buildings: the building does not stay chosen.
    await filter(page, "Filter by customer").selectOption({ label: "Larkspur Medical Partners" });
    await expect(page).toHaveURL(/\/\?customer_id=[0-9a-f-]{36}$/);
    await expect(filter(page, "Filter by building")).toHaveValue("");
    await expect(revenue).toContainText("$");

    // The address is the state: it survives a reload. Clearing the filters keeps the period.
    await segment(page, "Year to date").click();
    await expect(page).toHaveURL(/customer_id=[0-9a-f-]{36}&period=year_to_date$/);
    await page.reload();
    await expect(segment(page, "Year to date")).toBeChecked();
    await expect(filter(page, "Filter by customer").locator("option:checked")).toHaveText(
      "Larkspur Medical Partners",
    );
    await expect(revenue).toContainText("$");
    await expect(revenue).not.toContainText(dollars(yearToDate.revenue.value));
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/\?period=year_to_date$/);
    await expect(revenue).toContainText(dollars(yearToDate.revenue.value));
  });

  test("leads from each count to the list of exactly those records", async ({ page }) => {
    const back = async () => {
      await mainNavigation(page).getByRole("link", { name: "Overview", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    };

    // --- overdue invoices ---
    const overdue = await countOf(attention(page, "Overdue invoices"));
    expect(overdue).toBeGreaterThan(0);
    await attention(page, "Overdue invoices").click();
    await expect(page).toHaveURL(/\/invoices\?overdue=true$/);
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
    await expect(toggle(page, "Overdue only")).toBeChecked();
    await expectListed(page, "invoices", overdue);
    await expect(page.getByRole("row").nth(1)).toContainText(/\d+ days? overdue/);
    // The pointer is still where the count was, and a row of the list is under it now.
    await page.mouse.move(0, 0);
    await shot(page, "98b-a-count-followed-to-its-list");

    // --- outstanding invoices: issued, with something still owed ---
    await back();
    const outstanding = await countOf(attention(page, "Outstanding invoices"));
    expect(outstanding).toBeGreaterThanOrEqual(overdue);
    await attention(page, "Outstanding invoices").click();
    await expect(page).toHaveURL(/\/invoices\?status=issued$/);
    await expect(filter(page, "Filter by status")).toHaveValue("issued");
    await expectListed(page, "invoices", outstanding);

    // --- the work order backlog, and what is overdue in it ---
    await back();
    const open = await countOf(attention(page, "Open work orders"));
    const late = await countOf(attention(page, "Overdue work orders"));
    expect(late).toBeGreaterThan(0);
    await attention(page, "Open work orders").click();
    await expect(page).toHaveURL(/\/work-orders$/);
    await expect(segment(page, "Backlog")).toBeChecked();
    await expectListed(page, "work orders", open);
    await back();
    await attention(page, "Overdue work orders").click();
    await expect(page).toHaveURL(/\/work-orders\?overdue=true$/);
    await expect(toggle(page, "Overdue only")).toBeChecked();
    await expectListed(page, "work orders", late);

    // --- what is waiting for approval ---
    await back();
    const timesheets = await countOf(attention(page, "Pending timesheets"));
    const expenses = await countOf(attention(page, "Pending expenses"));
    expect(timesheets).toBeGreaterThan(0);
    await attention(page, "Pending timesheets").click();
    await expect(page).toHaveURL(/\/timesheets$/);
    await expect(segment(page, /^Pending/)).toBeChecked();
    await expect(segment(page, /^Pending/)).toHaveText(
      new RegExp(`^Pending\\s*${timesheets.toLocaleString("en-US")}$`),
    );
    await back();
    await attention(page, "Pending expenses").click();
    await expect(page).toHaveURL(/\/expenses\?status=pending$/);
    await expect(filter(page, "Filter by status")).toHaveValue("pending");
    await expectListed(page, "expenses", expenses);

    // --- and the buildings that are active, beside the page's heading ---
    await back();
    const active = page.getByRole("link", { name: /^[\d,]+$/ }).first();
    const count = Number((await active.textContent())!.replace(/,/g, ""));
    await active.click();
    await expect(page).toHaveURL(/\/buildings\?status=active$/);
    await expect(filter(page, "Filter by status")).toHaveValue("active");
    await expectListed(page, "buildings", count);
  });
});

test.describe("the dashboard while it loads, and when part of it cannot", () => {
  test("shows the shape of the report while its figures are on their way", async ({ page }) => {
    // Every answer is held back until the page has been looked at.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/dashboard/**", async (route) => {
      await held;
      await route.continue();
    });
    await signIn(page, ACCOUNTS.admin);

    // The page is laid out as it will be: its controls and the heading of every part.
    await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
    await expect(segment(page, "Last month")).toBeChecked();
    for (const name of [
      "Needs attention",
      "Revenue and operating cost",
      "Contract profitability",
      "Where the cost goes",
      "Costliest buildings",
      "Open work orders",
      "Work orders opened and completed",
    ]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
    // No figure yet, and no zero standing in for one.
    await expect(page.getByRole("group", { name: "Revenue" })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("$");
    await shot(page, "98c-while-loading", { wholePage: true, whileLoading: true });

    release();
    await expect(figure(page, "Revenue")).toContainText("$");
    await expect(page.getByRole("table", { name: /^Contract profitability/ })).toBeVisible();
  });

  test("says so where a part cannot be loaded, and shows the rest", async ({ page }) => {
    // The contracts cannot be had, as when the API is out of reach for a moment.
    let reachable = false;
    await page.route("**/api/v1/dashboard/contracts?*", (route) =>
      reachable
        ? route.continue()
        : route.fulfill({
            status: 502,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "The API is not reachable",
              status: 502,
              code: "upstream_unavailable",
            }),
          }),
    );
    await signIn(page, ACCOUNTS.admin);

    // It is asked for again before the page gives up, so this takes a few seconds.
    const contracts = page.getByRole("region", { name: "Contract profitability" });
    await expect(contracts.getByRole("alert")).toContainText("The API is not reachable", {
      timeout: 20_000,
    });
    await expect(contracts.getByRole("table")).toHaveCount(0);
    // Every other part of the report is there, with its figures.
    await expect(figure(page, "Revenue")).toContainText("$");
    await expect(attention(page, "Outstanding invoices")).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^Revenue and operating cost by month/ }),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Operating cost by category" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Costliest buildings" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(1);
    await shot(page, "98d-a-part-that-did-not-load", { wholePage: true });

    // Asked again once the API is back, the part fills in.
    reachable = true;
    await contracts.getByRole("button", { name: "Try again" }).click();
    await expect(contracts.getByRole("table")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
});

test.describe("who gets the dashboard", () => {
  test("an operations manager does", async ({ page }) => {
    await signIn(page, ACCOUNTS.manager);
    await expect(page.getByRole("heading", { name: "Welcome back, Marcus" })).toBeVisible();
    const summary = await fromApi(page, "summary", lastMonth());
    await expect(figure(page, "Revenue")).toContainText(dollars(summary.revenue.value));
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /^Revenue and operating cost by month/ }),
    ).toBeVisible();
  });

  test("a supervisor keeps the overview as it was, and the API refuses the figures", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.supervisor);
    await expect(page.getByRole("heading", { name: "Welcome back, Priya" })).toBeVisible();
    await expect(page.getByText("You're working in Meridian Facility Services.")).toBeVisible();
    // What was there before: what happened lately, the organization, and her own access.
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    await expect(page.getByText("Activity is visible to managers")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Organization", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your access" })).toBeVisible();
    await expect(page.getByText("Approve and reject timesheets")).toBeVisible();
    // And nothing of the dashboard: no figures, no period, no charts.
    await expect(page.getByRole("group", { name: "Revenue" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Period" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /by month/ })).toHaveCount(0);
    await expect(page.getByText("See revenue, costs and margins on the dashboard")).toHaveCount(0);
    await shot(page, "98a-supervisor-overview");

    // Hiding it is a convenience. The API is what refuses.
    const period = lastMonth();
    for (const endpoint of ["summary", "contracts", "buildings", "work-orders"]) {
      const refused = await page.request.get(
        `/api/v1/dashboard/${endpoint}?from=${period.from}&to=${period.to}`,
      );
      expect(refused.status(), endpoint).toBe(403);
      expect((await refused.json()).code, endpoint).toBe("permission_denied");
    }
    expect((await page.request.get("/api/v1/dashboard/trends")).status()).toBe(403);
  });

  test("an organization with nothing on its books is told what will appear, and where to start", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.platform);
    await openPage(page, "Organizations");
    await page.getByRole("button", { name: "New organization" }).click();
    const dialog = page.getByRole("dialog", { name: "New organization" });
    await dialog.getByLabel("Name", { exact: true }).fill("Juniper Hill Services");
    await dialog.getByLabel("Full name").fill("Rosa Juniper");
    await dialog.getByLabel("Work email").fill("rosa.juniper@juniperhill.example");
    await dialog.getByRole("button", { name: "Generate" }).click();
    await dialog.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByText("Juniper Hill Services was created")).toBeVisible();
    await page.getByRole("button", { name: "Actions for Juniper Hill Services" }).click();
    await page.getByRole("menuitem", { name: "Open this organization" }).click();

    await expect(page.getByText("You're working in Juniper Hill Services.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing to report yet" })).toBeVisible();
    await expect(
      page.getByText(
        "Revenue, costs and margins appear here once Juniper Hill Services has approved time and expenses, invoices and work orders.",
      ),
    ).toBeVisible();
    // Not a wall of zeros, and nothing to choose a period of.
    await expect(page.getByRole("group", { name: "Revenue" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Period" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /by month/ })).toHaveCount(0);
    // The API answers all the same, with zeros and with no percentage made up.
    const summary = await fromApi(page, "summary", lastMonth());
    expect(summary.revenue).toEqual({
      value: "0.00",
      previous: "0.00",
      change: "0.00",
      change_percent: null,
    });
    expect(summary.margin_percent.value).toBeNull();
    await shot(page, "98-empty-organization");

    await page.getByRole("link", { name: "Start with customers" }).click();
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
  });
});

test.describe("the dashboard on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("fits the screen, with the period in a menu", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    const revenue = figure(page, "Revenue");
    await expect(revenue).toContainText("$");
    await expect(figure(page, "Collected")).toBeVisible();
    await expect(attention(page, "Overdue work orders")).toBeVisible();

    // Six choices do not fit in a row here, so the period is a menu.
    await expect(page.getByRole("radiogroup", { name: "Period" })).toBeHidden();
    const period = page.getByRole("combobox", { name: "Period" });
    await expect(period).toHaveValue("last_month");
    const lastMonths = (await revenue.textContent())!;
    await period.selectOption({ label: "This quarter" });
    await expect(page).toHaveURL(/\/\?period=this_quarter$/);
    await expect(revenue).not.toHaveText(lastMonths);
    await period.selectOption({ label: "Last month" });
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(revenue).toHaveText(lastMonths);

    // The contracts table folds: revenue and cost go under the contract's name.
    const total = page
      .getByRole("table", { name: /^Contract profitability/ })
      .getByRole("row", { name: /^Total/ });
    await expect(total.getByText(/^Revenue \$[\d,.]+$/)).toBeVisible();
    await expect(total.getByText(/^Cost \$[\d,.]+$/)).toBeVisible();
    // So does the comparison of buildings: the hours go under each building's cost.
    const costliest = page.getByRole("table", { name: "Costliest buildings" });
    await expect(costliest.getByRole("columnheader", { name: "Hours" })).toHaveCount(0);
    await expect(costliest.getByText(/^[\d,.]+ hours$/)).toHaveCount(5);
    await expect(costliest.getByText(/^[\d,.]+ hours$/).first()).toBeVisible();
    // Nothing is wider than the screen.
    expect(await sidewaysScroll(page)).toBe(0);
    await shots(page, "99-phone");

    // Pointing at a month shows its figures inside the chart, where they fit.
    const chart = page.getByRole("img", { name: /^Revenue and operating cost by month/ });
    await chart.scrollIntoViewIfNeeded();
    await chart.locator("[data-point]").nth(9).click();
    await expect(chart.getByText("Operating cost")).toBeInViewport();
    await shot(page, "99z-phone-figures-of-a-month");
  });
});

test.describe("the dashboard from a small phone to a laptop", () => {
  // Narrowest first. On the last two the sidebar is beside the page, and takes its share.
  const WINDOWS = [
    { name: "small-phone", width: 320, height: 640, everyMonthNamed: false },
    { name: "tablet", width: 768, height: 1024, everyMonthNamed: true },
    { name: "small-laptop", width: 1024, height: 768, everyMonthNamed: true },
    { name: "laptop", width: 1280, height: 800, everyMonthNamed: true },
  ];

  test("keeps every figure whole, and is never wider than the window", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    // The most there is to fit: a range of one's own, which adds two date fields to the
    // controls, over the twelve months in which the demo's amounts run to millions.
    const address = `/?period=custom&from=${monthStart(-11)}&to=${organizationDay()}`;
    const figures = page.getByRole("group", {
      name: /^(Revenue|Operating cost|Margin|Collected)$/,
    });
    const counts = page.getByRole("region", { name: "Needs attention" }).getByRole("listitem");

    for (const { name, width, height, everyMonthNamed } of WINDOWS) {
      await page.setViewportSize({ width, height });
      // Loaded at this width, as on such a screen, rather than resized to it.
      await page.goto(address);
      await appReady(page);
      await expect(figure(page, "Revenue")).toContainText(/\$\d,\d{3},\d{3}\.\d\d/);
      await expect(figures).toHaveCount(4);
      await expect(counts).toHaveCount(6);
      await expect(page.getByRole("table", { name: /^Contract profitability/ })).toBeVisible();
      await expect(page.getByRole("table", { name: "Costliest buildings" })).toBeVisible();
      await expect(
        page.getByRole("img", { name: /^Work orders opened and completed by month/ }),
      ).toBeVisible();

      expect(await overrun(figures), `the period's figures at ${width} pixels`).toEqual([
        0, 0, 0, 0,
      ]);
      expect(await overrun(counts), `what needs attention at ${width} pixels`).toEqual([
        0, 0, 0, 0, 0, 0,
      ]);
      expect(await sidewaysScroll(page), `sideways scroll at ${width} pixels`).toBe(0);
      // Under columns too narrow for a name each, every other month goes without one:
      // the month before this one does, and this one never.
      const months = page.getByRole("figure").first();
      await expect(months.getByText(monthName(), { exact: true })).toBeVisible();
      await expect(months.getByText(monthName(-1), { exact: true })).toBeVisible({
        visible: everyMonthNamed,
      });
      await shot(page, `99w-${String(width).padStart(4, "0")}-${name}`, { wholePage: true });
    }
  });
});
