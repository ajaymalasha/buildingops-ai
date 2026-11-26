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

/**
 * Save a review screenshot when E2E_SCREENSHOT_DIR is set. Ordinary runs write nothing.
 * The screenshots are for people reviewing a change; they are never committed.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  await page.waitForLoadState("networkidle");
  // Animations are run to their end first, so a drawer is never caught half way in.
  await page.screenshot({ path: path.join(directory, `${name}.png`), animations: "disabled" });
}
