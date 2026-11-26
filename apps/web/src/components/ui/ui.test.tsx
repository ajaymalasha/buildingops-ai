import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BarChart, ChartLegend, type ChartPoint, type ChartSeries } from "./bar-chart";
import { BalanceBar, ShareBar } from "./bars";
import { Button } from "./button";
import { Blank, NameCell, StackedCell } from "./cells";
import { Checkbox } from "./checkbox";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type Column } from "./data-table";
import { DateRangeFilter } from "./date-range-filter";
import { Detail, DetailList } from "./detail-list";
import { Field } from "./field";
import { FilterSelect } from "./filter-select";
import { FilterToggle } from "./filter-toggle";
import { FormSection } from "./form-section";
import { Input, Textarea, UnitInput } from "./input";
import { Pagination } from "./pagination";
import { ReasonDialog } from "./reason-dialog";
import { SearchInput } from "./search-input";
import { SegmentedControl } from "./segmented-control";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetLoading } from "./sheet";
import { Timeline, TimelineItem } from "./timeline";
import { WeekGrid } from "./week-grid";

type Person = { id: string; name: string; hours: number };

const columns: Column<Person>[] = [
  { id: "name", header: "Name", sortKey: "name", cell: (person) => person.name },
  { id: "hours", header: "Hours", align: "end", cell: (person) => person.hours },
];
const people: Person[] = [
  { id: "1", name: "Dana", hours: 40 },
  { id: "2", name: "Luis", hours: 32 },
];

function table(props: Partial<React.ComponentProps<typeof DataTable<Person>>> = {}) {
  return render(
    <DataTable
      caption="People"
      columns={columns}
      rows={people}
      rowKey={(person) => person.id}
      isLoading={false}
      empty={<p>Nobody here yet</p>}
      {...props}
    />,
  );
}

