import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DashboardBuildings,
  DashboardContracts,
  DashboardSummary,
  DashboardTrends,
  DashboardWorkOrders,
  MoneyFigure,
  ProfitLine,
} from "@/lib/api/types";

import { ContractsTable } from "./contracts-table";
import { CostByCategory, CostliestBuildings } from "./cost-breakdown";
import { figureLinks } from "./dashboard-links";
import { AttentionBand, Footprint, HeadlineBand, isNegative } from "./headline-band";
import { MoneyTrendChart, WorkTrendChart } from "./trend-chart";
import { WorkBacklog } from "./work-backlog";

const MINUS = "\u2212";

const money = (
  value: string,
  previous: string,
  change: string,
  percent: string | null,
): MoneyFigure => ({ value, previous, change, change_percent: percent });

/** October 2026 at Meridian, as the API answers for it. */
const october: DashboardSummary = {
  period: { start: "2026-10-01", end: "2026-10-31", days: 31 },
  previous_period: { start: "2026-08-31", end: "2026-09-30", days: 31 },
  as_of: "2026-11-26",
  currency: "USD",
  scope: { building_id: null, customer_id: null, organization_wide: [], by_contract: [] },
  revenue: money("351024.60", "358844.18", "-7819.58", "-2.2"),
  labor_cost: money("289644.87", "297943.79", "-8298.92", "-2.8"),
  expense_cost: money("58535.52", "40289.09", "18246.43", "45.3"),
  operating_cost: money("348180.39", "338232.88", "9947.51", "2.9"),
  margin: money("2844.21", "20611.30", "-17767.09", "-86.2"),
  margin_percent: { value: "0.8", previous: "5.7", change: "-4.9" },
  collected: money("306385.79", "419165.88", "-112780.09", "-26.9"),
  work_orders_completed: { value: 44, previous: 34, change: 10, change_percent: "29.4" },
  cost_by_category: [
    { category: "labor", amount: "289644.87", share_percent: "83.2" },
    { category: "materials", amount: "14622.19", share_percent: "4.2" },
    { category: "equipment", amount: "13643.08", share_percent: "3.9" },
    { category: "subcontractor", amount: "26251.43", share_percent: "7.5" },
    { category: "supplies", amount: "4018.82", share_percent: "1.2" },
    { category: "travel", amount: "0.00", share_percent: "0.0" },
    { category: "other", amount: "0.00", share_percent: "0.0" },
  ],
  invoices_outstanding: { count: 17, amount: "489240.51" },
  invoices_overdue: { count: 6, amount: "136357.24" },
  work_orders_open: 32,
  work_orders_overdue: 10,
  timesheets_pending: { count: 1263, hours: "1913.00" },
  expenses_pending: { count: 41, amount: "31519.51" },
  buildings: { total: 30, active: 25 },
  employees: { total: 91, active: 79 },
  vendors: { total: 14, active: 11 },
};

/** A figure of the band, found by the name it is given to assistive technology. */
const figure = (name: string) => screen.getByRole("group", { name });

