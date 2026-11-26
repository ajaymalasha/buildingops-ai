import { expect, test } from "@playwright/test";

import { ACCOUNTS, appReady, mainNavigation, PASSWORD, row, shot, signIn } from "./support";

test.describe("signing in and out", () => {
  test("a signed-out visitor is sent to sign in, then back to where they were going", async ({
    page,
  }) => {
    await page.goto("/settings/members?role=supervisor");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fmembers%3Frole%3Dsupervisor$/);
    await shot(page, "01-sign-in");

    await page.getByLabel("Work email").fill(ACCOUNTS.admin);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("That email and password don't match an account.")).toBeVisible();
    await expect(page.getByLabel("Work email")).toHaveValue(ACCOUNTS.admin);
    await shot(page, "02-sign-in-refused");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/settings\/members\?role=supervisor$/);
    await appReady(page);
    await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/settings/members");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("a sign-in link cannot redirect to another site", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/phish");
    await page.getByLabel("Work email").fill(ACCOUNTS.admin);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(mainNavigation(page)).toBeVisible();
    expect(new URL(page.url()).origin).toBe("http://localhost:3100");
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("a company admin", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  test("sees the organization at a glance", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
    await expect(page.getByText("You're working in Meridian Facility Services.")).toBeVisible();
    await expect(mainNavigation(page).getByRole("link")).toHaveText([
      "Overview",
      "Work orders",
      "Buildings",
      "Customers",
      "Contracts",
      "Vendors",
      "Employees",
      "Schedule",
      "Timesheets",
      "Job roles",
      "Expenses",
      "Invoices",
      "Members",
      "Organization",
      "Audit log",
    ]);
    // An admin's overview is the dashboard, which has a spec of its own.
    await expect(page.getByRole("group", { name: "Revenue" })).toContainText("$");
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await shot(page, "03-overview");
  });

  test("adds, changes and suspends a member, and every step is audited", async ({ page }) => {
    await mainNavigation(page).getByRole("link", { name: "Members" }).click();
    await expect(row(page, "marcus.okafor@meridianfs.example")).toBeVisible();
    await shot(page, "04-members");

    // Validation happens before anything is sent.
    await page.getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a member" });
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
    await expect(dialog.getByText("Enter their name.")).toBeVisible();

    await dialog.getByLabel("Work email").fill("tessa.nguyen@meridianfs.example");
    await dialog.getByLabel("Full name").fill("Tessa Nguyen");
    await dialog.getByLabel("Role").selectOption("supervisor");
    await expect(dialog.getByText("Leads teams on site and approves their time.")).toBeVisible();
    await dialog.getByLabel("Job title").fill("Evening Supervisor");

    // The password policy is the server's; its answer lands on the field.
    await dialog.getByLabel("Initial password").fill("short");
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog.getByText("Use at least 10 characters.")).toBeVisible();

    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog.getByLabel("Initial password")).toHaveValue(/^(\w{4}-){3}\w{4}$/);
    await shot(page, "05-add-member");
    await dialog.getByRole("button", { name: "Add member" }).click();

    await expect(page.getByText("Tessa Nguyen was added")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(row(page, "Tessa Nguyen")).toContainText("Supervisor");

    // Change the role.
    await page.getByRole("button", { name: "Actions for Tessa Nguyen" }).click();
    await page.getByRole("menuitem", { name: "Edit role and title" }).click();
    const edit = page.getByRole("dialog", { name: "Tessa Nguyen" });
    await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await edit.getByLabel("Role").selectOption("operations_manager");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, "Tessa Nguyen")).toContainText("Operations manager");

    // Suspend, then find them with the filter. The filter lives in the URL.
    await page.getByRole("button", { name: "Actions for Tessa Nguyen" }).click();
    await page.getByRole("menuitem", { name: "Suspend access" }).click();
    await expect(row(page, "Tessa Nguyen")).toContainText("Suspended");
    await page.getByLabel("Filter by access").selectOption("suspended");
    await expect(page).toHaveURL(/status=suspended/);
    await expect(page.getByRole("row")).toHaveCount(2); // header + Tessa

    // An admin cannot lock themselves out.
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await page.getByRole("button", { name: "Actions for Dana Whitfield" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Edit role and title"]);
    await page.keyboard.press("Escape");

    await mainNavigation(page).getByRole("link", { name: "Audit log" }).click();
    await expect(row(page, "Changed Tessa Nguyen's status to suspended")).toBeVisible();
    await expect(row(page, "Changed Tessa Nguyen's role to operations manager")).toContainText(
      "Supervisor",
    );
    // Recorded text is shown exactly as it was recorded.
    await expect(row(page, "Added Tessa Nguyen as supervisor")).toContainText(
      "tessa.nguyen@meridianfs.example",
    );
    await shot(page, "06-audit-log");

    await page.getByLabel("Filter by activity").selectOption("auth");
    await expect(row(page, "Dana Whitfield signed in").first()).toBeVisible();
    await expect(row(page, "Tessa Nguyen")).toHaveCount(0);
  });

  test("updates organization settings, and the header follows", async ({ page }) => {
    await mainNavigation(page).getByRole("link", { name: "Organization" }).click();
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();
    await shot(page, "07-organization-settings");

    await page.getByLabel("Name", { exact: true }).fill("");
    await save.click();
    await expect(page.getByText("Enter the organization's name.")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Meridian Facility Group");
    await save.click();
    await expect(page.getByText("Organization settings saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(
      "Meridian Facility Group",
    );

    await page.getByLabel("Name", { exact: true }).fill("Meridian Facility Services");
    await save.click();
    await expect(page.getByRole("button", { name: "Switch organization" })).toContainText(
      "Meridian Facility Services",
    );
  });

  test("switches organization and sees only that organization's data", async ({ page }) => {
    await page.getByRole("button", { name: "Switch organization" }).click();
    await shot(page, "08-switch-organization");
    await page.getByRole("menuitem", { name: /Northgate Building Services/ }).click();

    await expect(page.getByText("You're working in Northgate Building Services.")).toBeVisible();
    await mainNavigation(page).getByRole("link", { name: "Members" }).click();
    await expect(row(page, "Helen Brandt")).toBeVisible();
    await expect(row(page, "Marcus Okafor")).toHaveCount(0);

    // Nothing recorded in the other organization is visible here.
    await mainNavigation(page).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(row(page, "Tessa Nguyen")).toHaveCount(0);
  });

  test("is told on the field when the current password is wrong", async ({ page }) => {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();

    await page.getByLabel("Current password").fill("not-my-password");
    await page.getByLabel("New password", { exact: true }).fill("a-much-better-password");
    await page.getByLabel("Repeat new password").fill("a-different-password");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The passwords don't match.")).toBeVisible();

    await page.getByLabel("Repeat new password").fill("a-much-better-password");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("The current password is not correct.")).toBeVisible();
    await shot(page, "09-account");
  });
});

