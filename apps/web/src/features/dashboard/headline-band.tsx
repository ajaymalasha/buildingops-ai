import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardSummary, MoneyFigure } from "@/lib/api/types";
import { isZero } from "@/lib/decimal";
import {
  formatHours,
  formatMoney,
  formatNumber,
  formatPercentPoint,
  moneyParts,
} from "@/lib/format";
import { cn } from "@/lib/utils";

import type { FigureLinks } from "./dashboard-links";

/** Whether a decimal string is below zero. Read off the string: it is never a number. */
export function isNegative(value: string): boolean {
  return value.startsWith("-") && !isZero(value);
}

/** A decimal string without its sign, for where an arrow or a colour says which way. */
function magnitude(value: string): string {
  return value.replace(/^-/, "");
}

// Both bands are laid out by the width of the page, not of the window: the sidebar takes
// its share of the window, so the two are far apart on a laptop.
//
// A cell's lines each share a row with its neighbours' (a subgrid), so that the figures
// stay level with each other even where one label runs to a second line.
const CELL_ROWS = "row-span-3 grid grid-rows-subgrid";

// --- the period's figures ----------------------------------------------------------------

// The four figures sit in a band between two rules, with a hairline between neighbours:
// in one row where the page is wide enough for four, two by two where it is not. The
// band knows how wide a cell is (`--cell`), for the amounts to be sized by.
const HEADLINE_BAND =
  "grid grid-cols-2 border-y border-line-strong [--cell:50cqw] @4xl:grid-cols-4 @4xl:[--cell:25cqw]";
const HEADLINE_CELLS = [
  "pr-4",
  "border-l border-line pl-5 pr-4 @4xl:pl-6",
  "border-t border-line pr-4 @4xl:border-t-0 @4xl:border-l @4xl:pl-6",
  "border-t border-l border-line pl-5 pr-4 @4xl:border-t-0 @4xl:pl-6",
];

/**
 * The size the four amounts are set in: the design's, unless the longest of them would
 * not fit its cell at that size, as millions do not in half the width of a phone. Then
 * all four are set smaller together, by just enough.
 *
 * A character of an amount takes 0.48em at most on average: a digit takes more, and the
 * separators and the smaller cents a good deal less. The 2.5rem is a cell's inset where
 * it is widest.
 */
function amountSize(amounts: readonly string[]): string {
  const longest = Math.max(...amounts.map((amount) => amount.length));
  const ems = (longest * 0.48).toFixed(2);
  return `clamp(1rem, calc((var(--cell) - 2.5rem) / ${ems}), 1.625rem)`;
}

/** How a figure moved against the period before: which way, by how much, and from what. */
function Change({ figure, currency }: { figure: MoneyFigure; currency: string }) {
  const unchanged = isZero(figure.change);
  const down = isNegative(figure.change);
  const Arrow = down ? ArrowDownRight : ArrowUpRight;
  return (
    <p className="mt-1.5 text-[13px] text-ink-muted tabular-nums">
      {unchanged ? (
        <span className="font-medium text-ink">No change</span>
      ) : (
        <span className="font-medium whitespace-nowrap text-ink">
          <Arrow
            aria-hidden="true"
            className="mr-0.5 inline size-3.5 align-[-2px] text-ink-muted"
          />
          {/* The arrow says which way to the eye. This says it to a screen reader. */}
          <span className="sr-only">{down ? "Down " : "Up "}</span>
          {/* From nothing there is no percentage to give, so the amount stands in. */}
          {figure.change_percent === null
            ? formatMoney(magnitude(figure.change), currency)
            : formatPercentPoint(magnitude(figure.change_percent))}
        </span>
      )}{" "}
      {/* Two figures across a phone leave no room for all of it on a line. It breaks here
          in every cell, rather than wherever each one happens to run out of room. */}
      <span className="@max-md:block @md:whitespace-nowrap">
        from {formatMoney(figure.previous, currency)}
      </span>
    </p>
  );
}

