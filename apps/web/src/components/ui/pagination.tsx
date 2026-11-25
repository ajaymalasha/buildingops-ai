import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "./button";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** What is being counted, plural: "members". */
  noun?: string;
};

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "results",
}: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5 text-[13px] text-ink-muted">
      <p className="tabular-nums" aria-live="polite">
        {total === 0
          ? `No ${noun}`
          : `${first}–${last} of ${total.toLocaleString("en-US")} ${noun}`}
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft />
          Previous
        </Button>
        <Button size="sm" disabled={last >= total} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
