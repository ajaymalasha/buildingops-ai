"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { ContractField } from "@/components/forms/contract-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { FormSection } from "@/components/ui/form-section";
import { Input, Select, UnitInput } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetLoading,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/states";
import { useBuildingOptions, useVendorOptions, useWorkOrderOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Building, Expense, Vendor } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { applyProblem, recordOptions } from "@/lib/forms";
import { formatMoney } from "@/lib/format";

import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_FIELDS,
  expenseBody,
  expenseDefaults,
  expenseSchema,
  type ExpenseValues,
} from "./expense-form-schema";

type Props = {
  /** The pending expense to edit, "new" for a blank form, or null while closed. */
  target: Expense | "new" | null;
  onClose: () => void;
};

export function ExpenseSheet({ target, onClose }: Props) {
  const expense = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={expense ? expense.description : "New expense"}
          description={
            expense
              ? `${formatMoney(expense.amount, expense.currency)} · ${EXPENSE_CATEGORY_LABELS[expense.category]}`
              : "Something bought or paid for. It waits for approval before it counts as a cost."
          }
        >
          <ExpenseSheetBody expense={expense} onDone={onClose} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

type BodyProps = { expense: Expense | null; onDone: () => void };

/**
 * The form needs the buildings and the vendors to choose from, so it waits for them. Once
 * it has them it stays: a later refresh that fails must not take the form away.
 */
function ExpenseSheetBody(props: BodyProps) {
  const canSeeVendors = useCan("vendors:read");
  const buildings = useBuildingOptions();
  const vendors = useVendorOptions({ enabled: canSeeVendors });
  if (!buildings.data || (canSeeVendors && !vendors.data)) {
    const error = buildings.error ?? vendors.error;
    if (!error) return <SheetLoading />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(error)}
          onRetry={() => {
            void buildings.refetch();
            if (canSeeVendors) void vendors.refetch();
          }}
        />
      </SheetBody>
    );
  }
  return (
    <ExpenseForm
      buildings={buildings.data.items}
      vendors={canSeeVendors ? (vendors.data?.items ?? []) : null}
      {...props}
    />
  );
}

type FormProps = BodyProps & {
  buildings: Building[];
  /** Null for someone who may not read vendors: the vendor is then left as it is. */
  vendors: Vendor[] | null;
};

