"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { ContractField } from "@/components/forms/contract-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { FormSection } from "@/components/ui/form-section";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetLoading,
} from "@/components/ui/sheet";
import { ErrorState } from "@/components/ui/states";
import { useBuildingOptions, useEmployeeOptions, useVendorOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { Building, Employee, Vendor, WorkOrder, WorkOrderDetail } from "@/lib/api/types";
import { applyProblem, recordOptions } from "@/lib/forms";

import {
  assigneeGroups,
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_FIELDS,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_SOURCE_LABELS,
  WORK_ORDER_SOURCES,
  workOrderBody,
  workOrderDefaults,
  workOrderSchema,
  type WorkOrderValues,
} from "./work-order-form-schema";
import { workOrderQuery } from "./work-order-query";

type Props = {
  /** The work order to edit, "new" for a blank form, or null while closed. */
  target: WorkOrder | "new" | null;
  /** The building a new work order starts with: the one the list is filtered to, if any. */
  defaultBuildingId?: string;
  onClose: () => void;
  /** Called with the work order as the API returned it, after it is saved. */
  onSaved?: (workOrder: WorkOrderDetail) => void;
};

export function WorkOrderSheet({ target, defaultBuildingId, onClose, onSaved }: Props) {
  const workOrder = target === "new" ? null : target;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      {target ? (
        <SheetContent
          title={workOrder ? workOrder.title : "New work order"}
          description={
            workOrder
              ? `Work order ${workOrder.number}`
              : "A job to be done at a building. It starts as open and is given the next number."
          }
        >
          <WorkOrderSheetBody
            workOrder={workOrder}
            defaultBuildingId={defaultBuildingId}
            onDone={onClose}
            onSaved={onSaved}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

type BodyProps = {
  workOrder: WorkOrder | null;
  defaultBuildingId?: string;
  onDone: () => void;
  onSaved?: (workOrder: WorkOrderDetail) => void;
};

/**
 * The form needs the buildings to choose from, and the people and vendors the work can
 * be given to, so it waits for them. Once it has them it stays: a later refresh that fails
 * must not take the form away.
 */
function WorkOrderSheetBody(props: BodyProps) {
  const canSeeEmployees = useCan("employees:read");
  const canSeeVendors = useCan("vendors:read");
  const buildings = useBuildingOptions();
  const employees = useEmployeeOptions({ enabled: canSeeEmployees });
  const vendors = useVendorOptions({ enabled: canSeeVendors });

  const waiting =
    !buildings.data || (canSeeEmployees && !employees.data) || (canSeeVendors && !vendors.data);
  if (waiting) {
    const error = buildings.error ?? employees.error ?? vendors.error;
    if (!error) return <SheetLoading />;
    return (
      <SheetBody>
        <ErrorState
          message={problemMessage(error)}
          onRetry={() => {
            void buildings.refetch();
            if (canSeeEmployees) void employees.refetch();
            if (canSeeVendors) void vendors.refetch();
          }}
        />
      </SheetBody>
    );
  }
  return (
    <WorkOrderForm
      buildings={buildings.data?.items ?? []}
      employees={canSeeEmployees ? (employees.data?.items ?? []) : null}
      vendors={canSeeVendors ? (vendors.data?.items ?? []) : null}
      {...props}
    />
  );
}

type FormProps = BodyProps & {
  buildings: Building[];
  /** Null for someone who may not read employees: the assignee is then left as it is. */
  employees: Employee[] | null;
  /** Null for someone who may not read vendors: the vendor is then left as it is. */
  vendors: Vendor[] | null;
};

function WorkOrderForm({
  workOrder,
  defaultBuildingId,
  buildings,
  employees,
  vendors,
  onDone,
  onSaved,
}: FormProps) {
  const me = useMe();
  const canSeeContracts = useCan("contracts:read");
  const queryClient = useQueryClient();
  const timeZone = me.organization?.timezone ?? "UTC";
  const [formError, setFormError] = useState<string | null>(null);
  const [opened] = useState(() =>
    workOrderDefaults(workOrder, { timeZone, buildingId: defaultBuildingId }),
  );
  const form = useForm<WorkOrderValues>({
    resolver: zodResolver(workOrderSchema),
    defaultValues: opened,
  });
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isDirty },
  } = form;
  const buildingId = useWatch({ control, name: "building_id" });

  // The people at the chosen building come first among those the work can be given to.
  const atBuilding = useEmployeeOptions({
    buildingId,
    enabled: employees !== null && buildingId !== "",
  });

  const buildingOptions = recordOptions(buildings, workOrder?.building);
  const building = buildingOptions.find((option) => option.value === buildingId);
  const assignees = employees
    ? assigneeGroups(
        buildingId === "" ? [] : (atBuilding.data?.items ?? []),
        employees,
        workOrder?.assigned_employee ?? null,
        building?.label,
      )
    : [];
  const vendorOptions = vendors ? recordOptions(vendors, workOrder?.vendor) : [];

  const onError = (error: unknown) =>
    setFormError(applyProblem(error, setError, WORK_ORDER_FIELDS));

  const create = $api.useMutation("post", "/api/v1/work-orders", {
    onSuccess: async (created) => {
      await invalidate(queryClient, "/api/v1/work-orders");
      toast.success(`${created.number} was added`, {
        description: `${created.title} at ${created.building.name}`,
      });
      onSaved?.(created);
      onDone();
    },
    onError,
  });

  const update = $api.useMutation("patch", "/api/v1/work-orders/{work_order_id}", {
    onSuccess: async (updated) => {
      // The drawer it may have been opened from shows it as saved straight away.
      queryClient.setQueryData(workOrderQuery(updated.id).queryKey, updated);
      await invalidate(queryClient, "/api/v1/work-orders");
      toast.success(`${updated.number} was updated`);
      onSaved?.(updated);
      onDone();
    },
    onError,
  });

  function onSubmit(values: WorkOrderValues) {
    setFormError(null);
    const body = workOrderBody(values, {
      timeZone,
      offered: {
        contract: canSeeContracts,
        assignee: employees !== null,
        vendor: vendors !== null,
      },
      opened: workOrder ? opened : null,
    });
    if (workOrder) {
      update.mutate({ params: { path: { work_order_id: workOrder.id } }, body });
    } else {
      create.mutate({ body });
    }
  }

  const buildingField = register("building_id");

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <FormError message={formError} />
          <div className="space-y-6">
            <FormSection title="Work order">
              <Field
                id="work-order-title"
                label="Title"
                hint="What needs doing, such as Replace the lamps in the east stairwell."
                error={errors.title?.message}
              >
                {(control) => <Input {...control} autoComplete="off" {...register("title")} />}
              </Field>
              <Field
                id="work-order-description"
                label="Description"
                optional
                error={errors.description?.message}
              >
                {(control) => <Textarea {...control} rows={3} {...register("description")} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="work-order-category" label="Category" error={errors.category?.message}>
                  {(control) => (
                    <Select {...control} {...register("category")}>
                      {WORK_ORDER_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {WORK_ORDER_CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="work-order-priority" label="Priority" error={errors.priority?.message}>
                  {(control) => (
                    <Select {...control} {...register("priority")}>
                      {WORK_ORDER_PRIORITIES.map((priority) => (
                        <option key={priority} value={priority}>
                          {WORK_ORDER_PRIORITY_LABELS[priority]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="work-order-source" label="Source" error={errors.source?.message}>
                  {(control) => (
                    <Select {...control} {...register("source")}>
                      {WORK_ORDER_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {WORK_ORDER_SOURCE_LABELS[source]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  id="work-order-requested-by"
                  label="Requested by"
                  optional
                  error={errors.requested_by?.message}
                >
                  {(control) => (
                    <Input {...control} autoComplete="off" {...register("requested_by")} />
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection title="Building and billing">
              <Field
                id="work-order-building"
                label="Building"
                hint={
                  buildingOptions.length === 0
                    ? "There are no buildings yet. Add the building first."
                    : undefined
                }
                error={errors.building_id?.message}
              >
                {(control) => (
                  <Select
                    {...control}
                    {...buildingField}
                    onChange={(event) => {
                      void buildingField.onChange(event);
                      // A contract covers particular buildings, so the choice starts again.
                      if (canSeeContracts) {
                        setValue("contract_id", "", { shouldDirty: true });
                      }
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
                  idPrefix="work-order"
                  buildingId={buildingId}
                  saved={
                    workOrder
                      ? { contract: workOrder.contract, buildingId: workOrder.building.id }
                      : null
                  }
                />
              ) : null}
              <Checkbox
                label="Billable"
                description="The work can be charged to the customer."
                {...register("billable")}
              />
            </FormSection>

            <FormSection title="Who and when">
              {employees || vendors ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {employees ? (
                    <Field
                      id="work-order-assignee"
                      label="Assigned to"
                      optional
                      error={errors.assigned_employee_id?.message}
                    >
                      {(control) => (
                        <Select {...control} {...register("assigned_employee_id")}>
                          <option value="">Nobody yet</option>
                          {assignees.map((group) => (
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
                  ) : null}
                  {vendors ? (
                    <Field
                      id="work-order-vendor"
                      label="Vendor"
                      optional
                      error={errors.vendor_id?.message}
                    >
                      {(control) => (
                        <Select {...control} {...register("vendor_id")}>
                          <option value="">No vendor</option>
                          {vendorOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="work-order-due" label="Due" optional error={errors.due_on?.message}>
                  {(control) => <Input {...control} type="date" {...register("due_on")} />}
                </Field>
                <Field
                  id="work-order-scheduled"
                  label="Scheduled for"
                  optional
                  hint={`In ${timeZone.replace(/_/g, " ")} time.`}
                  error={errors.scheduled_for?.message}
                >
                  {(control) => (
                    <Input {...control} type="datetime-local" {...register("scheduled_for")} />
                  )}
                </Field>
              </div>
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
            disabled={workOrder !== null && !isDirty}
            loading={create.isPending || update.isPending}
          >
            {workOrder ? "Save changes" : "Create work order"}
          </Button>
        </SheetFooter>
      </form>
    </FormProvider>
  );
}
