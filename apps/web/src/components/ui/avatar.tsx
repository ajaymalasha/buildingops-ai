import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold tracking-wide text-brand-800",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
