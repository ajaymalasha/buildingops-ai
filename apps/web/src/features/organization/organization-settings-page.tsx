"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useCan } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input, Select } from "@/components/ui/input";
import { PageHeader, Section } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { TimeZoneSelect } from "@/components/ui/timezone-select";
import { $api } from "@/lib/api/client";
import { problemMessage } from "@/lib/api/problem";
import type { Organization } from "@/lib/api/types";
import { applyProblem } from "@/lib/forms";
import { formatDate } from "@/lib/format";
import { COMMON_CURRENCIES } from "@/lib/regional";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the organization's name.")
    .max(200, "Use at most 200 characters."),
  legal_name: z.string().trim().max(200, "Use at most 200 characters."),
  timezone: z.string().min(1, "Choose a time zone."),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
});

type Values = z.infer<typeof schema>;

function toValues(organization: Organization): Values {
  return {
    name: organization.name,
    legal_name: organization.legal_name ?? "",
    timezone: organization.timezone,
    currency: organization.currency,
  };
}

export function OrganizationSettingsPage() {
  const canUpdate = useCan("organization:update");
  const organization = $api.useQuery("get", "/api/v1/organization");

  return (
    <>
      <PageHeader
        title="Organization"
        description="How this organization is named, and the regional settings used for dates and money."
      />
      {organization.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-full max-w-md" />
        </div>
      ) : organization.error ? (
        <ErrorState
          message={problemMessage(organization.error)}
          onRetry={() => void organization.refetch()}
        />
      ) : (
        <OrganizationForm organization={organization.data} readOnly={!canUpdate} />
      )}
    </>
  );
}

function OrganizationForm({
  organization,
  readOnly,
}: {
  organization: Organization;
  readOnly: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(organization) });

  const update = $api.useMutation("patch", "/api/v1/organization", {
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["get", "/api/v1/organization"] });
      reset(toValues(updated));
      toast.success("Organization settings saved");
      router.refresh(); // the name in the header comes from the server-rendered session
    },
    onError: (error) =>
      setFormError(applyProblem(error, setError, ["name", "legal_name", "timezone", "currency"])),
  });

  function onSubmit(values: Values) {
    setFormError(null);
    update.mutate({ body: { ...values, legal_name: values.legal_name || null } });
  }

  const currencies = COMMON_CURRENCIES.includes(organization.currency)
    ? COMMON_CURRENCIES
    : [organization.currency, ...COMMON_CURRENCIES];

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {readOnly ? (
        <p className="mb-8 flex items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-muted">
          <Lock className="size-4 shrink-0 text-ink-subtle" />
          Only company admins can change these settings.
        </p>
      ) : null}

      <Section title="Profile" description="Shown across the app and on documents you send.">
        <div className="max-w-md space-y-4">
          <FormError message={formError} />
          <Field id="org-name" label="Name" error={errors.name?.message}>
            {(control) => <Input {...control} disabled={readOnly} {...register("name")} />}
          </Field>
          <Field
            id="org-legal-name"
            label="Legal name"
            optional
            hint="The registered company name, if it differs."
            error={errors.legal_name?.message}
          >
            {(control) => <Input {...control} disabled={readOnly} {...register("legal_name")} />}
          </Field>
        </div>
      </Section>

      <Section
        title="Regional settings"
        description="The time zone your teams work in, and the currency contracts and invoices use."
      >
        <div className="grid max-w-md gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Field id="org-timezone" label="Time zone" error={errors.timezone?.message}>
            {(control) => (
              <TimeZoneSelect
                {...control}
                current={organization.timezone}
                disabled={readOnly}
                {...register("timezone")}
              />
            )}
          </Field>
          <Field id="org-currency" label="Currency" error={errors.currency?.message}>
            {(control) => (
              <Select {...control} disabled={readOnly} {...register("currency")}>
                {currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Reference" description="Fixed details, useful when contacting support.">
        <dl className="grid max-w-md grid-cols-[8rem_minmax(0,1fr)] gap-y-2.5 text-[13px]">
          <dt className="text-ink-muted">Identifier</dt>
          <dd className="font-mono text-xs leading-5 text-ink">{organization.slug}</dd>
          <dt className="text-ink-muted">Status</dt>
          <dd>
            <Badge dot tone={organization.status === "active" ? "positive" : "caution"}>
              {organization.status === "active" ? "Active" : "Suspended"}
            </Badge>
          </dd>
          <dt className="text-ink-muted">Created</dt>
          <dd className="text-ink">{formatDate(organization.created_at, organization.timezone)}</dd>
        </dl>
      </Section>

      {readOnly ? null : (
        <div className="flex items-center justify-end gap-2 border-t border-line pt-5">
          <Button variant="ghost" disabled={!isDirty || update.isPending} onClick={() => reset()}>
            Discard changes
          </Button>
          <Button type="submit" variant="primary" disabled={!isDirty} loading={update.isPending}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
