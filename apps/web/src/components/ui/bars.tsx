import { cn } from "@/lib/utils";

/*
 * Bars drawn inside a row of a table or a list, beside the figure they stand for. They are
 * decoration for the eye: the figure itself is always there in words, so assistive
 * technology is told nothing about them.
 */

export type BarTone = "brand" | "graphite" | "muted" | "critical";

const TONES: Record<BarTone, string> = {
  brand: "bg-brand-600",
  graphite: "bg-ink-muted",
  muted: "bg-line-strong",
  critical: "bg-critical",
};

type ShareBarProps = {
  /** How much of its room the bar fills, from 0 to 100. */
  percent: number;
  tone?: BarTone;
  className?: string;
};

/** A bar from the left edge: a share of a whole, or a size beside the largest of its kind. */
export function ShareBar({ percent, tone = "graphite", className }: ShareBarProps) {
  const width = Math.min(Math.max(percent, 0), 100);
  return (
    <span aria-hidden="true" className={cn("block h-2", className)}>
      <span
        // Anything above nothing shows, however small.
        className={cn("block h-full rounded-[1px]", TONES[tone], width > 0 && "min-w-0.5")}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

type BalanceBarProps = {
  /** How far the bar reaches from the middle, from -100 (all the way left) to 100. */
  percent: number;
  className?: string;
};

/**
 * A bar that grows from a line down the middle: to the right in pine for a gain, to the
 * left in the critical colour for a loss.
 */
export function BalanceBar({ percent, className }: BalanceBarProps) {
  const reach = Math.min(Math.abs(percent), 100);
  const loss = percent < 0;
  return (
    <span aria-hidden="true" className={cn("relative block h-2", className)}>
      <span className="absolute inset-y-[-4px] left-1/2 w-px bg-ink-subtle" />
      <span
        className={cn(
          "absolute inset-y-0 rounded-[1px]",
          loss ? "right-1/2 bg-critical" : "left-1/2 bg-brand-600",
          reach > 0 && "min-w-0.5",
        )}
        style={{ width: `${reach / 2}%` }}
      />
    </span>
  );
}