function ExpenseForm({ expense, buildings, vendors, onDone }: FormProps) {
  const me = useMe();
  const canSeeContracts = useCan("contracts:read");
  const canSeeWorkOrders = useCan("work_orders:read");
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expenseDefaults(expense, {
      today: todayInZone(me.organization?.timezone ?? "UTC"),
    }),
  });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isDirty },
  } = form;
  const buildingId = useWatch({ control, name: "building_id" });

  // An expense can be for one of the jobs done at its building.
  const workOrders = useWorkOrderOptions({
    buildingId,
    enabled: canSeeWorkOrders && buildingId !== "",
  });

  const currency = expense?.currency ?? me.organization?.currency ?? "USD";
  const buildingOptions = recordOptions(buildings, expense?.building);
  const vendorOptions = vendors ? recordOptions(vendors, expense?.vendor) : [];
  const labelled = (workOrder: { id: string; number: string; title: string }) => ({
    id: workOrder.id,
    name: `${workOrder.number} · ${workOrder.title}`,
  });
  const workOrderOptions = recordOptions(
    buildingId === "" ? [] : (workOrders.data?.items ?? []).map(labelled),
    // The one it is already for stays on offer while the building is the one it was saved with.
    expense?.work_order && (expense.building?.id ?? "") === buildingId
      ? labelled(expense.work_order)
      : null,
  );

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, EXPENSE_FIELDS));

  const create = $api.useMutation("post", "/api/v1/expenses", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/expenses");
      toast.success(`${created.description} was entered`, {
        description: `${formatMoney(created.amount, created.currency)}. It is waiting for approval.`,
      });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/expenses/{expense_id}", {
    onSuccess: async (updated) => {
      await invalidate(queryClient, "/api/v1/expenses");
      toast.success(`${updated.description} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: ExpenseValues) {
    setFormError(null);
    const body = expenseBody(values, {
      offered: {
        contract: canSeeContracts,
        vendor: vendors !== null,
        workOrder: canSeeWorkOrders,
      },
    });
    if (expense) {
      update.mutate({ params: { path: { expense_id: expense.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  const buildingField = register("building_id");

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <FormError message={formError} />
          <div className="space-y-6">
            <FormSection title="Expense">
              <Field
                id="expense-description"
                label="Description"
                hint="What was bought or paid for, such as Floor finish and stripper."
                error={errors.description?.message}
              >
                {(control) => (
                  <Input {...control} autoComplete="off" {...register("description")} />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="expense-category" label="Category" error={errors.category?.message}>
                  {(control) => (
                    <Select {...control} {...register("category")}>
                      {EXPENSE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {EXPENSE_CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="expense-amount" label="Amount" error={errors.amount?.message}>
                  {(control) => (
                    <UnitInput
                      {...control}
                      unit={currency}
                      inputMode="decimal"
                      autoComplete="off"
                      {...register("amount")}
                    />
                  )}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="expense-incurred-on"
                  label="Incurred on"
                  error={errors.incurred_on?.message}
                >
                  {(control) => <Input {...control} type="date" {...register("incurred_on")} />}
                </Field>
                <Field
                  id="expense-reference"
                  label="Reference"
                  optional
                  hint="A receipt or vendor invoice number."
                  error={errors.reference?.message}
                >
                  {(control) => (
                    <Input
                      {...control}
                      className="font-mono text-[13px]"
                      autoComplete="off"
                      {...register("reference")}
                    />
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="What it was for"
              description="All optional. An expense booked to a contract can be billed under it."
            >
              <Field
                id="expense-building"
                label="Building"
                optional
                error={errors.building_id?.message}
              >
                {(control) => (
                  <Select
                    {...control}
                    {...buildingField}
                    onChange={(event) => {
                      void buildingField.onChange(event);
                      // A contract covers particular buildings and a work order is at one,
                      // so both choices start again.
                      if (canSeeContracts) setValue("contract_id", "", { shouldDirty: true });
                      if (canSeeWorkOrders) setValue("work_order_id", "", { shouldDirty: true });
                    }}
                  >
                    <option value="">No building</option>
                    {buildingOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {canSeeContracts ? (
                <ContractField
                  idPrefix="expense"
                  buildingId={buildingId}
                  saved={
                    expense
                      ? { contract: expense.contract, buildingId: expense.building?.id ?? null }
                      : null
                  }
                  withoutBuilding
                />
              ) : null}
              {canSeeWorkOrders ? (
                <Field
                  id="expense-work-order"
                  label="Work order"
                  optional
                  hint={
                    buildingId === ""
                      ? "Choose a building to pick one of its work orders."
                      : workOrders.data && workOrderOptions.length === 0
                        ? "No work orders have been raised at this building."
                        : undefined
                  }
                  error={errors.work_order_id?.message}
                >
                  {(control) => (
                    <Select
                      {...control}
                      disabled={buildingId === ""}
                      {...register("work_order_id")}
                    >
                      <option value="">No work order</option>
                      {workOrderOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {vendors ? (
                <Field
                  id="expense-vendor"
                  label="Vendor"
                  optional
                  error={errors.vendor_id?.message}
                >
                  {(control) => (
                    <Select {...control} {...register("vendor_id")}>
                      <option value="">No vendor</option>
                      {vendorOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Checkbox
                label="Billable"
                description="The cost can be passed on to the customer."
                {...register("billable")}
              />
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
            disabled={expense !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {expense ? "Save changes" : "Enter expense"}
          </Button>
        </SheetFooter>
      </form>
    </FormProvider>
  );
}
