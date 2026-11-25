import { Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { Button } from "./button";

type EmptyStateProps = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

/** Shown where content would be, when there is none yet. Says what to do next. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      {Icon ? (
        <span className="mb-4 flex size-10 items-center justify-center rounded-md border border-line bg-surface text-ink-subtle">
          <Icon className="size-5" />
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
};

/** Shown where content would be, when loading it failed. */
export function ErrorState({
  title = "This didn't load",
  message,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center px-6 py-14 text-center", className)}
    >
      <span className="mb-4 flex size-10 items-center justify-center rounded-md bg-critical-soft text-critical">
        <TriangleAlert className="size-5" />
      </span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Shown in place of a page the signed-in person's role does not include. It is a courtesy:
 * the API refuses the data regardless of what the interface shows.
 */
export function NoAccess({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <span className="mb-4 flex size-10 items-center justify-center rounded-md border border-line bg-surface text-ink-subtle">
        <Lock className="size-5" />
      </span>
      <h1 className="text-base font-semibold text-ink">You don&apos;t have access to this page</h1>
      <p className="mt-1 max-w-sm text-[13px] text-ink-muted">
        Your role doesn&apos;t include {what}. If you need it, ask a company admin to change your
        role.
      </p>
      <Button asChild size="sm" className="mt-5">
        <Link href="/">Back to overview</Link>
      </Button>
    </div>
  );
}
