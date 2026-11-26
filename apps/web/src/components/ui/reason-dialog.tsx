"use client";

import { useId, useRef, useState } from "react";

import { fieldErrors, problemMessage } from "@/lib/api/problem";

import { Button } from "./button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "./dialog";
import { Field } from "./field";
import { FormError } from "./form-error";
import { Textarea } from "./input";

type ReasonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The question: "Reject this timesheet?" */
  title: string;
  /** What is being decided on, and what becomes of the reason. */
  description: string;
  /** Names the action: "Reject timesheet". */
  confirmLabel: string;
  /** What to say when nothing was typed. */
  requiredMessage?: string;
  /** The most the API keeps. */
  maxLength?: number;
  /** True while the action is in flight. */
  loading?: boolean;
  /** Why the last attempt failed, as the mutation reported it. */
  error?: unknown;
  onConfirm: (reason: string) => void;
};

/**
 * Asks for the reason before doing something that needs one, such as rejecting someone's
 * time. The dialog stays open until the caller closes it, so a refusal can be shown where
 * the reason was given.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  ...form
}: ReasonDialogProps) {
  const reason = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* It starts where the typing happens, not on the close button. */}
      <DialogContent title={title} description={description} initialFocus={reason}>
        {/* Rendered only while open, so each time it starts with nothing typed. */}
        <ReasonForm reason={reason} {...form} />
      </DialogContent>
    </Dialog>
  );
}

type ReasonFormProps = Omit<
  ReasonDialogProps,
  "open" | "onOpenChange" | "title" | "description"
> & { reason: React.RefObject<HTMLTextAreaElement | null> };

function ReasonForm({
  reason,
  confirmLabel,
  requiredMessage = "Enter a reason.",
  maxLength = 500,
  loading = false,
  error,
  onConfirm,
}: ReasonFormProps) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [missing, setMissing] = useState(false);
  // What the API said about the reason itself goes on the field. Anything else it said
  // is about the action as a whole.
  const onField = fieldErrors(error).reason;

  return (
    <form
      noValidate
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        const given = typed.trim();
        setMissing(given === "");
        if (given !== "") onConfirm(given);
      }}
    >
      <DialogBody className="space-y-4">
        {error && !onField ? <FormError message={problemMessage(error)} /> : null}
        <Field id={id} label="Reason" error={missing ? requiredMessage : onField}>
          {(control) => (
            <Textarea
              {...control}
              ref={reason}
              rows={3}
              maxLength={maxLength}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
                setMissing(false);
              }}
            />
          )}
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="danger" loading={loading}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
