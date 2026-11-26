import { ShareBar } from "@/components/ui/bars";
import {
  BACKLOG_STATUSES,
  WORK_ORDER_STATUS_LABELS,
} from "@/features/work-orders/work-order-status";
import type { DashboardWorkOrders } from "@/lib/api/types";
import { formatNumber } from "@/lib/format";

import { NothingToShow } from "./report";

type WorkBacklogProps = {
  counts: DashboardWorkOrders;
  /**
   * How many work orders are open, and how many of those are overdue: the API's own
   * totals, from the figures at the top of the page. Left out until those have loaded.
   */
  totals?: { open: number; overdue: number };
};

/**
 * The work orders that are open today, by where each one stands. Completed and cancelled
 * work is not in the backlog, so it is not listed. Each bar is beside the longest.
 */
export function WorkBacklog({ counts, totals }: WorkBacklogProps) {
  const lines = counts.by_status.filter((line) => BACKLOG_STATUSES.includes(line.status));
  const largest = Math.max(0, ...lines.map((line) => line.count));
  if (largest === 0) {
    return (
      <NothingToShow>Nothing is open. Every work order is completed or cancelled.</NothingToShow>
    );
  }
  return (
    <table className="w-full text-[13px] text-ink">
      <caption className="sr-only">Open work orders by status, as of today</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Work orders</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line border-t border-line-strong">
        {lines.map((line) => (
          <tr key={line.status}>
            <th scope="row" className="w-28 py-2.5 pr-3 text-left font-normal whitespace-nowrap">
              {WORK_ORDER_STATUS_LABELS[line.status]}
            </th>
            <td className="w-full py-2.5">
              <ShareBar percent={(line.count / largest) * 100} />
            </td>
            <td className="py-2.5 pl-3 text-right tabular-nums">{formatNumber(line.count)}</td>
          </tr>
        ))}
      </tbody>
      {totals ? (
        <tfoot className="border-t border-line-strong">
          <tr>
            <th scope="row" colSpan={2} className="py-3 pr-3 text-left font-semibold">
              Open work orders
              {totals.overdue > 0 ? (
                <span className="ml-2 font-normal text-critical">
                  {formatNumber(totals.overdue)} overdue
                </span>
              ) : null}
            </th>
            <td className="py-3 pl-3 text-right font-semibold tabular-nums">
              {formatNumber(totals.open)}
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
