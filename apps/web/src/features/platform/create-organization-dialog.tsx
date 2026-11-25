"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { TimeZoneSelect } from "@/components/ui/timezone-select";
import { generatePassword } from "@/features/members/member-form-schema";
import { $api } from "@/lib/api/client";
import { applyProblem } from "@/lib/forms";
import { COMMON_CURRENCIES } from "@/lib/regional";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the organization's name.")
    .max(200, "Use at most 200 characters."),
  slug: z
    .string()
    .trim()
    .max(80, "Use at most 80 characters.")
    .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, "Use lowercase letters, numbers and single hyphens."),
  timezone: z.string().min(1, "Choose a time zone."),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  admin_full_name: z.string().trim().min(1, "Enter the administrator's name.").max(200),
  admin_email: z.email("Enter a valid email address."),
  admin_password: z.string().max(128, "Use at most 128 characters."),
});

type Values = z.infer<typeof schema>;

const FIELDS = [
  "name",
  "slug",
  "timezone",
  "currency",
  "admin_full_name",
  "admin_email",
  "admin_password",
] as const;

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function CreateOrganizationDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title="New organization"
        description="Creates a separate, isolated workspace and its first company admin."
      >
        <CreateOrganizationForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateOrganizationForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      timezone: "America/New_York",
      currency: "USD",
      admin_full_name: "",
      admin_email: "",
      admin_password: "",
    },
  });

  const create = $api.useMutation("post", "/api/v1/platform/organizations", {
    onSuccess: async (organization) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/platform/organizations"] });
      toast.success(`${organization.name} was created`);
      onDone();
    },
    onError: (error) => setFormError(applyProblem(error, setError, FIELDS)),
  });

  function onSubmit(values: Values) {
    setFormError(null);
    create.mutate({
      body: { ...values, slug: values.slug || null, admin_password: values.admin_password || null },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <DialogBody className="space-y-5">
        <FormError message={formError} />

        <fieldset className="space-y-4">
          <legend className="mb-3 eyebrow">Organization</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="new-org-name" label="Name" error={errors.name?.message}>
              {(control) => <Input {...control} autoComplete="off" {...register("name")} />}
            </Field>
            <Field
              id="new-org-slug"
              label="Identifier"
              optional
              hint="Leave blank to derive it from the name."
              error={errors.slug?.message}
            >
              {(control) => (
                <Input
                  {...control}
                  className="font-mono text-[13px]"
                  autoComplete="off"
                  {...register("slug")}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field id="new-org-timezone" label="Time zone" error={errors.timezone?.message}>
              {(control) => <TimeZoneSelect {...control} {...register("timezone")} />}
            </Field>
            <Field id="new-org-currency" label="Currency" error={errors.currency?.message}>
              {(control) => (
                <Select {...control} {...register("currency")}>
                  {COMMON_CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="float-left mb-3 w-full eyebrow">First company admin</legend>
          <div className="clear-both grid gap-4 sm:grid-cols-2">
            <Field
              id="new-org-admin-name"
              label="Full name"
              error={errors.admin_full_name?.message}
            >
              {(control) => (
                <Input {...control} autoComplete="off" {...register("admin_full_name")} />
              )}
            </Field>
            <Field id="new-org-admin-email" label="Work email" error={errors.admin_email?.message}>
              {(control) => (
                <Input {...control} type="email" autoComplete="off" {...register("admin_email")} />
              )}
            </Field>
          </div>
          <Field
            id="new-org-admin-password"
            label="Initial password"
            hint="At least 10 characters. Not needed if this person already has a BuildingOps account."
            error={errors.admin_password?.message}
          >
            {(control) => (
              <div className="flex gap-2">
                <Input
                  {...control}
                  className="font-mono text-[13px]"
                  autoComplete="off"
                  {...register("admin_password")}
                />
                <Button
                  onClick={() =>
                    setValue("admin_password", generatePassword(), { shouldValidate: true })
                  }
                >
                  Generate
                </Button>
              </div>
            )}
          </Field>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={create.isPending}>
          Create organization
        </Button>
      </DialogFooter>
    </form>
  );
}
