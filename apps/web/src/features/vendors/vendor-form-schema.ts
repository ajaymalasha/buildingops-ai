import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type { Vendor, VendorCategory, VendorStatus } from "@/lib/api/types";
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

export const VENDOR_STATUSES = ["pending_compliance", "active", "inactive"] as const;

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  pending_compliance: "Pending compliance",
  active: "Active",
  inactive: "Inactive",
};

export const VENDOR_STATUS_TONES: Record<VendorStatus, BadgeTone> = {
  pending_compliance: "caution",
  active: "positive",
  inactive: "neutral",
};

export const VENDOR_CATEGORIES = [
  "janitorial",
  "hvac",
  "electrical",
  "plumbing",
  "landscaping",
  "security",
  "elevator",
  "pest_control",
  "waste",
  "supplies",
  "other",
] as const;

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  janitorial: "Janitorial",
  hvac: "HVAC",
  electrical: "Electrical",
  plumbing: "Plumbing",
  landscaping: "Landscaping",
  security: "Security",
  elevator: "Elevator",
  pest_control: "Pest control",
  waste: "Waste",
  supplies: "Supplies",
  other: "Other",
};

export const vendorSchema = z.object({
  name: requiredText(200, "Enter the vendor's name."),
  code: optionalText(20),
  category: z.enum(VENDOR_CATEGORIES),
  status: z.enum(VENDOR_STATUSES),
  ...contactFields,
  ...addressFields,
  insurance_expires_on: z.string(),
  payment_terms_days: wholeNumber("Enter the number of days."),
  notes: optionalText(5000),
});

export type VendorValues = z.infer<typeof vendorSchema>;

export const VENDOR_FIELDS = vendorSchema.keyof().options;

/** The form as it opens: blank for a new vendor, or filled in from the one being edited. */
export function vendorDefaults(vendor: Vendor | null): VendorValues {
  return {
    name: vendor?.name ?? "",
    code: vendor?.code ?? "",
    category: vendor?.category ?? "janitorial",
    status: vendor?.status ?? "active",
    ...contactDefaults(vendor),
    ...addressDefaults(vendor),
    insurance_expires_on: vendor?.insurance_expires_on ?? "",
    payment_terms_days: String(vendor?.payment_terms_days ?? 30),
    notes: vendor?.notes ?? "",
  };
}

/** What is sent to the API, for a new vendor and for a change to one alike. */
export function vendorBody(values: VendorValues): components["schemas"]["VendorCreate"] {
  return {
    name: values.name,
    code: blankToNull(values.code),
    category: values.category,
    status: values.status,
    ...contactBody(values),
    ...addressBody(values),
    insurance_expires_on: blankToNull(values.insurance_expires_on),
    payment_terms_days: Number(values.payment_terms_days),
    notes: blankToNull(values.notes),
  };
}
