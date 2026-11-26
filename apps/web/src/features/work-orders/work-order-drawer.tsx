"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { useCan, useMe } from "@/components/me-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Blank } from "@/components/ui/cells";
import { Detail, DetailList } from "@/components/ui/detail-list";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { problemMessage } from "@/lib/api/problem";
import type { WorkOrder, WorkOrderDetail } from "@/lib/api/types";
import { fromDateTimeInput, toDateTimeInput, todayInZone } from "@/lib/dates";
import { blankToNull, optionalText } from "@/lib/form-fields";
import { applyProblem } from "@/lib/forms";
import { formatDateTime, formatDay, formatOverdue } from "@/lib/format";

import {
  WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_PRIORITY_TONES,
  WORK_ORDER_SOURCE_LABELS,
} from "./work-order-form-schema";
import { workOrderQuery } from "./work-order-query";
import {
  activitySummary,
  BACKLOG_STATUSES,
  statusMoves,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_TONES,
  type StatusMove,
} from "./work-order-status";

type Props = {
  /** The work order to show, as the list has it, or null while closed. */
  workOrder: WorkOrder | null;
  onClose: () => void;
  /** Opens the form for the work order. Offered to people who may change it. */
  onEdit: (workOrder: WorkOrder) => void;
};

/**
 * A work order, opened from the list: what it is, where it stands and everything that has
 * happened to it.
 *
 * Moving it on and commenting are saved as they are made, and the drawer itself is the
 * confirmation: the status changes and the history gains an entry. What happened is
 * announced to screen readers from inside it.
 */