describe("the headline band", () => {
  it("shows what was earned, spent, kept and collected, to the cent", () => {
    render(<HeadlineBand summary={october} />);

    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"))).toEqual([
      "Revenue",
      "Operating cost",
      "Margin",
      "Collected",
    ]);
    expect(figure("Revenue")).toHaveTextContent("$351,024.60");
    expect(figure("Operating cost")).toHaveTextContent("$348,180.39");
    expect(figure("Margin")).toHaveTextContent("$2,844.21");
    expect(figure("Collected")).toHaveTextContent("$306,385.79");
    // Margin says what share of revenue it is. The others have no such share.
    expect(figure("Margin")).toHaveTextContent("0.8% of revenue");
    expect(figure("Revenue")).not.toHaveTextContent("of revenue");
  });

  it("says which way each figure moved, by how much, and from what", () => {
    render(<HeadlineBand summary={october} />);

    // The direction is in words for a screen reader. The arrow says it to the eye.
    expect(figure("Revenue")).toHaveTextContent("Down 2.2% from $358,844.18");
    expect(figure("Operating cost")).toHaveTextContent("Up 2.9% from $338,232.88");
    expect(figure("Margin")).toHaveTextContent("Down 86.2% from $20,611.30");
    expect(figure("Collected")).toHaveTextContent("Down 26.9% from $419,165.88");
    // A percentage is a size: the sign is the arrow's to give.
    expect(figure("Revenue")).not.toHaveTextContent(MINUS);
  });

  it("gives the amount when a figure rose from nothing, and says so when nothing moved", () => {
    render(
      <HeadlineBand
        summary={{
          ...october,
          revenue: money("1000.00", "0.00", "1000.00", null),
          operating_cost: money("250.00", "250.00", "0.00", "0.0"),
          collected: money("0.00", "0.00", "0.00", null),
        }}
      />,
    );

    // There is no percentage of nothing.
    expect(figure("Revenue")).toHaveTextContent("Up $1,000.00 from $0.00");
    expect(figure("Revenue")).not.toHaveTextContent("%");
    expect(figure("Operating cost")).toHaveTextContent("No change from $250.00");
    expect(figure("Collected")).toHaveTextContent("No change from $0.00");
    expect(figure("Collected")).not.toHaveTextContent(/Up|Down/);
  });

  it("sets a loss in the critical colour, and nothing else", () => {
    render(
      <HeadlineBand
        summary={{
          ...october,
          margin: money("-203280.74", "-447300.75", "244020.01", "54.6"),
          margin_percent: { value: "-6.3", previous: "-243.8", change: "237.5" },
        }}
      />,
    );

    const margin = figure("Margin");
    expect(within(margin).getByText(`${MINUS}$203,280`)).toHaveClass("text-critical");
    expect(within(margin).getByText(`${MINUS}6.3%`)).toHaveClass("text-critical");
    // It is up, from a larger loss. A change is not a loss, whichever way it goes.
    expect(margin).toHaveTextContent(`Up 54.6% from ${MINUS}$447,300.75`);
    expect(within(margin).getByText("54.6%")).not.toHaveClass("text-critical");
    expect(within(figure("Revenue")).getByText("$351,024")).not.toHaveClass("text-critical");
    expect(within(figure("Revenue")).getByText("2.2%")).not.toHaveClass("text-critical");
  });

  it("leaves the share of revenue out when there is no revenue to take it of", () => {
    render(
      <HeadlineBand
        summary={{
          ...october,
          revenue: money("0.00", "0.00", "0.00", null),
          margin: money("-125.00", "0.00", "-125.00", null),
          margin_percent: { value: null, previous: null, change: null },
        }}
      />,
    );

    expect(figure("Margin")).toHaveTextContent(`${MINUS}$125.00`);
    expect(figure("Margin")).not.toHaveTextContent("of revenue");
    expect(figure("Margin")).toHaveTextContent("Down $125.00 from $0.00");
  });

  it("sets the four amounts in one size, small enough for the longest to fit its cell", () => {
    const amounts = () =>
      screen
        .getAllByRole("group")
        .map((group) => (group.children[1] as HTMLElement).style.fontSize);
    const { rerender } = render(<HeadlineBand summary={october} />);

    // "$351,024.60" is the longest, at eleven characters of 0.48em at most: 5.28em in
    // all, in a cell less its inset. Never larger than the design's 1.625rem.
    const size = "clamp(1rem, calc((var(--cell) - 2.5rem) / 5.28), 1.625rem)";
    expect(amounts()).toEqual([size, size, size, size]);

    // Millions are longer, so all four give way together, the short ones included.
    rerender(
      <HeadlineBand
        summary={{ ...october, revenue: money("12351024.60", "0.00", "12351024.60", null) }}
      />,
    );
    const smaller = "clamp(1rem, calc((var(--cell) - 2.5rem) / 6.72), 1.625rem)";
    expect(amounts()).toEqual([smaller, smaller, smaller, smaller]);
  });

  it("tells a figure below zero from one that is not, without making it a number", () => {
    expect(isNegative("-0.01")).toBe(true);
    expect(isNegative("-203280.74")).toBe(true);
    expect(isNegative("0.00")).toBe(false);
    expect(isNegative("-0.00")).toBe(false);
    expect(isNegative("2844.21")).toBe(false);
  });
});

