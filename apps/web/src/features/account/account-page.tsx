"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { PageHeader, Section } from "@/components/ui/page";
import { signOutAction } from "@/features/auth/actions";
import { $api } from "@/lib/api/client";
import { applyProblem } from "@/lib/forms";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(128, "Use at most 128 characters."),
    confirm_password: z.string(),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    path: ["confirm_password"],
    message: "The passwords don't match.",
  });

type PasswordValues = z.infer<typeof passwordSchema>;

export function AccountPage() {
  const me = useMe();
  const [signingOut, startSignOut] = useTransition();

  return (
    <>
      <PageHeader
        title="Account"
        description="Your sign-in details and the organizations you belong to."
      />

      <Section title="Profile" description="An administrator manages your name, email and role.">
        <dl className="grid max-w-lg grid-cols-[9rem_minmax(0,1fr)] gap-y-3 text-[13px]">
          <dt className="text-ink-muted">Name</dt>
          <dd className="font-medium text-ink">{me.user.full_name}</dd>
          <dt className="text-ink-muted">Email</dt>
          <dd className="text-ink">{me.user.email}</dd>
          <dt className="text-ink-muted">Organizations</dt>
          <dd>
            {me.memberships.length === 0 ? (
              <span className="text-ink-subtle">None</span>
            ) : (
              <ul className="space-y-1.5">
                {me.memberships.map(({ organization, role }) => (
                  <li key={organization.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink">{organization.name}</span>
                    <Badge>{ROLE_LABELS[role]}</Badge>
                    {organization.id === me.organization?.id ? (
                      <Badge tone="brand">Active</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          {me.user.is_platform_admin ? (
            <>
              <dt className="text-ink-muted">Platform</dt>
              <dd>
                <Badge tone="info">Platform admin</Badge>
              </dd>
            </>
          ) : null}
        </dl>
      </Section>

      <Section
        title="Password"
        description="Changing it signs you out everywhere else. This device stays signed in."
      >
        <ChangePasswordForm />
      </Section>

      <Section title="This session" description="Sessions end after a week without activity.">
        <div className="flex max-w-lg flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-muted">
            Signed in until{" "}
            <span className="text-ink">
              {formatDateTime(me.session_expires_at, me.organization?.timezone)}
            </span>
            , unless you keep working.
          </p>
          <Button loading={signingOut} onClick={() => startSignOut(() => signOutAction())}>
            Sign out
          </Button>
        </div>
      </Section>
    </>
  );
}

function ChangePasswordForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const changePassword = $api.useMutation("post", "/api/v1/auth/change-password", {
    onSuccess: () => {
      reset();
      toast.success("Password changed", { description: "Your other sessions were signed out." });
    },
    onError: (error) =>
      setFormError(applyProblem(error, setError, ["current_password", "new_password"])),
  });

  function onSubmit(values: PasswordValues) {
    setFormError(null);
    changePassword.mutate({
      body: { current_password: values.current_password, new_password: values.new_password },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-sm space-y-4">
      <FormError message={formError} />
      <Field
        id="current-password"
        label="Current password"
        error={errors.current_password?.message}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="current-password"
            {...register("current_password")}
          />
        )}
      </Field>
      <Field
        id="new-password"
        label="New password"
        hint="At least 10 characters."
        error={errors.new_password?.message}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            {...register("new_password")}
          />
        )}
      </Field>
      <Field
        id="confirm-password"
        label="Repeat new password"
        error={errors.confirm_password?.message}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            {...register("confirm_password")}
          />
        )}
      </Field>
      <Button type="submit" variant="primary" loading={changePassword.isPending}>
        Change password
      </Button>
    </form>
  );
}
