import { cn } from "@/lib/utils";

type ControlProps = {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
};

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  /** Keep the label for screen readers only, when a heading just above already says it. */
  labelHidden?: boolean;
  className?: string;
  /** Receives the id and ARIA attributes that tie the control to its label and messages. */
  children: (control: ControlProps) => React.ReactNode;
};

/** A labelled form control with a hint and a validation message. */
export function Field({
  id,
  label,
  hint,
  error,
  optional,
  labelHidden,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={labelHidden ? "sr-only" : "text-[13px] font-medium text-ink"}>
        {label}
        {optional ? <span className="font-normal text-ink-subtle"> (optional)</span> : null}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
      })}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
