"use client";

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { isProblem, problemMessage } from "@/lib/api/problem";

import { Button } from "./button";
import { DialogFooter, overlayClasses } from "./dialog";
import { FormError } from "./form-error";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The question: "Archive Calloway Property Group?" */
  title: string;
  /** What will happen if they go ahead, in a sentence or two. */
  description: string;
  /** Names the action: "Archive customer", not "OK". */
  confirmLabel: string;
  /**
   * Names the way out. "Cancel" unless the action is itself a cancellation, where two
   * buttons saying cancel would be a trap: then say what is kept, as in "Keep shift".
   */
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** True while the action is in flight. */
  loading?: boolean;
  /** Why the last attempt failed, as the mutation reported it. */
  error?: unknown;
  onConfirm: () => void;
};

/**
 * Asks before doing something that is hard to take back.
 *
 * The dialog stays open until the caller closes it, so a failure can be shown where the
 * question was asked. A conflict (409) is a refusal: other records stand in the way, the
 * API's message says which, and asking again will not change the answer. Only "Close" is
 * offered then. Any other failure can be tried again.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const refused = isProblem(error) && error.status === 409;
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayClasses} />
        <AlertDialogPrimitive.Content className="fixed top-[16vh] left-1/2 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 animate-pop-in flex-col rounded-lg border border-line bg-surface shadow-overlay focus:outline-none">
          <div className="space-y-3 overflow-y-auto p-5">
            <div>
              <AlertDialogPrimitive.Title className="text-base font-semibold text-ink">
                {title}
              </AlertDialogPrimitive.Title>
              <AlertDialogPrimitive.Description className="mt-1.5 text-[13px] text-ink-muted">
                {description}
              </AlertDialogPrimitive.Description>
            </div>
            {error ? <FormError message={problemMessage(error)} /> : null}
          </div>
          <DialogFooter>
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant={refused ? "secondary" : "ghost"}>
                {refused ? "Close" : cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            {refused ? null : (
              <Button
                variant={tone === "danger" ? "danger" : "primary"}
                loading={loading}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            )}
          </DialogFooter>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
