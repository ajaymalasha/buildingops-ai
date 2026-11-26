import { cn } from "@/lib/utils";

/**
 * The facts of a record, each under its name, two to a row: what a drawer shows of a work
 * order or an invoice that is being read rather than edited.
 */
export function DetailList({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3.5", className)} {...props} />;
}

type DetailProps = {
  /** What the fact is: "Building", "Due". */
  term: string;
  /** Take the whole row, for a value that runs long. */
  wide?: boolean;
  children: React.ReactNode;
};

export function Detail({ term, wide = false, children }: DetailProps) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <dt className="text-xs text-ink-muted">{term}</dt>
      <dd className="mt-0.5 text-[13px] wrap-break-word text-ink">{children}</dd>
    </div>
  );
}
