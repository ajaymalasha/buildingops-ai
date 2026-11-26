"use client";

import { ToggleGroup } from "radix-ui";
import { useOptimistic, useTransition } from "react";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type Segment<Value extends string> = {
  value: Value;
  label: string;
  /** How many records the choice holds, shown after its label. Left out while unknown. */
  count?: number;
};

type SegmentedControlProps<Value extends string> = {
  /** The accessible name: "Timesheets by status". */
  label: string;
  value: Value;
  segments: readonly Segment<Value>[];
  onChange: (value: Value) => void;
  className?: string;
};

/**
 * A row of choices of which exactly one is on: the views of a list, such as the pending,
 * approved and rejected halves of an approval queue.
 *
 * To assistive technology it is a group of radio buttons. Tab reaches the one that is on,
 * and the arrow keys move between them, as they do in any radio group.
 *
 * Which choice is on is its owner's to say, and that usually comes from the URL, a moment
 * after the click. The choice that was pressed is shown as on at once all the same, and
 * falls in with its owner as soon as the change it asked for has gone through.
 */
export function SegmentedControl<Value extends string>({
  label,
  value,
  segments,
  onChange,
  className,
}: SegmentedControlProps<Value>) {
  const [, startTransition] = useTransition();
  const [shown, show] = useOptimistic(value);
  return (
    <ToggleGroup.Root
      type="single"
      role="radiogroup"
      aria-label={label}
      value={shown}
      onValueChange={(next) => {
        // Pressing the choice that is on would turn it off. One of them is always on.
        if (!next) return;
        startTransition(() => {
          show(next as Value);
          onChange(next as Value);
        });
      }}
      className={cn(
        "inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-sm border border-line bg-sunken p-0.5",
        className,
      )}
    >
      {segments.map((segment) => (
        <ToggleGroup.Item
          key={segment.value}
          value={segment.value}
          // The ring is drawn inside the choice: outside it, the group's edge would cut it off.
          className="group inline-flex h-full shrink-0 cursor-pointer items-center gap-1.5 rounded-xs px-3 text-[13px] font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-ink focus-visible:-outline-offset-2 data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-raised max-sm:px-2.5"
        >
          {segment.label}
          {segment.count === undefined ? null : (
            // On a phone there is room for one count: that of the choice that is on.
            <span className="text-xs font-normal text-ink-subtle tabular-nums max-sm:group-data-[state=off]:hidden">
              {formatNumber(segment.count)}
            </span>
          )}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
