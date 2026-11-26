"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type Changes = Record<string, string | number | null | undefined>;

type Options = {
  /**
   * Parameters that choose what the page shows rather than narrow it: the tab that is
   * open, the week or the building on show. They are not counted as filters, and
   * clearing the filters leaves them alone.
   */
  view?: readonly string[];
};

const NO_VIEW: readonly string[] = [];

/**
 * List state (search, filters, sort, page) kept in the URL.
 *
 * A filtered view can then be bookmarked or shared, and survives a reload. Changing any
 * filter returns to the first page, because page 4 of the old result set means nothing
 * in the new one.
 */
export function useListParams({ view = NO_VIEW }: Options = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Callers pass a new array each time they render. What it holds is what matters.
  const viewKeys = view.join(",");

  const get = useCallback((key: string) => searchParams.get(key) || undefined, [searchParams]);

  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const go = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const update = useCallback(
    (changes: Changes) => {
      const next = new URLSearchParams(searchParams);
      if (!("page" in changes)) next.delete("page");
      for (const [key, value] of Object.entries(changes)) {
        if (
          value === null ||
          value === undefined ||
          value === "" ||
          (key === "page" && value === 1)
        ) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      go(next);
    },
    [go, searchParams],
  );

  const isFilter = useCallback(
    (key: string) => key !== "page" && key !== "sort" && !viewKeys.split(",").includes(key),
    [viewKeys],
  );

  const hasFilters = [...searchParams.keys()].some(isFilter);

  const clear = useCallback(() => {
    const next = new URLSearchParams();
    for (const [key, value] of searchParams) {
      if (viewKeys.split(",").includes(key)) next.set(key, value);
    }
    go(next);
  }, [go, searchParams, viewKeys]);

  return { get, page, update, clear, hasFilters };
}
