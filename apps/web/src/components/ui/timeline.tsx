import { cn } from "@/lib/utils";

type TimelineProps = {
  /** Accessible name for the list: "History of WO-0412". */
  label: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * What happened to a record, one entry after another down a rail. The order is the
 * caller's: put the newest first where the latest news is what people open it for.
 */
export function Timeline({ label, className, children }: TimelineProps) {
  return (
    <ol aria-label={label} className={cn("text-[13px]", className)}>
      {children}
    </ol>
  );
}

type TimelineItemProps = {
  /** What happened, in a few words: "Work started". */
  title: React.ReactNode;
  /** Who did it, when that is known. */
  by?: string;
  /** When it happened, as an instant, for the `time` element. */
  at: string;
  /** The same moment as people read it: "Nov 24, 2026, 9:12 AM". */
  when: string;
  /** What was said with it: a comment, or the note given with a change. */
  children?: React.ReactNode;
};

export function TimelineItem({ title, by, at, when, children }: TimelineItemProps) {
  return (
    <li className="group relative flex gap-3 pb-5 last:pb-0">
      {/* The rail runs from this entry's marker down to the next one's. */}
      <span
        aria-hidden="true"
        className="absolute top-4 bottom-0 left-[3.5px] w-px bg-line group-last:hidden"
      />
      <span
        aria-hidden="true"
        className="relative mt-1.5 size-2 shrink-0 rounded-full border border-line-strong bg-surface"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-subtle">
          {by ? `${by} · ` : null}
          <time dateTime={at} className="tabular-nums">
            {when}
          </time>
        </p>
        {children ? (
          <div className="mt-1.5 rounded-sm bg-canvas px-3 py-2 wrap-break-word whitespace-pre-line text-ink">
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}
