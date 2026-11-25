"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

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
import { applyProblem } from "@/lib/forms";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";

import {
  addMemberSchema,
  generatePassword,
  ROLE_OPTIONS,
  type AddMemberValues,
} from "./member-form-schema";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function AddMemberDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a member"
        description="They can sign in straight away with the password you set here."
      >
        <AddMemberForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddMemberForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<AddMemberValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { email: "", full_name: "", role: "employee", title: "", password: "" },
  });
  const role = useWatch({ control, name: "role" });

  const createMember = $api.useMutation("post", "/api/v1/members", {
    onSuccess: async (member) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/members"] });
      if (member.existing_account) {
        toast.success(`${member.full_name} now has access`, {
          description: "They already had an account and keep their existing password.",
        });
      } else {
        toast.success(`${member.full_name} was added`);
      }
      onDone();
    },
    onError: (error) =>
      setFormError(
        applyProblem(error, setError, ["email", "full_name", "role", "title", "password"]),
      ),
  });

  function onSubmit(values: AddMemberValues) {
    setFormError(null);
    createMember.mutate({
      body: {
        email: values.email,
        full_name: values.full_name,
        role: values.role,
        title: values.title || null,
        password: values.password || null,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={formError} />
        <Field id="member-email" label="Work email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} type="email" autoComplete="off" {...register("email")} />
          )}
        </Field>
        <Field id="member-name" label="Full name" error={errors.full_name?.message}>
          {(control) => <Input {...control} autoComplete="off" {...register("full_name")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="member-role" label="Role" error={errors.role?.message}>
            {(control) => (
              <Select {...control} {...register("role")}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="member-title" label="Job title" optional error={errors.title?.message}>
            {(control) => <Input {...control} autoComplete="off" {...register("title")} />}
          </Field>
        </div>
        <p className="-mt-2 text-[13px] text-ink-muted">{ROLE_DESCRIPTIONS[role]}</p>
        <Field
          id="member-password"
          label="Initial password"
          error={errors.password?.message}
          hint="At least 10 characters. Not needed if this person already has a BuildingOps account."
        >
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                className="font-mono text-[13px]"
                autoComplete="off"
                {...register("password")}
              />
              <Button
                onClick={() => setValue("password", generatePassword(), { shouldValidate: true })}
              >
                Generate
              </Button>
            </div>
          )}
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={createMember.isPending}>
          Add member
        </Button>
      </DialogFooter>
    </form>
  );
}
