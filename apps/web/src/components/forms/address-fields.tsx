"use client";

import { useFormContext } from "react-hook-form";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AddressValues } from "@/lib/form-fields";

type AddressFieldsProps = {
  /** Prefix for the inputs' ids, unique among the forms on screen: "customer". */
  idPrefix: string;
  /** Whether the street and the city must be filled in, as they must for a building. */
  required?: boolean;
};

/**
 * The address inputs of customers, vendors and buildings.
 *
 * Reads the form from context: wrap the form in `FormProvider`, and give its values the
 * fields in `addressFields` from `lib/form-fields`.
 */
export function AddressFields({ idPrefix, required = false }: AddressFieldsProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<AddressValues>();
  return (
    <>
      <Field
        id={`${idPrefix}-address-line1`}
        label="Street address"
        optional={!required}
        error={errors.address_line1?.message}
      >
        {(control) => <Input {...control} autoComplete="off" {...register("address_line1")} />}
      </Field>
      <Field
        id={`${idPrefix}-address-line2`}
        label="Suite, floor or unit"
        optional
        error={errors.address_line2?.message}
      >
        {(control) => <Input {...control} autoComplete="off" {...register("address_line2")} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-city`}
          label="City"
          optional={!required}
          error={errors.city?.message}
        >
          {(control) => <Input {...control} autoComplete="off" {...register("city")} />}
        </Field>
        <Field
          id={`${idPrefix}-region`}
          label="State or region"
          optional
          error={errors.region?.message}
        >
          {(control) => <Input {...control} autoComplete="off" {...register("region")} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-postal-code`}
          label="Postal code"
          optional
          error={errors.postal_code?.message}
        >
          {(control) => <Input {...control} autoComplete="off" {...register("postal_code")} />}
        </Field>
        <Field
          id={`${idPrefix}-country`}
          label="Country"
          hint="Two-letter code, such as US."
          error={errors.country?.message}
        >
          {(control) => (
            <Input
              {...control}
              className="uppercase"
              maxLength={2}
              autoComplete="off"
              {...register("country")}
            />
          )}
        </Field>
      </div>
    </>
  );
}
