"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type Changes = Record<string, string | number | null | undefined>;

/**
 * List state (search, filters, sort, page) kept in the URL.
 *
 * A filtered view can then be bookmarked or shared, and survives a reload. Changing any
 * filter returns to the first page, because page 4 of the old result set means nothing
 * in the new one.
 */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const get = useCallback((key: string) => searchParams.get(key) || undefined, [searchParams]);

  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

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
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const hasFilters = [...searchParams.keys()].some((key) => key !== "page" && key !== "sort");

  const clear = useCallback(() => router.replace(pathname, { scroll: false }), [pathname, router]);

  return { get, page, update, clear, hasFilters };
}
