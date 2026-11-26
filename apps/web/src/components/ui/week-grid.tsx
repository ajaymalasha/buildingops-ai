import { formatLongDay, formatMonthDay, formatWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Skeleton } from "./skeleton";

type WeekGridProps<Row> = {
  /** Accessible name for the table: "Schedule for Calloway Tower, Nov 23 – 29, 2026". */
  caption: string;
  /** The days across the top, as YYYY-MM-DD, in order: a week from `weekDays`. */
  days: readonly string[];
  /** Today's date where the organization is, to mark its column. */
  today: string;
  /** Heading of the first column, which names each row: "Employee". */
  rowHeading: string;
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  /** The cell that names a row: a person and, under them, a quieter detail. */
  rowHeader: (row: Row) => React.ReactNode;
  /** What a row has on a day. Nothing at all leaves the cell empty. */
  cell: (row: Row, day: string) => React.ReactNode;
  /** True until the week's rows have arrived. Placeholder rows stand in for them. */
  isLoading?: boolean;
  skeletonRows?: number;
};

/**
 * A week laid out as a grid: one row for each person (or anything else that has a week)
 * and one column for each day, with today's column marked.
 *
 * It is a table, so a screen reader announces the person and the day with each cell. In
 * a narrow window it scrolls sideways under its first column, which stays in view.
 */
export function WeekGrid<Row>({
  caption,
  days,
  today,
  rowHeading,
  rows,
  rowKey,
  rowHeader,
  cell,
  isLoading = false,
  skeletonRows = 5,
}: WeekGridProps<Row>) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-busy={isLoading}
        className="w-full min-w-200 table-fixed border-separate border-spacing-0 text-[13px] sm:min-w-232"
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {/* Narrower on a phone, where every day it leaves room for counts. */}
          <col className="w-36 sm:w-52" />
          {days.map((day) => (
            <col key={day} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/*
              The first column stays put while the days scroll under it, so it cannot be
              see-through. Its heading is the tint of the other headings, mixed solid.
            */}
            <th
              scope="col"
              className="sticky left-0 z-10 h-12 border-b border-line bg-[color-mix(in_srgb,var(--color-canvas)_60%,var(--color-surface))] px-4 text-left text-xs font-medium text-ink-muted"
            >
              {rowHeading}
            </th>
            {days.map((day) => {
              const isToday = day === today;
              return (
                <th
                  key={day}
                  scope="col"
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    "h-12 border-b border-l border-line px-2.5 text-left font-normal",
                    isToday ? "bg-brand-50" : "bg-canvas/60",
                  )}
                >
                  <span aria-hidden="true" className="block">
                    <span
                      className={cn(
                        "block text-xs font-medium",
                        isToday ? "text-brand-700" : "text-ink-muted",
                      )}
                    >
                      {formatWeekday(day)}
                    </span>
                    <span className="block text-xs text-ink-subtle tabular-nums">
                      {formatMonthDay(day)}
                    </span>
                  </span>
                  <span className="sr-only">
                    {formatLongDay(day)}
                    {isToday ? ", today" : ""}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        {/* The surface the grid sits in draws the line under the last row. */}
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:last-child>th]:border-b-0">
          {isLoading
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index}>
                  <th className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-3">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="mt-2 h-3 w-20" />
                  </th>
                  {days.map((day, position) => (
                    <td key={day} className="border-b border-l border-line p-1.5 align-top">
                      {/* Most people work five days of the seven. */}
                      {position < 5 ? <Skeleton className="h-9 w-full" /> : null}
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((row) => (
                <tr key={rowKey(row)}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-2.5 text-left align-top font-normal"
                  >
                    {rowHeader(row)}
                  </th>
                  {days.map((day) => (
                    <td
                      key={day}
                      className={cn(
                        "border-b border-l border-line p-1.5 align-top",
                        day === today && "bg-brand-50/50",
                      )}
                    >
                      {cell(row, day)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
