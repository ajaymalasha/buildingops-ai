"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";

import { AddressFields } from "@/components/forms/address-fields";
import { ContactFields } from "@/components/forms/contact-fields";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { FormSection } from "@/components/ui/form-section";
import { Input, Select, Textarea, UnitInput } from "@/components/ui/input";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { Customer } from "@/lib/api/types";
import { applyProblem } from "@/lib/forms";

import {
  CUSTOMER_FIELDS,
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUSES,
  customerBody,
  customerDefaults,
  customerSchema,
  type CustomerValues,
} from "./customer-form-schema";

type Props = {
  /** The customer to edit, "new" for a blank form, or null while closed. */
  target: Customer | "new" | null;
  onClose: () => void;
};

export function CustomerSheet({ target, onClose }: Props) {
  const customer = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={customer ? customer.name : "New customer"}
          description={
            customer
              ? `Customer ${customer.code}`
              : "A company you service buildings for. Add its buildings once it is saved."
          }
        >
          <CustomerForm customer={customer} onDone={onClose} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function CustomerForm({ customer, onDone }: { customer: Customer | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: customerDefaults(customer),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = form;

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, CUSTOMER_FIELDS));

  const create = $api.useMutation("post", "/api/v1/customers", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/customers");
      toast.success(`${created.name} was added`, { description: `Customer ${created.code}` });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/customers/{customer_id}", {
    onSuccess: async (updated) => {
      // Buildings and contracts show their customer's name.
      await invalidate(queryClient, "/api/v1/customers", "/api/v1/buildings", "/api/v1/contracts");
      toast.success(`${updated.name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: CustomerValues) {
    setFormError(null);
    const body = customerBody(values);
    if (customer) {
      update.mutate({ params: { path: { customer_id: customer.id } }, body });
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
            <FormSection title="Customer">
              <Field id="customer-name" label="Name" error={errors.name?.message}>
                {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="customer-code"
                  label="Code"
                  optional={!customer}
                  hint={customer ? undefined : "Leave blank to generate the next one."}
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
                <Field id="customer-status" label="Status" error={errors.status?.message}>
                  {(control) => (
                    <Select {...control} {...register("status")}>
                      {CUSTOMER_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {CUSTOMER_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection title="Primary contact">
              <ContactFields idPrefix="customer" />
            </FormSection>

            <FormSection title="Address">
              <AddressFields idPrefix="customer" />
            </FormSection>

            <FormSection title="Billing">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="customer-payment-terms"
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
              </div>
            </FormSection>

            <FormSection title="Notes">
              <Field
                id="customer-notes"
                label="Notes"
                labelHidden
                hint="Anything your team should know about this customer."
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
            disabled={customer !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {customer ? "Save changes" : "Create customer"}
          </Button>
        </SheetFooter>
      </form>
    </FormProvider>
  );
}
