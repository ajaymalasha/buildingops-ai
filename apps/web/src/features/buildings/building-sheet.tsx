"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import { AddressFields } from "@/components/forms/address-fields";
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
import type { Building, Customer } from "@/lib/api/types";
import { applyProblem, recordOptions } from "@/lib/forms";

import {
  BUILDING_FIELDS,
  BUILDING_STATUS_LABELS,
  BUILDING_STATUSES,
  BUILDING_TYPE_LABELS,
  BUILDING_TYPES,
  buildingBody,
  buildingDefaults,
  buildingSchema,
  type BuildingValues,
} from "./building-form-schema";

type Props = {
  /** The building to edit, "new" for a blank form, or null while closed. */
  target: Building | "new" | null;
  /** The customer a new building starts with: the one the list is filtered to, if any. */
  defaultCustomerId?: string;
  onClose: () => void;
};

export function BuildingSheet({ target, defaultCustomerId, onClose }: Props) {
  const building = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={building ? building.name : "New building"}
          description={
            building
              ? `Building ${building.code}`
              : "A site your teams service. Every building belongs to one customer."
          }
        >
          <BuildingSheetBody
            building={building}
            defaultCustomerId={defaultCustomerId}
            onDone={onClose}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

type BodyProps = { building: Building | null; defaultCustomerId?: string; onDone: () => void };

/**
 * The form needs the customers to choose from, so it waits for them. Once it has them it
 * stays: a later refresh that fails must not take the form away.
 */
function BuildingSheetBody(props: BodyProps) {
  const customers = useCustomerOptions();
  if (!customers.data) {
    if (!customers.error) return <SheetLoading />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(customers.error)}
          onRetry={() => void customers.refetch()}
        />
      </SheetBody>
    );
  }
  return <BuildingForm customers={customers.data.items} {...props} />;
}

function BuildingForm({
  building,
  defaultCustomerId,
  customers,
  onDone,
}: BodyProps & { customers: Customer[] }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BuildingValues>({
    resolver: zodResolver(buildingSchema),
    defaultValues: buildingDefaults(building, defaultCustomerId),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = form;

  const customerOptions = recordOptions(customers, building?.customer);

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, BUILDING_FIELDS));

  // A building shows up in its customer's count and as an employee's primary building.
  const refresh = () =>
    invalidate(queryClient, "/api/v1/buildings", "/api/v1/customers", "/api/v1/employees");

  const create = $api.useMutation("post", "/api/v1/buildings", {
    onSuccess: async (created) => {
      await refresh();
      toast.success(`${created.name} was added`, { description: `Building ${created.code}` });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/buildings/{building_id}", {
    onSuccess: async (updated) => {
      await refresh();
      toast.success(`${updated.name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: BuildingValues) {
    setFormError(null);
    const body = buildingBody(values);
    if (building) {
      update.mutate({ params: { path: { building_id: building.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <FormError message={formError} />
          <div className="space-y-6">
            <FormSection title="Building">
              <Field
                id="building-customer"
                label="Customer"
                hint={
                  customerOptions.length === 0
                    ? "There are no customers yet. Add the customer first."
                    : undefined
                }
                error={errors.customer_id?.message}
              >
                {(control) => (
                  <Select {...control} {...register("customer_id")}>
                    <option value="">Choose a customer</option>
                    {customerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="building-name" label="Name" error={errors.name?.message}>
                {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="building-type" label="Type" error={errors.building_type?.message}>
                  {(control) => (
                    <Select {...control} {...register("building_type")}>
                      {BUILDING_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {BUILDING_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="building-status" label="Status" error={errors.status?.message}>
                  {(control) => (
                    <Select {...control} {...register("status")}>
                      {BUILDING_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {BUILDING_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="building-code"
                  label="Code"
                  optional={!building}
                  hint={building ? undefined : "Leave blank to generate the next one."}
                  error={errors.code?.message}
                >
                  {(control) => (
                    <Input
                      {...control}
                      className="font-mono text-[13px] uppercase"
                      autoComplete="off"
                      {...register("code")}
                    />
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection title="Address">
              <AddressFields idPrefix="building" required />
            </FormSection>

            <FormSection title="Size">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="building-square-feet"
                  label="Floor area"
                  optional
                  error={errors.square_feet?.message}
                >
                  {(control) => (
                    <UnitInput
                      {...control}
                      unit="sq ft"
                      inputMode="numeric"
                      autoComplete="off"
                      {...register("square_feet")}
                    />
                  )}
                </Field>
                <Field id="building-floors" label="Floors" optional error={errors.floors?.message}>
                  {(control) => (
                    <Input
                      {...control}
                      className="tabular-nums"
                      inputMode="numeric"
                      autoComplete="off"
                      {...register("floors")}
                    />
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection title="Notes">
              <Field
                id="building-notes"
                label="Notes"
                labelHidden
                hint="Access, loading docks, alarm procedures: what a crew needs to know on arrival."
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
            disabled={building !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {building ? "Save changes" : "Create building"}
          </Button>
        </SheetFooter>
      </form>
    </FormProvider>
  );
}
