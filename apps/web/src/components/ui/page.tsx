import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-ink-muted">{description}</p> : null}
      </div>
      {/* Never wider than the page: on the narrowest phones what is here wraps instead. */}
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** A bordered surface. The basic container for tables and forms. */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("overflow-hidden rounded-md border border-line bg-surface", className)}
      {...props}
    />
  );
}

type SectionProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
};

/** A titled block on a settings-style page: explanation on the left, content on the right. */
export function Section({ title, description, children, className }: SectionProps) {
  return (
    <section
      className={cn(
        "grid gap-x-10 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-0 lg:grid-cols-[260px_minmax(0,1fr)]",
        className,
      )}
    >
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-ink-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