describe("what needs attention", () => {
  const item = (name: RegExp) => screen.getByRole("link", { name });

  it("counts what is waiting today, with what is owed and how many hours", () => {
    render(<AttentionBand summary={october} links={figureLinks({})} />);

    expect(screen.getAllByRole("listitem").map((entry) => entry.textContent)).toEqual([
      "Outstanding invoices 17 $489,240.51 owed",
      "Overdue invoices 6 $136,357.24 past due",
      "Pending timesheets 1,263 1,913.00 hours",
      "Pending expenses 41 $31,519.51",
      "Open work orders 32 ",
      "Overdue work orders 10 ",
    ]);
  });

  it("links each count to the list of exactly those records", () => {
    render(<AttentionBand summary={october} links={figureLinks({})} />);

    expect(item(/^Outstanding invoices/)).toHaveAttribute("href", "/invoices?status=issued");
    expect(item(/^Overdue invoices/)).toHaveAttribute("href", "/invoices?overdue=true");
    expect(item(/^Pending timesheets/)).toHaveAttribute("href", "/timesheets");
    expect(item(/^Pending expenses/)).toHaveAttribute("href", "/expenses?status=pending");
    expect(item(/^Open work orders/)).toHaveAttribute("href", "/work-orders");
    expect(item(/^Overdue work orders/)).toHaveAttribute("href", "/work-orders?overdue=true");
  });

  it("narrows the links as the dashboard is narrowed, and drops the ones no list can follow", () => {
    const building = "01a21553-ccf9-7334-afae-c75e504000f6";
    render(<AttentionBand summary={october} links={figureLinks({ buildingId: building })} />);

    expect(item(/^Open work orders/)).toHaveAttribute(
      "href",
      `/work-orders?building_id=${building}`,
    );
    expect(item(/^Pending timesheets/)).toHaveAttribute(
      "href",
      `/timesheets?building_id=${building}`,
    );
    // Invoices cannot be listed by building. The figures are still there, as figures.
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: /invoices/ })).not.toBeInTheDocument();
    expect(screen.getByText("Outstanding invoices")).toBeInTheDocument();
    expect(screen.getByText("$136,357.24 past due")).toBeInTheDocument();
  });

  it("sets what is overdue in the critical colour, while there is any", () => {
    const { rerender } = render(<AttentionBand summary={october} links={figureLinks({})} />);

    expect(within(item(/^Overdue invoices/)).getByText("6")).toHaveClass("text-critical");
    expect(within(item(/^Overdue work orders/)).getByText("10")).toHaveClass("text-critical");
    expect(within(item(/^Outstanding invoices/)).getByText("17")).not.toHaveClass("text-critical");
    expect(within(item(/^Open work orders/)).getByText("32")).not.toHaveClass("text-critical");

    rerender(
      <AttentionBand
        summary={{
          ...october,
          invoices_overdue: { count: 0, amount: "0.00" },
          work_orders_overdue: 0,
        }}
        links={figureLinks({})}
      />,
    );
    expect(within(item(/^Overdue invoices/)).getByText("0")).not.toHaveClass("text-critical");
    expect(within(item(/^Overdue work orders/)).getByText("0")).not.toHaveClass("text-critical");
  });
});

describe("the size of the organization", () => {
  it("counts what is active of what there is, and links to those that are", () => {
    render(<Footprint summary={october} links={figureLinks({})} />);

    expect(screen.getByText("Active buildings").parentElement).toHaveTextContent("25 of 30");
    expect(screen.getByText("Active employees").parentElement).toHaveTextContent("79 of 91");
    expect(screen.getByText("Active vendors").parentElement).toHaveTextContent("11 of 14");
    expect(screen.getByRole("link", { name: "25" })).toHaveAttribute(
      "href",
      "/buildings?status=active",
    );
    expect(screen.getByRole("link", { name: "79" })).toHaveAttribute(
      "href",
      "/employees?status=active",
    );
    expect(screen.getByRole("link", { name: "11" })).toHaveAttribute(
      "href",
      "/vendors?status=active",
    );
  });

  it("does not link the buildings when they are narrowed to one", () => {
    render(
      <Footprint
        summary={{ ...october, buildings: { total: 1, active: 1 } }}
        links={figureLinks({ buildingId: "01a21553-ccf9-7334-afae-c75e504000f6" })}
      />,
    );

    expect(screen.getByText("Active buildings").parentElement).toHaveTextContent("1 of 1");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["79", "11"]);
  });
});

