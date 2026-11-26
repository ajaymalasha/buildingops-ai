import { ErrorState } from "@/components/ui/states";
import { isProblem, problemMessage } from "@/lib/api/problem";
import { cn } from "@/lib/utils";

type ReportSectionProps = {
  /** Ties the heading to the section. Unique on the page. */
  id: string;
  title: string;
  /** What the section covers, after its title: "October 2026". */
  scope?: React.ReactNode;
  /** Set against the title at the far end of its line: a legend. */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/**
 * A part of the dashboard: a rule, a heading, and what it reports. The dashboard is set
 * like a report, so its parts are told apart by rules and space, not by boxes.
 *
 * What is inside is laid out by the width of the section (it is a container), which is
 * half the page's where two sections stand side by side.
 */
export function ReportSection({
  id,
  title,
  scope,
  aside,
  className,
  children,
}: ReportSectionProps) {
  return (
    <section aria-labelledby={id} className={cn("@container border-t border-line pt-6", className)}>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h2 id={id} className="text-[15px] font-semibold text-ink">
            {title}
          </h2>
          {scope ? <p className="text-[13px] text-ink-muted">{scope}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

type SectionErrorProps = {
  error: unknown;
  onRetry: () => void;
};

/**
 * Stands where a section's figures would be when they could not be loaded. Each section
 * loads its own, so the rest of the report is still there.
 */
export function SectionError({ error, onRetry }: SectionErrorProps) {
  // Being refused is not a failure to load, and asking again will not change the answer.
  const refused = isProblem(error) && error.status === 403;
  return (
    <ErrorState
      className="py-8"
      title={refused ? "You don't have access to this" : undefined}
      message={problemMessage(error)}
      onRetry={refused ? undefined : onRetry}
    />
  );
}

/** A line saying there is nothing to show, where a table or a chart would be. */
export function NothingToShow({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-[13px] text-ink-muted">{children}</p>;
}
