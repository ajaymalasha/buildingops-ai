import { cn } from "@/lib/utils";

/** The BuildingOps mark: three stacked floors, widest at the base. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect x="2.5" y="14.5" width="19" height="6" rx="1.6" />
      <rect x="5.75" y="8.75" width="12.5" height="4.25" rx="1.3" opacity="0.72" />
      <rect x="9" y="3.5" width="6" height="3.75" rx="1.1" opacity="0.46" />
    </svg>
  );
}

type WordmarkProps = {
  /** Which surface it sits on: the dark sidebar or the light page. */
  surface?: "dark" | "light";
  className?: string;
};

export function Wordmark({ surface = "dark", className }: WordmarkProps) {
  const accent = surface === "dark" ? "text-mint" : "text-brand-600";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className={accent} />
      <span className="text-[15px] font-semibold tracking-tight">
        BuildingOps
        <span className={cn("ml-1 font-medium", accent)}>AI</span>
      </span>
    </span>
  );
}
