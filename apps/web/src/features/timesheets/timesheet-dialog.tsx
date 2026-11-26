"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { ContractField } from "@/components/forms/contract-field";
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
import { Input, Select, Textarea, UnitInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useBuildingOptions, useEmployeeOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { components } from "@/lib/api/schema";
import type { Building, Employee, Timesheet } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { applyProblem, personOptions, recordOptions } from "@/lib/forms";
import { formatDay } from "@/lib/format";

import {
  TIMESHEET_FIELDS,
  timesheetBody,
  timesheetDefaults,
  timesheetSchema,
  type TimesheetValues,
} from "./timesheet-form-schema";

type Props = {
  /** The pending timesheet to edit, "new" for a blank form, or null while closed. */
  target: Timesheet | "new" | null;
  onClose: () => void;
};

export function TimesheetDialog({ target, onClose }: Props) {
  const timesheet = target === "new" ? null : target;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <DialogContent
          size="lg"
          title={timesheet ? "Edit timesheet" : "Enter a timesheet"}
          description={
            timesheet
              ? `${timesheet.employee.full_name}, ${formatDay(timesheet.work_date)} at ${timesheet.building.name}`
              : "The time one person worked at one building on one day. It waits for approval."
          }
        >
          <TimesheetDialogBody timesheet={timesheet} onDone={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type BodyProps = { timesheet: Timesheet | null; onDone: () => void };

/** The form needs the people and the buildings to choose from, so it waits for them. */
function TimesheetDialogBody(props: BodyProps) {
  const employees = useEmployeeOptions();
  const buildings = useBuildingOptions();
  if (!employees.data || !buildings.data) {
    const error = employees.error ?? buildings.error;
    return (
      <DialogBody>
        {error ? (
          <ErrorState
            className="py-8"
            message={problemMessage(error)}
            onRetry={() => {
              void employees.refetch();
              void buildings.refetch();
            }}
          />
        ) : (
          <div role="status" aria-label="Loading" className="space-y-5">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        )}
      </DialogBody>
    );
  }
  return (
    <TimesheetForm employees={employees.data.items} buildings={buildings.data.items} {...props} />
  );
}

function TimesheetForm({
  timesheet,
  employees,
  buildings,
  onDone,
}: BodyProps & { employees: Employee[]; buildings: Building[] }) {
  const me = useMe();
  const canSeeContracts = useCan("contracts:read");
  const canSeePay = useCan("employees:read_compensation");
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<TimesheetValues>({
    resolver: zodResolver(timesheetSchema),
    defaultValues: timesheetDefaults(timesheet, {
      today: todayInZone(me.organization?.timezone ?? "UTC"),
    }),
  });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isDirty, dirtyFields },
  } = form;
  const buildingId = useWatch({ control, name: "building_id" });

  // People who have left are not offered, apart from the one the timesheet is already for.
  const employeeOptions = personOptions(
    employees.filter((employee) => employee.status !== "terminated"),
    timesheet?.employee,
  );
  const buildingOptions = recordOptions(buildings, timesheet?.building);

  const onError = (error: unknown) => setFormError(applyProblem(error, setError, TIMESHEET_FIELDS));

  // The list and the counts on its tabs both show it.
  const refresh = () => invalidate(queryClient, "/api/v1/timesheets", "/api/v1/timesheets/summary");

  const create = $api.useMutation("post", "/api/v1/timesheets", {
    onSuccess: async (created) => {
      await refresh();
      toast.success(`Time entered for ${created.employee.full_name}`, {
        description: `${formatDay(created.work_date)} at ${created.building.name}. It is waiting for approval.`,
      });
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/timesheets/{timesheet_id}", {
    onSuccess: async (updated) => {
      await refresh();
      toast.success(`${updated.employee.full_name}'s timesheet was updated`);
      onDone();
    },
    onError,
  });

  function onSubmit(values: TimesheetValues) {
    setFormError(null);
    const body = timesheetBody(values, { includeContract: canSeeContracts });
    if (timesheet) {
      update.mutate({ params: { path: { timesheet_id: timesheet.id } }, body });
    } else {
      // The generated type asks for the overtime multiplier, which is the API's to set.
      create.mutate({ body: body as components["schemas"]["TimesheetCreate"] });
    }
  }

  const employeeField = register("employee_id");
  const buildingField = register("building_id");

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
        <DialogBody className="space-y-4">
          <FormError message={formError} />
          <Field id="timesheet-employee" label="Employee" error={errors.employee_id?.message}>
            {(control) => (
              <Select
                {...control}
                {...employeeField}
                onChange={(event) => {
                  void employeeField.onChange(event);
                  // New time is most often for where the person is based, until someone
                  // says otherwise.
                  const employee = employees.find((item) => item.id === event.target.value);
                  if (!timesheet && employee?.primary_building && !dirtyFields.building_id) {
                    // Checked again, so that "choose a building" goes once there is one.
                    setValue("building_id", employee.primary_building.id, {
                      shouldValidate: true,
                    });
                    setValue("contract_id", "");
                  }
                }}
              >
                <option value="">Choose an employee</option>
                {employeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={canSeeContracts ? "grid gap-4 sm:grid-cols-2" : undefined}>
            <Field id="timesheet-building" label="Building" error={errors.building_id?.message}>
              {(control) => (
                <Select
                  {...control}
                  {...buildingField}
                  onChange={(event) => {
                    void buildingField.onChange(event);
                    // A contract covers particular buildings, so the choice starts again.
                    if (canSeeContracts) setValue("contract_id", "", { shouldDirty: true });
                  }}
                >
                  <option value="">Choose a building</option>
                  {buildingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {canSeeContracts ? (
              <ContractField
                idPrefix="timesheet"
                buildingId={buildingId}
                saved={
                  timesheet
                    ? { contract: timesheet.contract, buildingId: timesheet.building.id }
                    : null
                }
              />
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="timesheet-work-date" label="Work date" error={errors.work_date?.message}>
              {(control) => <Input {...control} type="date" {...register("work_date")} />}
            </Field>
            <Field
              id="timesheet-hours-regular"
              label="Regular hours"
              error={errors.hours_regular?.message}
            >
              {(control) => (
                <UnitInput
                  {...control}
                  unit="h"
                  inputMode="decimal"
                  autoComplete="off"
                  {...register("hours_regular")}
                />
              )}
            </Field>
            <Field
              id="timesheet-hours-overtime"
              label="Overtime hours"
              optional
              error={errors.hours_overtime?.message}
            >
              {(control) => (
                <UnitInput
                  {...control}
                  unit="h"
                  inputMode="decimal"
                  autoComplete="off"
                  {...register("hours_overtime")}
                />
              )}
            </Field>
          </div>
          <Field id="timesheet-notes" label="Notes" optional error={errors.notes?.message}>
            {(control) => <Textarea {...control} rows={2} {...register("notes")} />}
          </Field>
          {canSeePay ? (
            <p className="text-[13px] text-ink-muted">
              The labor cost is worked out from these hours and the employee&apos;s rate when the
              timesheet is saved.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            variant="primary"
            disabled={timesheet !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {timesheet ? "Save changes" : "Enter timesheet"}
          </Button>
        </DialogFooter>
      </form>
    </FormProvider>
  );
}
