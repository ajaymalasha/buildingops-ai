import { BalanceBar } from "@/components/ui/bars";
import { Blank } from "@/components/ui/cells";
import { Skeleton } from "@/components/ui/skeleton";
import { BILLING_MODEL_LABELS } from "@/features/contracts/billing-models";
import type { DashboardContracts, ProfitLine } from "@/lib/api/types";
import { toNumber } from "@/lib/chart";
import { isZero } from "@/lib/decimal";
import { formatMoney, formatPercentPoint } from "@/lib/format";
import { cn } from "@/lib/utils";

import { isNegative } from "./headline-band";
import { NothingToShow } from "./report";

// The table is laid out three ways, by the room its section has, so that nothing is lost
// and nothing has to be scrolled to:
//
// - wide: every column, and a bar for the margin;
// - in between: the customer moves under the contract's name, and the bar goes;
// - narrow (a phone): two columns, the contract and its margin, with the revenue and
//   the cost under the contract's name and the percentage under the margin.
const WIDE_ONLY = "@max-4xl:hidden";
const BELOW_WIDE = "@4xl:hidden";
const NARROW_ONLY = "@2xl:hidden";
const ABOVE_NARROW = "@max-2xl:hidden";
// Folded, a row is several lines tall, and its figures sit level with the first of them.
const LEVEL = "@max-2xl:align-top";
const MONEY = "text-right whitespace-nowrap tabular-nums";

/** Whether a line has nothing on it at all. */
function isEmpty(line: ProfitLine): boolean {
  return isZero(line.revenue) && isZero(line.operating_cost);
}

/**
 * Revenue and cost in a line of words, for under a contract's name in a narrow window.
 *
 * Where the two do not fit on one line, the cost goes under the revenue, and the dot
 * between them goes. Each part is drawn with a margin to its left that starts outside
 * the line, and the cost's dot stands in that margin: beside the revenue it falls
 * between the two, and at the start of a line it falls outside, where it is cut off.
 * The margin is as wide as a dot between two spaces, as on the line above.
 */
function Folded({ line, currency }: { line: ProfitLine; currency: string }) {
  const part = "relative -ml-[0.6em] pl-[0.6em] whitespace-nowrap";
  return (
    <span
      className={cn(
        "mt-0.5 flex flex-wrap gap-x-[0.6em] overflow-hidden text-xs font-normal text-ink-muted tabular-nums",
        NARROW_ONLY,
      )}
    >
      <span className={part}>Revenue {formatMoney(line.revenue, currency)}</span>
      <span
        className={cn(
          part,
          "before:absolute before:left-0 before:w-[0.6em] before:text-center before:content-['·']",
        )}
      >
        Cost {formatMoney(line.operating_cost, currency)}
      </span>
    </span>
  );
}

/** A line's margin as a share of its revenue, or a dash where there is no revenue. */
function MarginPercent({ line }: { line: ProfitLine }) {
  return line.margin_percent === null ? (
    <Blank label="No revenue to take a percentage of" />
  ) : (
    formatPercentPoint(line.margin_percent)
  );
}

type FiguresProps = {
  line: ProfitLine;
  currency: string;
  /** The room above and below, the same as the row's heading has. */
  padding?: string;
};

/** Revenue, cost and margin of a line, with its margin as a share of revenue and a bar. */
function Figures({ line, currency, padding = "py-2.5" }: FiguresProps) {
  const loss = isNegative(line.margin);
  return (
    <>
      <td className={cn(padding, MONEY, "px-3", ABOVE_NARROW)}>
        {formatMoney(line.revenue, currency)}
      </td>
      <td className={cn(padding, MONEY, "px-3", ABOVE_NARROW)}>
        {formatMoney(line.operating_cost, currency)}
      </td>
      <td className={cn(padding, MONEY, LEVEL, "pl-3 @2xl:pr-3", loss && "text-critical")}>
        {formatMoney(line.margin, currency)}
        <span
          className={cn("mt-0.5 block text-xs font-normal", !loss && "text-ink-muted", NARROW_ONLY)}
        >
          <MarginPercent line={line} />
        </span>
      </td>
      <td className={cn(padding, "pl-3", ABOVE_NARROW)}>
        <div className="flex items-center justify-end gap-3">
          {/* The bar reaches its end at 100%, of gain or of loss. Beyond that it is full. */}
          {line.margin_percent === null ? null : (
            <BalanceBar percent={toNumber(line.margin_percent)} className={cn("w-24", WIDE_ONLY)} />
          )}
          <span className={cn("w-16 text-right tabular-nums", loss && "text-critical")}>
            <MarginPercent line={line} />
          </span>
        </div>
      </td>
    </>
  );
}

