import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen } from "@testing-library/react";
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

import { AddressFields } from "./address-fields";
import { ContactFields } from "./contact-fields";

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