describe("DataTable", () => {
  it("renders a labelled table with one row per record", () => {
    table();

    const grid = screen.getByRole("table", { name: "People" });
    expect(within(grid).getAllByRole("row")).toHaveLength(3); // header + 2
    expect(within(grid).getByRole("cell", { name: "Dana" })).toBeInTheDocument();
    expect(grid).toHaveAttribute("aria-busy", "false");
  });

  it("shows placeholder rows while the first page loads", () => {
    table({ rows: undefined, isLoading: true, skeletonRows: 4 });

    const grid = screen.getByRole("table", { name: "People" });
    expect(grid).toHaveAttribute("aria-busy", "true");
    expect(within(grid).getAllByRole("row")).toHaveLength(5);
    expect(screen.queryByText("Nobody here yet")).not.toBeInTheDocument();
  });

  it("shows the empty state only when the request succeeded with no rows", () => {
    table({ rows: [] });

    expect(screen.getByText("Nobody here yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the API's message and a retry when loading failed", async () => {
    const onRetry = vi.fn();
    table({
      rows: undefined,
      error: { status: 503, code: "unavailable", title: "The service is temporarily unavailable" },
      onRetry,
    });

    expect(screen.getByRole("alert")).toHaveTextContent("The service is temporarily unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("treats a refusal as a refusal: no retry for something that will not change", () => {
    table({
      rows: undefined,
      error: {
        status: 403,
        code: "permission_denied",
        title: "You do not have permission to do this",
      },
      onRetry: vi.fn(),
    });

    expect(screen.getByRole("alert")).toHaveTextContent("You don't have access to this");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("keeps showing the previous rows if a refresh fails", () => {
    table({ error: new TypeError("fetch failed") });

    expect(screen.getByRole("cell", { name: "Dana" })).toBeInTheDocument();
  });

  it("cycles a sortable column through ascending, descending and unsorted", async () => {
    const onSortChange = vi.fn();
    const { rerender } = table({ onSortChange });
    const header = () => screen.getByRole("columnheader", { name: /Name/ });
    const press = () => userEvent.click(within(header()).getByRole("button"));
    const withSort = (sort: string | undefined) =>
      rerender(
        <DataTable
          caption="People"
          columns={columns}
          rows={people}
          rowKey={(person) => person.id}
          isLoading={false}
          empty={null}
          sort={sort}
          onSortChange={onSortChange}
        />,
      );

    expect(header()).not.toHaveAttribute("aria-sort");
    await press();
    expect(onSortChange).toHaveBeenLastCalledWith("name");

    withSort("name");
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    await press();
    expect(onSortChange).toHaveBeenLastCalledWith("-name");

    withSort("-name");
    expect(header()).toHaveAttribute("aria-sort", "descending");
    await press();
    expect(onSortChange).toHaveBeenLastCalledWith(undefined);
  });

  it("offers no sort control on columns the API cannot sort by", () => {
    table({ onSortChange: vi.fn() });

    const hours = screen.getByRole("columnheader", { name: "Hours" });
    expect(within(hours).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives text that follows a right-aligned number more room, in the heading and the cells", () => {
    table({
      columns: [...columns, { id: "site", header: "Site", cell: () => "Calloway Tower" }],
    });

    expect(screen.getByRole("columnheader", { name: "Site" })).toHaveClass("pl-8");
    for (const cell of screen.getAllByRole("cell", { name: "Calloway Tower" })) {
      expect(cell).toHaveClass("pl-8");
    }
    // Not the number itself, and not a column that follows text.
    expect(screen.getByRole("columnheader", { name: "Hours" })).not.toHaveClass("pl-8");
    expect(screen.getByRole("columnheader", { name: /Name/ })).not.toHaveClass("pl-8");
  });
});

describe("DataTable with rows that can be ticked", () => {
  const crew: Person[] = [
    { id: "1", name: "Dana", hours: 40 },
    { id: "2", name: "Luis", hours: 32 },
    { id: "3", name: "Priya", hours: 0 }, // nothing to approve: cannot be ticked
  ];

  function selectable(selected: string[] = []) {
    const onChange = vi.fn();
    const view = render(
      <DataTable
        caption="People"
        columns={columns}
        rows={crew}
        rowKey={(person) => person.id}
        isLoading={false}
        empty={null}
        selection={{
          selected: new Set(selected),
          onChange,
          isSelectable: (person) => person.hours > 0,
          rowLabel: (person) => `Select ${person.name}`,
          allLabel: "Select everyone with hours",
        }}
      />,
    );
    return { onChange, ...view };
  }
  const all = () => screen.getByRole("checkbox", { name: "Select everyone with hours" });
  const chosen = (onChange: ReturnType<typeof vi.fn>) =>
    [...(onChange.mock.lastCall![0] as Set<string>)].sort();

  it("gives each row that can be ticked a box named for it, and the others none", () => {
    selectable();

    expect(screen.getByRole("checkbox", { name: "Select Dana" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Luis" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Select Priya" })).not.toBeInTheDocument();
    // The boxes take a column of their own, in the heading too.
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(within(screen.getAllByRole("row")[1]!).getAllByRole("cell")).toHaveLength(3);
  });

  it("reports the rows that are ticked after one is ticked or unticked", async () => {
    const { onChange } = selectable(["1"]);

    expect(screen.getByRole("checkbox", { name: "Select Dana" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Luis" }));
    expect(chosen(onChange)).toEqual(["1", "2"]);

    await userEvent.click(screen.getByRole("checkbox", { name: "Select Dana" }));
    expect(chosen(onChange)).toEqual([]);
  });

  it("ticks every row that can be ticked from the heading, and unticks them all again", async () => {
    const { onChange, unmount } = selectable();
    expect(all()).not.toBeChecked();
    await userEvent.click(all());
    expect(chosen(onChange)).toEqual(["1", "2"]); // not Priya
    unmount();

    const again = selectable(["1", "2"]);
    expect(all()).toBeChecked();
    await userEvent.click(all());
    expect(chosen(again.onChange)).toEqual([]);
  });

  it("shows the heading's box as partly ticked when only some rows are", () => {
    selectable(["2"]);

    expect(all()).not.toBeChecked();
    expect(all()).toBePartiallyChecked();
  });

  it("has nothing for the heading's box to do when no row can be ticked", () => {
    render(
      <DataTable
        caption="People"
        columns={columns}
        rows={crew}
        rowKey={(person) => person.id}
        isLoading={false}
        empty={null}
        selection={{
          selected: new Set(),
          onChange: vi.fn(),
          isSelectable: () => false,
          rowLabel: (person) => `Select ${person.name}`,
          allLabel: "Select everyone with hours",
        }}
      />,
    );

    expect(all()).toBeDisabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});

describe("DataTable with rows that open", () => {
  function openable() {
    const onOpen = vi.fn();
    const onArchive = vi.fn();
    render(
      <DataTable
        caption="People"
        columns={[
          {
            id: "name",
            header: "Name",
            cell: (person: Person) => (
              <NameCell
                name={person.name}
                code={`EMP-${person.id}`}
                onOpen={() => onOpen(person)}
              />
            ),
          },
          { id: "hours", header: "Hours", align: "end", cell: (person) => person.hours },
          {
            id: "actions",
            header: "",
            cell: (person) => (
              <button onClick={() => onArchive(person)}>Archive {person.name}</button>
            ),
          },
        ]}
        rows={people}
        rowKey={(person) => person.id}
        isLoading={false}
        empty={null}
        onRowClick={onOpen}
      />,
    );
    return { onOpen, onArchive };
  }

  it("opens a row from a click anywhere on it", async () => {
    const { onOpen } = openable();

    await userEvent.click(screen.getByRole("cell", { name: "32" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(people[1]);
  });

  it("opens a row from the keyboard through the button that names it", async () => {
    const { onOpen } = openable();

    const open = screen.getByRole("button", { name: "Dana EMP-1" });
    open.focus();
    await userEvent.keyboard("{Enter}");

    // Once: the button opens it, and the row does not open it a second time.
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(people[0]);
  });

  it("leaves a control inside the row to do its own job", async () => {
    const { onOpen, onArchive } = openable();

    await userEvent.click(screen.getByRole("button", { name: "Archive Luis" }));

    expect(onArchive).toHaveBeenCalledExactlyOnceWith(people[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not make rows look clickable when they do not open", () => {
    table();

    expect(screen.getAllByRole("row")[1]).not.toHaveClass("cursor-pointer");
  });
});

describe("Pagination", () => {
  it("describes the visible range and disables the ends", async () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Pagination page={1} pageSize={25} total={60} onPageChange={onPageChange} noun="members" />,
    );

    expect(screen.getByText("1–25 of 60 members")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <Pagination page={3} pageSize={25} total={60} onPageChange={onPageChange} noun="members" />,
    );
    expect(screen.getByText("51–60 of 60 members")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it("formats large totals", () => {
    render(<Pagination page={1} pageSize={25} total={12480} onPageChange={() => undefined} />);

    expect(screen.getByText("1–25 of 12,480 results")).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("ties the control to its label and hint", () => {
    render(
      <Field id="title" label="Job title" hint="Shown to colleagues." optional>
        {(control) => <Input {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Job title/);
    expect(input).toHaveAccessibleDescription("Shown to colleagues.");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("announces a validation error and marks the control invalid", () => {
    render(
      <Field id="email" label="Email" hint="Work address." error="Enter a valid email address.">
        {(control) => <Input {...control} />}
      </Field>,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(screen.queryByText("Work address.")).not.toBeInTheDocument(); // the error replaces the hint
  });

  it("can keep its label for screen readers only, under a heading that already says it", () => {
    render(
      <Field id="notes" label="Notes" labelHidden hint="Anything the team should know.">
        {(control) => <Input {...control} />}
      </Field>,
    );

    expect(screen.getByText("Notes")).toHaveClass("sr-only");
    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription(
      "Anything the team should know.",
    );
  });
});

describe("UnitInput", () => {
  it("shows the unit inside the input and reads it out after the hint", () => {
    render(
      <Field id="terms" label="Payment terms" hint="Days from invoice to payment due.">
        {(control) => <UnitInput {...control} unit="days" defaultValue="30" />}
      </Field>,
    );

    const input = screen.getByLabelText("Payment terms");
    expect(input).toHaveValue("30");
    expect(input).toHaveAccessibleDescription("Days from invoice to payment due. days");
  });

  it("describes the input by its unit alone when there is no hint", () => {
    render(<UnitInput aria-label="Markup" unit="%" defaultValue="12.5" />);

    expect(screen.getByLabelText("Markup")).toHaveAccessibleDescription("%");
  });
});

describe("Checkbox", () => {
  it("is a native checkbox, tied to its label and its description", async () => {
    const onChange = vi.fn();
    render(
      <Checkbox
        label="Supervisory role"
        description="People in this role can be chosen as someone's supervisor."
        onChange={onChange}
      />,
    );

    const box = screen.getByRole("checkbox", { name: "Supervisory role" });
    expect(box).toHaveAccessibleDescription(
      "People in this role can be chosen as someone's supervisor.",
    );
    expect(box).not.toBeChecked();

    await userEvent.click(screen.getByText("Supervisory role")); // the label is a target too
    expect(box).toBeChecked();
    expect(onChange).toHaveBeenCalledOnce();

    box.focus();
    await userEvent.keyboard(" ");
    expect(box).not.toBeChecked();
  });

  it("shows the state it is given, and leaves changing it to its owner", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Calloway Tower" checked onChange={onChange} />);

    const box = screen.getByRole("checkbox", { name: "Calloway Tower" });
    expect(box).toBeChecked();
    expect(box).not.toHaveAttribute("aria-describedby");

    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledOnce();
    expect(box).toBeChecked(); // still what its owner says
  });

  it("cannot be changed while disabled", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Primary building" disabled onChange={onChange} />);

    await userEvent.click(screen.getByText("Primary building"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can keep its label for screen readers only, beside what it selects", () => {
    render(
      <Checkbox
        labelHidden
        label="Select the timesheet of Ana Zamora"
        onChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: "Select the timesheet of Ana Zamora" }),
    ).toBeVisible();
    expect(screen.getByText("Select the timesheet of Ana Zamora")).toHaveClass("sr-only");
  });

  it("can show that only some of what it stands for is ticked", () => {
    const { rerender } = render(
      <Checkbox label="Select all" indeterminate onChange={() => undefined} checked={false} />,
    );
    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box).toBePartiallyChecked();

    rerender(<Checkbox label="Select all" onChange={() => undefined} checked />);
    expect(box).not.toBePartiallyChecked();
    expect(box).toBeChecked();
  });

  it("still hands its input to a form that registers it by reference", () => {
    const ref = vi.fn();
    render(<Checkbox label="Billable" ref={ref} indeterminate />);

    expect(ref).toHaveBeenCalledWith(screen.getByRole("checkbox", { name: "Billable" }));
  });
});

describe("FilterSelect", () => {
  const options = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ];

  it("offers no filter first, then the options, and reports what was chosen", async () => {
    const onChange = vi.fn();
    render(
      <FilterSelect
        label="Filter by status"
        placeholder="Any status"
        value="active"
        options={options}
        onChange={onChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Filter by status" });
    expect(select).toHaveValue("active");
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("Any status");

    await userEvent.selectOptions(select, "Inactive");
    expect(onChange).toHaveBeenLastCalledWith("inactive");

    // Choosing the first option reports an empty value, which takes the filter off.
    await userEvent.selectOptions(select, "Any status");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("shows no filter when none is applied", () => {
    render(
      <FilterSelect
        label="Filter by status"
        placeholder="Any status"
        value={undefined}
        options={options}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("combobox")).toHaveDisplayValue("Any status");
  });
});

describe("table cells", () => {
  it("identifies a row by its name, with the code people quote under it", () => {
    render(<NameCell name="Calloway Tower" code="BLD-0001" />);

    expect(screen.getByText("Calloway Tower")).toHaveAttribute("title", "Calloway Tower");
    expect(screen.getByText("BLD-0001")).toHaveClass("font-mono");
  });

  it("puts a quieter detail under a value, and nothing when there is none", () => {
    const { rerender } = render(
      <StackedCell primary="New York, NY" secondary="410 Hollis Street" />,
    );
    expect(screen.getByText("410 Hollis Street")).toHaveClass("text-ink-muted");

    rerender(<StackedCell primary="New York, NY" secondary={null} />);
    expect(screen.getByText("New York, NY").parentElement?.children).toHaveLength(1);
  });

  it("says in words what a dash stands for", () => {
    render(<Blank label="No phone number" />);

    expect(screen.getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("No phone number")).toHaveClass("sr-only");
  });

  it("makes a button of the name and its code where the row opens a record", async () => {
    const onOpen = vi.fn();
    render(<NameCell name="No cooling on the 4th floor" code="WO-0412" onOpen={onOpen} />);

    // Named by both, since the same title can come up at several buildings.
    const open = screen.getByRole("button", { name: "No cooling on the 4th floor WO-0412" });
    await userEvent.click(open);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(open).toHaveAttribute("type", "button");
  });

  it("is plain text where there is nothing to open", () => {
    render(<NameCell name="Calloway Tower" code="BLD-0001" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("FormSection", () => {
  it("groups its fields under a title that is announced with them", () => {
    render(
      <FormSection title="Address" description="Where invoices are sent.">
        <Field id="city" label="City">
          {(control) => <Input {...control} />}
        </Field>
      </FormSection>,
    );

    const group = screen.getByRole("group", { name: "Address" });
    expect(within(group).getByLabelText("City")).toBeInTheDocument();
    expect(within(group).getByText("Where invoices are sent.")).toBeInTheDocument();
  });
});

describe("Sheet", () => {
  function sheet(onOpenChange: (open: boolean) => void = () => undefined) {
    return render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent title="New customer" description="A company you service buildings for.">
          <form>
            <SheetBody>
              <Field id="name" label="Name">
                {(control) => <Input {...control} />}
              </Field>
              <Field id="code" label="Code">
                {(control) => <Input {...control} />}
              </Field>
            </SheetBody>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="ghost">Cancel</Button>
              </SheetClose>
              <Button type="submit">Create customer</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>,
    );
  }

  it("is a dialog with a title and a description", () => {
    sheet();

    const dialog = screen.getByRole("dialog", { name: "New customer" });
    expect(dialog).toHaveAccessibleDescription("A company you service buildings for.");
    expect(within(dialog).getByRole("button", { name: "Create customer" })).toBeInTheDocument();
  });

  it("starts in the first field, not on the close button", () => {
    sheet();

    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("keeps focus inside while it is open", async () => {
    sheet();

    // Forward from the last control comes round to the first; it never reaches the page.
    screen.getByRole("button", { name: "Create customer" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Create customer" })).toHaveFocus();
  });

  it("closes from the close button, from Cancel and on Escape", async () => {
    const onOpenChange = vi.fn();
    sheet(onOpenChange);

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledTimes(3);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("closes on a click on the page behind while nothing has been entered", async () => {
    const onOpenChange = vi.fn();
    sheet(onOpenChange);

    await userEvent.click(document.querySelector(".animate-overlay-in")!);

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("stays open on a click behind once something has been typed, so a slip loses nothing", async () => {
    const onOpenChange = vi.fn();
    sheet(onOpenChange);

    await userEvent.type(screen.getByLabelText("Name"), "Harborline Offices");
    await userEvent.click(document.querySelector(".animate-overlay-in")!);
    expect(onOpenChange).not.toHaveBeenCalled();

    // Leaving on purpose still works.
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("renders nothing while closed", () => {
    render(
      <Sheet open={false}>
        <SheetContent title="New customer">
          <SheetBody>Fields</SheetBody>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("has a labelled placeholder for while a form's choices load", () => {
    render(
      <Sheet open>
        <SheetContent title="New building">
          <SheetLoading fields={3} />
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    // With no field to start in, focus falls back to the first control: the close button.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("moves focus to the first field when the form arrives after loading", () => {
    const drawer = (loaded: boolean) => (
      <Sheet open>
        <SheetContent title="New building">
          {loaded ? (
            <SheetBody>
              <Field id="customer" label="Customer">
                {(control) => <Input {...control} />}
              </Field>
            </SheetBody>
          ) : (
            <SheetLoading />
          )}
        </SheetContent>
      </Sheet>
    );
    const { rerender } = render(drawer(false));
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    rerender(drawer(true));

    expect(screen.getByLabelText("Customer")).toHaveFocus();
  });

  // A drawer that shows a record, with a comment box under it.
  const readingDrawer = (loaded: boolean) => (
    <Sheet open>
      <SheetContent reading title="No cooling on the 4th floor" description="Work order WO-0412">
        {loaded ? (
          <SheetBody>
            <p>Calloway Tower</p>
            <Field id="comment" label="Add a comment">
              {(control) => <Textarea {...control} />}
            </Field>
          </SheetBody>
        ) : (
          <SheetLoading />
        )}
      </SheetContent>
    </Sheet>
  );

  it("starts on the close button in a drawer for reading, even with a field further down", () => {
    render(readingDrawer(true));

    // Jumping to the comment box would scroll the record out of sight as it opens.
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("stays on the close button when what a reading drawer shows arrives after it opens", () => {
    const { rerender } = render(readingDrawer(false));

    rerender(readingDrawer(true));

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(screen.getByLabelText("Add a comment")).not.toHaveFocus();
  });

  it("leaves focus alone when loading ends because the drawer was closed", () => {
    const { rerender } = render(
      <Sheet open>
        <SheetContent title="New building">
          <SheetLoading />
        </SheetContent>
      </Sheet>,
    );

    rerender(
      <Sheet open={false}>
        <SheetContent title="New building">
          <SheetLoading />
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  const conflict = {
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code: "conflict",
    detail:
      "Calloway Property Group still has 4 buildings. Before archiving, archive its buildings or move them to another customer.",
  };

  function confirmDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
    const handlers = { onConfirm: vi.fn(), onOpenChange: vi.fn() };
    render(
      <ConfirmDialog
        open
        title="Archive Calloway Property Group?"
        description="It leaves the customer list. Archiving cannot be undone from the app."
        confirmLabel="Archive customer"
        tone="danger"
        {...handlers}
        {...props}
      />,
    );
    return handlers;
  }

  it("asks the question, says what will happen and starts on the safe answer", () => {
    confirmDialog();

    const dialog = screen.getByRole("alertdialog", { name: "Archive Calloway Property Group?" });
    expect(dialog).toHaveAccessibleDescription(
      "It leaves the customer list. Archiving cannot be undone from the app.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("leaves closing to its owner, so the outcome can be shown where the question was", async () => {
    const { onConfirm, onOpenChange } = confirmDialog();

    await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("blocks a second confirmation while the first is in flight", async () => {
    const { onConfirm } = confirmDialog({ loading: true });

    const confirm = screen.getByRole("button", { name: "Archive customer" });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a refusal in the API's words, with nothing left to do but close", async () => {
    const { onOpenChange } = confirmDialog({ error: conflict });

    expect(screen.getByRole("alert")).toHaveTextContent(conflict.detail);
    expect(screen.queryByRole("button", { name: "Archive customer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("lets a failure that is not a refusal be tried again", async () => {
    const { onConfirm } = confirmDialog({ error: new TypeError("fetch failed") });

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Archive customer" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes on Cancel and on Escape", async () => {
    const { onOpenChange } = confirmDialog();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("names the way out for what is kept when the action is itself a cancellation", async () => {
    const { onConfirm, onOpenChange } = confirmDialog({
      title: "Cancel this shift?",
      confirmLabel: "Cancel shift",
      cancelLabel: "Keep shift",
    });

    // Two buttons that both say cancel would be a trap.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep shift" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Keep shift" }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ReasonDialog", () => {
  function reasonDialog(props: Partial<React.ComponentProps<typeof ReasonDialog>> = {}) {
    const handlers = { onConfirm: vi.fn(), onOpenChange: vi.fn() };
    render(
      <ReasonDialog
        open
        title="Reject this timesheet?"
        description="Maya Castellano, Nov 25, 2026 at Calloway Tower. The reason is kept on the timesheet."
        confirmLabel="Reject timesheet"
        requiredMessage="Say why the timesheet is rejected."
        {...handlers}
        {...props}
      />,
    );
    return handlers;
  }
  const reason = () => screen.getByRole("textbox", { name: "Reason" });
  const submit = () => userEvent.click(screen.getByRole("button", { name: "Reject timesheet" }));

  it("asks the question, says what it is about and starts where the reason is typed", () => {
    reasonDialog();

    const dialog = screen.getByRole("dialog", { name: "Reject this timesheet?" });
    expect(dialog).toHaveAccessibleDescription(
      "Maya Castellano, Nov 25, 2026 at Calloway Tower. The reason is kept on the timesheet.",
    );
    expect(reason()).toHaveFocus();
  });

  it("does not go ahead without a reason, and says what is missing on the field", async () => {
    const { onConfirm } = reasonDialog();

    await userEvent.type(reason(), "   ");
    await submit();

    expect(onConfirm).not.toHaveBeenCalled();
    expect(reason()).toBeInvalid();
    expect(reason()).toHaveAccessibleDescription("Say why the timesheet is rejected.");

    // The message goes as soon as something is typed.
    await userEvent.type(reason(), "H");
    expect(reason()).toBeValid();
  });

  it("hands over the reason as it was typed, without the space around it", async () => {
    const { onConfirm, onOpenChange } = reasonDialog();

    await userEvent.type(reason(), "  Hours do not match the sign-in sheet. ");
    await submit();

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Hours do not match the sign-in sheet.");
    // Closing is its owner's, so that a refusal can be shown where the reason was given.
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks a second submission while the first is in flight", async () => {
    const { onConfirm } = reasonDialog({ loading: true });

    expect(screen.getByRole("button", { name: "Reject timesheet" })).toBeDisabled();
    await userEvent.type(reason(), "Duplicate of another entry.{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a refusal in the API's words", () => {
    reasonDialog({
      error: {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "conflict",
        detail: "This timesheet has already been approved. Reopen it to decide again.",
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This timesheet has already been approved. Reopen it to decide again.",
    );
  });

  it("puts what the API says about the reason itself on the field", () => {
    reasonDialog({
      error: {
        type: "about:blank",
        title: "Validation failed",
        status: 422,
        code: "validation_error",
        detail: "One or more fields are invalid.",
        errors: [{ field: "reason", message: "Use at most 500 characters." }],
      },
    });

    expect(reason()).toHaveAccessibleDescription("Use at most 500 characters.");
    expect(screen.queryByText("One or more fields are invalid.")).not.toBeInTheDocument();
  });

  it("closes on Cancel and on Escape, and starts empty the next time", async () => {
    const onOpenChange = vi.fn();
    const dialog = (open: boolean) => (
      <ReasonDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Reject this expense?"
        description="Ice melt ($184.20)."
        confirmLabel="Reject expense"
        onConfirm={() => undefined}
      />
    );
    const { rerender } = render(dialog(true));

    await userEvent.type(reason(), "No receipt attached.");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    rerender(dialog(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(dialog(true));
    expect(reason()).toHaveValue("");
  });
});

describe("SegmentedControl", () => {
  const segments = [
    { value: "pending", label: "Pending", count: 263 },
    { value: "approved", label: "Approved", count: 18227 },
    { value: "all", label: "All" },
  ] as const;

  function control(value: (typeof segments)[number]["value"] = "pending") {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Timesheets by status"
        value={value}
        segments={segments}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it("is a named group of radio buttons, with exactly one on", () => {
    control();

    const group = screen.getByRole("radiogroup", { name: "Timesheets by status" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /Pending/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Approved/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "All" })).not.toBeChecked();
  });

  it("shows how many records a choice holds, where that is known", () => {
    control();

    expect(screen.getByRole("radio", { name: /Pending/ })).toHaveTextContent("Pending263");
    expect(screen.getByRole("radio", { name: /Approved/ })).toHaveTextContent("Approved18,227");
    expect(screen.getByRole("radio", { name: "All" })).toHaveTextContent(/^All$/);
  });

  it("reports the choice that was pressed", async () => {
    const onChange = control();

    await userEvent.click(screen.getByRole("radio", { name: /Approved/ }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("approved");
  });

  it("keeps one choice on: pressing it again changes nothing", async () => {
    const onChange = control("approved");

    await userEvent.click(screen.getByRole("radio", { name: /Approved/ }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Approved/ })).toBeChecked();
  });

  it("moves between the choices with the arrow keys, as radio buttons do", async () => {
    control();

    // Tab reaches the group once, at the choice that is on.
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: /Pending/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Approved/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Pending/ })).toHaveFocus(); // round to the start
    await userEvent.tab();
    expect(document.body).toHaveFocus();
  });
});

describe("FilterToggle", () => {
  it("is a checkbox named for what it narrows the list to, and shows the applied state", () => {
    const { rerender } = render(
      <FilterToggle label="Overdue only" checked={false} onChange={() => undefined} />,
    );
    const toggle = screen.getByRole("checkbox", { name: "Overdue only" });
    expect(toggle).not.toBeChecked();

    rerender(<FilterToggle label="Overdue only" checked onChange={() => undefined} />);
    expect(toggle).toBeChecked();
  });

  it("reports being turned on and off, from the box, its label or the space bar", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterToggle label="Overdue only" checked={false} onChange={onChange} />,
    );

    await userEvent.click(screen.getByText("Overdue only"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<FilterToggle label="Overdue only" checked onChange={onChange} />);
    screen.getByRole("checkbox", { name: "Overdue only" }).focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(false);
    // What it shows is what it is given: the URL decides.
    expect(screen.getByRole("checkbox", { name: "Overdue only" })).toBeChecked();
  });
});

describe("DateRangeFilter", () => {
  function range(from?: string, to?: string) {
    const onChange = vi.fn();
    render(<DateRangeFilter label="Work date" from={from} to={to} onChange={onChange} />);
    return onChange;
  }

  it("is a named pair of date inputs, each saying which end it is", () => {
    range("2026-11-01", "2026-11-26");

    const group = screen.getByRole("group", { name: "Work date" });
    expect(within(group).getByText("Work date")).toBeVisible();
    expect(screen.getByLabelText("Work date from")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Work date to")).toHaveValue("2026-11-26");
  });

  it("stops each end at the other, so the range cannot be chosen backwards", () => {
    range("2026-11-01", "2026-11-26");

    expect(screen.getByLabelText("Work date from")).toHaveAttribute("max", "2026-11-26");
    expect(screen.getByLabelText("Work date to")).toHaveAttribute("min", "2026-11-01");
  });

  it("reports the end that changed, and an emptied end as empty", () => {
    const onChange = range(undefined, "2026-11-26");
    expect(screen.getByLabelText("Work date from")).toHaveValue("");
    expect(screen.getByLabelText("Work date from")).not.toHaveAttribute("min");

    fireEvent.change(screen.getByLabelText("Work date from"), { target: { value: "2026-11-10" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-11-10" });

    fireEvent.change(screen.getByLabelText("Work date to"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ to: "" });
  });
});

describe("Timeline", () => {
  function history() {
    return render(
      <Timeline label="History of WO-0412">
        <TimelineItem
          title="Completed"
          by="Luis Ortega"
          at="2026-11-26T15:42:00Z"
          when="Nov 26, 2026, 10:42 AM"
        >
          Replaced both lamps and tested them.
        </TimelineItem>
        <TimelineItem
          title="Work started"
          by="Luis Ortega"
          at="2026-11-26T14:10:00Z"
          when="Nov 26, 2026, 9:10 AM"
        />
        <TimelineItem
          title="Work order raised"
          at="2026-11-25T13:05:00Z"
          when="Nov 25, 2026, 8:05 AM"
        />
      </Timeline>,
    );
  }

  it("is a named list with an entry for each thing that happened, in the order given", () => {
    history();

    const list = screen.getByRole("list", { name: "History of WO-0412" });
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent("Completed");
    expect(entries[2]).toHaveTextContent("Work order raised");
  });

  it("says who did it and when, with the moment itself for machines", () => {
    history();

    const [completed, , raised] = screen.getAllByRole("listitem");
    expect(completed).toHaveTextContent("Luis Ortega · Nov 26, 2026, 10:42 AM");
    expect(within(completed!).getByText("Nov 26, 2026, 10:42 AM")).toHaveAttribute(
      "dateTime",
      "2026-11-26T15:42:00Z",
    );
    // Nobody is named where nobody is known.
    expect(raised).not.toHaveTextContent("·");
  });

  it("shows what was said with an entry under it, and nothing where nothing was", () => {
    history();

    const [completed, started] = screen.getAllByRole("listitem");
    expect(within(completed!).getByText("Replaced both lamps and tested them.")).toBeVisible();
    expect(started!.querySelector(".bg-canvas")).toBeNull();
  });
});

describe("WeekGrid", () => {
  type Roster = { id: string; name: string; shifts: Record<string, string> };

  const days = [
    "2026-11-23",
    "2026-11-24",
    "2026-11-25",
    "2026-11-26",
    "2026-11-27",
    "2026-11-28",
    "2026-11-29",
  ];
  const rows: Roster[] = [
    { id: "1", name: "Bo Adams", shifts: { "2026-11-23": "7:00 AM – 3:30 PM" } },
    {
      id: "2",
      name: "Maya Castellano",
      shifts: { "2026-11-23": "5:00 PM – 1:30 AM", "2026-11-26": "5:00 PM – 1:30 AM" },
    },
  ];

  function grid(props: Partial<React.ComponentProps<typeof WeekGrid<Roster>>> = {}) {
    return render(
      <WeekGrid
        caption="Schedule for Calloway Tower, Nov 23 – 29, 2026"
        days={days}
        today="2026-11-26"
        rowHeading="Employee"
        rows={rows}
        rowKey={(row) => row.id}
        rowHeader={(row) => row.name}
        cell={(row, day) => row.shifts[day]}
        {...props}
      />,
    );
  }

  it("is a labelled table with a column for each day and a row for each person", () => {
    grid();

    const table = screen.getByRole("table", {
      name: "Schedule for Calloway Tower, Nov 23 – 29, 2026",
    });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(8); // the people, then 7 days
    expect(within(table).getAllByRole("row")).toHaveLength(3); // the days, then 2 people
    expect(within(table).getByRole("columnheader", { name: "Employee" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Maya Castellano" })).toBeInTheDocument();
  });

  it("names each day in full for screen readers, and shows it short", () => {
    grid();

    const monday = screen.getByRole("columnheader", { name: "Monday, November 23" });
    expect(monday).toHaveTextContent("Mon");
    expect(monday).toHaveTextContent("Nov 23");
    expect(screen.getByRole("columnheader", { name: "Sunday, November 29" })).toBeInTheDocument();
  });

  it("marks today's column, and only that one", () => {
    grid();

    const today = screen.getByRole("columnheader", { name: "Thursday, November 26, today" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(screen.getAllByRole("columnheader", { current: "date" })).toHaveLength(1);
  });

  it("marks no column when today is in another week", () => {
    grid({ today: "2026-12-03" });

    expect(screen.queryByRole("columnheader", { current: "date" })).not.toBeInTheDocument();
  });

  it("puts what each person has on a day under that day, and leaves the other days empty", () => {
    grid();

    const maya = screen.getByRole("row", { name: /Maya Castellano/ });
    const cells = within(maya).getAllByRole("cell");
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveTextContent("5:00 PM – 1:30 AM"); // Monday
    expect(cells[1]).toBeEmptyDOMElement(); // Tuesday
    expect(cells[3]).toHaveTextContent("5:00 PM – 1:30 AM"); // Thursday
  });

  it("shows placeholder rows while the week loads, and says it is busy", () => {
    grid({ rows: undefined, isLoading: true, skeletonRows: 3 });

    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("aria-busy", "true");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByText("Maya Castellano")).not.toBeInTheDocument();
  });

  it("is not busy once the week has arrived", () => {
    grid();

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false");
  });
});

describe("DetailList", () => {
  it("is a list of facts, each under its name", () => {
    render(
      <DetailList>
        <Detail term="Building">Calloway Tower</Detail>
        <Detail term="Due">Nov 28, 2026</Detail>
        <Detail term="Description" wide>
          Second report this month.
        </Detail>
      </DetailList>,
    );

    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual([
      "Building",
      "Due",
      "Description",
    ]);
    expect(screen.getAllByRole("definition").map((value) => value.textContent)).toEqual([
      "Calloway Tower",
      "Nov 28, 2026",
      "Second report this month.",
    ]);
    // A long value can take the whole row.
    expect(screen.getByText("Description").parentElement).toHaveClass("col-span-2");
    expect(screen.getByText("Building").parentElement).not.toHaveClass("col-span-2");
  });
});

describe("Button", () => {
  it("does not submit a form unless asked to", () => {
    render(<Button>Cancel</Button>);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
  });

  it("blocks clicks while an action is in flight", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("can style a link as a button without nesting interactive elements", () => {
    render(
      <Button asChild variant="primary">
        <a href="/settings/members">Members</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Members" });
    expect(link).toHaveAttribute("href", "/settings/members");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("SearchInput", () => {
  afterEach(() => vi.useRealTimers());

  it("applies what was typed once, after a pause", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<SearchInput label="Search members" value={undefined} onChange={onChange} />);
    const input = screen.getByRole("searchbox", { name: "Search members" });

    fireEvent.change(input, { target: { value: "da" } });
    fireEvent.change(input, { target: { value: "  dana " } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("dana");
  });

  it("follows the applied value when it changes elsewhere", () => {
    const { rerender } = render(
      <SearchInput label="Search" value="dana" onChange={() => undefined} />,
    );
    const input = screen.getByRole<HTMLInputElement>("searchbox");
    expect(input.value).toBe("dana");

    rerender(<SearchInput label="Search" value={undefined} onChange={() => undefined} />);

    expect(input.value).toBe("");
  });
});

describe("DropdownMenu", () => {
  it("renders an item as a link without breaking the menu", async () => {
    const { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } =
      await import("./dropdown-menu");
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <a href="/settings/account">Account</a>
          </DropdownMenuItem>
          <DropdownMenuItem selected>Meridian</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const link = screen.getByRole("menuitem", { name: "Account" });
    expect(link).toHaveAttribute("href", "/settings/account");
    expect(screen.getByRole("menuitem", { name: "Meridian" })).toBeInTheDocument();
  });

  it("puts a row's actions behind a button named for the row", async () => {
    const { DropdownMenuItem, RowActions } = await import("./dropdown-menu");
    const onEdit = vi.fn();
    render(
      <RowActions label="Actions for Calloway Tower">
        <DropdownMenuItem onSelect={onEdit}>Edit building</DropdownMenuItem>
        <DropdownMenuItem tone="danger">Archive building</DropdownMenuItem>
      </RowActions>,
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions for Calloway Tower" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    await userEvent.click(screen.getByRole("menuitem", { name: "Edit building" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // choosing closes it
  });
});

describe("BarChart", () => {
  const series: ChartSeries[] = [
    { key: "revenue", label: "Revenue", tone: "brand" },
    { key: "labor", label: "Labor", tone: "graphite", stack: "cost" },
    { key: "expenses", label: "Expenses", tone: "muted", stack: "cost" },
  ];
  const point = (
    key: string,
    label: string,
    values: [number, number, number],
    extra: Partial<ChartPoint> = {},
  ): ChartPoint => ({
    key,
    label,
    title: `${label} 2026`,
    values: { revenue: values[0], labor: values[1], expenses: values[2] },
    cells: [
      { text: `$${values[0]}` },
      { text: `$${values[1]}` },
      { text: `$${values[2]}` },
      {
        text: `$${values[0] - values[1] - values[2]}`,
        critical: values[0] < values[1] + values[2],
      },
    ],
    ...extra,
  });
  const points = [
    point("sep", "Sep", [300, 150, 50]),
    point("oct", "Oct", [100, 150, 50]),
    point("nov", "Nov", [200, 60, 20], {
      partial: true,
      detail: "to date",
      title: "Nov 2026, to date",
    }),
  ];

  function chart(props: Partial<React.ComponentProps<typeof BarChart>> = {}) {
    return render(
      <BarChart
        label="Revenue and cost by month"
        series={series}
        points={points}
        headings={["Month", "Revenue", "Labor", "Expenses", "Margin"]}
        formatTick={(value) => `$${value}`}
        {...props}
      />,
    );
  }
  const plot = () => screen.getByRole("img");
  const column = (key: string) => plot().querySelector<HTMLElement>(`[data-point="${key}"]`)!;
  const bars = (key: string) => [...column(key).children] as HTMLElement[];

  it("says in a table everything it draws, for those who cannot see the drawing", () => {
    chart();

    const table = screen.getByRole("table", { name: "Revenue and cost by month" });
    expect(
      within(table)
        .getAllByRole("row")
        .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent)),
    ).toEqual([
      ["Month", "Revenue", "Labor", "Expenses", "Margin"],
      ["Sep 2026", "$300", "$150", "$50", "$100"],
      ["Oct 2026", "$100", "$150", "$50", "$-100"],
      ["Nov 2026, to date", "$200", "$60", "$20", "$120"],
    ]);
    // Hidden from the eye by what it is wrapped in: a table itself cannot be clipped to
    // nothing, and would be as wide as its figures, somewhere off the screen.
    expect(table).not.toHaveClass("sr-only");
    expect(table.parentElement).toHaveClass("sr-only");
    expect(plot()).toHaveAccessibleName(
      "Revenue and cost by month. The figures are in the table that follows.",
    );
  });

  it("starts its axis at zero and draws each bar in proportion to its figure", () => {
    chart();

    // The tallest bar stands for 300, so the axis is marked from 0 to 300.
    const marks = [...plot().parentElement!.firstElementChild!.children];
    expect(marks.map((mark) => mark.textContent)).toEqual(["$0", "$100", "$200", "$300"]);
    expect((marks[0] as HTMLElement).style.bottom).toBe("0%");
    expect((marks[3] as HTMLElement).style.bottom).toBe("100%");

    // September: revenue of 300 fills the plot, and costs of 200 reach two thirds of it.
    const [revenue, cost] = bars("sep");
    expect(revenue!.style.height).toBe("100%");
    expect(Number.parseFloat(cost!.style.height)).toBeCloseTo(66.67, 1);
    expect(Number.parseFloat(bars("oct")[0]!.style.height)).toBeCloseTo(33.33, 1);
  });

  it("stacks the series that share a stack, the first at the bottom, in their own tones", () => {
    chart();

    const [revenue, cost] = bars("sep");
    expect([...revenue!.children].map((part) => part.getAttribute("data-series"))).toEqual([
      "revenue",
    ]);
    const [labor, expenses] = [...cost!.children] as HTMLElement[];
    expect([labor!.dataset.series, expenses!.dataset.series]).toEqual(["labor", "expenses"]);
    // Drawn bottom first, each as tall as its share of the stack.
    expect(cost).toHaveClass("flex-col-reverse");
    expect([labor!.style.flexGrow, expenses!.style.flexGrow]).toEqual(["150", "50"]);
    expect(revenue!.firstElementChild).toHaveClass("bg-brand-600");
    expect(labor).toHaveClass("bg-ink-muted");
    expect(expenses).toHaveClass("bg-line-strong");
  });

  it("hatches a point that is not final, and says what it is under its column", () => {
    chart();

    for (const part of column("nov").querySelectorAll("[data-series]")) {
      expect(part).toHaveClass("hatched");
    }
    for (const part of column("oct").querySelectorAll("[data-series]")) {
      expect(part).not.toHaveClass("hatched");
    }
    expect(screen.getByText("to date")).toBeInTheDocument();
  });

  it("can spare every other label under narrow columns, but never the last one", () => {
    const labels = ["Jul", "Aug", "Sep", "Oct", "Nov"];
    chart({ points: labels.map((label) => point(label, label, [100, 50, 10])) });

    // Jsdom lays nothing out. What leaves a label out is a class that takes effect in a
    // column narrower than a label, and each column is a container, so knows its width.
    const spared = (label: string) =>
      screen.getByText(label).classList.contains("@max-[25px]:invisible");
    expect(labels.map(spared)).toEqual([false, true, false, true, false]);
    for (const label of labels) {
      expect(screen.getByText(label).parentElement).toHaveClass("@container");
    }
  });

  it("marks an axis of counts in whole numbers", () => {
    chart({
      series: [{ key: "revenue", label: "Opened", tone: "graphite" }],
      points: [point("sep", "Sep", [3, 0, 0])],
      headings: ["Month", "Opened"],
      formatTick: String,
      whole: true,
    });

    const marks = [...plot().parentElement!.firstElementChild!.children];
    expect(marks.map((mark) => mark.textContent)).toEqual(["0", "1", "2", "3"]);
  });

  it("shows a column's figures while it is pointed at", async () => {
    chart();
    expect(within(plot()).queryByText("Oct 2026")).not.toBeInTheDocument();

    await userEvent.hover(column("oct"));

    const figures = within(plot()).getByText("Oct 2026").parentElement!;
    expect(figures).toHaveAttribute("aria-hidden", "true"); // the table says it to a screen reader
    expect(
      [...figures.querySelectorAll("dl > div")].map((row) => [
        row.querySelector("dt")!.textContent,
        row.querySelector("dd")!.textContent,
      ]),
    ).toEqual([
      ["Revenue", "$100"],
      ["Labor", "$150"],
      ["Expenses", "$50"],
      ["Margin", "$-100"],
    ]);
    // A loss is in the critical colour. What follows from the bars is set under a rule.
    expect(within(figures).getByText("$-100")).toHaveClass("text-critical");
    expect(within(figures).getByText("$100")).not.toHaveClass("text-critical");
    expect(within(figures).getByText("Margin").parentElement).toHaveClass("border-t");
    expect(within(figures).getByText("Expenses").parentElement).not.toHaveClass("border-t");

    await userEvent.hover(column("sep"));
    expect(within(plot()).getByText("Sep 2026")).toBeInTheDocument();
    expect(within(plot()).queryByText("Oct 2026")).not.toBeInTheDocument();

    await userEvent.unhover(plot());
    expect(within(plot()).queryByText("Sep 2026")).not.toBeInTheDocument();
  });

  it("can be stepped through with the arrow keys, starting from the latest point", async () => {
    chart();

    await userEvent.tab();
    expect(plot()).toHaveFocus();
    expect(within(plot()).getByText("Nov 2026, to date")).toBeInTheDocument();

    await userEvent.keyboard("{ArrowLeft}");
    expect(within(plot()).getByText("Oct 2026")).toBeInTheDocument();
    await userEvent.keyboard("{Home}");
    expect(within(plot()).getByText("Sep 2026")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}"); // already at the first: stays there
    expect(within(plot()).getByText("Sep 2026")).toBeInTheDocument();
    await userEvent.keyboard("{End}{ArrowRight}");
    expect(within(plot()).getByText("Nov 2026, to date")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(within(plot()).queryByText("Nov 2026, to date")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(plot()).getByText("Sep 2026")).toBeInTheDocument();
    await userEvent.tab();
    expect(within(plot()).queryByText("Sep 2026")).not.toBeInTheDocument();
  });

  it("names its colours in a legend, and what hatching means", () => {
    render(<ChartLegend series={series} partial="Month to date" />);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Revenue",
      "Labor",
      "Expenses",
      "Month to date",
    ]);
    expect(screen.getByText("Month to date").firstElementChild).toHaveClass("hatched");
    expect(screen.getByText("Revenue").firstElementChild).toHaveClass("bg-brand-600");
  });
});

describe("bars in a row", () => {
  it("fill a share of their room, and never more than all of it", () => {
    const { container } = render(
      <>
        <ShareBar percent={83.2} />
        <ShareBar percent={140} tone="muted" />
        <ShareBar percent={-5} />
      </>,
    );
    const bars = [...container.querySelectorAll<HTMLElement>("span > span")];

    expect(bars.map((bar) => bar.style.width)).toEqual(["83.2%", "100%", "0%"]);
    expect(bars[0]).toHaveClass("bg-ink-muted");
    expect(bars[1]).toHaveClass("bg-line-strong");
    // Decoration: the figure beside it is what is read out.
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("grow from the middle: right in pine for a gain, left in the critical colour for a loss", () => {
    const { container } = render(
      <>
        <BalanceBar percent={38.9} />
        <BalanceBar percent={-21.5} />
        <BalanceBar percent={-128.6} />
        <BalanceBar percent={0} />
      </>,
    );
    // The second span of each is the bar. The first is the line down the middle.
    const bars = [...container.querySelectorAll<HTMLElement>("span > span:last-child")];

    // Half the room is each side's, so a full bar is 50% wide.
    expect(bars.map((bar) => bar.style.width)).toEqual(["19.45%", "10.75%", "50%", "0%"]);
    expect(bars[0]).toHaveClass("left-1/2", "bg-brand-600");
    expect(bars[1]).toHaveClass("right-1/2", "bg-critical");
    expect(bars[2]).toHaveClass("right-1/2", "bg-critical");
  });
});
