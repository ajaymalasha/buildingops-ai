import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  cents,
  filter,
  FROM_THIS_SITE,
  mainNavigation,
  openPage,
  organizationDay,
  row,
  rowAction,
  search,
  segment,
  shot,
  shownDay,
  signIn,
  toastsGone,
  toggle,
} from "./support";

/** The moves a work order's drawer can offer. Only the ones the rules allow are there. */
const MOVES = [
  "Start work",
  "Schedule",
  "Put on hold",
  "Resume work",
  "Complete",
  "Return to open",
  "Reopen",
  "Cancel work order",
];

/** The moves on offer in a work order's drawer, in the order they are offered. */
async function movesOffered(drawer: Locator): Promise<string[]> {
  const buttons = await drawer.getByRole("button").allTextContents();
  return buttons.filter((label) => MOVES.includes(label));
}

/** How many timesheets a tab of the queue holds, read off the tab itself. */
async function countOn(page: Page, tab: string): Promise<number> {
  const text = (await segment(page, new RegExp(`^${tab}`)).textContent()) ?? "";
  return Number(text.replace(/\D/g, ""));
}

/** Wait for a tab of the queue to show a count. */
async function expectCount(page: Page, tab: string, count: number): Promise<void> {
  await expect(segment(page, new RegExp(`^${tab}`))).toHaveText(
    `${tab}${count.toLocaleString("en-US")}`,
  );
}

