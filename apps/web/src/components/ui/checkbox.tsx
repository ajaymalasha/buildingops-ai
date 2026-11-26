"use client";

import { Check, Minus } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  label: React.ReactNode;
  /** A sentence under the label saying what ticking the box does. */
  description?: string;
  /** Keep the label for screen readers only, where the box sits beside what it selects. */
  labelHidden?: boolean;
  /** Some, but not all, of what the box stands for is ticked: the "select all" of a list. */
  indeterminate?: boolean;
};

/**
 * A labelled checkbox. It is a native input, so the keyboard, forms and screen readers
 * treat it as one; only its appearance is drawn here.
 */
export function Checkbox({
  id,
  label,
  description,
  labelHidden = false,
  indeterminate = false,
  className,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const box = useRef<HTMLSpanElement>(null);

  // "Some of them" is not an attribute. It can only be set on the element itself.
  useEffect(() => {
    const input = box.current?.querySelector("input");
    if (input) input.indeterminate = indeterminate;
  }, [indeterminate]);

  const control = (
    <span ref={box} className={cn("relative flex size-4 shrink-0", !labelHidden && "mt-0.5")}>
      <input
        id={inputId}
        type="checkbox"
        aria-describedby={descriptionId}
        // Focus shows as the outline every control without a border of its own gets.
        className="peer size-4 cursor-pointer appearance-none rounded-xs border border-line-strong bg-surface transition-colors checked:border-brand-600 checked:bg-brand-600 indeterminate:border-brand-600 indeterminate:bg-brand-600 hover:border-ink-subtle checked:hover:border-brand-700 checked:hover:bg-brand-700 indeterminate:hover:border-brand-700 indeterminate:hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
        {...props}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );

  if (labelHidden) {
    return (
      <span className={cn("inline-flex align-middle", className)}>
        {control}
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
      </span>
    );
  }
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      {control}
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block cursor-pointer text-[13px] font-medium text-ink">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-[13px] text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
