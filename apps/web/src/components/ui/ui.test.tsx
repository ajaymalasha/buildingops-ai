import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { DataTable, type Column } from "./data-table";
import { Field } from "./field";
import { Input } from "./input";
import { Pagination } from "./pagination";
import { SearchInput } from "./search-input";

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
});
