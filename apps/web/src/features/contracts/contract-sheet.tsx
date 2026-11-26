"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { FormSection } from "@/components/ui/form-section";
import { Input, Select, Textarea, UnitInput } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetLoading,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/states";
import { useCustomerOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Contract, ContractDetail, Customer } from "@/lib/api/types";
import { applyProblem, recordOptions } from "@/lib/forms";
import { COMMON_CURRENCIES } from "@/lib/regional";

import {
  BILLING_MODEL_LABELS,
  BILLING_MODELS,
  CONTRACT_FIELDS,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUSES,
  contractBody,
  contractDefaults,
  contractSchema,
  type ContractValues,
} from "./contract-form-schema";
import { CoveredBuildings } from "./covered-buildings";

type Props = {
  /** The contract to edit, "new" for a blank form, or null while closed. */
  target: Contract | "new" | null;
  /** The customer a new contract starts with: the one the list is filtered to, if any. */
  defaultCustomerId?: string;
  onClose: () => void;
};

export function ContractSheet({ target, defaultCustomerId, onClose }: Props) {
  const contract = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={contract ? contract.name : "New contract"}
          description={
            contract
              ? `Contract ${contract.contract_number} · ${contract.customer.name}`
              : "An agreement with a customer: how you bill them and which buildings it covers."
          }
        >
          <ContractSheetBody
            contract={contract}
            defaultCustomerId={defaultCustomerId}
            onDone={onClose}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

type BodyProps = { contract: Contract | null; defaultCustomerId?: string; onDone: () => void };

/**
 * The form needs the customers to choose from and, for an existing contract, the buildings
 * it covers, which the list does not carry. It waits for both.
 */
function ContractSheetBody({ contract, defaultCustomerId, onDone }: BodyProps) {
  const customers = useCustomerOptions();
  const detail = $api.useQuery(
    "get",
    "/api/v1/contracts/{contract_id}",
    { params: { path: { contract_id: contract?.id ?? "" } } },
    // Read afresh each time the drawer opens, then left alone: a form's starting values
    // must not change underneath the person filling it in.
    { enabled: contract !== null, staleTime: Infinity, gcTime: 0 },
  );

  // Once the form is up it stays: a later refresh that fails must not take it away.
  if (!customers.data || (contract && !detail.data)) {
    const error = customers.error ?? detail.error;
    if (!error) return <SheetLoading />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(error)}
          onRetry={() => {
            void customers.refetch();
            if (contract) void detail.refetch();
          }}
        />
      </SheetBody>
    );
  }

  return (
    <ContractForm
      contract={contract ? (detail.data ?? null) : null}
      customers={customers.data.items}
      defaultCustomerId={defaultCustomerId}
      onDone={onDone}
    />
  );
}

type FormProps = {
  contract: ContractDetail | null;
  customers: Customer[];
  defaultCustomerId?: string;
  onDone: () => void;
};

