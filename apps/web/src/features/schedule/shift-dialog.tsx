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
import { Input, Select, Textarea, UnitInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { useEmployeeOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Employee, Shift } from "@/lib/api/types";
import { applyProblem, personOptions } from "@/lib/forms";

import { shiftWhen } from "./roster";
import {
  changedShiftBody,
  endsNextDay,
  newShiftBody,
  SHIFT_FIELDS,
  shiftDefaults,
  shiftSchema,
  type ShiftValues,
} from "./shift-form-schema";

type Props = {
  /** The shift to edit, "new" for a blank form, or null while closed. */
  target: Shift | "new" | null;
  /** The building whose schedule is on show. A shift is added there. */
  building: { id: string; name: string };
  /** The day a new shift starts on, until another is chosen. */
  defaultDate: string;
  onClose: () => void;
  /** Asks to cancel the shift being edited, which is offered while it is still scheduled. */
  onCancelShift: (shift: Shift) => void;
};

export function ShiftDialog({ target, building, defaultDate, onClose, onCancelShift }: Props) {
  const shift = target === "new" ? null : target;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <DialogContent
          title={shift ? "Edit shift" : "Add shift"}
          description={
            shift
              ? `${shift.employee.full_name} at ${shift.building.name}`
              : `A shift at ${building.name} for someone assigned there.`
          }
        >
          <ShiftDialogBody
            shift={shift}
            building={shift?.building ?? building}
            defaultDate={defaultDate}
            onDone={onClose}
            onCancelShift={onCancelShift}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type BodyProps = {
  shift: Shift | null;
  building: { id: string; name: string };
  defaultDate: string;
  onDone: () => void;
  onCancelShift: (shift: Shift) => void;
};

/** The form offers the people assigned to the building, so it waits for them. */
function ShiftDialogBody(props: BodyProps) {
  const employees = useEmployeeOptions({ buildingId: props.building.id });
  if (!employees.data) {
    return (
      <DialogBody>
        {employees.error ? (
          <ErrorState
            className="py-8"
            message={problemMessage(employees.error)}
            onRetry={() => void employees.refetch()}
          />
        ) : (
          <div role="status" aria-label="Loading" className="space-y-5">
            {Array.from({ length: 3 }, (_, index) => (
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
  return <ShiftForm employees={employees.data.items} {...props} />;
}

function ShiftForm({
  shift,
  building,
  defaultDate,
  employees,
  onDone,
  onCancelShift,
}: BodyProps & { employees: Employee[] }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const timeZone = me.organization?.timezone ?? "UTC";
  const [formError, setFormError] = useState<string | null>(null);
  const [opened] = useState(() => shiftDefaults(shift, { timeZone, date: defaultDate }));
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isDirty },
  } = useForm<ShiftValues>({ resolver: zodResolver(shiftSchema), defaultValues: opened });
  const startsAt = useWatch({ control, name: "starts_at" });
  const endsAt = useWatch({ control, name: "ends_at" });

  const employeeOptions = personOptions(employees, shift?.employee);

  // The API reports an overlap on the start time. It concerns the whole shift, so it is
  // shown above the form, where its explanation has room to be read.
  const onError = (error: unknown) => setFormError(applyProblem(error, setError, SHIFT_FIELDS));

  const onSaved = async (saved: Shift, message: string) => {
    await invalidate(queryClient, "/api/v1/shifts");
    toast.success(message, {
      description: `${saved.employee.full_name} · ${shiftWhen(saved, timeZone)}`,
    });
    onDone();
  };

  const create = $api.useMutation("post", "/api/v1/shifts", {
    onSuccess: (created) => onSaved(created, "Shift added"),
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/shifts/{shift_id}", {
    onSuccess: (updated) => onSaved(updated, "Shift updated"),
    onError,
  });

  function onSubmit(values: ShiftValues) {
    setFormError(null);
    const where = { buildingId: building.id, timeZone };
    if (shift) {
      update.mutate({
        params: { path: { shift_id: shift.id } },
        body: changedShiftBody(values, opened, where),
      });
      return;
    }
    const body = newShiftBody(values, where);
    if (body) create.mutate({ body });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
      <DialogBody className="space-y-4">
        <FormError message={formError} />
        <Field
          id="shift-employee"
          label="Employee"
          hint={
            employeeOptions.length === 0
              ? `Nobody is assigned to ${building.name} yet. Assign people to it from the employee list.`
              : undefined
          }
          error={errors.employee_id?.message}
        >
          {(control) => (
            <Select {...control} {...register("employee_id")}>
              <option value="">Choose an employee</option>
              {employeeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="shift-date" label="Date" error={errors.date?.message}>
          {(control) => <Input {...control} type="date" {...register("date")} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="shift-starts-at" label="Starts" error={errors.starts_at?.message}>
            {(control) => <Input {...control} type="time" {...register("starts_at")} />}
          </Field>
          <Field
            id="shift-ends-at"
            label="Ends"
            hint={
              endsNextDay({ starts_at: startsAt, ends_at: endsAt }) ? "The next day." : undefined
            }
            error={errors.ends_at?.message}
          >
            {(control) => <Input {...control} type="time" {...register("ends_at")} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="shift-break"
            label="Break"
            hint="Unpaid, and taken off the hours."
            error={errors.break_minutes?.message}
          >
            {(control) => (
              <UnitInput
                {...control}
                unit="min"
                inputMode="numeric"
                autoComplete="off"
                {...register("break_minutes")}
              />
            )}
          </Field>
        </div>
        <Field id="shift-notes" label="Notes" optional error={errors.notes?.message}>
          {(control) => <Textarea {...control} rows={2} {...register("notes")} />}
        </Field>
      </DialogBody>
      <DialogFooter className={shift?.status === "scheduled" ? "justify-between" : undefined}>
        {shift?.status === "scheduled" ? (
          <Button
            variant="ghost"
            className="-ml-2 text-critical hover:bg-critical-soft hover:text-critical"
            onClick={() => onCancelShift(shift)}
          >
            Cancel shift
          </Button>
        ) : null}
        <div className="flex items-center gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{shift ? "Close" : "Cancel"}</Button>
          </DialogClose>
          <Button
            type="submit"
            variant="primary"
            disabled={shift !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {shift ? "Save changes" : "Add shift"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
