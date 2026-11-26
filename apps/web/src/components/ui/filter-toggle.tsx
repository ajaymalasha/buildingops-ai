"use client";

import { Check } from "lucide-react";
import { useId, useOptimistic, useTransition } from "react";

import { cn } from "@/lib/utils";

type FilterToggleProps = {
  /** What the list is narrowed to while this is on: "Overdue only". */
  label: string;
  /** Whether the filter is applied (from the URL). */
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

/**
 * A filter in a list toolbar that is either on or off. It is a native checkbox drawn at
 * the height of the selects beside it, with its label inside.
 *
 * Whether the filter is applied is its owner's to say, and that usually comes from the
 * URL, a moment after the click. The box is ticked at once all the same, and falls in
 * with its owner as soon as the change it asked for has gone through.
 */
export function FilterToggle({ label, checked, onChange, className }: FilterToggleProps) {
  const id = useId();
  const [, startTransition] = useTransition();
  const [shown, show] = useOptimistic(checked);
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border bg-surface px-3 text-sm whitespace-nowrap text-ink transition-colors select-none has-[:focus-visible]:border-brand-500 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-brand-500/20",
        shown ? "border-brand-600" : "border-line-strong hover:border-ink-subtle",
        className,
      )}
    >
      <span className="relative flex size-4 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={shown}
          onChange={(event) => {
            const next = event.target.checked;
            startTransition(() => {
              show(next);
              onChange(next);
            });
          }}
          // The label around it shows the focus, as the selects beside it do.
          className="peer size-4 cursor-pointer appearance-none rounded-xs border border-line-strong bg-surface transition-colors checked:border-brand-600 checked:bg-brand-600 focus-visible:outline-none"
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100"
        />
      </span>
      {label}
    </label>
  );
}
