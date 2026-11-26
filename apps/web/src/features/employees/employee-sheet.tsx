"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { FormSection } from "@/components/ui/form-section";
import { Input, Select, Textarea, UnitInput } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetLoading,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/states";
import { useJobRoleOptions, useSupervisorOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Employee, JobRole } from "@/lib/api/types";
import { applyProblem, recordOptions } from "@/lib/forms";
import { formatMoney } from "@/lib/format";

import {
  EMPLOYEE_FIELDS,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  employeeBody,
  employeeDefaults,
  employeeSchema,
  supervisorGroups,
  type EmployeeValues,
} from "./employee-form-schema";

type Props = {
  /** The employee to edit, "new" for a blank form, or null while closed. */
  target: Employee | "new" | null;
  onClose: () => void;
};

export function EmployeeSheet({ target, onClose }: Props) {
  const employee = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={employee ? employee.full_name : "New employee"}
          description={
            employee
              ? `Employee ${employee.employee_number}`
              : "Someone who works for you. Assign them to buildings once they are saved."
          }
        >
          <EmployeeSheetBody employee={employee} onDone={onClose} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

type BodyProps = { employee: Employee | null; onDone: () => void };

/**
 * The form needs the job roles and the supervisors to choose from, so it waits for them.
 * Once it has them it stays: a later refresh that fails must not take the form away.
 */
function EmployeeSheetBody(props: BodyProps) {
  const jobRoles = useJobRoleOptions();
  const supervisors = useSupervisorOptions();
  if (!jobRoles.data || !supervisors.data) {
    const error = jobRoles.error ?? supervisors.error;
    if (!error) return <SheetLoading />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(error)}
          onRetry={() => {
            void jobRoles.refetch();
            void supervisors.refetch();
          }}
        />
      </SheetBody>
    );
  }
  return (
    <EmployeeForm jobRoles={jobRoles.data.items} supervisors={supervisors.data.items} {...props} />
  );
}

