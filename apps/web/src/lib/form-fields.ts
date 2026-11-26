/**
 * Field shapes shared by the record forms.
 *
 * These check what a browser can know: that something was entered and that it has the
 * shape of a number, an email or a country code. Whether a value is acceptable (ranges,
 * uniqueness, how fields depend on each other) is the API's decision, and its answer is put
 * on the field with `applyProblem`.
 *
 * Every field is a string while it is in a form. Amounts stay strings on their way to the
 * API too, because money is never a float.
 */

import { z } from "zod";

/** Text that must be filled in. `message` says what to enter. */
export function requiredText(max: number, message: string) {
  return z.string().trim().min(1, message).max(max, `Use at most ${max} characters.`);
}

/** Text that may be left blank. */
export function optionalText(max: number) {
  return z.string().trim().max(max, `Use at most ${max} characters.`);
}

/** Blank, or an email address. */
export const optionalEmail = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address.",
  );

/** Blank, or a whole number. */
export const optionalWholeNumber = z
  .string()
  .trim()
  .regex(/^\d{0,9}$/, "Enter a whole number.");

/** A whole number that must be filled in. `message` says what to enter. */
export function wholeNumber(message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .regex(/^\d{0,9}$/, "Enter a whole number.");
}

/** Blank, or an amount of money with at most two decimal places. */
export const optionalAmount = z
  .string()
  .trim()
  .regex(/^(\d{1,10}(\.\d{1,2})?)?$/, "Enter an amount such as 18.50.");

/** An amount of money that must be filled in. `message` says what to enter. */
export function requiredAmount(message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .regex(/^(\d{1,10}(\.\d{1,2})?)?$/, "Enter an amount such as 18.50.");
}

/** Blank, or a number of hours with at most two decimal places. */
export const optionalHours = z
  .string()
  .trim()
  .regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Enter hours such as 7.5.");

/** A number of hours that must be filled in. `message` says what to enter. */
export function requiredHours(message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Enter hours such as 7.5.");
}

/** A time of day as a time input gives it, on the 24-hour clock: 17:00. */
export function timeOfDay(message: string) {
  return z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, message);
}

/** Blank, or a percentage with at most two decimal places. */
export const optionalPercent = z
  .string()
  .trim()
  .regex(/^(\d{1,3}(\.\d{1,2})?)?$/, "Enter a percentage such as 12.5.");

export const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code such as US.");

/** What an optional field sends when it was left empty: null, which the API stores as no value. */
export function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

/** The number in a whole-number field, or null when it was left empty. */
export function toInteger(value: string): number | null {
  return value === "" ? null : Number.parseInt(value, 10);
}

// --- contact details: customers and vendors ------------------------------------------------

export const contactFields = {
  contact_name: optionalText(200),
  email: optionalEmail,
  phone: optionalText(40),
};

export type ContactValues = z.infer<z.ZodObject<typeof contactFields>>;

type Stored<Values> = { [Field in keyof Values]: string | null };

export function contactDefaults(record: Stored<ContactValues> | null): ContactValues {
  return {
    contact_name: record?.contact_name ?? "",
    email: record?.email ?? "",
    phone: record?.phone ?? "",
  };
}

export function contactBody(values: ContactValues): Stored<ContactValues> {
  return {
    contact_name: blankToNull(values.contact_name),
    email: blankToNull(values.email),
    phone: blankToNull(values.phone),
  };
}

// --- postal address: customers, vendors and buildings --------------------------------------

/** Every part optional, as for a customer or a vendor. A building requires some of them. */
export const addressFields = {
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postal_code: optionalText(20),
  country: countryCode,
};

export type AddressValues = z.infer<z.ZodObject<typeof addressFields>>;

export function addressDefaults(record: Stored<AddressValues> | null): AddressValues {
  return {
    address_line1: record?.address_line1 ?? "",
    address_line2: record?.address_line2 ?? "",
    city: record?.city ?? "",
    region: record?.region ?? "",
    postal_code: record?.postal_code ?? "",
    country: record?.country ?? "US",
  };
}

export function addressBody(values: AddressValues): Stored<AddressValues> & { country: string } {
  return {
    address_line1: blankToNull(values.address_line1),
    address_line2: blankToNull(values.address_line2),
    city: blankToNull(values.city),
    region: blankToNull(values.region),
    postal_code: blankToNull(values.postal_code),
    country: values.country.toUpperCase(),
  };
}
