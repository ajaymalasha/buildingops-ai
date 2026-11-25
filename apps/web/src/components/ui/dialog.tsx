"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

type DialogContentProps = {
  title: string;
  description?: string;
  size?: "md" | "lg";
  className?: string;
  children: React.ReactNode;
};

export function DialogContent({
  title,
  description,
  size = "md",
  className,
  children,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-overlay-in bg-ink/45" />
      <DialogPrimitive.Content
        // Without a description, tell Radix there is deliberately nothing to point at.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "fixed top-[10vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-2rem)] -translate-x-1/2 animate-pop-in flex-col rounded-lg border border-line bg-surface shadow-overlay focus:outline-none",
          size === "md" ? "max-w-md" : "max-w-xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-1">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mt-1 -mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 rounded-b-lg border-t border-line bg-canvas/70 px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
