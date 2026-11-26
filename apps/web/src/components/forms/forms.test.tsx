import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  addressDefaults,
  addressFields,
  contactDefaults,
  contactFields,
  requiredText,
  type AddressValues,
  type ContactValues,
} from "@/lib/form-fields";

import { useContractOptions } from "@/hooks/use-options";

import { AddressFields } from "./address-fields";
import { ContactFields } from "./contact-fields";
import { ContractField } from "./contract-field";

// The contract field asks the API which contracts cover a building. Here the answer is
// given to it, so that what it does with the answer can be seen.
vi.mock("@/hooks/use-options", () => ({ useContractOptions: vi.fn() }));

type Values = AddressValues & ContactValues;

const anyAddress = z.object({ ...contactFields, ...addressFields });
// As for a building: it has to say where it is.
const fullAddress = anyAddress.extend({
  address_line1: requiredText(200, "Enter the street address."),
  city: requiredText(100, "Enter the city."),
});

type FormProps = {
  required?: boolean;
  defaults?: Partial<Values>;
  onSubmit?: (values: Values) => void;
};

/** A form like the customer's, cut down to the two shared groups of fields. */
function Form({ required = false, defaults, onSubmit = () => undefined }: FormProps) {
  const form = useForm<Values>({
    resolver: zodResolver(required ? fullAddress : anyAddress),
    defaultValues: { ...contactDefaults(null), ...addressDefaults(null), ...defaults },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => onSubmit(values))} noValidate>
        <ContactFields idPrefix="customer" />
        <AddressFields idPrefix="customer" required={required} />
        <button type="submit">Save</button>
      </form>
    </FormProvider>
  );
}

const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

