import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Blank, NameCell, StackedCell } from "./cells";
import { Checkbox } from "./checkbox";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type Column } from "./data-table";
import { Field } from "./field";
import { FilterSelect } from "./filter-select";
import { FormSection } from "./form-section";
import { Input, UnitInput } from "./input";
import { Pagination } from "./pagination";
import { SearchInput } from "./search-input";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetLoading } from "./sheet";

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