test.describe("an employee", () => {
  test("sees only what the role allows, in the menu and by direct link", async ({ page }) => {
    await signIn(page, ACCOUNTS.employee);

    await expect(mainNavigation(page).getByRole("link")).toHaveText(["Overview", "Organization"]);
    await expect(page.getByText("Activity is visible to managers")).toBeVisible();
    // The overview says what the role may do, and offers no figures to someone without them.
    await expect(page.getByText("View organization details")).toBeVisible();
    await expect(page.getByRole("group", { name: "Revenue" })).toHaveCount(0);
    await shot(page, "10-employee-overview");

    // Hiding the link is a convenience. The API is what refuses.
    await page.goto("/settings/members");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add member" })).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await shot(page, "11-employee-refused");

    await page.goto("/platform/organizations");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();

    await page.goto("/settings/organization");
    await expect(page.getByText("Only company admins can change these settings.")).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  });
});

test.describe("a platform admin", () => {
  test("creates an organization, opens it, and the visit is recorded there", async ({ page }) => {
    await signIn(page, ACCOUNTS.platform);
    await expect(page.getByText("Choose an organization to work in")).toBeVisible();
    await expect(mainNavigation(page).getByRole("link")).toHaveText(["Overview", "Organizations"]);

    await mainNavigation(page).getByRole("link", { name: "Organizations" }).click();
    await expect(row(page, "Meridian Facility Services")).toContainText("meridian");
    await shot(page, "12-platform-organizations");

    await page.getByRole("button", { name: "New organization" }).click();
    const dialog = page.getByRole("dialog", { name: "New organization" });
    await dialog.getByLabel("Name", { exact: true }).fill("Harbor Point Services");
    await dialog.getByLabel("Time zone").selectOption("America/Los_Angeles");
    await dialog.getByLabel("Full name").fill("Olive Harbor");
    await dialog.getByLabel("Work email").fill("olive.harbor@harborpoint.example");
    await dialog.getByRole("button", { name: "Generate" }).click();
    await shot(page, "13-new-organization");
    await dialog.getByRole("button", { name: "Create organization" }).click();

    await expect(page.getByText("Harbor Point Services was created")).toBeVisible();
    await expect(row(page, "Harbor Point Services")).toContainText("harbor-point-services");

    await page.getByRole("button", { name: "Actions for Harbor Point Services" }).click();
    await page.getByRole("menuitem", { name: "Open this organization" }).click();
    await expect(page.getByText("You're working in Harbor Point Services.")).toBeVisible();

    await mainNavigation(page).getByRole("link", { name: "Audit log" }).click();
    await expect(
      row(page, "Platform administrator Jordan Reyes entered the organization"),
    ).toBeVisible();
    await expect(row(page, "Organization Harbor Point Services created")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the navigation opens from the menu button", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await expect(page.getByRole("heading", { name: "Welcome back, Dana" })).toBeVisible();
    await expect(mainNavigation(page)).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(mainNavigation(page)).toBeVisible();
    await shot(page, "14-phone-navigation");

    await mainNavigation(page).getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { name: "Members", level: 1 })).toBeVisible();
    await expect(mainNavigation(page)).toBeHidden();
    await shot(page, "15-phone-members");
  });
});