// --- contract profitability --------------------------------------------------------------

const line = (
  revenue: string,
  labor: string,
  expenses: string,
  cost: string,
  margin: string,
  percent: string | null,
): ProfitLine => ({
  revenue,
  labor_cost: labor,
  expense_cost: expenses,
  operating_cost: cost,
  margin,
  margin_percent: percent,
});

const profitability: DashboardContracts = {
  period: { start: "2026-10-01", end: "2026-10-31", days: 31 },
  currency: "USD",
  contracts: [
    {
      ...line("18400.00", "2184.00", "0.00", "2184.00", "16216.00", "88.1"),
      contract: { id: "c2", contract_number: "CTR-0002", name: "Day Porter Program" },
      customer: { id: "u1", name: "Calloway Property Group", code: "CUS-0001" },
      billing_model: "fixed_fee",
    },
    {
      ...line("22900.00", "34981.55", "17370.61", "52352.16", "-29452.16", "-128.6"),
      contract: { id: "c6", contract_number: "CTR-0006", name: "Campus Custodial Services" },
      customer: { id: "u5", name: "Ashcombe Academy", code: "CUS-0005" },
      billing_model: "fixed_fee",
    },
    {
      ...line("0.00", "0.00", "1000.00", "1000.00", "-1000.00", null),
      contract: { id: "c9", contract_number: "CTR-0009", name: "Engineering Services" },
      customer: { id: "u8", name: "Quillhaven Partners", code: "CUS-0008" },
      billing_model: "cost_plus",
    },
  ],
  unattributed: line("0.00", "0.00", "4882.96", "4882.96", "-4882.96", null),
  totals: line("41300.00", "37165.55", "23253.57", "60419.12", "-19119.12", "-46.3"),
};

