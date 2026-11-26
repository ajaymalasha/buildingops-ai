import { cn } from "@/lib/utils";

type FormSectionProps = {
  title: string;
  /** A line under the title, for a group that needs explaining. */
  description?: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * A titled group of fields in a long form. Groups after the first are set off by a
 * hairline. It is a fieldset, so the title is announced with each field inside it.
 */
export function FormSection({ title, description, className, children }: FormSectionProps) {
  return (
    <fieldset
      className={cn("min-w-0 border-t border-line pt-5 first:border-t-0 first:pt-0", className)}
    >
      {/* Floated so the legend sits inside the fieldset's padding instead of on its border. */}
      <legend className="float-left w-full eyebrow">{title}</legend>
      <div className="clear-both space-y-4 pt-3">
        {description ? <p className="-mt-1.5 text-[13px] text-ink-muted">{description}</p> : null}
        {children}
      </div>
    </fieldset>
  );
}
