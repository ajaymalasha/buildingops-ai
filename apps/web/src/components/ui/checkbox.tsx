import { Check } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  label: React.ReactNode;
  /** A sentence under the label saying what ticking the box does. */
  description?: string;
};

/**
 * A labelled checkbox. It is a native input, so the keyboard, forms and screen readers
 * treat it as one; only its appearance is drawn here.
 */
export function Checkbox({ id, label, description, className, ...props }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <span className="relative mt-0.5 flex size-4 shrink-0">
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={descriptionId}
          // Focus shows as the outline every control without a border of its own gets.
          className="peer size-4 cursor-pointer appearance-none rounded-xs border border-line-strong bg-surface transition-colors checked:border-brand-600 checked:bg-brand-600 hover:border-ink-subtle checked:hover:border-brand-700 checked:hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-50"
          {...props}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3 text-white opacity-0 peer-checked:opacity-100"
        />
      </span>
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