describe("AddressFields", () => {
  it("labels every part, and marks all but the country optional for a customer or vendor", () => {
    render(<Form />);

    for (const label of ["Street address", "Suite, floor or unit", "City", "State or region"]) {
      expect(screen.getByLabelText(`${label} (optional)`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Postal code (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Country")).toHaveValue("US");
    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription(
      "Two-letter code, such as US.",
    );
  });

  it("does not call the street and the city optional where they are required", () => {
    render(<Form required />);

    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
    expect(screen.getByLabelText("City")).toBeInTheDocument();
    expect(screen.getByLabelText("Suite, floor or unit (optional)")).toBeInTheDocument();
  });

  it("opens with the address on record and hands back what was typed", async () => {
    const onSubmit = vi.fn();
    render(
      <Form
        defaults={{ address_line1: "410 Hollis Street", city: "New York", region: "NY" }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText(/Street address/)).toHaveValue("410 Hollis Street");

    await userEvent.type(screen.getByLabelText(/Suite, floor or unit/), "Suite 2200");
    await userEvent.type(screen.getByLabelText(/Postal code/), " 10016 ");
    await save();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        address_line1: "410 Hollis Street",
        address_line2: "Suite 2200",
        city: "New York",
        region: "NY",
        postal_code: "10016",
        country: "US",
      }),
    );
  });

  it("puts each message on the input it is about, and does not submit", async () => {
    const onSubmit = vi.fn();
    render(<Form required onSubmit={onSubmit} />);

    await userEvent.clear(screen.getByLabelText("Country"));
    await userEvent.type(screen.getByLabelText("Country"), "U1");
    await save();

    expect(screen.getByLabelText("Street address")).toHaveAccessibleDescription(
      "Enter the street address.",
    );
    expect(screen.getByLabelText("City")).toHaveAccessibleDescription("Enter the city.");
    // The message takes the hint's place.
    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription(
      "Use a two-letter country code such as US.",
    );
    expect(screen.getByLabelText("Country")).toBeInvalid();
    expect(screen.getByLabelText(/State or region/)).toBeValid();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ContractField", () => {
  const janitorial = {
    id: "contract-1",
    contract_number: "CTR-0001",
    name: "Janitorial Services Agreement",
    status: "active",
  };
  const porters = {
    id: "contract-2",
    contract_number: "CTR-0002",
    name: "Day Porter Program",
    status: "expired",
  };

  type Loaded = { items?: (typeof janitorial)[]; error?: unknown };
  type FieldProps = Partial<React.ComponentProps<typeof ContractField>> & {
    contractId?: string;
    onSubmit?: (values: { contract_id: string }) => void;
  };

  /** The API's answer to "which contracts cover this building". */
  function contracts({ items, error = null }: Loaded) {
    vi.mocked(useContractOptions).mockReturnValue({
      data: items ? { items } : undefined,
      error,
    } as unknown as ReturnType<typeof useContractOptions>);
  }

  function ContractForm({ contractId = "", onSubmit = () => undefined, ...props }: FieldProps) {
    const form = useForm<{ contract_id: string }>({ defaultValues: { contract_id: contractId } });
    return (
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit((values) => onSubmit(values))} noValidate>
          <ContractField idPrefix="work-order" buildingId="building-1" {...props} />
          <button type="submit">Save</button>
        </form>
      </FormProvider>
    );
  }

  const field = () => screen.getByLabelText("Contract (optional)");
  const offered = () =>
    within(field())
      .getAllByRole("option")
      .map((option) => option.textContent);

  it("waits for a building before it offers anything", () => {
    contracts({});
    render(<ContractForm buildingId="" />);

    expect(field()).toBeDisabled();
    expect(field()).toHaveAccessibleDescription(
      "Choose a building to see the contracts that cover it.",
    );
    expect(offered()).toEqual(["No contract"]);
    // And does not ask the API until there is a building to ask about.
    expect(useContractOptions).toHaveBeenLastCalledWith({ buildingId: undefined, enabled: false });
  });

  it("offers the contracts that cover the building, and no contract at all", () => {
    contracts({ items: [janitorial, porters] });
    render(<ContractForm />);

    expect(useContractOptions).toHaveBeenLastCalledWith({
      buildingId: "building-1",
      enabled: true,
    });
    expect(field()).toBeEnabled();
    expect(offered()).toEqual([
      "No contract",
      "CTR-0001 · Janitorial Services Agreement",
      // One that is not in force can still be chosen. It says what it is.
      "CTR-0002 · Day Porter Program (expired)",
    ]);
    expect(field()).not.toHaveAccessibleDescription();
  });

  it("hands the form the contract that was chosen", async () => {
    contracts({ items: [janitorial, porters] });
    const onSubmit = vi.fn();
    render(<ContractForm onSubmit={onSubmit} />);

    await userEvent.selectOptions(field(), "CTR-0001 · Janitorial Services Agreement");
    await save();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ contract_id: "contract-1" });
  });

  it("says so when no contract covers the building", () => {
    contracts({ items: [] });
    render(<ContractForm />);

    expect(offered()).toEqual(["No contract"]);
    expect(field()).toHaveAccessibleDescription("No contract covers this building.");
  });

  it("keeps the contract the record was saved with while its building is unchanged", () => {
    // Still loading: the saved contract is there to be shown all the same.
    contracts({});
    // A record carries its contract's number and name, not the state it is in.
    const { id, contract_number, name } = porters;
    const saved = { contract: { id, contract_number, name }, buildingId: "building-1" };
    const { rerender } = render(<ContractForm contractId="contract-2" saved={saved} />);
    expect(field()).toHaveValue("contract-2");
    expect(offered()).toEqual(["No contract", "CTR-0002 · Day Porter Program"]);

    // Once the list arrives, it is in it once, not twice.
    contracts({ items: [janitorial, porters] });
    rerender(<ContractForm contractId="contract-2" saved={saved} />);
    expect(offered()).toHaveLength(3);

    // Another building: only what covers that building is offered.
    contracts({ items: [janitorial] });
    rerender(<ContractForm contractId="contract-2" saved={saved} buildingId="building-2" />);
    expect(offered()).toEqual(["No contract", "CTR-0001 · Janitorial Services Agreement"]);
  });

  it("offers every contract while no building is chosen, where a record need not have one", () => {
    contracts({ items: [janitorial, porters] });
    render(<ContractForm buildingId="" withoutBuilding />);

    expect(useContractOptions).toHaveBeenLastCalledWith({ buildingId: undefined, enabled: true });
    expect(field()).toBeEnabled();
    expect(offered()).toHaveLength(3);
  });

  it("says why when the contracts could not be loaded", () => {
    contracts({
      error: {
        type: "about:blank",
        title: "The service is temporarily unavailable",
        status: 503,
        code: "unavailable",
      },
    });
    render(<ContractForm />);

    expect(field()).toHaveAccessibleDescription("The service is temporarily unavailable");
  });
});

describe("ContactFields", () => {
  it("offers a name, an email and a phone number, all optional", async () => {
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Contact name (optional)"), "Renee Aldous");
    await userEvent.type(screen.getByLabelText("Phone (optional)"), "(201) 555-0142");
    await save();

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ contact_name: "Renee Aldous", email: "", phone: "(201) 555-0142" }),
    );
  });

  it("asks for an email address that looks like one", async () => {
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Email (optional)"), "renee@");
    await save();

    expect(screen.getByLabelText("Email (optional)")).toHaveAccessibleDescription(
      "Enter a valid email address.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
