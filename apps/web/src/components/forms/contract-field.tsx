"use client";

import { useFormContext } from "react-hook-form";

import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useContractOptions } from "@/hooks/use-options";
import { problemMessage } from "@/lib/api/problem";
import { contractOptions } from "@/lib/forms";

type ContractFieldProps = {
  /** Prefix for the select's id, unique among the forms on screen: "work-order". */
  idPrefix: string;
  /** The building chosen in the form, or an empty string before one is. */
  buildingId: string;
  /**
   * The contract and the building the record was saved with. That contract stays on
   * offer for as long as the form's building is that one, so that opening the form and
   * saving it changes nothing.
   */
  saved?: { contract: Contract | null; buildingId: string | null } | null;
  /**
   * Offer every contract while no building is chosen, for a record that may be booked to
   * a contract without being for a building. Otherwise the field waits for the building.
   */
  withoutBuilding?: boolean;
};

type Contract = { id: string; contract_number: string; name: string };

/**
 * The contract a work order, a timesheet or an expense is booked to.
 *
 * A record booked to a contract must be for a building that contract covers, so the select
 * offers the contracts covering the form's building and no others. The form it sits in
 * clears the choice when the building changes.
 *
 * Reads the form from context: wrap the form in `FormProvider`, and give its values a
 * `contract_id`. Leave the field out, and `contract_id` out of the request, for someone
 * who may not read contracts.
 */
export function ContractField({
  idPrefix,
  buildingId,
  saved,
  withoutBuilding = false,
}: ContractFieldProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<{ contract_id: string }>();
  const waitsForBuilding = buildingId === "" && !withoutBuilding;
  const contracts = useContractOptions({
    buildingId: buildingId || undefined,
    enabled: !waitsForBuilding,
  });

  const current =
    saved?.contract && (saved.buildingId ?? "") === buildingId ? saved.contract : null;
  const options = contractOptions(waitsForBuilding ? [] : (contracts.data?.items ?? []), current);

  let hint: string | undefined;
  if (waitsForBuilding) hint = "Choose a building to see the contracts that cover it.";
  else if (contracts.error) hint = problemMessage(contracts.error);
  else if (contracts.data && options.length === 0) {
    hint = buildingId === "" ? "There are no contracts yet." : "No contract covers this building.";
  }

  return (
    <Field
      id={`${idPrefix}-contract`}
      label="Contract"
      optional
      hint={hint}
      error={errors.contract_id?.message}
    >
      {(control) => (
        <Select {...control} disabled={waitsForBuilding} {...register("contract_id")}>
          <option value="">No contract</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
