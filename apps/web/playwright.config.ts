import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: a real browser against the real web app, API and database.
 *
 * They run on their own ports and their own database (`buildingops_e2e`), which the global
 * setup rebuilds and seeds before every run, so they never touch development data.
 */

const WEB_PORT = 3100;
const API_PORT = 8100;
const DATABASE = process.env.E2E_DATABASE ?? "buildingops_e2e";
const DATABASE_HOST = process.env.E2E_DATABASE_HOST ?? "localhost:5432";

if (!DATABASE.endsWith("_e2e")) {
  throw new Error(`Refusing to run against '${DATABASE}': the e2e database name must end in _e2e`);
}

/** Environment for the API under test, also used by the global setup to migrate and seed. */
export const apiEnv = {
  ENVIRONMENT: "test",
  LOG_LEVEL: "WARNING",
  DATABASE_URL: `postgresql+psycopg://buildingops_app:buildingops_app@${DATABASE_HOST}/${DATABASE}`,
  DATABASE_ADMIN_URL: `postgresql+psycopg://buildingops_owner:buildingops_owner@${DATABASE_HOST}/${DATABASE}`,
  SEED_DEMO_PASSWORD: "BuildingOps-Demo-2026",
  // Every test signs in from the same address.
  LOGIN_MAX_FAILURES_PER_IP: "10000",
};

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One database shared by all tests, so they run one after another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      name: "api",
      command: `uv run uvicorn buildingops.main:app_factory --factory --port ${API_PORT}`,
      cwd: "../api",
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      env: apiEnv,
      stdout: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: "web",
      // A production build: what users get, and no development overlay in screenshots.
      command: `pnpm build && pnpm start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      env: {
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
        AUTH_URL: `http://localhost:${WEB_PORT}`,
        AUTH_SECRET: "e2e-only-secret-used-for-nothing-else",
        AUTH_TRUST_HOST: "true",
      },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
