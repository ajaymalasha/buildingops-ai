import { cn } from "@/lib/utils";

import { Select } from "./input";

export type Option = { value: string; label: string };

type FilterSelectProps = {
  /** The accessible name: "Filter by status". */
  label: string;
  /** The first option, which removes the filter: "Any status". */
  placeholder: string;
  /** The applied value (from the URL), or undefined when the filter is off. */
  value: string | undefined;
  options: readonly Option[];
  onChange: (value: string) => void;
  /** Tailwind width class. */
  className?: string;
};

/** A filter in a list toolbar: a native select whose first option means "no filter". */
export function FilterSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  className,
}: FilterSelectProps) {
  return (
    <div className={cn("w-40", className)}>
      <Select
        aria-label={label}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
