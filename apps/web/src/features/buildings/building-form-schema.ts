import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type { Building, BuildingStatus, BuildingType } from "@/lib/api/types";
import {
  addressBody,
  addressDefaults,
  addressFields,
  blankToNull,
  optionalText,
  optionalWholeNumber,
  requiredText,
  toInteger,
} from "@/lib/form-fields";

export const BUILDING_STATUSES = ["onboarding", "active", "inactive"] as const;

export const BUILDING_STATUS_LABELS: Record<BuildingStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
};

export const BUILDING_STATUS_TONES: Record<BuildingStatus, BadgeTone> = {
  onboarding: "info",
  active: "positive",
  inactive: "neutral",
};

export const BUILDING_TYPES = [
  "office",
  "retail",
  "industrial",
  "medical",
  "education",
  "residential",
  "mixed_use",
  "other",
] as const;

export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  office: "Office",
  retail: "Retail",
  industrial: "Industrial",
  medical: "Medical",
  education: "Education",
  residential: "Residential",
  mixed_use: "Mixed use",
  other: "Other",
};

export const buildingSchema = z.object({
  customer_id: z.string().min(1, "Choose the customer this building belongs to."),
  name: requiredText(200, "Enter the building's name."),
  code: optionalText(20),
  building_type: z.enum(BUILDING_TYPES),
  status: z.enum(BUILDING_STATUSES),
  ...addressFields,
  // Unlike a customer or a vendor, a building has to say where it is.
  address_line1: requiredText(200, "Enter the street address."),
  city: requiredText(100, "Enter the city."),
  square_feet: optionalWholeNumber,
  floors: optionalWholeNumber,
  notes: optionalText(5000),
});

export type BuildingValues = z.infer<typeof buildingSchema>;

export const BUILDING_FIELDS = buildingSchema.keyof().options;

/**
 * The form as it opens: filled in from the building being edited, or blank for a new one.
 * `customerId` preselects a customer for a new building, when the list it was opened from
 * is showing only that customer's.
 */
export function buildingDefaults(building: Building | null, customerId = ""): BuildingValues {
  return {
    customer_id: building?.customer.id ?? customerId,
    name: building?.name ?? "",
    code: building?.code ?? "",
    building_type: building?.building_type ?? "office",
    status: building?.status ?? "active",
    ...addressDefaults(building),
    square_feet: building?.square_feet?.toString() ?? "",
    floors: building?.floors?.toString() ?? "",
    notes: building?.notes ?? "",
  };
}

/** What is sent to the API, for a new building and for a change to one alike. */
export function buildingBody(values: BuildingValues): components["schemas"]["BuildingCreate"] {
  return {
    customer_id: values.customer_id,
    name: values.name,
    code: blankToNull(values.code),
    building_type: values.building_type,
    status: values.status,
    ...addressBody(values),
    address_line1: values.address_line1,
    city: values.city,
    square_feet: toInteger(values.square_feet),
    floors: toInteger(values.floors),
    notes: blankToNull(values.notes),
  };
}
