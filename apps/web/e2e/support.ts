import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "BuildingOps-Demo-2026";

/** Accounts created by `buildingops seed`. */
export const ACCOUNTS = {
  admin: "dana.whitfield@meridianfs.example",
  manager: "marcus.okafor@meridianfs.example",
  supervisor: "priya.raman@meridianfs.example",
  employee: "luis.ortega@meridianfs.example",
  platform: "platform.admin@buildingops.example",
} as const;

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await appReady(page);
}

/** Wait until the signed-in shell is interactive, not merely rendered. */
export async function appReady(page: Page): Promise<void> {
  await expect(page.locator('html[data-app-ready="true"]')).toBeAttached();
}

export function mainNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Main" });
}

/** A table row, found by any text it contains. */
export function row(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

/** Go to a page through the sidebar, as a person would, and wait for it to show. */
export async function openPage(page: Page, name: string): Promise<void> {
  await mainNavigation(page).getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

/**
 * A filter in a list's toolbar. Found by role: the framework keeps pages visited earlier
 * mounted but hidden, and they have filters with the same names.
 */
export function filter(page: Page, name: string) {
  return page.getByRole("combobox", { name });
}

/** Type into a list's search box. The list follows after a short pause. */
export async function search(page: Page, name: string, text: string): Promise<void> {
  await page.getByRole("searchbox", { name }).fill(text);
}

/** Choose from the menu at the end of the row for `name`. */
export async function rowAction(page: Page, name: string | RegExp, action: string): Promise<void> {
  const label = typeof name === "string" ? `Actions for ${name}` : name;
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** Wait for confirmation messages to clear, so they are not in the way of the next step. */
export async function toastsGone(page: Page): Promise<void> {
  await page.mouse.move(0, 0); // a message stays up while the pointer rests on it
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
}

/** A calendar date a number of days from now, in the form a date input takes. */
export function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Where Meridian Facility Services works. Its days and its clock times are New York's. */
export const ORGANIZATION_TIME_ZONE = "America/New_York";

/**
 * A calendar date a number of days from today where the organization is, in the form a
 * date input takes. "Today" for a due date, a shift or a timesheet is the organization's,
 * which for some hours of every day is not the date on the machine running the tests.
 */
export function organizationDay(days = 0, timeZone = ORGANIZATION_TIME_ZONE): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(
    new Date(),
  );
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "Nov 26, 2026": a calendar date (YYYY-MM-DD) as the app shows it. */
export function shownDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** One of the choices of a segmented control, such as a tab of the timesheet queue. */
export function segment(page: Page, name: string | RegExp) {
  return page.getByRole("radio", { name });
}

/** An on-off filter in a list's toolbar, such as "Overdue only". */
export function toggle(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true });
}

/** "$1,284.50" as 128450 cents, so that amounts read off the screen can be added exactly. */
export function cents(amount: string): number {
  const [whole = "0", fraction = ""] = amount.replace(/[^0-9.]/g, "").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

/**
 * Headers for a request that changes something, made by a test rather than by the page.
 * The web app refuses such a request unless it comes from its own pages, which a browser
 * says with this header.
 */
export const FROM_THIS_SITE = { origin: "http://localhost:3100" };

type ShotOptions = {
  /** Take in the whole page, however far it scrolls, rather than what is in the window. */
  wholePage?: boolean;
  /** The picture is of a page still waiting for something, so do not wait for it. */
  whileLoading?: boolean;
};

/**
 * Save a review screenshot when E2E_SCREENSHOT_DIR is set. Ordinary runs write nothing.
 * The screenshots are for people reviewing a change; they are never committed.
 */
export async function shot(
  page: Page,
  name: string,
  { wholePage = false, whileLoading = false }: ShotOptions = {},
): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  if (!whileLoading) await page.waitForLoadState("networkidle");
  const file = path.join(directory, `${name}.png`);
  const window = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (!wholePage || !window || height <= window.height) {
    // Animations are run to their end first, so a drawer is never caught half way in.
    await page.screenshot({ path: file, animations: "disabled" });
    return;
  }
  // The window is made as tall as the page for the picture, rather than the picture
  // stitched together from scrolls: the sidebar and the header are fixed to the window,
  // and would otherwise be drawn once at the top and missing below.
  await page.setViewportSize({ width: window.width, height });
  await page.screenshot({ path: file, animations: "disabled" });
  await page.setViewportSize(window);
}
