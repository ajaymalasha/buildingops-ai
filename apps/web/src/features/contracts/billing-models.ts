import type { BillingModel } from "@/lib/api/types";

// How a contract can be billed, and what each way is called. They are kept apart from the
// form's schema so that a page which only names a billing model, as the dashboard does,
// does not load the form's validation along with the name.

export const BILLING_MODELS = ["cost_plus", "fixed_fee", "time_and_materials"] as const;

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  cost_plus: "Cost plus",
  fixed_fee: "Fixed fee",
  time_and_materials: "Time and materials",
};
