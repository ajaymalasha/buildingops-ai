import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  appReady,
  daysFromNow,
  filter,
  mainNavigation,
  openPage,
  row,
  rowAction,
  search,
  shot,
  signIn,
  toastsGone,
} from "./support";

test.describe("a company admin keeping master data", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  test("adds a customer, a building for it and a cost-plus contract covering the building", async ({
    page,
  }) => {
    // --- the customer ---
    await openPage(page, "Customers");
    await expect(row(page, "Calloway Property Group")).toContainText("CUS-0001");
    await shot(page, "20-customers");

    await page.getByRole("button", { name: "New customer" }).click();
    const newCustomer = page.getByRole("dialog", { name: "New customer" });
    await expect(newCustomer.getByLabel("Name", { exact: true })).toBeFocused();

    // What the browser can check is checked before anything is sent.
    await newCustomer.getByLabel("Email").fill("not-an-address");
    await newCustomer.getByRole("button", { name: "Create customer" }).click();
    await expect(newCustomer.getByText("Enter the customer's name.")).toBeVisible();
    await expect(newCustomer.getByText("Enter a valid email address.")).toBeVisible();

    await newCustomer.getByLabel("Name", { exact: true }).fill("Harborline Offices");
    await newCustomer.getByLabel("Contact name").fill("Renee Aldous");
    await newCustomer.getByLabel("Email").fill("renee.aldous@harborline.example");
    await newCustomer.getByLabel("Phone").fill("(201) 555-0142");
    await newCustomer.getByLabel("Street address").fill("1 Harborline Plaza");
    await newCustomer.getByLabel("City").fill("Jersey City");
    await newCustomer.getByLabel("State or region").fill("NJ");
    await newCustomer.getByLabel("Postal code").fill("07302");
    await newCustomer.getByLabel("Payment terms").fill("45");
    await newCustomer.getByLabel("Name", { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "21-new-customer");
    await newCustomer.getByRole("button", { name: "Create customer" }).click();

    await expect(page.getByText("Harborline Offices was added")).toBeVisible();
    await expect(newCustomer).toBeHidden();
    // The code was left blank, so the next one in the series was given.
    await expect(row(page, "Harborline Offices")).toContainText("CUS-0013");
    await expect(row(page, "Harborline Offices")).toContainText("Renee Aldous");
    await expect(row(page, "Harborline Offices")).toContainText("Net 45");

    // --- a building for it ---
    await openPage(page, "Buildings");
    await expect(row(page, "Calloway Tower")).toContainText("Calloway Property Group");
    await toastsGone(page);
    await shot(page, "22-buildings");

    await page.getByRole("button", { name: "New building" }).click();
    const newBuilding = page.getByRole("dialog", { name: "New building" });
    await newBuilding.getByRole("button", { name: "Create building" }).click();
    await expect(
      newBuilding.getByText("Choose the customer this building belongs to."),
    ).toBeVisible();
    await expect(newBuilding.getByText("Enter the street address.")).toBeVisible();

    await newBuilding.getByLabel("Customer").selectOption({ label: "Harborline Offices" });
    await newBuilding.getByLabel("Name", { exact: true }).fill("Harborline Tower");
    await newBuilding.getByLabel("Street address").fill("1 Harborline Plaza");
    await newBuilding.getByLabel("City").fill("Jersey City");
    await newBuilding.getByLabel("State or region").fill("NJ");
    await newBuilding.getByLabel("Postal code").fill("07302");
    await newBuilding.getByLabel("Floor area").fill("240000");
    await newBuilding.getByLabel("Floors").fill("18");
    await newBuilding.getByLabel("Customer").scrollIntoViewIfNeeded();
    await shot(page, "23-new-building");
    await newBuilding.getByRole("button", { name: "Create building" }).click();

    await expect(page.getByText("Harborline Tower was added")).toBeVisible();
    await expect(row(page, "Harborline Tower")).toContainText("BLD-0031");
    await expect(row(page, "Harborline Tower")).toContainText("Harborline Offices");
    await expect(row(page, "Harborline Tower")).toContainText("240,000 sq ft");

    // --- a contract covering it ---
    await openPage(page, "Contracts");
    await expect(row(page, "Day Porter Program")).toContainText("$18,400.00 a month");
    await toastsGone(page);
    await shot(page, "24-contracts");

    await page.getByRole("button", { name: "New contract" }).click();
    const newContract = page.getByRole("dialog", { name: "New contract" });
    await expect(newContract.getByText("Choose a customer to see its buildings.")).toBeVisible();
    await newContract.getByLabel("Customer").selectOption({ label: "Harborline Offices" });
    await newContract.getByLabel("Name", { exact: true }).fill("Harborline Janitorial Services");
    // The contract takes its customer's payment terms.
    await expect(newContract.getByLabel("Payment terms")).toHaveValue("45");

    // The billing model decides which figure is asked for.
    await expect(newContract.getByLabel("Markup")).toBeVisible();
    await newContract.getByLabel("Billing model").selectOption("fixed_fee");
    await expect(newContract.getByLabel("Monthly fee")).toBeVisible();
    await expect(newContract.getByLabel("Markup")).toHaveCount(0);
    await newContract.getByLabel("Billing model").selectOption("cost_plus");
    await newContract.getByRole("button", { name: "Create contract" }).click();
    await expect(newContract.getByText("Enter the markup percentage.")).toBeVisible();
    await expect(newContract.getByText("Choose the day the contract starts.")).toBeVisible();

    await newContract.getByLabel("Markup").fill("18.5");
    await newContract.getByLabel("Starts").fill(daysFromNow(30));
    await newContract.getByRole("checkbox", { name: /Harborline Tower/ }).check();
    await expect(newContract.getByText("1 of 1 selected")).toBeVisible();

    // The buildings on offer are the customer's, so another customer means choosing again.
    await newContract.getByLabel("Customer").selectOption({ label: "Calloway Property Group" });
    await expect(newContract.getByText("0 of 4 selected")).toBeVisible();
    await expect(newContract.getByRole("checkbox", { name: /Harborline Tower/ })).toHaveCount(0);
    await newContract.getByRole("button", { name: "Select all" }).click();
    await expect(newContract.getByText("4 of 4 selected")).toBeVisible();
    await newContract.getByLabel("Customer").selectOption({ label: "Harborline Offices" });
    await expect(newContract.getByText("0 of 1 selected")).toBeVisible();
    await newContract.getByRole("checkbox", { name: /Harborline Tower/ }).check();
    await expect(newContract.getByText("1 of 1 selected")).toBeVisible();
    await shot(page, "25-new-contract");
    await newContract.getByRole("button", { name: "Create contract" }).click();

    await expect(page.getByText("Harborline Janitorial Services was added")).toBeVisible();
    const contract = row(page, "Harborline Janitorial Services");
    await expect(contract).toContainText("CTR-0015");
    await expect(contract).toContainText("Harborline Offices");
    await expect(contract).toContainText("18.5% markup");
    await expect(contract).toContainText("Open-ended");
    await expect(contract).toContainText("Draft");

    // The saved contract opens with its building ticked, and can be put into force.
    await toastsGone(page);
    await rowAction(page, /Actions for Harborline Janitorial Services/, "Edit contract");
    const editContract = page.getByRole("dialog", { name: "Harborline Janitorial Services" });
    // The drawer waits for the contract, then starts in its first field like any other.
    await expect(editContract.getByLabel("Customer")).toBeFocused();
    await expect(editContract.getByRole("checkbox", { name: /Harborline Tower/ })).toBeChecked();
    await expect(editContract.getByLabel("Markup")).toHaveValue("18.50");
    await expect(editContract.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await editContract.getByLabel("Status").selectOption("active");
    await shot(page, "26-edit-contract");
    await editContract.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Harborline Janitorial Services was updated")).toBeVisible();
    await expect(contract).toContainText("Active");
  });

  test("searches, filters and sorts vendors, and the view lives in the URL", async ({ page }) => {
    await openPage(page, "Vendors");
    await expect(page.getByRole("row")).toHaveCount(15); // header + 14 vendors
    // Insurance that has lapsed, or is about to, says so.
    await expect(row(page, "Arbor & Stone Landscaping")).toContainText(/Lapsed \d+ days ago/);
    await expect(row(page, "Upright Elevator Works")).toContainText(/Expires in \d+ days/);
    await expect(row(page, "Nightingale Overnight Cleaning")).toContainText("Not on file");
    await shot(page, "27-vendors");

    await filter(page, "Filter by category").selectOption("janitorial");
    await expect(page).toHaveURL(/category=janitorial/);
    await expect(page.getByRole("row")).toHaveCount(4);

    await search(page, "Search vendors", "night");
    await expect(page).toHaveURL(/q=night/);
    await expect(page.getByRole("row")).toHaveCount(2);
    await expect(row(page, "Nightingale Overnight Cleaning")).toBeVisible();

    // A view that matches nothing says so, and offers the way back.
    await filter(page, "Filter by status").selectOption("inactive");
    await expect(
      page.getByRole("heading", { name: "No vendors match these filters" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/vendors$/);
    await expect(page.getByRole("row")).toHaveCount(15);

    // Sorted by the date insurance expires: soonest first, then latest first.
    const insurance = page.getByRole("columnheader", { name: "Insurance expires" });
    await insurance.getByRole("button").click();
    await expect(page).toHaveURL(/sort=insurance_expires_on/);
    await expect(insurance).toHaveAttribute("aria-sort", "ascending");
    await expect(page.getByRole("row").nth(1)).toContainText("Highpane Window Cleaning");
    await insurance.getByRole("button").click();
    await expect(page).toHaveURL(/sort=-insurance_expires_on/);
    await expect(page.getByRole("row").nth(1)).toContainText("Sentinel Ridge Security");

    // The view survives a reload, because it is in the URL.
    await page.reload();
    await appReady(page);
    await expect(insurance).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByRole("row").nth(1)).toContainText("Sentinel Ridge Security");

    // Renewing a lapsed certificate clears the warning.
    await rowAction(page, "Arbor & Stone Landscaping", "Edit vendor");
    const editVendor = page.getByRole("dialog", { name: "Arbor & Stone Landscaping" });
    await expect(editVendor.getByLabel("Code", { exact: true })).toHaveValue("VEN-0005");
    await editVendor.getByLabel("Insurance expires").fill(daysFromNow(400));
    await editVendor.getByLabel("Status").selectOption("active");
    await shot(page, "28-edit-vendor");
    await editVendor.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Arbor & Stone Landscaping was updated")).toBeVisible();
    await expect(row(page, "Arbor & Stone Landscaping")).not.toContainText("Lapsed");
    await expect(row(page, "Arbor & Stone Landscaping")).toContainText("Active");

    // Nothing depends on a vendor, so one can be archived straight away.
    await toastsGone(page);
    await rowAction(page, "Ironclad Door & Lock", "Archive vendor");
    const confirm = page.getByRole("alertdialog", { name: "Archive Ironclad Door & Lock?" });
    await confirm.getByRole("button", { name: "Archive vendor" }).click();
    await expect(page.getByText("Ironclad Door & Lock was archived")).toBeVisible();
    await expect(row(page, "Ironclad Door & Lock")).toHaveCount(0);
  });

  test("cannot archive a customer that still has buildings, and is told what to do first", async ({
    page,
  }) => {
    await openPage(page, "Customers");
    await expect(row(page, "Calloway Property Group")).toBeVisible();
    const customers = await page.getByRole("row").count();

    await rowAction(page, "Calloway Property Group", "Archive customer");
    const confirm = page.getByRole("alertdialog", { name: "Archive Calloway Property Group?" });
    await expect(confirm).toContainText("can no longer be chosen for buildings or contracts");
    await shot(page, "29-archive-customer");
    await confirm.getByRole("button", { name: "Archive customer" }).click();

    // The API's own explanation, shown where the question was asked.
    await expect(confirm.getByRole("alert")).toHaveText(
      "Calloway Property Group still has 4 buildings and 2 contracts not yet terminated." +
        " Before archiving, archive its buildings or move them to another customer" +
        " and terminate its contracts.",
    );
    // Asking again would get the same answer, so the only way on is to close.
    await expect(confirm.getByRole("button", { name: "Archive customer" })).toHaveCount(0);
    await shot(page, "30-archive-refused");
    await confirm.getByRole("button", { name: "Close" }).click();
    await expect(confirm).toBeHidden();

    // Nothing was removed: the customer and its buildings are where they were.
    await expect(row(page, "Calloway Property Group")).toContainText("Active");
    await expect(page.getByRole("row")).toHaveCount(customers);
    await row(page, "Calloway Property Group")
      .getByRole("link", { name: /Buildings of/ })
      .click();
    await expect(page).toHaveURL(/\/buildings\?customer_id=/);
    await expect(page.getByRole("heading", { name: "Buildings", level: 1 })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(5); // header + its 4 buildings
    await expect(filter(page, "Filter by customer")).toHaveValue(/.+/);
  });

  test("adds an employee, assigns buildings, changes the primary one and ends an assignment", async ({
    page,
  }) => {
    await openPage(page, "Employees");
    await expect(page.getByText(/^1–25 of \d+ employees$/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Hourly rate" })).toBeVisible();
    await shot(page, "31-employees");

    await page.getByRole("button", { name: "New employee" }).click();
    const newEmployee = page.getByRole("dialog", { name: "New employee" });
    await newEmployee.getByLabel("First name").fill("Maya");
    await newEmployee.getByLabel("Last name").fill("Castellano");
    await newEmployee.getByLabel("Email").fill("maya.castellano@meridianfs.example");
    // A new hire starts on the rate of the role, until someone says otherwise.
    await newEmployee.getByLabel("Job role").selectOption({ label: "Custodian" });
    await expect(newEmployee.getByLabel("Hourly rate")).toHaveValue("19.50");
    await expect(newEmployee.getByText("Custodian starts at $19.50.")).toBeVisible();
    await newEmployee.getByLabel("Supervisor").selectOption({ label: "Priya Raman" });
    await newEmployee.getByLabel("Employment type").selectOption("part_time");
    await newEmployee.getByLabel("Hire date").fill(daysFromNow(-3));
    await shot(page, "32-new-employee");
    await newEmployee.getByRole("button", { name: "Create employee" }).click();

    await expect(page.getByText("Maya Castellano was added")).toBeVisible();
    await search(page, "Search employees", "castellano");
    await expect(page).toHaveURL(/q=castellano/);
    const employee = row(page, "Maya Castellano");
    await expect(employee).toContainText("EMP-0092");
    await expect(employee).toContainText("Custodian");
    await expect(employee).toContainText("Part time");
    await expect(employee).toContainText("$19.50");
    await expect(employee).toContainText("None"); // no primary building yet

    // --- buildings ---
    await toastsGone(page);
    await rowAction(page, "Maya Castellano", "Building assignments");
    const assignments = page.getByRole("dialog", { name: "Building assignments" });
    const current = assignments.getByRole("region", { name: "Current buildings" });
    await expect(current).toContainText("Maya is not assigned to a building.");

    // The first building someone is given is their primary one unless the box is cleared.
    await expect(assignments.getByLabel("Primary building")).toBeChecked();
    await assignments
      .getByLabel("Building", { exact: true })
      .selectOption({ label: "Calloway Tower" });
    await assignments.getByRole("button", { name: "Assign" }).click();
    await expect(current.getByRole("listitem")).toHaveCount(1);
    await expect(current.getByRole("listitem").filter({ hasText: "Calloway Tower" })).toContainText(
      "Primary",
    );

    // After that the box starts clear: a second building does not take the first one's place.
    for (const building of ["One Granite Plaza", "Calloway Annex"]) {
      await expect(assignments.getByLabel("Primary building")).not.toBeChecked();
      await assignments.getByLabel("Building", { exact: true }).selectOption({ label: building });
      await assignments.getByRole("button", { name: "Assign" }).click();
      await expect(current.getByRole("listitem").filter({ hasText: building })).toBeVisible();
    }
    const tower = current.getByRole("listitem").filter({ hasText: "Calloway Tower" });
    const granite = current.getByRole("listitem").filter({ hasText: "One Granite Plaza" });
    await expect(current.getByRole("listitem")).toHaveCount(3);
    await expect(granite).not.toContainText("Primary");
    // A building someone already works at is not offered a second time.
    await expect(
      assignments.getByLabel("Building", { exact: true }).getByRole("option", {
        name: "Calloway Tower",
      }),
    ).toHaveCount(0);

    // Making another building primary takes the mark from the first, and puts it on top.
    await granite.getByRole("button", { name: "Make primary" }).click();
    await expect(granite).toContainText("Primary");
    await expect(tower).not.toContainText("Primary");
    await expect(tower.getByRole("button", { name: "Make primary" })).toBeVisible();
    await expect(current.getByRole("listitem").first()).toContainText("One Granite Plaza");

    // Ending an assignment asks for the last day, then moves it to the history.
    await tower.getByRole("button", { name: "End", exact: true }).click();
    await expect(tower.getByLabel("Last day")).not.toHaveValue("");
    await shot(page, "34-end-assignment");
    await tower.getByRole("button", { name: "End assignment" }).click();
    await expect(current.getByRole("listitem")).toHaveCount(2);
    await expect(assignments.getByRole("region", { name: "Past assignments" })).toContainText(
      "Calloway Tower",
    );
    await shot(page, "33-building-assignments");

    await assignments.getByRole("button", { name: "Done" }).click();
    await expect(assignments).toBeHidden();
    await expect(employee).toContainText("One Granite Plaza");

    // The list can be narrowed to the people at a building.
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await filter(page, "Filter by building").selectOption({ label: "One Granite Plaza" });
    await expect(page).toHaveURL(/building_id=/);
    await expect(row(page, "Maya Castellano")).toBeVisible();

    // Someone still assigned to a building cannot be archived, and the API says why.
    await rowAction(page, "Maya Castellano", "Archive employee");
    const confirm = page.getByRole("alertdialog", { name: "Archive Maya Castellano?" });
    await confirm.getByRole("button", { name: "Archive employee" }).click();
    await expect(confirm.getByRole("alert")).toHaveText(
      "Maya Castellano still has 2 open assignments. Before archiving, end the assignments.",
    );
    await confirm.getByRole("button", { name: "Close" }).click();
    await expect(row(page, "Maya Castellano")).toBeVisible();
  });

  test("adds, changes and archives job roles", async ({ page }) => {
    await openPage(page, "Job roles");
    // By the name a row starts with: "Custodian" is also part of "Lead Custodian".
    const custodian = page.getByRole("row", { name: /^Custodian/ });
    await expect(page.getByRole("row", { name: /^Site Supervisor/ })).toContainText("Yes");
    await expect(custodian).toContainText("$19.50");
    await shot(page, "35-job-roles");

    await page.getByRole("button", { name: "New job role" }).click();
    const newRole = page.getByRole("dialog", { name: "New job role" });
    await newRole.getByLabel("Name").fill("Custodian");
    await newRole.getByLabel("Default hourly rate").fill("21.255");
    await newRole.getByRole("button", { name: "Create job role" }).click();
    await expect(newRole.getByText("Enter an amount such as 18.50.")).toBeVisible();
    await newRole.getByLabel("Default hourly rate").fill("21.25");
    await newRole.getByRole("button", { name: "Create job role" }).click();
    // Whether a name is taken is the API's to say. Its answer lands on the field.
    await expect(newRole.getByText("A job role named Custodian already exists.")).toBeVisible();

    await newRole.getByLabel("Name").fill("Night Porter");
    await newRole
      .getByLabel("Description")
      .fill("Keeps lobbies and loading docks in order overnight.");
    await shot(page, "36-new-job-role");
    await newRole.getByRole("button", { name: "Create job role" }).click();
    await expect(page.getByText("Night Porter was added")).toBeVisible();
    await expect(row(page, "Night Porter")).toContainText("$21.25");
    await expect(row(page, "Night Porter")).toContainText("No");

    await toastsGone(page);
    await rowAction(page, "Night Porter", "Edit job role");
    const editRole = page.getByRole("dialog", { name: "Night Porter" });
    await editRole.getByLabel("Supervisory role").check();
    await editRole.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, "Night Porter")).toContainText("Yes");

    // A role people hold cannot be archived. One nobody holds can.
    await toastsGone(page);
    await rowAction(page, "Custodian", "Archive job role");
    const refused = page.getByRole("alertdialog", { name: "Archive Custodian?" });
    await refused.getByRole("button", { name: "Archive job role" }).click();
    await expect(refused.getByRole("alert")).toHaveText(
      /^Custodian still has \d+ employees\. Before archiving, give them another job role\.$/,
    );
    await refused.getByRole("button", { name: "Close" }).click();

    await rowAction(page, "Night Porter", "Archive job role");
    const confirm = page.getByRole("alertdialog", { name: "Archive Night Porter?" });
    await confirm.getByRole("button", { name: "Archive job role" }).click();
    await expect(page.getByText("Night Porter was archived")).toBeVisible();
    await expect(row(page, "Night Porter")).toHaveCount(0);
    await expect(custodian).toBeVisible();

    // The count of people in a role leads to them.
    await row(page, "Building Engineer").getByRole("link").click();
    await expect(page).toHaveURL(/\/employees\?job_role_id=/);
    await expect(page.getByRole("row")).toHaveCount(5); // header + 4 building engineers
  });
});

test.describe("a supervisor", () => {
  test("browses the directory but cannot change it, and sees neither pay nor contracts", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.supervisor);
    await expect(mainNavigation(page).getByRole("link")).toHaveText([
      "Overview",
      "Buildings",
      "Customers",
      "Vendors",
      "Employees",
      "Job roles",
      "Members",
      "Organization",
    ]);

    // Each list, something known to be in it, and the button a supervisor must not have.
    const lists = [
      ["Buildings", "Calloway Tower", "New building"],
      ["Customers", "Calloway Property Group", "New customer"],
      ["Vendors", "Dovemoor Mechanical Services", "New vendor"],
      ["Job roles", "Day Porter", "New job role"],
      ["Employees", "EMP-", "New employee"],
    ] as const;
    for (const [name, known, create] of lists) {
      await openPage(page, name);
      await expect(row(page, known).first()).toBeVisible();
      await expect(page.getByRole("button", { name: create })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
    }

    // Pay is not shown at all: not the figures, and not the column they would be in.
    await expect(page.getByRole("columnheader", { name: "Hourly rate" })).toHaveCount(0);
    await expect(page.getByRole("table")).not.toContainText("$");
    await shot(page, "37-supervisor-employees");
    await search(page, "Search employees", "raman");
    await expect(row(page, "Priya Raman")).toContainText("Site Supervisor");
    await openPage(page, "Job roles");
    await expect(page.getByRole("columnheader", { name: "Default rate" })).toHaveCount(0);
    await expect(page.getByRole("table")).not.toContainText("$");

    // Hiding the link is a convenience. The page refuses too, and so does the API.
    await page.goto("/contracts");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New contract" })).toHaveCount(0);
    await shot(page, "38-supervisor-refused");
    const response = await page.request.get("/api/v1/contracts");
    expect(response.status()).toBe(403);
  });
});

test.describe("master data on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the lists scroll sideways and the drawer fills the screen", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(mainNavigation(page).getByRole("link", { name: "Job roles" })).toBeVisible();
    await shot(page, "39-phone-navigation");
    await mainNavigation(page).getByRole("link", { name: "Buildings" }).click();
    await expect(page.getByRole("heading", { name: "Buildings", level: 1 })).toBeVisible();
    await expect(row(page, "Calloway Tower")).toBeVisible();
    await shot(page, "40-phone-buildings");

    await page.getByRole("button", { name: "New building" }).click();
    const newBuilding = page.getByRole("dialog", { name: "New building" });
    await expect(newBuilding.getByLabel("Customer")).toBeVisible();
    await expect(newBuilding.getByRole("button", { name: "Create building" })).toBeInViewport();
    await shot(page, "41-phone-new-building");
  });
});
