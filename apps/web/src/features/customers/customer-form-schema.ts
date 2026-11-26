import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type { Customer, CustomerStatus } from "@/lib/api/types";
import {
  addressBody,
  addressDefaults,
  addressFields,
  blankToNull,
  contactBody,
  contactDefaults,
  contactFields,
  optionalText,
  requiredText,
  wholeNumber,
} from "@/lib/form-fields";

export const CUSTOMER_STATUSES = ["prospect", "active", "inactive"] as const;

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
};

export const CUSTOMER_STATUS_TONES: Record<CustomerStatus, BadgeTone> = {
  prospect: "info",
  active: "positive",
  inactive: "neutral",
};

export const customerSchema = z.object({
  name: requiredText(200, "Enter the customer's name."),
  code: optionalText(20),
  status: z.enum(CUSTOMER_STATUSES),
  ...contactFields,
  ...addressFields,
  payment_terms_days: wholeNumber("Enter the number of days."),
  notes: optionalText(5000),
});

export type CustomerValues = z.infer<typeof customerSchema>;

export const CUSTOMER_FIELDS = customerSchema.keyof().options;

/** The form as it opens: blank for a new customer, or filled in from the one being edited. */
export function customerDefaults(customer: Customer | null): CustomerValues {
  return {
    name: customer?.name ?? "",
    code: customer?.code ?? "",
    status: customer?.status ?? "active",
    ...contactDefaults(customer),
    ...addressDefaults(customer),
    payment_terms_days: String(customer?.payment_terms_days ?? 30),
    notes: customer?.notes ?? "",
  };
}

/** What is sent to the API, for a new customer and for a change to one alike. */
export function customerBody(values: CustomerValues): components["schemas"]["CustomerCreate"] {
  return {
    name: values.name,
    code: blankToNull(values.code),
    status: values.status,
    ...contactBody(values),
    ...addressBody(values),
    payment_terms_days: Number(values.payment_terms_days),
    notes: blankToNull(values.notes),
  };
}
