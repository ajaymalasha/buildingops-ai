import { Skeleton } from "@/components/ui/skeleton";

import { Wordmark } from "./logo";

/**
 * The static frame shown while the session is verified. It has the same geometry as the
 * real shell, so nothing shifts when the content arrives.
 */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh" aria-busy="true" aria-label="Loading">
      <aside className="fixed inset-y-0 left-0 hidden w-60 bg-night text-night-ink lg:block">
        <div className="flex h-14 items-center px-5">
          <Wordmark />
        </div>
        <div className="space-y-2 px-5 py-5">
          {[28, 36, 32, 30].map((width, index) => (
            <div
              key={index}
              className="h-3.5 rounded-xs bg-night-raised"
              style={{ width: `${width * 4}px` }}
            />
          ))}
        </div>
      </aside>
      <div className="lg:pl-60">
        <div className="flex h-14 items-center border-b border-line px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-3 h-3.5 w-80" />
          <Skeleton className="mt-8 h-64 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
