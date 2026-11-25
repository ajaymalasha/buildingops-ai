"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input, Select } from "@/components/ui/input";
import { $api } from "@/lib/api/client";
import type { Member } from "@/lib/api/types";
import { applyProblem } from "@/lib/forms";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";

import { editMemberSchema, ROLE_OPTIONS, type EditMemberValues } from "./member-form-schema";

type Props = { member: Member | null; onClose: () => void };

export function EditMemberDialog({ member, onClose }: Props) {
  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      {member ? (
        <DialogContent title={member.full_name} description={member.email}>
          <EditMemberForm member={member} onDone={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function EditMemberForm({ member, onDone }: { member: Member; onDone: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const isSelf = member.user_id === me.user.id;

  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isDirty },
  } = useForm<EditMemberValues>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: {
      // A membership can only hold an assignable role; the wider API type includes platform_admin.
      role: ROLE_OPTIONS.find((option) => option === member.role) ?? "employee",
      status: member.status,
      title: member.title ?? "",
    },
  });
  const role = useWatch({ control, name: "role" });

  const updateMember = $api.useMutation("patch", "/api/v1/members/{member_id}", {
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/members"] });
      toast.success(`${updated.full_name} was updated`);
      onDone();
    },
    onError: (error) => setFormError(applyProblem(error, setError, ["role", "status", "title"])),
  });

  function onSubmit(values: EditMemberValues) {
    setFormError(null);
    updateMember.mutate({
      params: { path: { member_id: member.id } },
      // Your own role and status are not yours to change, so they are not sent.
      body: isSelf
        ? { title: values.title || null }
        : { role: values.role, status: values.status, title: values.title || null },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="edit-role" label="Role" error={errors.role?.message}>
            {(control) => (
              <Select {...control} disabled={isSelf} {...register("role")}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="edit-status" label="Access" error={errors.status?.message}>
            {(control) => (
              <Select {...control} disabled={isSelf} {...register("status")}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </Select>
            )}
          </Field>
        </div>
        <p className="-mt-2 text-[13px] text-ink-muted">
          {isSelf
            ? "You can't change your own role or access. Ask another company admin."
            : ROLE_DESCRIPTIONS[role]}
        </p>
        <Field id="edit-title" label="Job title" optional error={errors.title?.message}>
          {(control) => <Input {...control} autoComplete="off" {...register("title")} />}
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          disabled={!isDirty}
          loading={updateMember.isPending}
        >
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
