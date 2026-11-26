"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { overlayClasses } from "./dialog";
import { Skeleton } from "./skeleton";

export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;

/** Where focus starts in a drawer: the first control of the form in its body. */
const FIRST_FIELD = "[data-sheet-body] :is(input, select, textarea):not(:disabled)";

type SheetContentProps = {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * A drawer on the right-hand side, for forms with too many fields for a dialog. The list
 * it was opened from stays visible beside it.
 *
 * It is a modal dialog underneath: Radix keeps focus inside while it is open, closes it on
 * Escape and puts focus back where it was. Put a `SheetBody` and a `SheetFooter` inside,
 * usually wrapped in the form they belong to.
 */
export function SheetContent({ title, description, className, children }: SheetContentProps) {
  const content = useRef<HTMLDivElement>(null);
  const edited = useRef(false);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClasses} />
      <DialogPrimitive.Content
        ref={content}
        // Without a description, tell Radix there is deliberately nothing to point at.
        {...(description ? {} : { "aria-describedby": undefined })}
        // Start in the first field rather than on the close button, which comes first in
        // the document.
        onOpenAutoFocus={(event) => {
          const field = content.current?.querySelector<HTMLElement>(FIRST_FIELD);
          if (field) {
            event.preventDefault();
            field.focus();
          }
        }}
        // A click on the page behind closes an untouched drawer. Once something has been
        // typed or chosen it no longer does: a stray click must not throw away half a
        // form. Escape, Cancel and the close button still close it.
        onInput={() => {
          edited.current = true;
        }}
        onPointerDownOutside={(event) => {
          if (edited.current) event.preventDefault();
        }}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-xl animate-slide-in-right flex-col border-l border-line bg-surface shadow-overlay focus:outline-none",
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-base font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-[13px] text-ink-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-sunken hover:text-ink"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The scrolling part of a drawer. */
export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-sheet-body=""
      className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", className)}
      {...props}
    />
  );
}

/** Stays at the bottom of the drawer while the body scrolls. Holds Cancel and the action. */
export function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-t border-line bg-canvas/70 px-6 py-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Stands in for a drawer's body while the record or the choices its form offers load.
 *
 * When the form takes its place, focus moves to the form's first field, where it would
 * have started had there been nothing to wait for.
 */
export function SheetLoading({ fields = 6 }: { fields?: number }) {
  const placeholder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sheet = placeholder.current?.closest('[role="dialog"]');
    // Runs once the placeholder is gone and whatever replaces it is in the document. If
    // the drawer itself was closed, there is nothing left to focus.
    return () => {
      if (sheet?.isConnected) sheet.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
    };
  }, []);

  return (
    <SheetBody ref={placeholder} role="status" aria-label="Loading" className="space-y-5">
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </SheetBody>
  );
}