function EmployeeForm({
  employee,
  jobRoles,
  supervisors,
  onDone,
}: BodyProps & { jobRoles: JobRole[]; supervisors: Employee[] }) {
  const me = useMe();
  const canSeePay = useCan("employees:read_compensation");
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    control,
    formState: { errors, isDirty },
  } = useForm<EmployeeValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employeeDefaults(employee),
  });
  const jobRoleId = useWatch({ control, name: "job_role_id" });
  const status = useWatch({ control, name: "status" });

  const currency = me.organization?.currency ?? "USD";
  const jobRoleOptions = recordOptions(jobRoles, employee?.job_role);
  const supervisorOptions = supervisorGroups(supervisors, employee);
  const jobRole = jobRoles.find((role) => role.id === jobRoleId);
  const defaultRate = (roleId: string) =>
    jobRoles.find((role) => role.id === roleId)?.default_hourly_rate ?? "";

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, EMPLOYEE_FIELDS));

  // An employee counts towards their job role and may be offered as a supervisor.
  const refresh = () => invalidate(queryClient, "/api/v1/employees", "/api/v1/job-roles");

  const create = $api.useMutation("post", "/api/v1/employees", {
    onSuccess: async (created) => {
      await refresh();
      toast.success(`${created.full_name} was added`, {
        description: `Employee ${created.employee_number}`,
      });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/employees/{employee_id}", {
    onSuccess: async (updated) => {
      await refresh();
      toast.success(`${updated.full_name} was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: EmployeeValues) {
    setFormError(null);
    const body = employeeBody(values, { includeRate: canSeePay });
    if (employee) {
      update.mutate({ params: { path: { employee_id: employee.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  const jobRoleField = register("job_role_id");

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <FormError message={formError} />
        <div className="space-y-6">
          <FormSection title="Employee">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="employee-first-name" label="First name" error={errors.first_name?.message}>
                {(control) => <Input {...control} autoComplete="off" {...register("first_name")} />}
              </Field>
              <Field id="employee-last-name" label="Last name" error={errors.last_name?.message}>
                {(control) => <Input {...control} autoComplete="off" {...register("last_name")} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="employee-email" label="Email" optional error={errors.email?.message}>
                {(control) => (
                  <Input {...control} type="email" autoComplete="off" {...register("email")} />
                )}
              </Field>
              <Field id="employee-phone" label="Phone" optional error={errors.phone?.message}>
                {(control) => (
                  <Input {...control} type="tel" autoComplete="off" {...register("phone")} />
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="employee-number"
                label="Employee number"
                optional={!employee}
                hint={employee ? undefined : "Leave blank to generate the next one."}
                error={errors.employee_number?.message}
              >
                {(control) => (
                  <Input
                    {...control}
                    className="font-mono text-[13px] uppercase"
                    autoComplete="off"
                    {...register("employee_number")}
                  />
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Employment">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="employee-job-role"
                label="Job role"
                hint={
                  jobRoleOptions.length === 0
                    ? "There are no job roles yet. Add one first."
                    : undefined
                }
                error={errors.job_role_id?.message}
              >
                {(control) => (
                  <Select
                    {...control}
                    {...jobRoleField}
                    onChange={(event) => {
                      const previous = getValues("job_role_id");
                      void jobRoleField.onChange(event);
                      // A new hire starts on the role's rate, unless another was typed in.
                      const rate = getValues("hourly_rate");
                      if (
                        !employee &&
                        canSeePay &&
                        (rate === "" || rate === defaultRate(previous))
                      ) {
                        setValue("hourly_rate", defaultRate(event.target.value), {
                          shouldValidate: true,
                        });
                      }
                    }}
                  >
                    <option value="">Choose a job role</option>
                    {jobRoleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id="employee-type"
                label="Employment type"
                error={errors.employment_type?.message}
              >
                {(control) => (
                  <Select {...control} {...register("employment_type")}>
                    {EMPLOYMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {EMPLOYMENT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="employee-supervisor"
                label="Supervisor"
                optional
                error={errors.supervisor_id?.message}
              >
                {(control) => (
                  <Select {...control} {...register("supervisor_id")}>
                    <option value="">No supervisor</option>
                    {supervisorOptions.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="employee-status" label="Status" error={errors.status?.message}>
                {(control) => (
                  <Select {...control} {...register("status")}>
                    {EMPLOYEE_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {EMPLOYEE_STATUS_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="employee-hire-date"
                label="Hire date"
                optional
                error={errors.hire_date?.message}
              >
                {(control) => <Input {...control} type="date" {...register("hire_date")} />}
              </Field>
              <Field
                id="employee-termination-date"
                label="Termination date"
                optional
                hint={status === "terminated" ? "Left blank, today is used." : undefined}
                error={errors.termination_date?.message}
              >
                {(control) => <Input {...control} type="date" {...register("termination_date")} />}
              </Field>
            </div>
            {canSeePay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="employee-hourly-rate"
                  label="Hourly rate"
                  optional
                  hint={
                    jobRole?.default_hourly_rate
                      ? `${jobRole.name} starts at ${formatMoney(jobRole.default_hourly_rate, currency)}.`
                      : undefined
                  }
                  error={errors.hourly_rate?.message}
                >
                  {(control) => (
                    <UnitInput
                      {...control}
                      unit={currency}
                      inputMode="decimal"
                      autoComplete="off"
                      {...register("hourly_rate")}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </FormSection>

          <FormSection title="Notes">
            <Field
              id="employee-notes"
              label="Notes"
              labelHidden
              hint="Anything your team should know about this employee."
              error={errors.notes?.message}
            >
              {(control) => <Textarea {...control} rows={3} {...register("notes")} />}
            </Field>
          </FormSection>
        </div>
      </SheetBody>
      <SheetFooter>
        <SheetClose asChild>
          <Button variant="ghost">Cancel</Button>
        </SheetClose>
        <Button
          type="submit"
          variant="primary"
          disabled={employee !== null && !isDirty}
          loading={create.isPending || update.isPending}
        >
          {employee ? "Save changes" : "Create employee"}
        </Button>
      </SheetFooter>
    </form>
  );
}
