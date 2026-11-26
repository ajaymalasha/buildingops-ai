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
import type { Vendor } from "@/lib/api/types";
import { applyProblem } from "@/lib/forms";

import {
  VENDOR_CATEGORIES,
  VENDOR_CATEGORY_LABELS,
  VENDOR_FIELDS,
  VENDOR_STATUS_LABELS,
  VENDOR_STATUSES,
  vendorBody,
  vendorDefaults,
  vendorSchema,
  type VendorValues,
} from "./vendor-form-schema";

type Props = {
  /** The vendor to edit, "new" for a blank form, or null while closed. */
  target: Vendor | "new" | null;
  onClose: () => void;
};

export function VendorSheet({ target, onClose }: Props) {
  const vendor = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={vendor ? vendor.name : "New vendor"}
          description={
            vendor
              ? `Vendor ${vendor.code}`
              : "A subcontractor or supplier you send work to or buy from."
          }
        >
          <VendorForm vendor={vendor} onDone={onClose} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function VendorForm({ vendor, onDone }: { vendor: Vendor | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<VendorValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: vendorDefaults(vendor),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = form;

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, VENDOR_FIELDS));

  const create = $api.useMutation("post", "/api/v1/vendors", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/vendors");
      toast.success(`${created.name} was added`, { description: `Vendor ${created.code}` });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/vendors/{vendor_id}", {
    onSuccess: async (updated) => {
      await invalidate(queryClient, "/api/v1/vendors");
      toast.success(`${updated.name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: VendorValues) {
    setFormError(null);
    const body = vendorBody(values);
    if (vendor) {
      update.mutate({ params: { path: { vendor_id: vendor.id } }, body });
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
            <FormSection title="Vendor">
              <Field id="vendor-name" label="Name" error={errors.name?.message}>
                {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="vendor-category" label="Category" error={errors.category?.message}>
                  {(control) => (
                    <Select {...control} {...register("category")}>
                      {VENDOR_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {VENDOR_CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="vendor-status" label="Status" error={errors.status?.message}>
                  {(control) => (
                    <Select {...control} {...register("status")}>
                      {VENDOR_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {VENDOR_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="vendor-code"
                  label="Code"
                  optional={!vendor}
                  hint={vendor ? undefined : "Leave blank to generate the next one."}
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

            <FormSection title="Contact">
              <ContactFields idPrefix="vendor" />
            </FormSection>

            <FormSection title="Address">
              <AddressFields idPrefix="vendor" />
            </FormSection>

            <FormSection title="Compliance and payment">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="vendor-insurance"
                  label="Insurance expires"
                  optional
                  hint="The last day their certificate is valid."
                  error={errors.insurance_expires_on?.message}
                >
                  {(control) => (
                    <Input {...control} type="date" {...register("insurance_expires_on")} />
                  )}
                </Field>
                <Field
                  id="vendor-payment-terms"
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
                id="vendor-notes"
                label="Notes"
                labelHidden
                hint="Anything your team should know about this vendor."
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
            disabled={vendor !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {vendor ? "Save changes" : "Create vendor"}
          </Button>
        </SheetFooter>
      </form>
    </FormProvider>
  );
}