type ContractsTableProps = {
  profitability: DashboardContracts;
  /** What the table is called: "Contract profitability, October 2026". */
  caption: string;
};

/**
 * What each contract earned against what it cost, largest margin first. Under the
 * contracts, on a line of its own, is whatever names no contract, so that the lines come
 * to the total, and the total to the figures at the top of the page.
 */
export function ContractsTable({ profitability, caption }: ContractsTableProps) {
  const { contracts, unattributed, totals, currency } = profitability;
  if (contracts.length === 0 && isEmpty(unattributed)) {
    return <NothingToShow>Nothing was invoiced or spent in this period.</NothingToShow>;
  }
  const heading = "pb-2 font-medium whitespace-nowrap";
  return (
    <table className="w-full text-[13px] text-ink">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-line-strong text-xs text-ink-muted">
          <th scope="col" className={cn(heading, "pr-3 text-left")}>
            Contract
          </th>
          <th scope="col" className={cn(heading, "pr-3 text-left", WIDE_ONLY)}>
            Customer
          </th>
          <th scope="col" className={cn(heading, "px-3 text-right", ABOVE_NARROW)}>
            Revenue
          </th>
          <th scope="col" className={cn(heading, "px-3 text-right", ABOVE_NARROW)}>
            Cost
          </th>
          <th scope="col" className={cn(heading, "pl-3 text-right @2xl:pr-3")}>
            Margin
          </th>
          <th scope="col" className={cn(heading, "pl-3 text-right", ABOVE_NARROW)}>
            Margin %
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {contracts.map((line) => (
          <tr key={line.contract.id}>
            <th scope="row" className="py-2.5 pr-3 text-left font-normal">
              <span className="block font-medium">{line.contract.name}</span>
              <span className={cn("block text-xs text-ink-muted", BELOW_WIDE)}>
                {line.customer.name}
              </span>
              <span className="block text-xs text-ink-subtle">
                <span className="font-mono text-[11px]">{line.contract.contract_number}</span>
                {" · "}
                {BILLING_MODEL_LABELS[line.billing_model]}
              </span>
              <Folded line={line} currency={currency} />
            </th>
            <td className={cn("py-2.5 pr-3", WIDE_ONLY)}>{line.customer.name}</td>
            <Figures line={line} currency={currency} />
          </tr>
        ))}
      </tbody>
      {isEmpty(unattributed) ? null : (
        // Set apart by a heavier rule: it is not a contract, and belongs to no customer.
        <tbody className="border-t border-line-strong">
          <tr>
            <th scope="row" className="py-2.5 pr-3 text-left font-normal">
              <span className="block text-ink-muted italic">Not attributed to a contract</span>
              <span className="block text-xs text-ink-subtle">
                Invoices, time and expenses that name no contract
              </span>
              <Folded line={unattributed} currency={currency} />
            </th>
            <td className={WIDE_ONLY} />
            <Figures line={unattributed} currency={currency} />
          </tr>
        </tbody>
      )}
      <tfoot className="border-t border-line-strong">
        <tr className="font-semibold">
          <th scope="row" className="py-3 pr-3 text-left font-semibold">
            Total
            <Folded line={totals} currency={currency} />
          </th>
          <td className={WIDE_ONLY} />
          <Figures line={totals} currency={currency} padding="py-3" />
        </tr>
      </tfoot>
    </table>
  );
}

export function ContractsTableSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-line border-t border-line-strong">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-6 py-3.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className={cn("h-3.5 w-36", WIDE_ONLY)} />
          <Skeleton className={cn("ml-auto h-3.5 w-20", ABOVE_NARROW)} />
          <Skeleton className={cn("h-3.5 w-20", ABOVE_NARROW)} />
          <Skeleton className="h-3.5 w-20 @max-2xl:ml-auto" />
          <Skeleton className={cn("h-3.5 w-28", WIDE_ONLY)} />
        </div>
      ))}
    </div>
  );
}
