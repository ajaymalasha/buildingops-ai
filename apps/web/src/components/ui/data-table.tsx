"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { isProblem, problemMessage } from "@/lib/api/problem";
import { selectionState, toggleAll, toggleOne } from "@/lib/selection";
import { cn } from "@/lib/utils";

import { Checkbox } from "./checkbox";
import { Skeleton } from "./skeleton";
import { ErrorState } from "./states";

export type Column<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /** The API sort field. Columns without one are not sortable. */
  sortKey?: string;
  align?: "start" | "end";
  /** Tailwind width class, for columns that should not stretch. */
  width?: string;
};

/** Rows that can be ticked, to act on several at once. The caller owns what is ticked. */
export type RowSelection<Row> = {
  /** The keys (as `rowKey` gives them) of the rows that are ticked. */
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  /** Which rows can be ticked. The others get no box: a timesheet already decided on. */
  isSelectable: (row: Row) => boolean;
  /** Names a row's box: "Select the timesheet of Ana Zamora for Nov 24". */
  rowLabel: (row: Row) => string;
  /** Names the box in the heading: "Select all pending timesheets on this page". */
  allLabel: string;
};

/** What a click on a row leaves alone: a control inside the row has its own job. */
const INTERACTIVE = "a, button, input, select, textarea, label";

type DataTableProps<Row> = {
  /** Accessible name for the table. */
  caption: string;
  columns: Column<Row>[];
  rows: Row[] | undefined;
  rowKey: (row: Row) => string;
  isLoading: boolean;
  /** True while showing previous rows during a refetch. */
  isRefreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** What to show when the request succeeded and returned nothing. */
  empty: React.ReactNode;
  /** Current sort, as sent to the API: `name` or `-name`. */
  sort?: string;
  onSortChange?: (sort: string | undefined) => void;
  skeletonRows?: number;
  /** Adds a first column of boxes for ticking rows. */
  selection?: RowSelection<Row>;
  /**
   * Opens a row when it is clicked anywhere that is not a control of its own. This is a
   * shortcut for the pointer: also give the row a button that does the same, such as
   * `NameCell` with `onOpen`, for the keyboard and for screen readers.
   */
  onRowClick?: (row: Row) => void;
};

/**
 * A server-driven table. The API does the sorting, filtering and paging; this component
 * renders the four states a list can be in: loading, failed, empty and populated.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  isLoading,
  isRefreshing = false,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  skeletonRows = 8,
  selection,
  onRowClick,
}: DataTableProps<Row>) {
  if (error && !rows) {
    // Being refused is not a failure to load, and asking again will not change the answer.
    const refused = isProblem(error) && error.status === 403;
    return (
      <ErrorState
        title={refused ? "You don't have access to this" : undefined}
        message={problemMessage(error)}
        onRetry={refused ? undefined : onRetry}
      />
    );
  }
  if (!isLoading && rows?.length === 0) {
    return <>{empty}</>;
  }

  const sortKey = sort?.replace(/^-/, "");
  const descending = sort?.startsWith("-") ?? false;

  function nextSort(key: string): string | undefined {
    if (sortKey !== key) return key;
    return descending ? undefined : `-${key}`;
  }

  // Text that starts right after a right-aligned number gets more room on its left, so the
  // two do not read as one value.
  const gapBefore = columns.map((column, index) =>
    column.align !== "end" && columns[index - 1]?.align === "end" ? "pl-8" : undefined,
  );

  // The rows on this page that can be ticked: what the box in the heading stands for.
  const selectable = selection ? (rows ?? []).filter(selection.isSelectable).map(rowKey) : [];
  const ticked = selection ? selectionState(selection.selected, selectable) : "none";

  return (
    <div className="overflow-x-auto">
      <table
        aria-busy={isLoading || isRefreshing}
        className={cn("w-full text-[13px] transition-opacity", isRefreshing && "opacity-60")}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-canvas/60">
            {selection ? (
              <th scope="col" className="h-9 w-10 pr-0 pl-4 text-left">
                <Checkbox
                  labelHidden
                  label={selection.allLabel}
                  checked={ticked === "all"}
                  indeterminate={ticked === "some"}
                  disabled={selectable.length === 0}
                  onChange={() => selection.onChange(toggleAll(selection.selected, selectable))}
                />
              </th>
            ) : null}
            {columns.map((column, columnIndex) => {
              const active = column.sortKey !== undefined && column.sortKey === sortKey;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={active ? (descending ? "descending" : "ascending") : undefined}
                  className={cn(
                    "h-9 px-4 text-xs font-medium whitespace-nowrap text-ink-muted",
                    column.align === "end" ? "text-right" : "text-left",
                    gapBefore[columnIndex],
                    column.width,
                  )}
                >
                  {column.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(nextSort(column.sortKey!))}
                      className={cn(
                        "group -mx-1 inline-flex cursor-pointer items-center gap-1 rounded-xs px-1 py-0.5 transition-colors hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {column.header}
                      {active ? (
                        descending ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUp className="size-3.5" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {isLoading
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index}>
                  {selection ? <td className="h-11 w-10" /> : null}
                  {columns.map((column, columnIndex) => (
                    <td key={column.id} className={cn("h-11 px-4", gapBefore[columnIndex])}>
                      <Skeleton
                        className={cn(
                          "h-3.5",
                          columnIndex === 0 ? "w-40" : "w-24",
                          column.align === "end" && "ml-auto",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((row) => {
                const key = rowKey(row);
                const isTicked = selection?.selected.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    className={cn(
                      "transition-colors hover:bg-canvas/50",
                      isTicked && "bg-brand-50/50 hover:bg-brand-50/70",
                      onRowClick && "cursor-pointer",
                    )}
                    onClick={
                      onRowClick
                        ? (event) => {
                            // A control in the row does its own job, and dragging across
                            // the row to copy its text is not a click on it.
                            if ((event.target as Element).closest(INTERACTIVE)) return;
                            if (window.getSelection()?.toString()) return;
                            onRowClick(row);
                          }
                        : undefined
                    }
                  >
                    {selection ? (
                      <td className="h-11 w-10 py-2 pr-0 pl-4 align-middle">
                        {selection.isSelectable(row) ? (
                          <Checkbox
                            labelHidden
                            label={selection.rowLabel(row)}
                            checked={isTicked}
                            onChange={() => selection.onChange(toggleOne(selection.selected, key))}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    {columns.map((column, columnIndex) => (
                      <td
                        key={column.id}
                        className={cn(
                          "h-11 px-4 py-2 align-middle text-ink",
                          column.align === "end" && "text-right tabular-nums",
                          gapBefore[columnIndex],
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