describe("the contract profitability table", () => {
  const table = () => screen.getByRole("table", { name: "Contract profitability, October 2026" });
  const rowOf = (name: RegExp) => within(table()).getByRole("row", { name });

  it("sets each contract's revenue against its cost, in the API's order", () => {
    render(
      <ContractsTable
        profitability={profitability}
        caption="Contract profitability, October 2026"
      />,
    );

    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((heading) => heading.textContent),
    ).toEqual(["Contract", "Customer", "Revenue", "Cost", "Margin", "Margin %"]);
    // What each row is headed by, before the lines under it.
    expect(
      within(table())
        .getAllByRole("rowheader")
        .map((header) => header.firstChild?.textContent),
    ).toEqual([
      "Day Porter Program",
      "Campus Custodial Services",
      "Engineering Services",
      "Not attributed to a contract",
      "Total",
    ]);
    const porters = rowOf(/^Day Porter Program/);
    expect(porters).toHaveTextContent("CTR-0002 · Fixed fee");
    // The margin's cell carries the percentage as well, for where the last column is
    // folded away.
    expect(
      within(porters)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["Calloway Property Group", "$18,400.00", "$2,184.00", "$16,216.0088.1%", "88.1%"]);
  });

  it("folds into two columns where it is narrow, and loses nothing by it", () => {
    render(
      <ContractsTable
        profitability={profitability}
        caption="Contract profitability, October 2026"
      />,
    );

    // Jsdom lays nothing out, so both arrangements are in the document. What tells
    // them apart is the width of the section each is shown at.
    const wideOnly = "@max-4xl:hidden";
    const aboveNarrow = "@max-2xl:hidden";
    const belowWide = "@4xl:hidden";
    const narrowOnly = "@2xl:hidden";
    const shownWhen = (heading: HTMLElement) =>
      heading.classList.contains(wideOnly)
        ? "wide"
        : heading.classList.contains(aboveNarrow)
          ? "not narrow"
          : "always";
    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((heading) => [heading.textContent, shownWhen(heading)]),
    ).toEqual([
      ["Contract", "always"],
      ["Customer", "wide"],
      ["Revenue", "not narrow"],
      ["Cost", "not narrow"],
      ["Margin", "always"],
      ["Margin %", "not narrow"],
    ]);

    const porters = rowOf(/^Day Porter Program/);
    const [customer, revenue, cost, margin, percent] = within(porters).getAllByRole("cell");
    expect(customer).toHaveClass(wideOnly);
    expect(revenue).toHaveClass(aboveNarrow);
    expect(cost).toHaveClass(aboveNarrow);
    expect(margin).not.toHaveClass(aboveNarrow, wideOnly);
    expect(percent).toHaveClass(aboveNarrow);
    // Under the contract's name: the customer, until it has a column of its own, and
    // the revenue and the cost, while they have none.
    const header = within(porters).getByRole("rowheader");
    expect(within(header).getByText("Calloway Property Group")).toHaveClass(belowWide);
    expect(within(header).getByText("Revenue $18,400.00").parentElement).toHaveClass(narrowOnly);
    expect(within(header).getByText("Cost $2,184.00").parentElement).toHaveClass(narrowOnly);
    // Under the margin: the percentage.
    expect(within(margin!).getByText("88.1%")).toHaveClass(narrowOnly);
    // The total folds the same way.
    const total = within(table().querySelector("tfoot")!).getByRole("rowheader");
    expect(within(total).getByText("Revenue $41,300.00").parentElement).toHaveClass(narrowOnly);
    expect(within(total).getByText("Cost $60,419.12").parentElement).toHaveClass(narrowOnly);
  });

  it("sets a loss in the critical colour: the margin and its percentage, not the rest", () => {
    render(
      <ContractsTable
        profitability={profitability}
        caption="Contract profitability, October 2026"
      />,
    );

    const critical = (element: HTMLElement) => element.closest(".text-critical") !== null;
    const campus = rowOf(/^Campus Custodial Services/);
    expect(critical(within(campus).getByText(`${MINUS}$29,452.16`))).toBe(true);
    // The percentage twice: in its column, and under the margin where that is folded.
    expect(within(campus).getAllByText(`${MINUS}128.6%`).map(critical)).toEqual([true, true]);
    expect(critical(within(campus).getByText("$22,900.00"))).toBe(false);
    expect(critical(within(campus).getByText("$52,352.16"))).toBe(false);
    expect(critical(within(campus).getByText("Revenue $22,900.00"))).toBe(false);
    const porters = rowOf(/^Day Porter Program/);
    expect(critical(within(porters).getByText("$16,216.00"))).toBe(false);
    expect(within(porters).getAllByText("88.1%").map(critical)).toEqual([false, false]);
  });

  it("says there is no percentage where there is no revenue, rather than a zero", () => {
    render(
      <ContractsTable
        profitability={profitability}
        caption="Contract profitability, October 2026"
      />,
    );

    const engineering = rowOf(/^Engineering Services/);
    for (const blank of within(engineering).getAllByText("No revenue to take a percentage of")) {
      expect(blank).toHaveClass("sr-only");
    }
    expect(engineering).not.toHaveTextContent("%");
  });

  it("sets what names no contract apart, under the contracts and above the total", () => {
    render(
      <ContractsTable
        profitability={profitability}
        caption="Contract profitability, October 2026"
      />,
    );

    const bodies = table().querySelectorAll("tbody");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toHaveClass("border-t", "border-line-strong");
    expect(bodies[1]).toHaveTextContent("Not attributed to a contract");
    expect(bodies[1]).toHaveTextContent(`$4,882.96${MINUS}$4,882.96`);
    const total = within(table().querySelector("tfoot")!).getByRole("row");
    expect(
      within(total)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["", "$41,300.00", "$60,419.12", `${MINUS}$19,119.12${MINUS}46.3%`, `${MINUS}46.3%`]);
  });

  it("leaves that line out when everything names a contract", () => {
    render(
      <ContractsTable
        profitability={{
          ...profitability,
          unattributed: line("0.00", "0.00", "0.00", "0.00", "0.00", null),
        }}
        caption="Contract profitability, October 2026"
      />,
    );

    expect(table().querySelectorAll("tbody")).toHaveLength(1);
    expect(screen.queryByText("Not attributed to a contract")).not.toBeInTheDocument();
  });

  it("says so when nothing was invoiced or spent", () => {
    const nothing = line("0.00", "0.00", "0.00", "0.00", "0.00", null);
    render(
      <ContractsTable
        profitability={{ ...profitability, contracts: [], unattributed: nothing, totals: nothing }}
        caption="Contract profitability, October 2026"
      />,
    );

    expect(screen.getByText("Nothing was invoiced or spent in this period.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// --- where the cost goes -----------------------------------------------------------------

describe("the cost breakdown", () => {
  it("lists what was spent on, largest first, and comes to the operating cost", () => {
    render(<CostByCategory summary={october} />);

    const table = screen.getByRole("table", { name: "Operating cost by category" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent)
          .filter(Boolean),
      );
    // Travel and other, on which nothing was spent, are left out.
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((header) => header.textContent),
    ).toEqual(["Labor", "Subcontractor", "Materials", "Equipment", "Supplies", "Operating cost"]);
    expect(rows).toEqual([
      ["$289,644.87", "83.2%"],
      ["$26,251.43", "7.5%"],
      ["$14,622.19", "4.2%"],
      ["$13,643.08", "3.9%"],
      ["$4,018.82", "1.2%"],
      ["$348,180.39"],
    ]);
  });

  it("says so when nothing was spent", () => {
    const nothing = october.cost_by_category.map((share) => ({
      ...share,
      amount: "0.00",
      share_percent: null,
    }));
    render(<CostByCategory summary={{ ...october, cost_by_category: nothing }} />);

    expect(
      screen.getByText("No time or expenses were approved in this period."),
    ).toBeInTheDocument();
  });
});

const building = (name: string, cost: string, hours: string, open: number) => ({
  building: { id: name, name, code: name.slice(0, 3).toUpperCase() },
  customer: { id: `${name}-customer`, name: `${name} Holdings`, code: "CUS" },
  labor_cost: cost,
  expense_cost: "0.00",
  operating_cost: cost,
  labor_hours: hours,
  work_orders_open: open,
  work_orders_completed: 0,
});

const comparison: DashboardBuildings = {
  period: { start: "2026-10-01", end: "2026-10-31", days: 31 },
  as_of: "2026-11-26",
  currency: "USD",
  buildings: [
    building("The Fenwick", "32733.74", "1051.75", 2),
    building("Ashcombe Lower School", "27507.02", "558.75", 0),
    building("Calloway Tower", "24282.93", "907.50", 2),
    building("Northlight Outlet Court", "22185.97", "779.50", 3),
    building("The Finch Building", "21758.98", "859.25", 0),
    building("Saltmarsh Cross-Dock North", "18326.44", "606.25", 0),
  ],
};

describe("the costliest buildings", () => {
  it("shows the first five the API lists, with their cost, hours and open work", () => {
    render(<CostliestBuildings comparison={comparison} />);

    const table = screen.getByRole("table", { name: "Costliest buildings" });
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((header) => header.textContent),
    ).toEqual([
      "The FenwickThe Fenwick Holdings",
      "Ashcombe Lower SchoolAshcombe Lower School Holdings",
      "Calloway TowerCalloway Tower Holdings",
      "Northlight Outlet CourtNorthlight Outlet Court Holdings",
      "The Finch BuildingThe Finch Building Holdings",
    ]);
    const first = within(table).getByRole("row", { name: /^The Fenwick/ });
    // The cost's cell carries the hours as well, for where their column is folded away.
    expect(
      within(first)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["$32,733.741,051.75 hours", "", "1,051.75", "2"]);
    // Each bar is the building's cost beside the costliest: the first is full.
    const bars = [...table.querySelectorAll<HTMLElement>("td > span > span")];
    expect(bars[0]!.style.width).toBe("100%");
    expect(Number.parseFloat(bars[1]!.style.width)).toBeCloseTo(84.03, 1);
  });

  it("puts the hours under the cost where there is no room for a column of them", () => {
    render(<CostliestBuildings comparison={comparison} />);

    // Jsdom lays nothing out, so both arrangements are in the document. What tells them
    // apart is the width of the section each is shown at.
    const column = "@max-md:hidden";
    const underCost = "@md:hidden";
    const table = screen.getByRole("table", { name: "Costliest buildings" });
    expect(within(table).getByRole("columnheader", { name: "Hours" })).toHaveClass(column);
    const first = within(table).getByRole("row", { name: /^The Fenwick/ });
    const [cost, , hours, open] = within(first).getAllByRole("cell");
    expect(hours).toHaveClass(column);
    expect(within(cost!).getByText("1,051.75 hours")).toHaveClass(underCost);
    // Folded, the figures stand level with the first line of the building's name.
    const level = "@max-md:align-top";
    expect(within(first).getByRole("rowheader")).toHaveClass(level);
    expect(cost).toHaveClass(level);
    expect(open).toHaveClass(level);
  });

  it("says so when no building has anything to show", () => {
    render(<CostliestBuildings comparison={{ ...comparison, buildings: [] }} />);

    expect(
      screen.getByText("No building had costs or work orders in this period."),
    ).toBeInTheDocument();
  });
});

// --- work --------------------------------------------------------------------------------

const counts: DashboardWorkOrders = {
  period: { start: "2026-10-01", end: "2026-10-31", days: 31 },
  as_of: "2026-11-26",
  by_status: [
    { status: "open", count: 10 },
    { status: "scheduled", count: 7 },
    { status: "in_progress", count: 10 },
    { status: "on_hold", count: 5 },
    { status: "completed", count: 541 },
    { status: "cancelled", count: 27 },
  ],
  opened: 50,
  opened_by_category: [],
  opened_by_priority: [],
};

describe("the backlog", () => {
  it("lists the work that is open by where it stands, and leaves out what is finished", () => {
    render(<WorkBacklog counts={counts} totals={{ open: 32, overdue: 10 }} />);

    const table = screen.getByRole("table", { name: "Open work orders by status, as of today" });
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent),
    ).toEqual([
      "Open10",
      "Scheduled7",
      "In progress10",
      "On hold5",
      "Open work orders10 overdue32",
    ]);
    expect(within(table).getByText("10 overdue")).toHaveClass("text-critical");
  });

  it("uses the API's totals, and shows none until it has them", () => {
    const { rerender } = render(<WorkBacklog counts={counts} />);
    expect(screen.queryByText("Open work orders")).not.toBeInTheDocument();

    rerender(<WorkBacklog counts={counts} totals={{ open: 32, overdue: 0 }} />);
    expect(screen.getByText("Open work orders").closest("tr")).toHaveTextContent(
      /^Open work orders32$/,
    );
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("says so when nothing is open", () => {
    const closed = counts.by_status.map((entry) =>
      entry.status === "completed" ? entry : { ...entry, count: 0 },
    );
    render(
      <WorkBacklog counts={{ ...counts, by_status: closed }} totals={{ open: 0, overdue: 0 }} />,
    );

    expect(
      screen.getByText("Nothing is open. Every work order is completed or cancelled."),
    ).toBeInTheDocument();
  });
});

// --- trends ------------------------------------------------------------------------------

const month = (
  start: string,
  end: string,
  revenue: string,
  labor: string,
  expenses: string,
  cost: string,
  margin: string,
  percent: string | null,
  opened: number,
  completed: number,
  partial = false,
) => ({
  month: start,
  end,
  is_partial: partial,
  revenue,
  labor_cost: labor,
  expense_cost: expenses,
  operating_cost: cost,
  margin,
  margin_percent: percent,
  work_orders_opened: opened,
  work_orders_completed: completed,
});

const trends: DashboardTrends = {
  as_of: "2026-11-26",
  currency: "USD",
  months: [
    month(
      "2025-12-01",
      "2025-12-31",
      "183489.37",
      "269541.29",
      "52255.90",
      "321797.19",
      "-138307.82",
      "-75.4",
      42,
      41,
    ),
    month(
      "2026-01-01",
      "2026-01-31",
      "0.00",
      "263752.47",
      "31186.84",
      "294939.31",
      "-294939.31",
      null,
      53,
      52,
    ),
    month(
      "2026-10-01",
      "2026-10-31",
      "351024.60",
      "289644.87",
      "58535.52",
      "348180.39",
      "2844.21",
      "0.8",
      50,
      44,
    ),
    month(
      "2026-11-01",
      "2026-11-26",
      "354977.43",
      "175010.40",
      "16565.78",
      "191576.18",
      "163401.25",
      "46.0",
      64,
      41,
      true,
    ),
  ],
};

describe("the trend charts", () => {
  /** The rows of the table that says in words what a chart draws. */
  const rowsOf = (name: string) =>
    within(screen.getByRole("table", { name }))
      .getAllByRole("row")
      .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));

  it("says in a table what the money chart draws, month by month and to the cent", () => {
    render(<MoneyTrendChart trends={trends} />);

    expect(rowsOf("Revenue and operating cost by month")).toEqual([
      ["Month", "Revenue", "Labor", "Expenses", "Operating cost", "Margin"],
      [
        "December 2025",
        "$183,489.37",
        "$269,541.29",
        "$52,255.90",
        "$321,797.19",
        `${MINUS}$138,307.82 (${MINUS}75.4%)`,
      ],
      // No revenue, so the margin has no percentage.
      ["January 2026", "$0.00", "$263,752.47", "$31,186.84", "$294,939.31", `${MINUS}$294,939.31`],
      [
        "October 2026",
        "$351,024.60",
        "$289,644.87",
        "$58,535.52",
        "$348,180.39",
        "$2,844.21 (0.8%)",
      ],
      // The month still running says how far it has got.
      [
        "November 2026, to Nov 26",
        "$354,977.43",
        "$175,010.40",
        "$16,565.78",
        "$191,576.18",
        "$163,401.25 (46.0%)",
      ],
    ]);
    // The drawing is named, and is not read out bar by bar.
    expect(
      screen.getByRole("img", {
        name: "Revenue and operating cost by month. The figures are in the table that follows.",
      }),
    ).toBeInTheDocument();
  });

  it("says in a table what the work chart draws", () => {
    render(<WorkTrendChart trends={trends} />);

    expect(rowsOf("Work orders opened and completed by month")).toEqual([
      ["Month", "Opened", "Completed"],
      ["December 2025", "42", "41"],
      ["January 2026", "53", "52"],
      ["October 2026", "50", "44"],
      ["November 2026, to Nov 26", "64", "41"],
    ]);
  });

  /** What is written under each column of the chart: its month, and a note if it has one. */
  const underColumns = (months: DashboardTrends["months"]) => {
    const { container, unmount } = render(<WorkTrendChart trends={{ ...trends, months }} />);
    const written = [...container.querySelector("figure > div[aria-hidden='true']")!.children].map(
      (column) => [...column.children].map((line) => line.textContent),
    );
    unmount();
    return written;
  };
  /** A month with nothing in it: what is written under a column depends only on when it is. */
  const quiet = (start: string, partial = false) =>
    month(start, start, "0.00", "0.00", "0.00", "0.00", "0.00", null, 0, 0, partial);

  it("notes the year under each January, and that the last month is still running", () => {
    // December starts the chart, but the January beside it says the year.
    expect(underColumns(trends.months)).toEqual([
      ["Dec"],
      ["Jan", "2026"],
      ["Oct"],
      ["Nov", "to date"],
    ]);
    // With no January beside it, the first column says the year itself.
    expect(
      underColumns([quiet("2026-03-01"), quiet("2026-04-01"), quiet("2026-05-01", true)]),
    ).toEqual([["Mar", "2026"], ["Apr"], ["May", "to date"]]);
  });

  it("never sets two notes side by side: beside a January's year, the other gives way", () => {
    // In February the month still running is beside January. The hatching says it is
    // not over, and nothing else would say the year.
    expect(
      underColumns([quiet("2026-12-01"), quiet("2027-01-01"), quiet("2027-02-01", true)]),
    ).toEqual([["Dec"], ["Jan", "2027"], ["Feb"]]);
    // In January the month still running is the January, and says the year too.
    expect(
      underColumns([quiet("2026-11-01"), quiet("2026-12-01"), quiet("2027-01-01", true)]),
    ).toEqual([["Nov", "2026"], ["Dec"], ["Jan", "2027"]]);
  });
});
