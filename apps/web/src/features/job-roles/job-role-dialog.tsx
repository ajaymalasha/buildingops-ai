"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input, Textarea, UnitInput } from "@/components/ui/input";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import type { JobRole } from "@/lib/api/types";
import { applyProblem } from "@/lib/forms";

import {
  JOB_ROLE_FIELDS,
  jobRoleBody,
  jobRoleDefaults,
  jobRoleSchema,
  type JobRoleValues,
} from "./job-role-form-schema";

type Props = {
  /** The job role to edit, "new" for a blank form, or null while closed. */
  target: JobRole | "new" | null;
  onClose: () => void;
};

export function JobRoleDialog({ target, onClose }: Props) {
  const jobRole = target === "new" ? null : target;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <DialogContent
          title={jobRole ? jobRole.name : "New job role"}
          description={
            jobRole
              ? "Changes apply to everyone who holds this role."
              : "A position employees can hold, such as custodian or site supervisor."
          }
        >
          <JobRoleForm jobRole={jobRole} onDone={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function JobRoleForm({ jobRole, onDone }: { jobRole: JobRole | null; onDone: () => void }) {
  const me = useMe();
  const canSeePay = useCan("employees:read_compensation");
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<JobRoleValues>({
    resolver: zodResolver(jobRoleSchema),
    defaultValues: jobRoleDefaults(jobRole),
  });

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, JOB_ROLE_FIELDS));

  const create = $api.useMutation("post", "/api/v1/job-roles", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/job-roles");
      toast.success(`${created.name} was added`);
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/job-roles/{job_role_id}", {
    onSuccess: async (updated) => {
      // Employees show the name of their role.
      await invalidate(queryClient, "/api/v1/job-roles", "/api/v1/employees");
      toast.success(`${updated.name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: JobRoleValues) {
    setFormError(null);
    const body = jobRoleBody(values, { includeRate: canSeePay });
    if (jobRole) {
      update.mutate({ params: { path: { job_role_id: jobRole.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={formError} />
        <Field id="job-role-name" label="Name" error={errors.name?.message}>
          {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
        </Field>
        <Field
          id="job-role-description"
          label="Description"
          optional
          error={errors.description?.message}
        >
          {(control) => <Textarea {...control} rows={2} {...register("description")} />}
        </Field>
        {canSeePay ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="job-role-rate"
              label="Default hourly rate"
              optional
              error={errors.default_hourly_rate?.message}
            >
              {(control) => (
                <UnitInput
                  {...control}
                  unit={me.organization?.currency ?? "USD"}
                  inputMode="decimal"
                  autoComplete="off"
                  {...register("default_hourly_rate")}
                />
              )}
            </Field>
          </div>
        ) : null}
        <Checkbox
          label="Supervisory role"
          description="People in this role can be chosen as someone's supervisor."
          {...register("is_supervisory")}
        />
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button
          type="submit"
          variant="primary"
          disabled={jobRole !== null && !isDirty}
          loading={create.isPending || update.isPending}
        >
          {jobRole ? "Save changes" : "Create job role"}
        </Button>
      </DialogFooter>
    </form>
  );
}
