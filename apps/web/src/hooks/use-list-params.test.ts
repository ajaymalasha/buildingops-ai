import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useListParams } from "./use-list-params";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => "/timesheets",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

/** The hook for a page at `/timesheets?<search>`. */
function listAt(search: string, options?: Parameters<typeof useListParams>[0]) {
  navigation.search = search;
  return renderHook(() => useListParams(options)).result.current;
}

const wentTo = () => navigation.replace.mock.lastCall?.[0] as string;

beforeEach(() => navigation.replace.mockClear());

describe("list state in the URL", () => {
  it("reads filters from the URL, and an empty one as not set", () => {
    const list = listAt("q=raman&status=&page=3");

    expect(list.get("q")).toBe("raman");
    expect(list.get("status")).toBeUndefined();
    expect(list.get("building_id")).toBeUndefined();
    expect(list.page).toBe(3);
  });

  it("starts on the first page, whatever the URL says the page is", () => {
    expect(listAt("").page).toBe(1);
    expect(listAt("page=0").page).toBe(1);
    expect(listAt("page=-2").page).toBe(1);
    expect(listAt("page=two").page).toBe(1);
  });

  it("goes back to the first page when a filter changes", () => {
    listAt("q=raman&page=3").update({ status: "approved" });

    expect(wentTo()).toBe("/timesheets?q=raman&status=approved");
    expect(navigation.replace).toHaveBeenCalledWith(expect.any(String), { scroll: false });
  });

  it("keeps the filters when only the page changes, and leaves page 1 out of the URL", () => {
    listAt("q=raman&page=3").update({ page: 4 });
    expect(wentTo()).toBe("/timesheets?q=raman&page=4");

    listAt("q=raman&page=3").update({ page: 1 });
    expect(wentTo()).toBe("/timesheets?q=raman");
  });

  it("takes a filter off when it is given nothing", () => {
    listAt("q=raman&status=approved").update({ status: "" });
    expect(wentTo()).toBe("/timesheets?q=raman");

    listAt("q=raman&status=approved").update({ q: null, status: undefined });
    expect(wentTo()).toBe("/timesheets");
  });

  it("does not count the page or the sort order as filters", () => {
    expect(listAt("page=2&sort=-work_date").hasFilters).toBe(false);
    expect(listAt("page=2&sort=-work_date&q=raman").hasFilters).toBe(true);
    expect(listAt("").hasFilters).toBe(false);
  });

  it("clears every filter, and the sort order with them", () => {
    listAt("q=raman&status=approved&sort=-work_date&page=2").clear();

    expect(wentTo()).toBe("/timesheets");
  });
});

describe("what a page is showing, as opposed to how it is narrowed", () => {
  const view = ["status"] as const;

  it("does not count the tab that is open as a filter", () => {
    expect(listAt("status=approved", { view }).hasFilters).toBe(false);
    expect(listAt("status=approved&building_id=b1", { view }).hasFilters).toBe(true);
    // The same parameter is a filter on a page that does not say otherwise.
    expect(listAt("status=approved").hasFilters).toBe(true);
  });

  it("stays in the tab when the filters are cleared", () => {
    listAt("status=approved&building_id=b1&from=2026-11-01&sort=employee&page=2", { view }).clear();

    expect(wentTo()).toBe("/timesheets?status=approved");
  });

  it("goes back to the first page when the tab changes, like any other change", () => {
    listAt("building_id=b1&page=3", { view }).update({ status: "rejected" });

    expect(wentTo()).toBe("/timesheets?building_id=b1&status=rejected");
  });

  it("keeps several such parameters, as a schedule keeps its building and its week", () => {
    const schedule = ["building_id", "week", "cancelled"] as const;

    expect(
      listAt("building_id=b1&week=2026-11-23&cancelled=true", { view: schedule }).hasFilters,
    ).toBe(false);
    listAt("building_id=b1&week=2026-11-23", { view: schedule }).clear();
    expect(wentTo()).toBe("/timesheets?building_id=b1&week=2026-11-23");
  });
});
