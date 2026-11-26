import type { QueryClient } from "@tanstack/react-query";

import type { paths } from "./schema";

/**
 * Mark what was fetched from these endpoints as out of date. Lists on screen fetch again
 * straight away, and the promise resolves when they have; the rest fetch when next shown.
 *
 * Name every endpoint the change shows up in, not only the one that was written to:
 * archiving a building also changes its customer's building count.
 */
export async function invalidate(
  queryClient: QueryClient,
  ...endpoints: (keyof paths)[]
): Promise<void> {
  await Promise.all(
    endpoints.map((endpoint) => queryClient.invalidateQueries({ queryKey: ["get", endpoint] })),
  );
}
