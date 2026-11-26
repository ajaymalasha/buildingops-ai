"use client";

import { useFormContext } from "react-hook-form";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ContactValues } from "@/lib/form-fields";

/**
 * The inputs for the person to call at a customer or a vendor.
 *
 * Reads the form from context: wrap the form in `FormProvider`, and give its values the
 * fields in `contactFields` from `lib/form-fields`.
 */
export function ContactFields({ idPrefix }: { idPrefix: string }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ContactValues>();
  return (
    <>
      <Field
        id={`${idPrefix}-contact-name`}
        label="Contact name"
        optional
        error={errors.contact_name?.message}
      >
        {(control) => <Input {...control} autoComplete="off" {...register("contact_name")} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-email`} label="Email" optional error={errors.email?.message}>
          {(control) => (
            <Input {...control} type="email" autoComplete="off" {...register("email")} />
          )}
        </Field>
        <Field id={`${idPrefix}-phone`} label="Phone" optional error={errors.phone?.message}>
          {(control) => <Input {...control} type="tel" autoComplete="off" {...register("phone")} />}
        </Field>
      </div>
    </>
  );
}
