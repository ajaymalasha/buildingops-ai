import { z } from "zod";

import type { BadgeTone } from "@/components/ui/badge";
import type { components } from "@/lib/api/schema";
import type { BillingModel, Contract, ContractDetail, ContractStatus } from "@/lib/api/types";
import {
  blankToNull,
  optionalAmount,
  optionalPercent,
  optionalText,
  requiredText,
  wholeNumber,
} from "@/lib/form-fields";
import { formatMoney, formatPercent } from "@/lib/format";

export const CONTRACT_STATUSES = ["draft", "active", "expired", "terminated"] as const;

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "Draft",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
};

export const CONTRACT_STATUS_TONES: Record<ContractStatus, BadgeTone> = {
  draft: "info",
  active: "positive",
  expired: "caution",
  terminated: "neutral",
};

export const BILLING_MODELS = ["cost_plus", "fixed_fee", "time_and_materials"] as const;

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  cost_plus: "Cost plus",
  fixed_fee: "Fixed fee",
  time_and_materials: "Time and materials",
};

const contractFields = z.object({
  customer_id: z.string().min(1, "Choose the customer this contract is with."),
  name: requiredText(200, "Enter a name for the contract."),
  contract_number: optionalText(30),
  status: z.enum(CONTRACT_STATUSES),
  billing_model: z.enum(BILLING_MODELS),
  markup_percent: optionalPercent,
  monthly_fee: optionalAmount,
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  payment_terms_days: wholeNumber("Enter the number of days."),
  start_date: z.string().min(1, "Choose the day the contract starts."),
  end_date: z.string(),
  building_ids: z.array(z.string()),
  notes: optionalText(5000),
});

// The billing model decides which figure the contract is billed from. The form shows that
// one field, so it is also the one that has to be filled in.
export const contractSchema = contractFields
  .refine((values) => values.billing_model !== "cost_plus" || values.markup_percent !== "", {
    path: ["markup_percent"],
    message: "Enter the markup percentage.",
  })
  .refine((values) => values.billing_model !== "fixed_fee" || values.monthly_fee !== "", {
    path: ["monthly_fee"],
    message: "Enter the monthly fee.",
  });

export type ContractValues = z.infer<typeof contractSchema>;

export const CONTRACT_FIELDS = contractFields.keyof().options;

type NewContract = {
  /** The organization's currency, which a contract uses unless another is chosen. */
  currency: string;
  /** Preselected when the list the form was opened from shows one customer's contracts. */
  customerId?: string;
};

/** The form as it opens: filled in from the contract being edited, or blank for a new one. */
export function contractDefaults(
  contract: ContractDetail | null,
  { currency, customerId = "" }: NewContract,
): ContractValues {
  return {
    customer_id: contract?.customer.id ?? customerId,
    name: contract?.name ?? "",
    contract_number: contract?.contract_number ?? "",
    status: contract?.status ?? "draft",
    billing_model: contract?.billing_model ?? "cost_plus",
    markup_percent: contract?.markup_percent ?? "",
    monthly_fee: contract?.monthly_fee ?? "",
    currency: contract?.currency ?? currency,
    payment_terms_days: String(contract?.payment_terms_days ?? 30),
    start_date: contract?.start_date ?? "",
    end_date: contract?.end_date ?? "",
    building_ids: contract?.buildings.map((building) => building.id) ?? [],
    notes: contract?.notes ?? "",
  };
}

type BillingTerms = Pick<ContractValues, "billing_model" | "markup_percent" | "monthly_fee">;

/**
 * The two billing figures as they are sent: the one the billing model uses, and null for
 * the other. A figure typed in before the model was changed is not on screen any more, so
 * it is not saved either.
 */
export function billingTerms(values: BillingTerms): {
  markup_percent: string | null;
  monthly_fee: string | null;
} {
  return {
    markup_percent:
      values.billing_model === "cost_plus" ? blankToNull(values.markup_percent) : null,
    monthly_fee: values.billing_model === "fixed_fee" ? blankToNull(values.monthly_fee) : null,
  };
}

/** What is sent to the API, for a new contract and for a change to one alike. */
export function contractBody(values: ContractValues): components["schemas"]["ContractCreate"] {
  return {
    customer_id: values.customer_id,
    name: values.name,
    contract_number: blankToNull(values.contract_number),
    status: values.status,
    billing_model: values.billing_model,
    ...billingTerms(values),
    currency: values.currency,
    payment_terms_days: Number(values.payment_terms_days),
    start_date: values.start_date,
    end_date: blankToNull(values.end_date),
    building_ids: values.building_ids,
    notes: blankToNull(values.notes),
  };
}

export type CoverageOption = {
  id: string;
  name: string;
  code: string;
  /** On the saved contract, but no longer among the customer's buildings. */
  gone: boolean;
};

/**
 * The buildings the form's checklist offers for the chosen customer.
 *
 * First the customer's own buildings, as the list endpoint returns them. Then, when the
 * saved contract is with that customer, any building it still covers that is no longer
 * among them: it was archived after it went on the contract. Those stay listed, marked,
 * so that they can be seen and taken off.
 */
export function coverageOptions(
  buildings: readonly { id: string; name: string; code: string }[],
  contract: ContractDetail | null,
  customerId: string,
): CoverageOption[] {
  const live = buildings.map(({ id, name, code }) => ({ id, name, code, gone: false }));
  const listed = new Set(live.map((building) => building.id));
  const gone =
    contract?.customer.id === customerId
      ? contract.buildings
          .filter((building) => !listed.has(building.id))
          .map(({ id, name, code }) => ({ id, name, code, gone: true }))
      : [];
  return [...live, ...gone];
}

type Billed = Pick<Contract, "billing_model" | "markup_percent" | "monthly_fee" | "currency">;

/** The figure a contract is billed from, as people say it: "12.5% markup". */
export function billingSummary(contract: Billed): string | null {
  if (contract.billing_model === "cost_plus" && contract.markup_percent) {
    return `${formatPercent(contract.markup_percent)} markup`;
  }
  if (contract.billing_model === "fixed_fee" && contract.monthly_fee) {
    return `${formatMoney(contract.monthly_fee, contract.currency)} a month`;
  }
  return null;
}
