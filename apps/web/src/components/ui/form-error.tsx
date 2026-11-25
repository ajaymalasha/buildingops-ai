import { CircleAlert } from "lucide-react";

/** A message about the form as a whole, for errors that belong to no single field. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-sm bg-critical-soft px-3 py-2.5 text-[13px] text-critical"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}
