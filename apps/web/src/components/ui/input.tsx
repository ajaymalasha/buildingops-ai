import { ChevronDown } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

const controlClasses =
  "border-line-strong bg-surface text-ink placeholder:text-ink-subtle hover:border-ink-subtle focus-visible:border-brand-500 focus-visible:ring-brand-500/20 disabled:bg-sunken disabled:text-ink-muted aria-invalid:border-critical aria-invalid:focus-visible:ring-critical/20 w-full rounded-sm border text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:hover:border-line-strong";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-9 px-3", className)} {...props} />;
}

type UnitInputProps = React.ComponentProps<"input"> & {
  /** What the number counts, shown inside the input after the value: "USD", "%", "days". */
  unit: string;
};

/** An input for an amount, with its unit shown inside it and read out after the value. */
export function UnitInput({ unit, className, ...props }: UnitInputProps) {
  const unitId = useId();
  return (
    <div className="relative">
      <input
        className={cn(controlClasses, "h-9 pr-14 pl-3 tabular-nums", className)}
        {...props}
        aria-describedby={[props["aria-describedby"], unitId].filter(Boolean).join(" ")}
      />
      <span
        id={unitId}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-subtle"
      >
        {unit}
      </span>
    </div>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-20 px-3 py-2", className)} {...props} />;
}

/** A native select: keyboard, screen reader and mobile behaviour come from the platform. */
export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(controlClasses, "h-9 cursor-pointer appearance-none pr-8 pl-3", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
}
