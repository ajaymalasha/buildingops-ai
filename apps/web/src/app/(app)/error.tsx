"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <ErrorState
        title="BuildingOps couldn't load"
        message="The page failed to load, most likely because the API is not reachable. Check that it is running, then try again."
        onRetry={reset}
      />
    </div>
  );
}
