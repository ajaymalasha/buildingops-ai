"use client";

import { useWatch, type Control, type UseFormSetValue } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useBuildingOptions } from "@/hooks/use-options";
import { problemMessage } from "@/lib/api/problem";
import type { ContractDetail } from "@/lib/api/types";

import { coverageOptions, type ContractValues } from "./contract-form-schema";

type CoveredBuildingsProps = {
  control: Control<ContractValues>;
  setValue: UseFormSetValue<ContractValues>;
  /** The customer chosen in the form, or an empty string before one is. */
  customerId: string;
  /** The contract being edited, or null for a new one. */
  contract: ContractDetail | null;
  /** What the API said about the buildings, if it refused them. */
  error: string | undefined;
};

/**
 * The chosen customer's buildings as a checklist, for the form's `building_ids`. A contract
 * covers buildings of its own customer only, so the list follows the customer field.
 */
export function CoveredBuildings({
  control,
  setValue,
  customerId,
  contract,
  error,
}: CoveredBuildingsProps) {
  const selected = useWatch({ control, name: "building_ids" });
  const buildings = useBuildingOptions({ customerId, enabled: customerId !== "" });

  if (customerId === "") {
    return <p className="text-[13px] text-ink-muted">Choose a customer to see its buildings.</p>;
  }
  if (!buildings.data) {
    return buildings.error ? (
      <p role="alert" className="text-[13px] text-critical">
        {problemMessage(buildings.error)}
      </p>
    ) : (
      <div role="status" aria-label="Loading buildings" className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const options = coverageOptions(buildings.data.items, contract, customerId);
  if (options.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted">
        This customer has no buildings yet. The contract can be saved without any, and they can be
        added later.
      </p>
    );
  }

  // Kept in the order they are listed, so that the same choice always reads as unchanged.
  const choose = (ids: Set<string>) =>
    setValue(
      "building_ids",
      options.filter((option) => ids.has(option.id)).map((option) => option.id),
      { shouldDirty: true },
    );
  const everySelected = options.every((option) => selected.includes(option.id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted tabular-nums" aria-live="polite">
          {selected.length} of {options.length} selected
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="-mr-2.5"
          onClick={() =>
            choose(everySelected ? new Set() : new Set(options.map((option) => option.id)))
          }
        >
          {everySelected ? "Clear selection" : "Select all"}
        </Button>
      </div>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {options.map((option) => (
          <li key={option.id} className="px-3 py-2.5">
            <Checkbox
              checked={selected.includes(option.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(option.id);
                else next.delete(option.id);
                choose(next);
              }}
              label={
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate">{option.name}</span>
                  <span className="shrink-0 font-mono text-[11px] font-normal text-ink-subtle">
                    {option.code}
                  </span>
                </span>
              }
              description={
                option.gone ? "No longer one of this customer's active buildings." : undefined
              }
            />
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-[13px] text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
