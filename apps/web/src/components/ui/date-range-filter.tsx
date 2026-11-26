import { Input } from "./input";

type DateRangeFilterProps = {
  /**
   * What the dates are, as a noun: "Work date". It names the two inputs ("Work date
   * from", "Work date to") and is shown before them.
   */
  label: string;
  /** The applied range (from the URL), as YYYY-MM-DD. Either end may be left open. */
  from: string | undefined;
  to: string | undefined;
  /** Called with the end that changed. An emptied input reports an empty string. */
  onChange: (change: { from: string } | { to: string }) => void;
};

/**
 * A filter in a list toolbar for records dated between two days, both included. Each
 * input stops at the other's date, so the range cannot be chosen the wrong way round.
 */
export function DateRangeFilter({ label, from, to, onChange }: DateRangeFilterProps) {
  return (
    // In a narrow window the label goes above the two inputs, which then fit side by side.
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="text-[13px] whitespace-nowrap text-ink-muted max-sm:w-full">{label}</span>
      <Input
        type="date"
        aria-label={`${label} from`}
        className="w-38"
        value={from ?? ""}
        max={to}
        onChange={(event) => onChange({ from: event.target.value })}
      />
      <span className="text-xs text-ink-subtle">to</span>
      <Input
        type="date"
        aria-label={`${label} to`}
        className="w-38"
        value={to ?? ""}
        min={from}
        onChange={(event) => onChange({ to: event.target.value })}
      />
    </div>
  );
}