type FigureProps = {
  label: string;
  figure: MoneyFigure;
  currency: string;
  /** The size the amount is set in: one size for the whole band. */
  size: string;
  /** Said beside the label: margin as a share of revenue. */
  rate?: string | null;
  className?: string;
};

function Figure({ label, figure, currency, size, rate, className }: FigureProps) {
  const { whole, cents } = moneyParts(figure.value, currency);
  const loss = isNegative(figure.value);
  return (
    <div role="group" aria-label={label} className={cn(CELL_ROWS, "py-5", className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-muted">
        {label}
        {rate ? (
          <span className="whitespace-nowrap tabular-nums">
            <span className={cn("font-medium", loss ? "text-critical" : "text-ink")}>
              {formatPercentPoint(rate)}
            </span>{" "}
            of revenue
          </span>
        ) : null}
      </p>
      <p
        className={cn(
          "mt-1 leading-8 font-semibold tracking-tight whitespace-nowrap tabular-nums",
          loss ? "text-critical" : "text-ink",
        )}
        style={{ fontSize: size }}
      >
        {whole}
        <span className={cn("text-[0.65em] font-medium", !loss && "text-ink-muted")}>{cents}</span>
      </p>
      <Change figure={figure} currency={currency} />
    </div>
  );
}

/** What the business earned, spent, kept and collected in the period, and how each moved. */
export function HeadlineBand({ summary }: { summary: DashboardSummary }) {
  const { currency } = summary;
  const figures = [
    { label: "Revenue", figure: summary.revenue },
    { label: "Operating cost", figure: summary.operating_cost },
    { label: "Margin", figure: summary.margin, rate: summary.margin_percent.value },
    { label: "Collected", figure: summary.collected },
  ];
  const size = amountSize(figures.map(({ figure }) => formatMoney(figure.value, currency)));
  return (
    <div className={HEADLINE_BAND}>
      {figures.map(({ label, figure, rate }, index) => (
        <Figure
          key={label}
          label={label}
          figure={figure}
          currency={currency}
          size={size}
          rate={rate}
          className={HEADLINE_CELLS[index]}
        />
      ))}
    </div>
  );
}

export function HeadlineBandSkeleton() {
  return (
    <div className={HEADLINE_BAND}>
      {HEADLINE_CELLS.map((cell, index) => (
        <div key={index} className={cn("py-5", cell)}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-3 h-7 w-36 max-w-full" />
          <Skeleton className="mt-3 h-3.5 w-40 max-w-full" />
        </div>
      ))}
    </div>
  );
}

// --- what needs attention today ----------------------------------------------------------

type Attention = {
  label: string;
  count: number;
  /** Said under the count: what is owed, how many hours. */
  detail?: string;
  /** The list of exactly these records, or null when no list can show them. */
  href: string | null;
  /** Overdue: in the critical colour while there is anything to count. */
  critical?: boolean;
};

function attentionOf(summary: DashboardSummary, links: FigureLinks): Attention[] {
  const { currency } = summary;
  return [
    {
      label: "Outstanding invoices",
      count: summary.invoices_outstanding.count,
      detail: `${formatMoney(summary.invoices_outstanding.amount, currency)} owed`,
      href: links.invoicesOutstanding,
    },
    {
      label: "Overdue invoices",
      count: summary.invoices_overdue.count,
      detail: `${formatMoney(summary.invoices_overdue.amount, currency)} past due`,
      href: links.invoicesOverdue,
      critical: true,
    },
    {
      label: "Pending timesheets",
      count: summary.timesheets_pending.count,
      detail: `${formatHours(summary.timesheets_pending.hours)} hours`,
      href: links.timesheetsPending,
    },
    {
      label: "Pending expenses",
      count: summary.expenses_pending.count,
      detail: formatMoney(summary.expenses_pending.amount, currency),
      href: links.expensesPending,
    },
    {
      label: "Open work orders",
      count: summary.work_orders_open,
      href: links.workOrdersOpen,
    },
    {
      label: "Overdue work orders",
      count: summary.work_orders_overdue,
      href: links.workOrdersOverdue,
      critical: true,
    },
  ];
}

// Six counts: two across on a phone, then three, and all six in a row once the page is
// wide enough for the longest label to stay on one line in a sixth of it.
const ATTENTION_BAND =
  "grid grid-cols-2 border-y border-line-strong @xl:grid-cols-3 @min-[68rem]:grid-cols-6";

/**
 * The hairlines and the inset of the cell at `index` of six. A cell draws the line that
 * separates it from the one before it and from the row above, and the first of a row
 * starts at the page's edge.
 */
function attentionCell(index: number): string {
  return cn(
    "border-line py-4 pr-4",
    index % 2 === 0 ? "pl-0" : "border-l pl-5",
    index >= 2 && "border-t",
    index % 3 === 0 ? "@xl:border-l-0 @xl:pl-0" : "@xl:border-l @xl:pl-5",
    index >= 3 ? "@xl:border-t" : "@xl:border-t-0",
    index === 0
      ? "@min-[68rem]:border-l-0 @min-[68rem]:pl-0"
      : "@min-[68rem]:border-l @min-[68rem]:pl-5",
    "@min-[68rem]:border-t-0",
  );
}

/** What is waiting on someone as of today, each with a way to the records themselves. */
export function AttentionBand({
  summary,
  links,
}: {
  summary: DashboardSummary;
  links: FigureLinks;
}) {
  return (
    <ul className={ATTENTION_BAND}>
      {attentionOf(summary, links).map((item, index) => {
        const content = (
          <>
            <span className="flex items-center gap-1 text-[13px] text-ink-muted">
              <span className={cn(item.href && "group-hover:text-ink group-hover:underline")}>
                {item.label}
              </span>
              {item.href ? (
                <ArrowUpRight aria-hidden="true" className="size-3 shrink-0 text-ink-subtle" />
              ) : null}
            </span>{" "}
            <span
              className={cn(
                "mt-1 block text-xl leading-7 font-semibold tabular-nums",
                item.critical && item.count > 0 ? "text-critical" : "text-ink",
              )}
            >
              {formatNumber(item.count)}
            </span>{" "}
            <span className="block min-h-5 text-[13px] text-ink-muted tabular-nums">
              {item.detail}
            </span>
          </>
        );
        return (
          <li key={item.label} className={cn(CELL_ROWS, attentionCell(index))}>
            {item.href ? (
              <Link href={item.href} className={cn(CELL_ROWS, "group rounded-xs")}>
                {content}
              </Link>
            ) : (
              <div className={CELL_ROWS}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AttentionBandSkeleton() {
  return (
    <div className={ATTENTION_BAND}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={attentionCell(index)}>
          <Skeleton className="h-3.5 w-28 max-w-full" />
          <Skeleton className="mt-2.5 h-6 w-12" />
          <Skeleton className="mt-2 h-3.5 w-24 max-w-full" />
        </div>
      ))}
    </div>
  );
}

// --- how large the organization is -------------------------------------------------------

type FootprintProps = {
  summary: DashboardSummary;
  links: FigureLinks;
};

/** The buildings, people and vendors that are active today, beside the page's heading. */
export function Footprint({ summary, links }: FootprintProps) {
  const counts = [
    { label: "Active buildings", count: summary.buildings, href: links.buildingsActive },
    { label: "Active employees", count: summary.employees, href: links.employeesActive },
    { label: "Active vendors", count: summary.vendors, href: links.vendorsActive },
  ];
  return (
    <dl className="flex min-w-0 flex-wrap gap-x-7 gap-y-2 text-[13px]">
      {counts.map(({ label, count, href }) => (
        <div key={label}>
          <dt className="text-xs text-ink-muted">{label}</dt>
          <dd className="mt-0.5 text-ink-muted tabular-nums">
            {href ? (
              <Link href={href} className="font-medium text-brand-700 hover:text-brand-800">
                {formatNumber(count.active)}
              </Link>
            ) : (
              <span className="font-medium text-ink">{formatNumber(count.active)}</span>
            )}{" "}
            of {formatNumber(count.total)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
