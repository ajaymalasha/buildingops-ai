import { describe, expect, it, vi } from "vitest";

import { formatValue } from "@/features/audit/audit-log-page";
import { safeRedirectPath } from "@/features/auth/sign-in";
import {
  addMemberSchema,
  editMemberSchema,
  generatePassword,
} from "@/features/members/member-form-schema";
import { fieldErrors, isProblem, problemMessage } from "@/lib/api/problem";
import { nextDay, startOfDayInZone } from "@/lib/dates";
import { applyProblem, pick } from "@/lib/forms";
import { formatDate, formatDateTime, formatRelative, humanize, initials } from "@/lib/format";
import { breadcrumbsFor, isActivePath, visibleNavigation } from "@/lib/navigation";
import { groupedTimeZones, timeZoneLabel } from "@/lib/regional";

describe("safeRedirectPath", () => {
  it.each([
    ["/settings/members?role=supervisor", "/settings/members?role=supervisor"],
    ["/", "/"],
  ])("keeps a path on this site: %s", (next, expected) => {
    expect(safeRedirectPath(next)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a scheme", "javascript:alert(1)"],
    ["the sign-in page itself", "/login?next=/"],
    ["an API route", "/api/v1/members"],
    ["the session-ended route", "/session/ended"],
    ["nothing", ""],
    ["null", null],
  ])("falls back to the home page for %s", (_label, next) => {
    expect(safeRedirectPath(next)).toBe("/");
  });
});

describe("dates in a time zone", () => {
  it.each([
    ["2026-01-15", "America/New_York", "2026-01-15T05:00:00.000Z"], // EST, UTC-5
    ["2026-07-15", "America/New_York", "2026-07-15T04:00:00.000Z"], // EDT, UTC-4
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"], // clocks change later that day
    ["2026-03-09", "America/New_York", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00.000Z"], // clocks go back that day
    ["2026-06-01", "Asia/Kolkata", "2026-05-31T18:30:00.000Z"], // UTC+5:30
    ["2026-06-01", "UTC", "2026-06-01T00:00:00.000Z"],
  ])("%s starts in %s at %s", (date, zone, expected) => {
    expect(startOfDayInZone(date, zone).toISOString()).toBe(expected);
  });

  it("steps to the next day across month and year ends", () => {
    expect(nextDay("2026-02-28")).toBe("2026-03-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("formatting", () => {
  const instant = "2026-11-25T22:54:00Z";

  it("shows dates and times in the requested zone", () => {
    expect(formatDateTime(instant, "America/New_York")).toBe("Nov 25, 2026, 5:54 PM");
    expect(formatDateTime(instant, "Asia/Tokyo")).toBe("Nov 26, 2026, 7:54 AM");
    expect(formatDate(instant, "Asia/Tokyo")).toBe("Nov 26, 2026");
  });

  it("describes how long ago something happened", () => {
    const now = new Date("2026-11-25T23:00:00Z");
    expect(formatRelative("2026-11-25T22:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-11-25T22:54:00Z", now)).toBe("6 minutes ago");
    expect(formatRelative("2026-11-25T20:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-11-24T23:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-11-02T23:00:00Z", now)).toBe("3 weeks ago");
    expect(formatRelative("2025-11-25T23:00:00Z", now)).toBe("last year");
    expect(formatRelative("2026-11-27T23:00:00Z", now)).toBe("in 2 days");
  });

  it("derives initials", () => {
    expect(initials("Dana Whitfield")).toBe("DW");
    expect(initials("Luis de la Ortega")).toBe("LO");
    expect(initials("cher")).toBe("C");
    expect(initials("   ")).toBe("?");
  });

  it("rewords codes", () => {
    expect(humanize("operations_manager")).toBe("Operations manager");
    expect(humanize("member.role_changed")).toBe("Member role changed");
  });

  it("rewords recorded codes but shows recorded text exactly", () => {
    expect(formatValue("operations_manager")).toBe("Operations manager");
    expect(formatValue("tessa.nguyen@meridianfs.example")).toBe("tessa.nguyen@meridianfs.example");
    expect(formatValue("Regional Manager")).toBe("Regional Manager");
    expect(formatValue("America/New_York")).toBe("America/New_York");
    expect(formatValue(null)).toBe("empty");
    expect(formatValue("")).toBe("empty");
    expect(formatValue(42)).toBe("42");
  });
});

describe("API problems", () => {
  const problem = {
    type: "about:blank",
    title: "Validation failed",
    status: 422,
    code: "validation_error",
    detail: "One or more fields are invalid.",
    errors: [
      { field: "email", message: "Already a member." },
      { field: "password", message: "Use at least 10 characters." },
    ],
  };

  it("recognizes a problem document", () => {
    expect(isProblem(problem)).toBe(true);
    expect(isProblem(new TypeError("fetch failed"))).toBe(false);
    expect(isProblem(null)).toBe(false);
    expect(isProblem("Internal Server Error")).toBe(false);
  });

  it("chooses a message for the user", () => {
    expect(problemMessage(problem)).toBe("One or more fields are invalid.");
    expect(problemMessage({ ...problem, detail: undefined })).toBe("Validation failed");
    expect(problemMessage(new TypeError("fetch failed"))).toBe("Something went wrong. Try again.");
    expect(problemMessage(undefined, "Could not save.")).toBe("Could not save.");
  });

  it("maps field errors by field name", () => {
    expect(fieldErrors(problem)).toEqual({
      email: "Already a member.",
      password: "Use at least 10 characters.",
    });
    expect(fieldErrors(new Error("nope"))).toEqual({});
  });

  it("puts messages on the fields a form has, and returns the rest for the form", () => {
    const setError = vi.fn();

    expect(applyProblem(problem, setError, ["email", "full_name"])).toBeNull();
    expect(setError).toHaveBeenCalledExactlyOnceWith("email", {
      type: "server",
      message: "Already a member.",
    });

    setError.mockClear();
    expect(applyProblem(problem, setError, ["full_name"])).toBe("One or more fields are invalid.");
    expect(setError).not.toHaveBeenCalled();
  });

  it("only accepts filter values it knows", () => {
    expect(pick("active", ["active", "suspended"] as const)).toBe("active");
    expect(pick("deleted", ["active", "suspended"] as const)).toBeUndefined();
    expect(pick(undefined, ["active"] as const)).toBeUndefined();
  });
});

describe("navigation", () => {
  const labels = (permissions: Parameters<typeof visibleNavigation>[0]) =>
    visibleNavigation(permissions).flatMap((section) => section.items.map((item) => item.label));

  it("shows each person only what their permissions allow", () => {
    expect(labels(["organization:read"])).toEqual(["Overview", "Organization"]);
    expect(labels(["organization:read", "members:read", "audit:read"])).toEqual([
      "Overview",
      "Members",
      "Organization",
      "Audit log",
    ]);
    expect(labels(["platform:organizations"])).toEqual(["Overview", "Organizations"]);
    expect(labels([])).toEqual(["Overview"]);
  });

  it("drops a section when none of its items are visible", () => {
    const sections = visibleNavigation(["organization:read"]).map((section) => section.label);
    expect(sections).toEqual([undefined, "Administration"]);
  });

  it("marks the right item active", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/members", "/")).toBe(false);
    expect(isActivePath("/settings/members", "/settings/members")).toBe(true);
    expect(isActivePath("/settings/members/abc", "/settings/members")).toBe(true);
    expect(isActivePath("/settings/members-archive", "/settings/members")).toBe(false);
  });

  it("builds breadcrumbs from the navigation", () => {
    expect(breadcrumbsFor("/")).toEqual(["Overview"]);
    expect(breadcrumbsFor("/settings/audit-log")).toEqual(["Administration", "Audit log"]);
    expect(breadcrumbsFor("/settings/account")).toEqual(["Account"]);
    expect(breadcrumbsFor("/nowhere")).toEqual([]);
  });
});

describe("regional settings", () => {
  it("groups time zones by region and keeps an unknown saved value", () => {
    const groups = new Map(groupedTimeZones("Mars/Olympus_Mons"));

    expect(groups.get("America")).toContain("America/New_York");
    expect(groups.get("Mars")).toEqual(["Mars/Olympus_Mons"]);
  });

  it("labels a zone by its city", () => {
    expect(timeZoneLabel("America/New_York")).toBe("New York");
    expect(timeZoneLabel("America/Argentina/Buenos_Aires")).toBe("Argentina / Buenos Aires");
    expect(timeZoneLabel("UTC")).toBe("UTC");
  });
});

describe("member forms", () => {
  it("generates a readable password that meets the policy, different every time", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => generatePassword()));

    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
      expect(password.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("validates a new member before anything is sent", () => {
    const result = addMemberSchema.safeParse({
      email: "not-an-email",
      full_name: "   ",
      role: "platform_admin",
      title: "",
      password: "",
    });

    expect(result.success).toBe(false);
    const fields = result.error!.issues.map((issue) => issue.path[0]);
    expect(fields).toEqual(expect.arrayContaining(["email", "full_name", "role"]));
  });

  it("accepts a valid new member and trims what was typed", () => {
    const result = addMemberSchema.parse({
      email: "tessa@example.com",
      full_name: "  Tessa Nguyen ",
      role: "supervisor",
      title: " Evening Supervisor ",
      password: "",
    });

    expect(result.full_name).toBe("Tessa Nguyen");
    expect(result.title).toBe("Evening Supervisor");
  });

  it("only allows roles and access states that exist", () => {
    expect(editMemberSchema.safeParse({ role: "owner", status: "active", title: "" }).success).toBe(
      false,
    );
    expect(
      editMemberSchema.safeParse({ role: "employee", status: "deleted", title: "" }).success,
    ).toBe(false);
    expect(
      editMemberSchema.safeParse({ role: "employee", status: "suspended", title: "" }).success,
    ).toBe(true);
  });
});
