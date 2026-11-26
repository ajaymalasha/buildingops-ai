"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";

import { useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input, Select } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetLoading,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/states";
import { BUILDING_STATUS_LABELS } from "@/features/buildings/building-form-schema";
import { useBuildingOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Assignment, Building, Employee } from "@/lib/api/types";
import { todayInZone } from "@/lib/dates";
import { applyProblem } from "@/lib/forms";
import { formatDay } from "@/lib/format";

import {
  assignSchema,
  endAssignmentSchema,
  splitAssignments,
  type AssignValues,
  type EndAssignmentValues,
} from "./employee-form-schema";

type Props = {
  /** The employee whose buildings to show, or null while closed. */
  employee: Employee | null;
  onClose: () => void;
};

/**
 * Where an employee works: the one place their building assignments are seen and changed.
 *
 * Unlike the forms in the other drawers, each change here is saved as it is made, and the
 * lists in the drawer are the confirmation. A toast would sit on top of the drawer's own
 * buttons, so what happened is announced to screen readers from inside it instead.
 */
export function EmployeeBuildingsSheet({ employee, onClose }: Props) {
  return (
    <Sheet open={employee !== null} onOpenChange={(open) => !open && onClose()}>
      {employee ? (
        <SheetContent
          title="Building assignments"
          description={`${employee.full_name} · ${employee.job_role.name} · ${employee.employee_number}`}
        >
          <Assignments employee={employee} />
          <SheetFooter>
            <SheetClose asChild>
              <Button>Done</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function Assignments({ employee }: { employee: Employee }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [announcement, setAnnouncement] = useState("");
  const detail = $api.useQuery("get", "/api/v1/employees/{employee_id}", {
    params: { path: { employee_id: employee.id } },
  });
  const buildings = useBuildingOptions();

  if (!detail.data || !buildings.data) {
    const error = detail.error ?? buildings.error;
    if (!error) return <SheetLoading fields={4} />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(error)}
          onRetry={() => {
            void detail.refetch();
            void buildings.refetch();
          }}
        />
      </SheetBody>
    );
  }

  // Assignments start and end on calendar days, where the organization is.
  const today = todayInZone(me.organization?.timezone ?? "UTC");
  const { current, past } = splitAssignments(detail.data.assignments);
  const assigned = new Set(current.map((assignment) => assignment.building.id));
  const available = buildings.data.items.filter((building) => !assigned.has(building.id));

  // The employee list shows each person's primary building and can be filtered by building.
  const onChanged = async (message: string) => {
    await invalidate(queryClient, "/api/v1/employees/{employee_id}", "/api/v1/employees");
    setAnnouncement(message);
  };

  return (
    <SheetBody className="space-y-7">
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <section aria-labelledby="assignments-current">
        <h3 id="assignments-current" className="eyebrow">
          Current buildings
        </h3>
        {current.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            {employee.first_name} is not assigned to a building.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-md border border-line">
            {current.map((assignment) => (
              <CurrentAssignment
                key={assignment.id}
                employee={employee}
                assignment={assignment}
                today={today}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="assignments-new">
        <h3 id="assignments-new" className="eyebrow">
          Assign to a building
        </h3>
        {available.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-muted">
            {buildings.data.items.length === 0
              ? "There are no buildings yet. Add one first."
              : `${employee.first_name} is already assigned to every building.`}
          </p>
        ) : (
          <AssignForm
            // A fresh form after every change: its defaults depend on what is assigned now.
            key={current.map((assignment) => `${assignment.id}:${assignment.is_primary}`).join()}
            employee={employee}
            buildings={available}
            hasPrimary={current.some((assignment) => assignment.is_primary)}
            today={today}
            onChanged={onChanged}
          />
        )}
      </section>

      {past.length > 0 ? (
        <section aria-labelledby="assignments-past">
          <h3 id="assignments-past" className="eyebrow">
            Past assignments
          </h3>
          <ul className="mt-3 space-y-1.5 text-[13px] text-ink-muted">
            {past.map((assignment) => (
              <li key={assignment.id} className="flex items-baseline justify-between gap-4">
                <span className="truncate">{assignment.building.name}</span>
                <span className="shrink-0 text-xs text-ink-subtle tabular-nums">
                  {formatDay(assignment.starts_on)} – {formatDay(assignment.ends_on!)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SheetBody>
  );
}

type CurrentAssignmentProps = {
  employee: Employee;
  assignment: Assignment;
  today: string;
  /** Called after a change is saved, with a sentence saying what happened. */
  onChanged: (message: string) => Promise<void>;
};

function CurrentAssignment({ employee, assignment, today, onChanged }: CurrentAssignmentProps) {
  const nameId = useId();
  const [ending, setEnding] = useState(false);
  const building = assignment.building.name;

  const makePrimary = $api.useMutation(
    "patch",
    "/api/v1/employees/{employee_id}/assignments/{assignment_id}",
    {
      onSuccess: () => onChanged(`${building} is now ${employee.full_name}'s primary building.`),
    },
  );

  return (
    <li className="px-3.5 py-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span id={nameId} className="truncate font-medium text-ink">
              {building}
            </span>
            {assignment.is_primary ? <Badge tone="brand">Primary</Badge> : null}
          </p>
          <p className="text-xs text-ink-muted">
            {assignment.starts_on > today ? "Starts" : "Since"} {formatDay(assignment.starts_on)}
          </p>
        </div>
        {ending ? null : (
          <>
            {assignment.is_primary ? null : (
              <Button
                size="sm"
                aria-describedby={nameId}
                loading={makePrimary.isPending}
                onClick={() =>
                  makePrimary.mutate({
                    params: { path: { employee_id: employee.id, assignment_id: assignment.id } },
                    body: { is_primary: true },
                  })
                }
              >
                Make primary
              </Button>
            )}
            <Button size="sm" aria-describedby={nameId} onClick={() => setEnding(true)}>
              End
            </Button>
          </>
        )}
      </div>
      {makePrimary.error ? (
        <div className="mt-3">
          <FormError message={problemMessage(makePrimary.error)} />
        </div>
      ) : null}
      {ending ? (
        <EndAssignmentForm
          employee={employee}
          assignment={assignment}
          today={today}
          onChanged={onChanged}
          onCancel={() => setEnding(false)}
        />
      ) : null}
    </li>
  );
}

function EndAssignmentForm({
  employee,
  assignment,
  today,
  onChanged,
  onCancel,
}: CurrentAssignmentProps & { onCancel: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EndAssignmentValues>({
    resolver: zodResolver(endAssignmentSchema),
    // Today, unless the assignment has not started yet.
    defaultValues: { ends_on: today > assignment.starts_on ? today : assignment.starts_on },
  });

  const end = $api.useMutation(
    "patch",
    "/api/v1/employees/{employee_id}/assignments/{assignment_id}",
    {
      onSuccess: () =>
        onChanged(`${employee.full_name}'s assignment to ${assignment.building.name} was ended.`),
      onError: (error) => setFormError(applyProblem(error, setError, ["ends_on"])),
    },
  );

  function onSubmit(values: EndAssignmentValues) {
    setFormError(null);
    end.mutate({
      params: { path: { employee_id: employee.id, assignment_id: assignment.id } },
      body: { ends_on: values.ends_on },
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-3 space-y-3">
      <FormError message={formError} />
      <div className="flex flex-wrap items-start gap-2">
        <Field
          id={`assignment-end-${assignment.id}`}
          label="Last day"
          labelHidden
          hint={`The last day ${employee.first_name} works at ${assignment.building.name}.`}
          error={errors.ends_on?.message}
          className="min-w-44 flex-1"
        >
          {(control) => (
            <Input {...control} type="date" min={assignment.starts_on} {...register("ends_on")} />
          )}
        </Field>
        <Button type="submit" variant="primary" loading={end.isPending}>
          End assignment
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type AssignFormProps = {
  employee: Employee;
  /** The buildings they are not already assigned to. */
  buildings: Building[];
  hasPrimary: boolean;
  today: string;
  onChanged: (message: string) => Promise<void>;
};

function AssignForm({ employee, buildings, hasPrimary, today, onChanged }: AssignFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AssignValues>({
    resolver: zodResolver(assignSchema),
    // Someone with no primary building most likely needs this one to be it.
    defaultValues: { building_id: "", starts_on: today, is_primary: !hasPrimary },
  });

  const assign = $api.useMutation("post", "/api/v1/employees/{employee_id}/assignments", {
    onSuccess: (created) =>
      onChanged(`${employee.full_name} was assigned to ${created.building.name}.`),
    onError: (error) =>
      setFormError(applyProblem(error, setError, ["building_id", "starts_on", "is_primary"])),
  });

  function onSubmit(values: AssignValues) {
    setFormError(null);
    assign.mutate({ params: { path: { employee_id: employee.id } }, body: values });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-3 space-y-4">
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field id="assignment-building" label="Building" error={errors.building_id?.message}>
          {(control) => (
            <Select {...control} {...register("building_id")}>
              <option value="">Choose a building</option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.status === "active"
                    ? building.name
                    : `${building.name} (${BUILDING_STATUS_LABELS[building.status].toLowerCase()})`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="assignment-starts-on" label="First day" error={errors.starts_on?.message}>
          {(control) => <Input {...control} type="date" {...register("starts_on")} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <Checkbox
          label="Primary building"
          description={
            hasPrimary
              ? "Where they are based. It takes the place of their current primary building."
              : "Where they are based. An employee has one primary building at a time."
          }
          className="max-w-sm"
          {...register("is_primary")}
        />
        <Button type="submit" loading={assign.isPending}>
          Assign
        </Button>
      </div>
    </form>
  );
}
