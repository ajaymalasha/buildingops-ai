import { execFileSync } from "node:child_process";
import path from "node:path";

import { apiEnv } from "../playwright.config";

/** Rebuild the e2e database from the migrations and load the demo accounts. */
export default function globalSetup(): void {
  const apiDirectory = path.resolve(__dirname, "../../api");
  const run = (...args: string[]) =>
    execFileSync("uv", ["run", ...args], {
      cwd: apiDirectory,
      env: { ...process.env, ...apiEnv },
      stdio: ["ignore", "ignore", "inherit"],
    });

  try {
    run("alembic", "downgrade", "base");
    run("alembic", "upgrade", "head");
    run("buildingops", "seed");
  } catch (error) {
    throw new Error(
      "Could not prepare the e2e database. Create it once with:\n" +
        "  BUILDINGOPS_DATABASES=buildingops_e2e ./infra/postgres/bootstrap.sh",
      { cause: error },
    );
  }
}