function ContractForm({ contract, customers, defaultCustomerId, onDone }: FormProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<ContractValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: contractDefaults(contract, {
      currency: me.organization?.currency ?? "USD",
      customerId: defaultCustomerId,
    }),
  });
  const customerId = useWatch({ control, name: "customer_id" });
  const billingModel = useWatch({ control, name: "billing_model" });
  const currency = useWatch({ control, name: "currency" });

  const customerOptions = recordOptions(customers, contract?.customer);
  // The currency the form opened with stays on offer even if it is not one of the common ones.
  const openedWith = contract?.currency ?? me.organization?.currency ?? "USD";
  const currencies = COMMON_CURRENCIES.includes(openedWith)
    ? COMMON_CURRENCIES
    : [openedWith, ...COMMON_CURRENCIES];

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, CONTRACT_FIELDS));

  const create = $api.useMutation("post", "/api/v1/contracts", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/contracts");
      toast.success(`${created.name} was added`, {
        description: `Contract ${created.contract_number} with ${created.customer.name}`,
      });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/contracts/{contract_id}", {
    onSuccess: async (updated) => {
      await invalidate(queryClient, "/api/v1/contracts");
      toast.success(`${updated.name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: ContractValues) {
    setFormError(null);
    const body = contractBody(values);
    if (contract) {
      update.mutate({ params: { path: { contract_id: contract.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  const customerField = register("customer_id");

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <FormError message={formError} />
        <div className="space-y-6">
          <FormSection title="Contract">
            <Field
              id="contract-customer"
              label="Customer"
              hint={
                customerOptions.length === 0
                  ? "There are no customers yet. Add the customer first."
                  : undefined
              }
              error={errors.customer_id?.message}
            >
              {(control) => (
                <Select
                  {...control}
                  {...customerField}
                  onChange={(event) => {
                    void customerField.onChange(event);
                    // The buildings belong to the customer, so the choice starts again.
                    setValue("building_ids", [], { shouldDirty: true });
                    // A new contract takes the customer's payment terms unless others were typed.
                    const customer = customers.find((item) => item.id === event.target.value);
                    if (!contract && customer && !dirtyFields.payment_terms_days) {
                      setValue("payment_terms_days", String(customer.payment_terms_days));
                    }
                  }}
                >
                  <option value="">Choose a customer</option>
                  {customerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id="contract-name"
              label="Name"
              hint="What the agreement is for, such as Janitorial Services Agreement."
              error={errors.name?.message}
            >
              {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="contract-number"
                label="Contract number"
                optional={!contract}
                hint={contract ? undefined : "Leave blank to generate the next one."}
                error={errors.contract_number?.message}
              >
                {(control) => (
                  <Input
                    {...control}
                    className="font-mono text-[13px] uppercase"
                    autoComplete="off"
                    {...register("contract_number")}
                  />
                )}
              </Field>
              <Field id="contract-status" label="Status" error={errors.status?.message}>
                {(control) => (
                  <Select {...control} {...register("status")}>
                    {CONTRACT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {CONTRACT_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Billing">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="contract-billing-model"
                label="Billing model"
                hint={
                  billingModel === "time_and_materials"
                    ? "Labor and materials are billed as the work is done, with no fixed figure."
                    : undefined
                }
                error={errors.billing_model?.message}
              >
                {(control) => (
                  <Select {...control} {...register("billing_model")}>
                    {BILLING_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {BILLING_MODEL_LABELS[model]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {billingModel === "cost_plus" ? (
                <Field
                  id="contract-markup"
                  label="Markup"
                  hint="Added to the cost of the work."
                  error={errors.markup_percent?.message}
                >
                  {(control) => (
                    <UnitInput
                      {...control}
                      unit="%"
                      inputMode="decimal"
                      autoComplete="off"
                      {...register("markup_percent")}
                    />
                  )}
                </Field>
              ) : billingModel === "fixed_fee" ? (
                <Field
                  id="contract-monthly-fee"
                  label="Monthly fee"
                  hint="Billed each month, whatever the work costs."
                  error={errors.monthly_fee?.message}
                >
                  {(control) => (
                    <UnitInput
                      {...control}
                      unit={currency}
                      inputMode="decimal"
                      autoComplete="off"
                      {...register("monthly_fee")}
                    />
                  )}
                </Field>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="contract-payment-terms"
                label="Payment terms"
                hint="Days from invoice to payment due."
                error={errors.payment_terms_days?.message}
              >
                {(control) => (
                  <UnitInput
                    {...control}
                    unit="days"
                    inputMode="numeric"
                    autoComplete="off"
                    {...register("payment_terms_days")}
                  />
                )}
              </Field>
              <Field id="contract-currency" label="Currency" error={errors.currency?.message}>
                {(control) => (
                  <Select {...control} {...register("currency")}>
                    {currencies.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Term">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="contract-start-date" label="Starts" error={errors.start_date?.message}>
                {(control) => <Input {...control} type="date" {...register("start_date")} />}
              </Field>
              <Field
                id="contract-end-date"
                label="Ends"
                optional
                hint="Leave blank for an open-ended contract."
                error={errors.end_date?.message}
              >
                {(control) => <Input {...control} type="date" {...register("end_date")} />}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Buildings covered">
            <CoveredBuildings
              control={control}
              setValue={setValue}
              customerId={customerId}
              contract={contract}
              error={errors.building_ids?.message}
            />
          </FormSection>

          <FormSection title="Notes">
            <Field
              id="contract-notes"
              label="Notes"
              labelHidden
              hint="Scope, exclusions, renewal terms: what the team should know about this contract."
              error={errors.notes?.message}
            >
              {(control) => <Textarea {...control} rows={3} {...register("notes")} />}
            </Field>
          </FormSection>
        </div>
      </SheetBody>
      <SheetFooter>
        <SheetClose asChild>
          <Button variant="ghost">Cancel</Button>
        </SheetClose>
        <Button
          type="submit"
          variant="primary"
          disabled={contract !== null && !isDirty}
          loading={create.isPending || update.isPending}
        >
          {contract ? "Save changes" : "Create contract"}
        </Button>
      </SheetFooter>
    </form>
  );
}