export function WorkOrderDrawer({ workOrder, onClose, onEdit }: Props) {
  return (
    <Sheet open={workOrder !== null} onOpenChange={(open) => !open && onClose()}>
      {workOrder ? (
        <SheetContent
          reading
          title={workOrder.title}
          description={`Work order ${workOrder.number} · ${workOrder.building.name}`}
        >
          <WorkOrderView listed={workOrder} onEdit={onEdit} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function WorkOrderView({ listed, onEdit }: { listed: WorkOrder; onEdit: Props["onEdit"] }) {
  const me = useMe();
  const canWrite = useCan("work_orders:write");
  const queryClient = useQueryClient();
  const timeZone = me.organization?.timezone ?? "UTC";
  const [moving, setMoving] = useState<StatusMove | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const moveButtons = useRef<HTMLDivElement>(null);
  const hadMoveForm = useRef(false);

  // The buttons for the moves give way to a form, and come back when it closes. Each time
  // the control that had the keyboard is gone, so the keyboard is put on the first of
  // the moves on offer rather than left on nothing.
  useEffect(() => {
    if (hadMoveForm.current && !moving) moveButtons.current?.querySelector("button")?.focus();
    hadMoveForm.current = moving !== null;
  }, [moving]);

  const detail = useQuery(workOrderQuery(listed.id));
  // The list's row has everything but the history, so there is something to read at once.
  const workOrder: WorkOrder = detail.data ?? listed;
  const moves = statusMoves(workOrder.status);
  const inBacklog = BACKLOG_STATUSES.includes(workOrder.status);

  // The list shows the status and who has the work, so it follows every change made here.
  const onChanged = async (message: string) => {
    await invalidate(queryClient, "/api/v1/work-orders/{work_order_id}", "/api/v1/work-orders");
    setMoving(null);
    setAnnouncement(message);
  };

  const when = (instant: string | null, missing: string) =>
    instant ? (
      <span className="tabular-nums">{formatDateTime(instant, timeZone)}</span>
    ) : (
      <Blank label={missing} />
    );

  return (
    <>
      <SheetBody className="space-y-7">
        <p role="status" className="sr-only">
          {announcement}
        </p>

        <section aria-labelledby="work-order-status" className="space-y-3">
          <h3 id="work-order-status" className="sr-only">
            Status
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Badge dot tone={WORK_ORDER_STATUS_TONES[workOrder.status]}>
              {WORK_ORDER_STATUS_LABELS[workOrder.status]}
            </Badge>
            <Badge tone={WORK_ORDER_PRIORITY_TONES[workOrder.priority]}>
              {WORK_ORDER_PRIORITY_LABELS[workOrder.priority]} priority
            </Badge>
            {workOrder.is_overdue && workOrder.due_on ? (
              <span className="text-xs font-medium text-critical">
                {formatOverdue(workOrder.due_on, todayInZone(timeZone))}
              </span>
            ) : null}
          </div>
          {canWrite && moving ? (
            <MoveForm
              key={moving.to}
              workOrder={workOrder}
              move={moving}
              timeZone={timeZone}
              onMoved={() =>
                onChanged(
                  `${workOrder.number} is now ${WORK_ORDER_STATUS_LABELS[moving.to].toLowerCase()}.`,
                )
              }
              onCancel={() => setMoving(null)}
            />
          ) : null}
          {canWrite && !moving ? (
            <div ref={moveButtons} className="flex flex-wrap gap-2">
              {moves.map((move, index) => (
                <Button
                  key={move.to}
                  size="sm"
                  // The next step of live work stands out. Reopening finished work does not.
                  variant={index === 0 && inBacklog ? "primary" : "secondary"}
                  onClick={() => setMoving(move)}
                >
                  {move.label}
                </Button>
              ))}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="work-order-details" className="space-y-3">
          <h3 id="work-order-details" className="eyebrow">
            Details
          </h3>
          {workOrder.description ? (
            <p className="text-[13px] whitespace-pre-line text-ink">{workOrder.description}</p>
          ) : null}
          <DetailList>
            <Detail term="Building">{workOrder.building.name}</Detail>
            <Detail term="Contract">
              {workOrder.contract ? (
                `${workOrder.contract.contract_number} · ${workOrder.contract.name}`
              ) : (
                <Blank label="No contract" />
              )}
            </Detail>
            <Detail term="Category">{WORK_ORDER_CATEGORY_LABELS[workOrder.category]}</Detail>
            <Detail term="Billable">{workOrder.billable ? "Yes" : "No"}</Detail>
            <Detail term="Source">{WORK_ORDER_SOURCE_LABELS[workOrder.source]}</Detail>
            <Detail term="Requested by">
              {workOrder.requested_by ?? <Blank label="Nobody named" />}
            </Detail>
            <Detail term="Assigned to">
              {workOrder.assigned_employee ? (
                workOrder.assigned_employee.full_name
              ) : (
                <span className="text-ink-subtle">Nobody yet</span>
              )}
            </Detail>
            <Detail term="Vendor">
              {workOrder.vendor ? workOrder.vendor.name : <Blank label="No vendor" />}
            </Detail>
            <Detail term="Due">
              {workOrder.due_on ? (
                <span className="tabular-nums">{formatDay(workOrder.due_on)}</span>
              ) : (
                <Blank label="No due date" />
              )}
            </Detail>
            <Detail term="Scheduled for">{when(workOrder.scheduled_for, "Not scheduled")}</Detail>
            <Detail term="Started">{when(workOrder.started_at, "Not started")}</Detail>
            <Detail term="Completed">{when(workOrder.completed_at, "Not completed")}</Detail>
          </DetailList>
        </section>

        <section aria-labelledby="work-order-history" className="space-y-4">
          <h3 id="work-order-history" className="eyebrow">
            History
          </h3>
          {canWrite ? (
            <CommentForm
              workOrder={workOrder}
              onAdded={() => onChanged(`Your comment was added to ${workOrder.number}.`)}
            />
          ) : null}
          {detail.data ? (
            <History workOrder={detail.data} timeZone={timeZone} />
          ) : detail.error ? (
            <ErrorState
              className="py-8"
              message={problemMessage(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <div role="status" aria-label="Loading the history" className="space-y-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              ))}
            </div>
          )}
        </section>
      </SheetBody>
      <SheetFooter className={canWrite ? "justify-between" : undefined}>
        {canWrite ? <Button onClick={() => onEdit(workOrder)}>Edit work order</Button> : null}
        <SheetClose asChild>
          <Button>Done</Button>
        </SheetClose>
      </SheetFooter>
    </>
  );
}

function History({ workOrder, timeZone }: { workOrder: WorkOrderDetail; timeZone: string }) {
  // The API lists the history oldest first. Here the latest news comes first.
  const activities = [...workOrder.activities].reverse();
  return (
    <Timeline label={`History of ${workOrder.number}`}>
      {activities.map((activity) => {
        const { title, note } = activitySummary(activity);
        return (
          <TimelineItem
            key={activity.id}
            title={title}
            by={activity.author_name}
            at={activity.created_at}
            when={formatDateTime(activity.created_at, timeZone)}
          >
            {note}
          </TimelineItem>
        );
      })}
      <TimelineItem
        title="Work order raised"
        at={workOrder.created_at}
        when={formatDateTime(workOrder.created_at, timeZone)}
      />
    </Timeline>
  );
}

const moveSchema = z.object({
  scheduled_for: z.string(),
  comment: optionalText(5000),
});

type MoveValues = z.infer<typeof moveSchema>;

type MoveFormProps = {
  workOrder: WorkOrder;
  move: StatusMove;
  timeZone: string;
  /** Called once the work order has moved. */
  onMoved: () => Promise<void>;
  onCancel: () => void;
};

/**
 * Confirms a move to another status, with room for a comment that is kept with the change
 * in the history. Scheduling also asks when, and saves that on the work order first.
 */
function MoveForm({ workOrder, move, timeZone, onMoved, onCancel }: MoveFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const booked = workOrder.scheduled_for ? toDateTimeInput(workOrder.scheduled_for, timeZone) : "";
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<MoveValues>({
    resolver: zodResolver(moveSchema),
    defaultValues: { scheduled_for: booked, comment: "" },
  });
  const path = { work_order_id: workOrder.id };
  const reschedule = $api.useMutation("patch", "/api/v1/work-orders/{work_order_id}");
  const changeStatus = $api.useMutation("post", "/api/v1/work-orders/{work_order_id}/status");

  async function onSubmit(values: MoveValues) {
    setFormError(null);
    try {
      if (move.to === "scheduled" && values.scheduled_for !== booked) {
        await reschedule.mutateAsync({
          params: { path },
          body: {
            scheduled_for: fromDateTimeInput(values.scheduled_for, timeZone)?.toISOString() ?? null,
          },
        });
      }
      await changeStatus.mutateAsync({
        params: { path },
        body: { status: move.to, comment: blankToNull(values.comment) },
      });
      await onMoved();
    } catch (error) {
      setFormError(applyProblem(error, setError, ["scheduled_for", "comment"]));
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label={move.label}
      className="space-y-3 rounded-md border border-line p-3.5"
    >
      <FormError message={formError} />
      {move.to === "scheduled" ? (
        <Field
          id="work-order-move-scheduled"
          label="Scheduled for"
          optional
          hint={`When the work is booked for, in ${timeZone.replace(/_/g, " ")} time.`}
          error={errors.scheduled_for?.message}
        >
          {(control) => (
            <Input
              {...control}
              // The form takes the place of the button that was pressed, so the keyboard
              // goes to its first field.
              autoFocus
              type="datetime-local"
              className="sm:w-64"
              {...register("scheduled_for")}
            />
          )}
        </Field>
      ) : null}
      <Field
        id="work-order-move-comment"
        label="Comment"
        optional
        hint="Kept with the change in the history."
        error={errors.comment?.message}
      >
        {(control) => (
          <Textarea
            {...control}
            autoFocus={move.to !== "scheduled"}
            rows={2}
            {...register("comment")}
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          variant={move.to === "cancelled" ? "danger" : "primary"}
          loading={isSubmitting}
        >
          {move.label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </form>
  );
}

const commentSchema = z.object({ body: optionalText(5000) });

type CommentValues = z.infer<typeof commentSchema>;

function CommentForm({
  workOrder,
  onAdded,
}: {
  workOrder: WorkOrder;
  onAdded: () => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors },
  } = useForm<CommentValues>({
    resolver: zodResolver(commentSchema),
    defaultValues: { body: "" },
  });
  const body = useWatch({ control, name: "body" });

  const addComment = $api.useMutation("post", "/api/v1/work-orders/{work_order_id}/comments", {
    onSuccess: async () => {
      await onAdded();
      reset();
    },
    onError: (error) => setFormError(applyProblem(error, setError, ["body"])),
  });

  function onSubmit(values: CommentValues) {
    setFormError(null);
    addComment.mutate({ params: { path: { work_order_id: workOrder.id } }, body: values });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-2">
      <FormError message={formError} />
      <Field id="work-order-comment" label="Add a comment" labelHidden error={errors.body?.message}>
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            placeholder="Add a comment for the team"
            {...register("body")}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={body.trim() === ""}
          loading={addComment.isPending}
        >
          Add comment
        </Button>
      </div>
    </form>
  );
}