test.describe("a company admin running operations", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
  });

  test("raises a work order, schedules it, starts it and completes it, and its history keeps each step", async ({
    page,
  }) => {
    await openPage(page, "Work orders");
    // The list opens on the live backlog: nothing finished, nothing cancelled.
    await expect(segment(page, "Backlog")).toBeChecked();
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await expect(page.getByRole("table")).not.toContainText("Completed");
    await expect(page.getByRole("table")).not.toContainText("Cancelled");
    await shot(page, "50-work-orders");

    // Overdue work can be picked out, and the view lives in the URL.
    await toggle(page, "Overdue only").check();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByRole("row").nth(1)).toContainText(/\d+ days? overdue/);
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/work-orders$/);

    // --- raise one ---
    await page.getByRole("button", { name: "New work order" }).click();
    const form = page.getByRole("dialog", { name: "New work order" });
    await expect(form.getByLabel("Title")).toBeFocused();
    await form.getByRole("button", { name: "Create work order" }).click();
    await expect(form.getByText("Enter what needs doing.")).toBeVisible();
    await expect(form.getByText("Choose the building the work is at.")).toBeVisible();
    // A contract covers particular buildings, so there is nothing to choose from yet.
    await expect(form.getByLabel("Contract")).toBeDisabled();

    await form.getByLabel("Title").fill("Replace the lobby directory sign");
    await form
      .getByLabel("Description")
      .fill("The tenant list is out of date. New inserts are at the front desk.");
    await form.getByLabel("Category").selectOption("maintenance");
    await form.getByLabel("Priority").selectOption("high");
    await form.getByLabel("Building").selectOption({ label: "Calloway Tower" });
    // Only the contracts that cover Calloway Tower are offered.
    await expect(form.getByLabel("Contract").getByRole("option")).toHaveText([
      "No contract",
      "CTR-0002 · Day Porter Program",
      "CTR-0001 · Janitorial Services Agreement",
    ]);
    await form
      .getByLabel("Contract")
      .selectOption({ label: "CTR-0001 · Janitorial Services Agreement" });
    // Another building means choosing again, from the contracts that cover that one.
    await form.getByLabel("Building").selectOption({ label: "Larkspur Medical Pavilion" });
    await expect(form.getByLabel("Contract")).toHaveValue("");
    await expect(form.getByLabel("Contract").getByRole("option")).toHaveText([
      "No contract",
      "CTR-0003 · Clinical Cleaning Services",
    ]);
    await form.getByLabel("Building").selectOption({ label: "Calloway Tower" });
    await form
      .getByLabel("Contract")
      .selectOption({ label: "CTR-0001 · Janitorial Services Agreement" });
    // The people assigned to the building come first among those it can be given to.
    await expect(
      form
        .getByLabel("Assigned to")
        .locator('optgroup[label="Assigned to Calloway Tower"] option', {
          hasText: "Priya Raman",
        }),
    ).toHaveCount(1);
    await form.getByLabel("Assigned to").selectOption({ label: "Priya Raman" });
    await form.getByLabel("Due").fill(organizationDay(3));
    await form.getByLabel("Requested by").fill("Front desk");
    await form.getByLabel("Title").scrollIntoViewIfNeeded();
    await shot(page, "51-new-work-order");
    await form.getByRole("button", { name: "Create work order" }).click();

    // It is given the next number, and it is at the top of the backlog.
    await expect(page.getByText("WO-0601 was added")).toBeVisible();
    await expect(form).toBeHidden();
    const listed = row(page, "WO-0601");
    await expect(listed).toContainText("Replace the lobby directory sign");
    await expect(listed).toContainText("Calloway Tower");
    await expect(listed).toContainText("High");
    await expect(listed).toContainText("Priya Raman");
    await expect(listed).toContainText("Open");

    // --- open it ---
    await toastsGone(page);
    await listed.getByRole("button", { name: /WO-0601/ }).click();
    const drawer = page.getByRole("dialog", { name: "Replace the lobby directory sign" });
    await expect(drawer).toContainText("Work order WO-0601 · Calloway Tower");
    await expect(drawer.getByText("High priority")).toBeVisible();
    await expect(drawer.getByText("CTR-0001 · Janitorial Services Agreement")).toBeVisible();
    const history = drawer.getByRole("list", { name: "History of WO-0601" });
    await expect(history.getByRole("listitem")).toHaveText([
      /Assigned to Priya Raman.*Dana Whitfield/,
      /Work order raised/,
    ]);
    // From open, work can start, be booked, be held or be called off. It cannot be
    // completed: that is not a move the rules allow, so it is not offered.
    await expect
      .poll(() => movesOffered(drawer))
      .toEqual(["Start work", "Schedule", "Put on hold", "Cancel work order"]);
    await shot(page, "52-work-order");

    // --- schedule it ---
    await drawer.getByRole("button", { name: "Schedule", exact: true }).click();
    const tomorrow = organizationDay(1);
    await drawer.getByLabel("Scheduled for").fill(`${tomorrow}T09:30`);
    await drawer
      .getByLabel("Comment (optional)")
      .fill("Booked with the front desk for first thing.");
    await shot(page, "53-work-order-schedule");
    await drawer.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(drawer.getByText("Scheduled", { exact: true }).first()).toBeVisible();
    // The time is the organization's, however far away the browser is.
    await expect(drawer.getByText(`${shownDay(tomorrow)}, 9:30 AM`)).toBeVisible();
    await expect
      .poll(() => movesOffered(drawer))
      .toEqual(["Start work", "Put on hold", "Return to open", "Cancel work order"]);

    // --- start it ---
    await drawer.getByRole("button", { name: "Start work" }).click();
    await drawer.getByRole("button", { name: "Start work" }).click();
    await expect(drawer.getByText("In progress", { exact: true })).toBeVisible();
    await expect
      .poll(() => movesOffered(drawer))
      .toEqual(["Complete", "Put on hold", "Cancel work order"]);

    // --- complete it, with a comment ---
    await drawer.getByRole("button", { name: "Complete", exact: true }).click();
    // The form takes the place of the buttons, and the keyboard goes with it.
    await expect(drawer.getByLabel("Comment (optional)")).toBeFocused();
    await drawer
      .getByLabel("Comment (optional)")
      .fill("Sign replaced and checked with the front desk.");
    await drawer.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(drawer.getByText("Completed", { exact: true }).first()).toBeVisible();
    // Finished work can only be taken up again.
    await expect.poll(() => movesOffered(drawer)).toEqual(["Reopen"]);
    await expect(drawer.getByRole("button", { name: "Reopen" })).toBeFocused();

    // --- and say something more about it ---
    const comment = drawer.getByRole("textbox", { name: "Add a comment" });
    await expect(drawer.getByRole("button", { name: "Add comment" })).toBeDisabled();
    await comment.fill("The old sign is in the mail room for recycling.");
    await drawer.getByRole("button", { name: "Add comment" }).click();
    await expect(comment).toHaveValue("");

    // Every step is in the history, newest first, with who did it.
    await expect(history.getByRole("listitem")).toHaveText([
      /Comment.*Dana Whitfield.*The old sign is in the mail room for recycling\./,
      /Completed.*Dana Whitfield.*Sign replaced and checked with the front desk\./,
      /Work started.*Dana Whitfield/,
      /Scheduled.*Dana Whitfield.*Booked with the front desk for first thing\./,
      /Assigned to Priya Raman.*Dana Whitfield/,
      /Work order raised/,
    ]);
    await history.scrollIntoViewIfNeeded();
    await shot(page, "54-work-order-history");

    // The API holds the rule. A move it does not allow is refused, with the ones it does.
    const found = await page.request.get("/api/v1/work-orders?q=WO-0601");
    const { id } = (await found.json()).items[0];
    const refused = await page.request.post(`/api/v1/work-orders/${id}/status`, {
      data: { status: "on_hold" },
      headers: FROM_THIS_SITE,
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).detail).toBe(
      "A work order that is completed cannot move to on hold. It can move to in progress.",
    );

    // --- edit it, from the drawer ---
    await drawer.getByRole("button", { name: "Edit work order" }).click();
    const edit = page.getByRole("dialog", { name: "Replace the lobby directory sign" });
    await expect(edit.getByLabel("Title")).toBeFocused();
    await expect(edit.getByLabel("Scheduled for")).toHaveValue(`${tomorrow}T09:30`);
    await expect(edit.getByLabel("Contract")).toHaveValue(/.+/);
    await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await edit.getByLabel("Priority").selectOption("urgent");
    await edit.getByLabel("Title").fill("Replace the lobby directory sign and inserts");
    await shot(page, "55-edit-work-order");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("WO-0601 was updated")).toBeVisible();
    // The drawer comes back, showing the work order as it was saved.
    const updated = page.getByRole("dialog", {
      name: "Replace the lobby directory sign and inserts",
    });
    await expect(updated.getByText("Urgent priority")).toBeVisible();
    await expect(updated.getByText(`${shownDay(tomorrow)}, 9:30 AM`)).toBeVisible();
    await updated.getByRole("button", { name: "Done" }).click();
    await expect(updated).toBeHidden();

    // Finished work has left the backlog. It is among the completed, and can be searched for.
    await expect(row(page, "WO-0601")).toHaveCount(0);
    await segment(page, "Completed").click();
    await expect(page).toHaveURL(/view=completed/);
    await search(page, "Search work orders", "WO-0601");
    await expect(page).toHaveURL(/q=WO-0601/);
    await expect(page.getByRole("row")).toHaveCount(2);
    await expect(row(page, "WO-0601")).toContainText("Completed");
    await expect(row(page, "WO-0601")).toContainText("Urgent");
    // Clearing the search stays among the completed work orders.
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expect(page).toHaveURL(/\/work-orders\?view=completed$/);
    await expect(segment(page, "Completed")).toBeChecked();
  });

  test("adds a shift, is refused one that overlaps it, then changes and cancels shifts", async ({
    page,
  }) => {
    await openPage(page, "Schedule");
    await page.getByRole("combobox", { name: "Building", exact: true }).selectOption({
      label: "Calloway Tower",
    });
    await expect(page).toHaveURL(/building_id=/);
    const roster = page.getByRole("table", { name: /^Schedule for Calloway Tower/ });
    // This week: a row for each person, a column for each day, today's marked.
    await expect(roster.getByRole("columnheader")).toHaveCount(8);
    await expect(roster.locator('th[aria-current="date"]')).toHaveCount(1);
    expect(await roster.getByRole("rowheader").count()).toBeGreaterThan(1);
    await expect(page.getByText(/\d+ people, \d+ shifts, [\d.,]+ h scheduled/)).toBeVisible();
    await shot(page, "56-schedule");

    // Three weeks on, nothing has been scheduled yet.
    for (let week = 0; week < 3; week += 1) {
      await page.getByRole("button", { name: "Next week" }).click();
    }
    await expect(page).toHaveURL(/week=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole("heading", { name: "No shifts this week" })).toBeVisible();
    await expect(page.getByRole("button", { name: "This week" })).toBeEnabled();
    await shot(page, "57-schedule-empty-week");

    // --- add a shift ---
    await page.getByRole("button", { name: "Add shift" }).first().click();
    const add = page.getByRole("dialog", { name: "Add shift" });
    // The people on offer are the ones assigned to the building.
    await expect(
      add.getByLabel("Employee").getByRole("option", { name: "Priya Raman" }),
    ).toHaveCount(1);
    await expect(
      add.getByLabel("Employee").getByRole("option", { name: "Luis Ortega" }),
    ).toHaveCount(0);
    await add.getByRole("button", { name: "Add shift" }).click();
    await expect(add.getByText("Choose who works the shift.")).toBeVisible();
    await add.getByLabel("Employee").selectOption({ label: "Priya Raman" });
    // A new shift starts on the Monday of the week on show, as a day shift.
    const monday = await add.getByLabel("Date").inputValue();
    expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);
    await expect(add.getByLabel("Starts")).toHaveValue("08:00");
    await expect(add.getByLabel("Ends")).toHaveValue("16:30");
    await add.getByLabel("Notes").fill("Walk the building with the new porter.");
    await shot(page, "58-add-shift");
    await add.getByRole("button", { name: "Add shift" }).click();
    await expect(page.getByText("Shift added")).toBeVisible();
    await expect(add).toBeHidden();

    const priya = roster.getByRole("row", { name: /Priya Raman/ });
    await expect(priya.getByRole("cell").first()).toContainText("8:00 AM – 4:30 PM");
    // Eight and a half hours on site, less half an hour's break.
    await expect(priya.getByRole("rowheader")).toContainText("8 h");

    // --- a second shift that overlaps it is refused, in the API's words ---
    await toastsGone(page);
    await page.getByRole("button", { name: "Add shift" }).first().click();
    await add.getByLabel("Employee").selectOption({ label: "Priya Raman" });
    await add.getByLabel("Starts").fill("12:00");
    await add.getByLabel("Ends").fill("20:00");
    await add.getByRole("button", { name: "Add shift" }).click();
    await expect(add.getByRole("alert")).toHaveText(
      `Priya Raman already has a shift at Calloway Tower that overlaps this one (${monday} 08:00 to 16:30).`,
    );
    await shot(page, "59-shift-overlap");

    // One that starts as the other ends is fine, and one past midnight ends the next day.
    await add.getByLabel("Starts").fill("16:30");
    await add.getByLabel("Ends").fill("00:30");
    await expect(add.getByText("The next day.")).toBeVisible();
    await add.getByRole("button", { name: "Add shift" }).click();
    await expect(page.getByText("Shift added")).toBeVisible();
    await expect(priya.getByRole("cell").first()).toContainText("4:30 PM – 12:30 AM");
    await expect(priya.getByRole("rowheader")).toContainText("15.5 h");

    // --- change one ---
    await toastsGone(page);
    await priya
      .getByRole("button", { name: /Edit shift: Priya Raman, .*8:00 AM – 4:30 PM/ })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit shift" });
    await expect(edit.getByLabel("Employee")).toHaveValue(/.+/);
    await expect(edit.getByLabel("Date")).toHaveValue(monday);
    await expect(edit.getByLabel("Notes")).toHaveValue("Walk the building with the new porter.");
    await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await edit.getByLabel("Starts").fill("07:00");
    await edit.getByLabel("Ends").fill("15:00");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Shift updated")).toBeVisible();
    await expect(priya.getByRole("cell").first()).toContainText("7:00 AM – 3:00 PM");
    await shot(page, "60-schedule-week");

    // --- cancel the other ---
    await toastsGone(page);
    await priya
      .getByRole("button", { name: /Edit shift: Priya Raman, .*4:30 PM – 12:30 AM/ })
      .click();
    await edit.getByRole("button", { name: "Cancel shift" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel this shift?" });
    await expect(confirm).toContainText("Priya Raman at Calloway Tower");
    await expect(confirm.getByRole("button", { name: "Keep shift" })).toBeFocused();
    await shot(page, "61-cancel-shift");
    await confirm.getByRole("button", { name: "Cancel shift" }).click();
    await expect(page.getByText("Shift cancelled")).toBeVisible();
    // A cancelled shift leaves the roster, and frees the hours.
    await expect(priya.getByRole("cell").first()).not.toContainText("4:30 PM");
    await expect(priya.getByRole("rowheader")).toContainText("7.5 h");
    await expect(page.getByText("1 person, 1 shift, 7.5 h scheduled.")).toBeVisible();

    // It stays on record, and can be shown: struck through, and no longer something to edit.
    await toggle(page, "Show cancelled").check();
    await expect(page).toHaveURL(/cancelled=true/);
    await expect(priya.getByRole("cell").first()).toContainText("4:30 PM – 12:30 AM");
    await expect(priya.getByRole("cell").first()).toContainText("Cancelled");
    await expect(priya.getByRole("button", { name: /4:30 PM – 12:30 AM/ })).toHaveCount(0);
    await expect(priya.getByRole("rowheader")).toContainText("7.5 h");
    // The week's count keeps the cancelled one apart, so it agrees with the hours.
    await expect(
      page.getByText("1 person, 1 shift, 7.5 h scheduled, plus 1 cancelled."),
    ).toBeVisible();
    await toastsGone(page);
    await shot(page, "62-schedule-cancelled-shown");

    // The week and the building survive a reload, because they are in the URL.
    await page.reload();
    await expect(roster.getByRole("row", { name: /Priya Raman/ })).toBeVisible();
    await page.getByRole("button", { name: "This week" }).click();
    await expect(page).not.toHaveURL(/week=/);
    await expect(roster.locator('th[aria-current="date"]')).toHaveCount(1);
  });

  test("enters time, approves it singly and several at once, and rejects with a reason", async ({
    page,
  }) => {
    await openPage(page, "Timesheets");
    // The queue opens on what is waiting.
    await expect(segment(page, /^Pending/)).toBeChecked();
    await expect(page.getByRole("row").nth(1)).toContainText("Pending");
    const waiting = await countOn(page, "Pending");
    expect(waiting).toBeGreaterThan(10);
    // A company admin sees what the time cost.
    await expect(page.getByRole("columnheader", { name: "Cost" })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText("$");
    await shot(page, "63-timesheets");

    // --- enter time ---
    const today = organizationDay();
    await page.getByRole("button", { name: "Enter timesheet" }).click();
    const entry = page.getByRole("dialog", { name: "Enter a timesheet" });
    await entry.getByRole("button", { name: "Enter timesheet" }).click();
    await expect(entry.getByText("Choose whose time this is.")).toBeVisible();
    await expect(entry.getByText("Enter the regular hours worked.")).toBeVisible();
    await entry.getByLabel("Employee").selectOption({ label: "Priya Raman" });
    // It starts at the building the person is based at, on today's date.
    await expect(entry.getByLabel("Building").locator("option:checked")).toHaveText(
      "Calloway Tower",
    );
    await expect(entry.getByLabel("Work date")).toHaveValue(today);
    await entry.getByLabel("Regular hours").fill("7.5");
    await entry.getByLabel("Overtime hours").fill("1.25");
    await entry.getByLabel("Notes").fill("Stayed on for the fire alarm test.");
    // Nothing in the form asks what the time costs: the API works that out.
    await expect(entry.getByLabel(/rate|cost/i)).toHaveCount(0);
    await shot(page, "64-enter-timesheet");
    await entry.getByRole("button", { name: "Enter timesheet" }).click();
    await expect(page.getByText("Time entered for Priya Raman")).toBeVisible();
    await expect(entry).toBeHidden();

    // It waits for approval, priced by the API.
    await expectCount(page, "Pending", waiting + 1);
    const entered = page.getByRole("row").nth(1);
    await expect(entered).toContainText(shownDay(today));
    await expect(entered).toContainText("Priya Raman");
    await expect(entered).toContainText("7.50");
    await expect(entered).toContainText("+ 1.25 overtime");
    await expect(entered).toContainText(/\$\d/);
    await expect(entered).toContainText("Manual");

    // The same person, day and building cannot be entered twice. The API says so on the field.
    await toastsGone(page);
    await page.getByRole("button", { name: "Enter timesheet" }).click();
    await entry.getByLabel("Employee").selectOption({ label: "Priya Raman" });
    await entry.getByLabel("Regular hours").fill("8");
    await entry.getByRole("button", { name: "Enter timesheet" }).click();
    await expect(
      entry.getByText(`Priya Raman already has a timesheet for ${today} at Calloway Tower.`),
    ).toBeVisible();
    await entry.getByRole("button", { name: "Cancel" }).click();

    // While it waits, it can be corrected.
    const mine = new RegExp(
      `Actions for the timesheet of Priya Raman for ${shownDay(today)} at Calloway Tower`,
    );
    await rowAction(page, mine, "Edit timesheet");
    const correction = page.getByRole("dialog", { name: "Edit timesheet" });
    await expect(correction.getByLabel("Regular hours")).toHaveValue("7.50");
    await expect(correction.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await correction.getByLabel("Overtime hours").fill("1.5");
    await correction.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Priya Raman's timesheet was updated")).toBeVisible();
    await expect(entered).toContainText("+ 1.50 overtime");

    // --- approve it ---
    await toastsGone(page);
    await rowAction(page, mine, "Approve");
    await expect(
      page.getByText(`Priya Raman's time for ${shownDay(today)} was approved`),
    ).toBeVisible();
    await expectCount(page, "Pending", waiting);
    await expect(page.getByRole("button", { name: mine })).toHaveCount(0);

    // --- approve several together ---
    await toastsGone(page);
    const boxes = page.getByRole("checkbox", { name: /^Select the timesheet of/ });
    for (const index of [0, 1, 2]) await boxes.nth(index).check();
    const selection = page.getByRole("region", { name: "Selected timesheets" });
    await expect(selection).toContainText("3 selected");
    await expect(selection).toContainText(/[\d.]+ hours/);
    await expect(
      page.getByRole("checkbox", { name: "Select all pending timesheets on this page" }),
    ).toHaveJSProperty("indeterminate", true);
    await shot(page, "65-timesheets-selected");
    await selection.getByRole("button", { name: "Approve 3 timesheets" }).click();
    await expect(page.getByText("3 timesheets were approved")).toBeVisible();
    await expectCount(page, "Pending", waiting - 3);
    await expect(selection).toBeHidden();

    // A whole page can be ticked at once, and unticked again.
    await page
      .getByRole("checkbox", { name: "Select all pending timesheets on this page" })
      .check();
    await expect(selection.getByRole("button", { name: /^Approve \d+ timesheets$/ })).toBeVisible();
    await selection.getByRole("button", { name: "Clear selection" }).click();
    await expect(selection).toBeHidden();

    // --- reject one, with a reason ---
    await toastsGone(page);
    await page
      .getByRole("button", { name: /^Actions for the timesheet of/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Reject" }).click();
    const reject = page.getByRole("dialog", { name: "Reject this timesheet?" });
    await expect(reject.getByLabel("Reason")).toBeFocused();
    await reject.getByRole("button", { name: "Reject timesheet" }).click();
    await expect(reject.getByText("Say why the timesheet is rejected.")).toBeVisible();
    await reject
      .getByLabel("Reason")
      .fill("Hours do not match the sign-in sheet for that evening.");
    await shot(page, "66-reject-timesheet");
    await reject.getByRole("button", { name: "Reject timesheet" }).click();
    await expect(page.getByText(/time for .* was rejected/)).toBeVisible();
    await expectCount(page, "Pending", waiting - 4);

    // It is among the rejected, with the reason. Rejected time has nothing left to tick.
    const rejectedBefore = await countOn(page, "Rejected");
    await segment(page, /^Rejected/).click();
    await expect(page).toHaveURL(/status=rejected/);
    await expect(row(page, "Hours do not match the sign-in sheet for that evening.")).toContainText(
      "Rejected",
    );
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await toastsGone(page);
    await shot(page, "67-timesheets-rejected");

    // A decision can be undone: reopened, it is pending again.
    await row(page, "Hours do not match the sign-in sheet for that evening.")
      .getByRole("button", { name: /^Actions for/ })
      .click();
    await expect(page.getByRole("menuitem")).toHaveText(["Reopen"]);
    await page.getByRole("menuitem", { name: "Reopen" }).click();
    await expect(page.getByText(/time for .* is pending again/)).toBeVisible();
    await expectCount(page, "Rejected", rejectedBefore - 1);
    await expectCount(page, "Pending", waiting - 3);

    // The queue can be narrowed, and the counts follow the filters.
    await segment(page, /^Pending/).click();
    await filter(page, "Filter by building").selectOption({ label: "Calloway Tower" });
    await expect(page).toHaveURL(/building_id=/);
    await expect.poll(() => countOn(page, "Pending")).toBeLessThan(waiting - 3);
    await page.getByLabel("Work date from").filter({ visible: true }).fill(organizationDay(-1));
    await expect(page).toHaveURL(/from=/);
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await expectCount(page, "Pending", waiting - 3);
  });

  test("enters an expense, approves it, and rejects another with a reason", async ({ page }) => {
    await openPage(page, "Expenses");
    await expect(page.getByRole("row").nth(1)).toContainText("$");
    await shot(page, "68-expenses");

    await page.getByRole("button", { name: "New expense" }).click();
    const form = page.getByRole("dialog", { name: "New expense" });
    await form.getByRole("button", { name: "Enter expense" }).click();
    await expect(form.getByText("Enter what was bought or paid for.")).toBeVisible();
    await expect(form.getByText("Enter the amount.")).toBeVisible();
    await form.getByLabel("Description").fill("Replacement directory sign inserts");
    await form.getByLabel("Category").selectOption("materials");
    await form.getByLabel("Amount").fill("184.2");
    await form.getByLabel("Reference").fill("R-48213");
    // Without a building, any contract can be chosen, and there is no work order to pick.
    await expect(form.getByLabel("Work order")).toBeDisabled();
    await form.getByLabel("Building").selectOption({ label: "Calloway Tower" });
    await expect(form.getByLabel("Contract").getByRole("option")).toHaveCount(3);
    await form
      .getByLabel("Contract")
      .selectOption({ label: "CTR-0001 · Janitorial Services Agreement" });
    await expect(form.getByLabel("Work order")).toBeEnabled();
    await expect(form.getByLabel("Work order").getByRole("option").nth(1)).toContainText(
      /^WO-\d+ · /,
    );
    await form.getByLabel("Work order").selectOption({ index: 1 });
    await form.getByLabel("Vendor").selectOption({ label: "Clearwater Janitorial Supply" });
    await form.getByLabel("Description").scrollIntoViewIfNeeded();
    await shot(page, "69-new-expense");
    await form.getByRole("button", { name: "Enter expense" }).click();
    await expect(page.getByText("Replacement directory sign inserts was entered")).toBeVisible();

    // Incurred today, so it is at the top, formatted as money and waiting for a decision.
    const entered = row(page, "Replacement directory sign inserts");
    await expect(entered).toContainText("$184.20");
    await expect(entered).toContainText("R-48213");
    await expect(entered).toContainText("Calloway Tower");
    await expect(entered).toContainText("CTR-0001");
    await expect(entered).toContainText("Clearwater Janitorial Supply");
    await expect(entered).toContainText("Pending");

    // The API refuses an amount of nothing, and says so on the field.
    await toastsGone(page);
    await rowAction(page, /Actions for Replacement directory sign inserts/, "Edit expense");
    const edit = page.getByRole("dialog", { name: "Replacement directory sign inserts" });
    await expect(edit.getByLabel("Amount")).toHaveValue("184.20");
    await expect(edit.getByLabel("Work order")).toHaveValue(/.+/);
    await edit.getByLabel("Amount").fill("0");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit.getByLabel("Amount")).toHaveAccessibleDescription(/greater than 0/);
    await edit.getByLabel("Amount").fill("196.75");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Replacement directory sign inserts was updated")).toBeVisible();
    await expect(entered).toContainText("$196.75");

    // --- approve it ---
    await toastsGone(page);
    await rowAction(page, /Actions for Replacement directory sign inserts/, "Approve");
    await expect(
      page.getByText("Replacement directory sign inserts ($196.75) was approved"),
    ).toBeVisible();
    await expect(entered).toContainText("Approved");
    // Once decided it can only be reopened.
    await toastsGone(page);
    await page
      .getByRole("button", { name: /Actions for Replacement directory sign inserts/ })
      .click();
    await expect(page.getByRole("menuitem")).toHaveText(["Reopen"]);
    await page.keyboard.press("Escape");

    // --- reject another, with a reason ---
    await filter(page, "Filter by status").selectOption("pending");
    await expect(page).toHaveURL(/status=pending/);
    await expect(page.getByRole("row").nth(1)).toContainText("Pending");
    await page
      .getByRole("button", { name: /^Actions for/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Reject" }).click();
    const reject = page.getByRole("dialog", { name: "Reject this expense?" });
    await reject
      .getByLabel("Reason")
      .fill("No receipt attached. Enter it again with the receipt number.");
    await shot(page, "70-reject-expense");
    await reject.getByRole("button", { name: "Reject expense" }).click();
    await expect(page.getByText(/was rejected$/)).toBeVisible();
    await filter(page, "Filter by status").selectOption("rejected");
    await expect(
      row(page, "No receipt attached. Enter it again with the receipt number."),
    ).toContainText("Rejected");
  });

  test("reads an invoice whose lines add up to its total, and can change nothing about it", async ({
    page,
  }) => {
    await openPage(page, "Invoices");
    await expect(page.getByRole("row").nth(1)).toContainText(/INV-\d+/);
    // The current month's invoices are drafts: not issued, with no due date.
    await expect(page.getByRole("row").nth(1)).toContainText("Not issued yet");
    await expect(page.getByRole("row").nth(1)).toContainText("Draft");
    await toastsGone(page);
    await shot(page, "71-invoices");

    // Invoices are history here. There is nothing to create, issue, edit or record.
    await expect(
      page.getByRole("main").getByRole("button", { name: /new|add|create|issue|record|edit/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);

    // --- a paid cost-plus invoice: labor, materials and the markup on them ---
    await filter(page, "Filter by contract").selectOption({
      label: "Calloway Property Group · Janitorial Services Agreement",
    });
    await filter(page, "Filter by status").selectOption("paid");
    await expect(page).toHaveURL(/contract_id=.*status=paid|status=paid.*contract_id=/);
    const paid = page.getByRole("row").nth(1);
    await expect(paid).toContainText("Paid");
    await expect(paid).toContainText("Calloway Property Group");
    const number = (await paid.getByRole("button").textContent())?.trim() ?? "";
    expect(number).toMatch(/^INV-\d+$/);
    const listedTotal = (await paid.getByRole("cell").nth(3).textContent()) ?? "";
    await paid.getByRole("button", { name: number }).click();

    const drawer = page.getByRole("dialog", { name: `Invoice ${number}` });
    await expect(drawer).toContainText("Calloway Property Group");
    await expect(drawer.getByText("CTR-0001 · Janitorial Services Agreement")).toBeVisible();
    const lines = drawer.getByRole("table", { name: "Lines" });
    await expect(lines.getByRole("row", { name: /Markup at 12.50%/ })).toBeVisible();
    await shot(page, "72-invoice");

    // The lines come to the total, to the cent.
    const amounts = await lines.locator("tbody tr td:last-child").allTextContents();
    expect(amounts.length).toBeGreaterThanOrEqual(2);
    const total = await lines
      .getByRole("row", { name: /^Total/ })
      .getByRole("cell")
      .textContent();
    expect(amounts.map(cents).reduce((sum, amount) => sum + amount, 0)).toBe(cents(total ?? ""));
    // And it is the total the row it was opened from shows.
    expect(total).toBe(listedTotal);
    await expect(drawer.getByRole("alert")).toHaveCount(0);

    // What was received comes to what is recorded as paid, which is all of it.
    const payments = drawer.getByRole("table", { name: "Payments received" });
    const received = await payments.locator("tbody tr td:last-child").allTextContents();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const paidInAll = await payments
      .getByRole("row", { name: /^Paid/ })
      .getByRole("cell")
      .textContent();
    expect(received.map(cents).reduce((sum, amount) => sum + amount, 0)).toBe(
      cents(paidInAll ?? ""),
    );
    expect(cents(paidInAll ?? "")).toBe(cents(total ?? ""));
    await expect(payments.getByRole("row", { name: /^Balance due/ })).toContainText("$0.00");

    // The drawer has a way out and nothing else to press.
    await expect(drawer.getByRole("button")).toHaveText(["", "Done"]);
    await drawer.getByRole("button", { name: "Done" }).click();
    await expect(drawer).toBeHidden();

    // --- overdue invoices are picked out, in the list and when opened ---
    await page.getByRole("button", { name: "Clear filters" }).first().click();
    await toggle(page, "Overdue only").check();
    await expect(page).toHaveURL(/overdue=true/);
    const overdue = page.getByRole("row").nth(1);
    await expect(overdue).toContainText(/\d+ days? overdue/);
    await expect(overdue).toContainText("Issued");
    await toastsGone(page);
    await shot(page, "73-invoices-overdue");
    await overdue.getByRole("button", { name: /^INV-/ }).click();
    const owed = page.getByRole("dialog", { name: /^Invoice INV-/ });
    await expect(owed.getByText(/\d+ days? overdue/)).toBeVisible();
    await expect(owed.getByRole("table", { name: "Lines" })).toBeVisible();
    await shot(page, "74-invoice-overdue");
  });
});

test.describe("a supervisor running operations", () => {
  test("runs work orders and approves time, but sees no costs, approves no expenses and has no invoices", async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.supervisor);
    // Work orders, the schedule, time and expenses are hers. Contracts and invoices are not.
    await expect(mainNavigation(page).getByRole("link")).toHaveText([
      "Overview",
      "Work orders",
      "Buildings",
      "Customers",
      "Vendors",
      "Employees",
      "Schedule",
      "Timesheets",
      "Job roles",
      "Expenses",
      "Members",
      "Organization",
    ]);

    // --- work orders: hers to run ---
    await openPage(page, "Work orders");
    await expect(page.getByRole("button", { name: "New work order" })).toBeVisible();
    await page
      .getByRole("row")
      .nth(1)
      .getByRole("button", { name: /WO-\d+/ })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("button", { name: "Edit work order" })).toBeVisible();
    await expect.poll(async () => (await movesOffered(drawer)).length).toBeGreaterThan(0);
    await drawer
      .getByRole("textbox", { name: "Add a comment" })
      .fill("Checked on site. Access is through the loading dock.");
    await drawer.getByRole("button", { name: "Add comment" }).click();
    await expect(drawer.getByRole("listitem").first()).toHaveText(
      /Comment.*Priya Raman.*Checked on site\. Access is through the loading dock\./,
    );
    await shot(page, "75-supervisor-work-order");
    await drawer.getByRole("button", { name: "Done" }).click();
    // She reads no contracts, so the form does not ask her for one.
    await page.getByRole("button", { name: "New work order" }).click();
    const form = page.getByRole("dialog", { name: "New work order" });
    await expect(form.getByLabel("Building")).toBeVisible();
    await expect(form.getByLabel("Contract")).toHaveCount(0);
    await form.getByRole("button", { name: "Cancel" }).click();

    // --- the schedule: hers to keep ---
    await openPage(page, "Schedule");
    await expect(page.getByRole("button", { name: "Add shift" }).first()).toBeVisible();

    // --- timesheets: she approves time, and sees no costs ---
    await openPage(page, "Timesheets");
    await expect(page.getByRole("row").nth(1)).toContainText("Pending");
    await expect(page.getByRole("columnheader", { name: "Hours" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
    await expect(page.getByRole("table")).not.toContainText("$");
    // Nor a contract to filter by.
    await expect(filter(page, "Filter by contract")).toHaveCount(0);
    await shot(page, "76-supervisor-timesheets");

    // Her own time, entered by her, at a building she covers.
    const today = organizationDay();
    await page.getByRole("button", { name: "Enter timesheet" }).click();
    const entry = page.getByRole("dialog", { name: "Enter a timesheet" });
    await expect(entry.getByLabel("Contract")).toHaveCount(0);
    await expect(entry).not.toContainText("cost");
    await entry.getByLabel("Employee").selectOption({ label: "Priya Raman" });
    await entry.getByLabel("Building").selectOption({ label: "One Granite Plaza" });
    await entry.getByLabel("Regular hours").fill("8");
    await entry.getByRole("button", { name: "Enter timesheet" }).click();
    await expect(page.getByText("Time entered for Priya Raman")).toBeVisible();
    const own = page.getByRole("row").nth(1);
    await expect(own).toContainText("Priya Raman");
    await expect(own).toContainText("One Granite Plaza");
    await expect(own).not.toContainText("$");

    // Nobody approves their own time. The API refuses, and its explanation is shown.
    await toastsGone(page);
    await rowAction(
      page,
      new RegExp(
        `Actions for the timesheet of Priya Raman for ${shownDay(today)} at One Granite Plaza`,
      ),
      "Approve",
    );
    await expect(
      page.getByText("You cannot approve your own time. Someone else has to approve it."),
    ).toBeVisible();
    await expect(own).toContainText("Pending");

    // The same when it is one of several: nothing is approved, and it says which is hers.
    await toastsGone(page);
    const hers = page.getByRole("checkbox", {
      name: `Select the timesheet of Priya Raman for ${shownDay(today)} at One Granite Plaza`,
    });
    const someoneElses = page
      .getByRole("checkbox", { name: /^Select the timesheet of (?!Priya Raman)/ })
      .first();
    await hers.check();
    await someoneElses.check();
    const selection = page.getByRole("region", { name: "Selected timesheets" });
    const waiting = await countOn(page, "Pending");
    await selection.getByRole("button", { name: "Approve 2 timesheets" }).click();
    await expect(selection.getByRole("alert")).toHaveText(
      `You cannot approve your own time (Priya Raman on ${today} at One Granite Plaza).` +
        " Leave it out for someone else to approve. Nothing was approved.",
    );
    await expectCount(page, "Pending", waiting);
    await shot(page, "77-supervisor-own-time-refused");

    // Leaving her own out, the other is approved.
    await hers.uncheck();
    await expect(selection.getByRole("alert")).toHaveCount(0);
    await selection.getByRole("button", { name: "Approve 1 timesheet" }).click();
    await expect(page.getByText("1 timesheet was approved")).toBeVisible();
    await expectCount(page, "Pending", waiting - 1);

    // --- expenses: she enters them, and someone else decides ---
    await openPage(page, "Expenses");
    await expect(page.getByRole("button", { name: "New expense" })).toBeVisible();
    await filter(page, "Filter by status").selectOption("pending");
    await expect(page.getByRole("row").nth(1)).toContainText("Pending");
    await expect(filter(page, "Filter by contract")).toHaveCount(0);
    await toastsGone(page);
    await page
      .getByRole("button", { name: /^Actions for/ })
      .first()
      .click();
    await expect(page.getByRole("menuitem")).toHaveText(["Edit expense"]);
    await shot(page, "78-supervisor-expenses");
    await page.keyboard.press("Escape");
    // An expense that has been decided on offers her nothing at all.
    await filter(page, "Filter by status").selectOption("approved");
    await expect(page.getByRole("row").nth(1)).toContainText("Approved");
    await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
    // Hiding the action is a convenience. The API is what refuses.
    const pending = await page.request.get("/api/v1/expenses?status=pending&page_size=1");
    const expense = (await pending.json()).items[0];
    const approval = await page.request.post(`/api/v1/expenses/${expense.id}/approve`, {
      headers: FROM_THIS_SITE,
    });
    expect(approval.status()).toBe(403);
    expect((await approval.json()).code).toBe("permission_denied");

    // --- invoices: not hers to see, by the menu, by the address or by the API ---
    await page.goto("/invoices");
    await expect(
      page.getByRole("heading", { name: "You don't have access to this page" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await shot(page, "79-supervisor-invoices-refused");
    expect((await page.request.get("/api/v1/invoices")).status()).toBe(403);
  });
});

test.describe("operations on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the backlog, a work order and the week's roster are all within reach", async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await mainNavigation(page).getByRole("link", { name: "Work orders" }).click();
    await expect(page.getByRole("heading", { name: "Work orders", level: 1 })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText(/WO-\d+/);
    await expect(segment(page, "Backlog")).toBeChecked();
    await shot(page, "80-phone-work-orders");

    // The drawer fills the screen, with its way out in view.
    await page
      .getByRole("row")
      .nth(1)
      .getByRole("button", { name: /WO-\d+/ })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "History" })).toBeAttached();
    await expect(drawer.getByRole("button", { name: "Done" })).toBeInViewport();
    await shot(page, "81-phone-work-order");
    await drawer.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Open navigation" }).click();
    await mainNavigation(page).getByRole("link", { name: "Schedule" }).click();
    await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
    await page.getByRole("combobox", { name: "Building", exact: true }).selectOption({
      label: "Calloway Tower",
    });
    const roster = page.getByRole("table", { name: /^Schedule for Calloway Tower/ });
    // The roster scrolls sideways under the names, which stay in view.
    await expect(roster.getByRole("rowheader").first()).toBeInViewport();
    await shot(page, "82-phone-schedule");

    await page.getByRole("button", { name: "Add shift" }).first().click();
    const add = page.getByRole("dialog", { name: "Add shift" });
    await expect(add.getByLabel("Employee")).toBeVisible();
    await expect(add.getByRole("button", { name: "Add shift" })).toBeInViewport();
    await shot(page, "83-phone-add-shift");
    await add.getByRole("button", { name: "Cancel" }).click();

    // The approval queue: its tabs and filters fit, and the table scrolls under them.
    await page.getByRole("button", { name: "Open navigation" }).click();
    await mainNavigation(page).getByRole("link", { name: "Timesheets" }).click();
    await expect(page.getByRole("heading", { name: "Timesheets", level: 1 })).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText("Pending");
    await expect(page.getByLabel("Work date to").filter({ visible: true })).toBeInViewport();
    await shot(page, "84-phone-timesheets");
  });
});
