import { cn } from "@/lib/utils";

/*
 * Cells for text that can be long: names, addresses, emails.
 *
 * In a wide window they show their text in full. As the window narrows they give way before
 * the table has to scroll sideways: the text wraps onto a second line, then ends in an
 * ellipsis. They never shrink below a width that still reads, and never grow past one that
 * would crowd out the other columns.
 */

type NameCellProps = {
  name: string;
  code?: string;
  /**
   * Opens the record. The name and its code then make up a button, which is what the
   * keyboard and screen readers open the row with.
   */
  onOpen?: () => void;
};

/** The cell that identifies a row: its name and, under it, the code people quote. */
export function NameCell({ name, code, onOpen }: NameCellProps) {
  const content = (
    <>
      <span
        className={cn("line-clamp-2 font-medium text-ink", onOpen && "group-hover:underline")}
        title={name}
      >
        {name}
      </span>
      {code ? (
        <>
          {/* Read out as two words, not run together, where the two make up a button. */}{" "}
          <span className="block font-mono text-[11px] whitespace-nowrap text-ink-subtle">
            {code}
          </span>
        </>
      ) : null}
    </>
  );
  if (!onOpen) return <div className="max-w-72 min-w-36">{content}</div>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block max-w-72 min-w-36 cursor-pointer rounded-xs text-left"
    >
      {content}
    </button>
  );
}

type StackedCellProps = {
  primary: React.ReactNode;
  /** A quieter detail under the value, where a column of its own would cost more than it tells. */
  secondary?: React.ReactNode;
  /** For a value that must stay on one line, pass `min-w-0 whitespace-nowrap`. */
  className?: string;
};

export function StackedCell({ primary, secondary, className }: StackedCellProps) {
  return (
    <div className={cn("max-w-72 min-w-28", className)}>
      <p className="line-clamp-2">{primary}</p>
      {secondary ? (
        // An email address has nowhere to wrap, so it may be cut anywhere.
        <p className="line-clamp-1 text-xs [overflow-wrap:anywhere] text-ink-muted">{secondary}</p>
      ) : null}
    </div>
  );
}

/** Stands where a value would be when nothing is recorded. Read out as `label`. */
export function Blank({ label = "Not set" }: { label?: string }) {
  return (
    <span className="text-ink-subtle">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
