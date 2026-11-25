import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "BuildingOps-Demo-2026";

/** Accounts created by `buildingops seed`. */
export const ACCOUNTS = {
  admin: "dana.whitfield@meridianfs.example",
  manager: "marcus.okafor@meridianfs.example",
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

/**
 * Save a review screenshot when E2E_SCREENSHOT_DIR is set. Ordinary runs write nothing.
 * The screenshots are for people reviewing a change; they are never committed.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}
