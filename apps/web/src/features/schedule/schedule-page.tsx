"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/components/me-provider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterToggle } from "@/components/ui/filter-toggle";
import { Select } from "@/components/ui/input";
import { PageHeader, Panel } from "@/components/ui/page";
import { EmptyState, ErrorState, NoAccess } from "@/components/ui/states";
import { WeekGrid } from "@/components/ui/week-grid";
import { useListParams } from "@/hooks/use-list-params";
import { useBuildingOptions } from "@/hooks/use-options";
import { $api } from "@/lib/api/client";
import { invalidate } from "@/lib/api/invalidate";
import { isProblem, problemMessage } from "@/lib/api/problem";
import type { Shift } from "@/lib/api/types";
import { addDays, startOfWeek, todayInZone, weekDays } from "@/lib/dates";
import { pickDate, pickId } from "@/lib/forms";
import { formatDayRange, formatDuration, formatLongDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { buildRoster, rosterSummary, shiftHours, shiftWhen, type RosterRow } from "./roster";
import { ShiftDialog } from "./shift-dialog";
import { SHIFT_STATUS_LABELS } from "./shift-form-schema";

// The most shifts the API returns at once. A week with more is read a page at a time.
const PAGE_SIZE = 200;
// The building, the week and whether cancelled shifts show are what the page is showing,
// not filters on it.
const VIEW = ["building_id", "week", "cancelled"] as const;

export function SchedulePage() {
  return useCan("schedule:read") ? <Schedule /> : <NoAccess what="the schedule" />;
}

/**
 * Every shift that starts at a building in a week. The first request says how many there
 * are, and the rest of them, in the rare week with more than one request can carry, are
 * asked for alongside.
 */
function useWeekShifts(buildingId: string | undefined, from: string, to: string) {
  const query = { from, to, building_id: buildingId, page_size: PAGE_SIZE };
  // Another week or another building starts from nothing. Last week's people under this
  // week's dates, even dimmed, would be a roster that never was.
  const first = $api.useQuery(
    "get",
    "/api/v1/shifts",
    { params: { query } },
    { enabled: buildingId !== undefined },
  );
  const pages = first.data ? Math.ceil(first.data.total / PAGE_SIZE) : 1;
  const rest = useQueries({
    queries: Array.from({ length: Math.max(pages - 1, 0) }, (_, index) =>
      $api.queryOptions("get", "/api/v1/shifts", {
        params: { query: { ...query, page: index + 2 } },
      }),
    ),
  });
  const shifts =
    first.data && rest.every((page) => page.data)
      ? [...first.data.items, ...rest.flatMap((page) => page.data?.items ?? [])]
      : undefined;
  return {
    shifts,
    isPending: buildingId !== undefined && !shifts && !first.error,
    error: first.error ?? rest.find((page) => page.error)?.error ?? null,
    refetch: () => {
      void first.refetch();
      for (const page of rest) void page.refetch();
    },
  };
}

function Schedule() {
  const me = useMe();
  const canWrite = useCan("schedule:write");
  const list = useListParams({ view: VIEW });
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Shift | null>(null);

  const timeZone = me.organization?.timezone ?? "UTC";
  const today = todayInZone(timeZone);
  const thisWeek = startOfWeek(today);
  const week = startOfWeek(pickDate(list.get("week")) ?? today);
  const days = weekDays(week);
  const lastDay = days[days.length - 1] ?? week;
  const showCancelled = list.get("cancelled") === "true";

  const buildings = useBuildingOptions();
  // Until one is chosen, the first building by name: a roster is better than a prompt.
  const building =
    buildings.data?.items.find((item) => item.id === pickId(list.get("building_id"))) ??
    buildings.data?.items[0];

  const { shifts, isPending, error, refetch } = useWeekShifts(building?.id, week, lastDay);
  const roster = shifts ? buildRoster(shifts, timeZone, { showCancelled }) : undefined;
  const range = formatDayRange(week, lastDay);
  const goToWeek = (monday: string) => list.update({ week: monday === thisWeek ? null : monday });

  if (!buildings.data) {
    return (
      <>
        <PageHeader title="Schedule" description="Who is working at each building, week by week." />
        <Panel>
          {buildings.error ? (
            <ErrorState
              title={
                isProblem(buildings.error) && buildings.error.status === 403
                  ? "You don't have access to this"
                  : undefined
              }
              message={problemMessage(buildings.error)}
              onRetry={() => void buildings.refetch()}
            />
          ) : (
            <WeekGrid
              caption="Schedule"
              days={days}
              today={today}
              rowHeading="Employee"
              rows={undefined}
              rowKey={() => ""}
              rowHeader={() => null}
              cell={() => null}
              isLoading
            />
          )}
        </Panel>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Schedule"
        description="Who is working at each building, week by week."
        actions={
          canWrite && building ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus />
              Add shift
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line p-3">
          <div className="w-full sm:w-64">
            <Select
              aria-label="Building"
              value={building?.id ?? ""}
              onChange={(event) => list.update({ building_id: event.target.value })}
            >
              {buildings.data.items.length === 0 ? <option value="">No buildings</option> : null}
              {buildings.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              className="size-9"
              aria-label="Previous week"
              onClick={() => goToWeek(addDays(week, -7))}
            >
              <ChevronLeft />
            </Button>
            <Button disabled={week === thisWeek} onClick={() => goToWeek(thisWeek)}>
              This week
            </Button>
            <Button
              size="icon"
              className="size-9"
              aria-label="Next week"
              onClick={() => goToWeek(addDays(week, 7))}
            >
              <ChevronRight />
            </Button>
          </div>
          <h2 aria-live="polite" className="text-sm font-semibold text-ink tabular-nums">
            {range}
          </h2>
          <FilterToggle
            label="Show cancelled"
            checked={showCancelled}
            onChange={(checked) => list.update({ cancelled: checked ? "true" : null })}
            className="sm:ml-auto"
          />
        </div>

        {!building ? (
          <EmptyState
            icon={CalendarDays}
            title="No buildings yet"
            description="A schedule is kept building by building. Add a building, and assign people to it, to schedule shifts there."
          />
        ) : error && !roster ? (
          <ErrorState message={problemMessage(error)} onRetry={refetch} />
        ) : roster?.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={shifts?.length ? "Every shift this week was cancelled" : "No shifts this week"}
            description={
              shifts?.length
                ? `Turn on "Show cancelled" to see the shifts that were cancelled at ${building.name}.`
                : `Nobody is scheduled at ${building.name} for ${range}.`
            }
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setEditing("new")}>
                  Add shift
                </Button>
              ) : null
            }
          />
        ) : (
          <WeekGrid
            caption={`Schedule for ${building.name}, ${range}`}
            days={days}
            today={today}
            rowHeading="Employee"
            rows={roster}
            rowKey={(row) => row.employee.id}
            isLoading={isPending}
            rowHeader={(row) => <Person row={row} />}
            cell={(row, day) =>
              row.days[day]?.map((shift) => (
                <ShiftEntry
                  key={shift.id}
                  shift={shift}
                  day={day}
                  timeZone={timeZone}
                  onOpen={canWrite && shift.status !== "cancelled" ? setEditing : undefined}
                />
              ))
            }
          />
        )}
      </Panel>

      <p className="mt-3 text-xs text-ink-subtle">
        {roster && roster.length > 0 ? `${rosterSummary(roster)}. ` : null}
        Times are shown in {timeZone.replace(/_/g, " ")}.
      </p>

      {building ? (
        <ShiftDialog
          target={editing}
          building={building}
          // A new shift starts today if today is on show, and on the week's Monday if not.
          defaultDate={days.includes(today) ? today : week}
          onClose={() => setEditing(null)}
          onCancelShift={(shift) => {
            setEditing(null);
            setCancelling(shift);
          }}
        />
      ) : null}
      {cancelling ? (
        <CancelShift shift={cancelling} timeZone={timeZone} onDone={() => setCancelling(null)} />
      ) : null}
    </>
  );
}

/** Who a row of the roster is for, with their hours for the week under their name. */
function Person({ row }: { row: RosterRow }) {
  return (
    <>
      <span className="line-clamp-2 font-medium text-ink">{row.employee.full_name}</span>
      <span className="block text-xs whitespace-nowrap text-ink-muted tabular-nums">
        <span className="font-mono text-[11px] text-ink-subtle">
          {row.employee.employee_number}
        </span>
        {" · "}
        {formatDuration(row.minutes)}
      </span>
    </>
  );
}

type ShiftEntryProps = {
  shift: Shift;
  day: string;
  timeZone: string;
  /** Opens the shift for editing. Left out for people who may not change the schedule. */
  onOpen?: (shift: Shift) => void;
};

/** One shift in a day's cell: its hours, and a word when it was missed or cancelled. */
function ShiftEntry({ shift, day, timeZone, onOpen }: ShiftEntryProps) {
  const start = formatTime(shift.starts_at, timeZone);
  const end = formatTime(shift.ends_at, timeZone);
  const cancelled = shift.status === "cancelled";
  const flagged = shift.status === "missed" || cancelled;
  const content = (
    <>
      {/* Where the column is too narrow for both times, the line breaks after the dash. */}
      <span
        className={cn(
          "block font-medium tabular-nums",
          cancelled ? "text-ink-subtle line-through" : "text-ink",
        )}
      >
        <span className="whitespace-nowrap">{start} –</span>{" "}
        <span className="whitespace-nowrap">{end}</span>
      </span>
      {flagged ? (
        <span className={cn("block", cancelled ? "text-ink-subtle" : "font-medium text-critical")}>
          {SHIFT_STATUS_LABELS[shift.status]}
        </span>
      ) : null}
    </>
  );
  if (!onOpen) {
    return <div className="px-1.5 py-1 text-xs">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(shift)}
      // Read out with who and when: a row of times alone would not say whose they are.
      aria-label={`Edit shift: ${shift.employee.full_name}, ${formatLongDay(day)}, ${shiftHours(shift, timeZone)}${
        flagged ? `, ${SHIFT_STATUS_LABELS[shift.status].toLowerCase()}` : ""
      }`}
      title={shift.notes ?? undefined}
      className="block w-full cursor-pointer rounded-xs px-1.5 py-1 text-left text-xs transition-colors hover:bg-sunken"
    >
      {content}
    </button>
  );
}

function CancelShift({
  shift,
  timeZone,
  onDone,
}: {
  shift: Shift;
  timeZone: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const cancel = $api.useMutation("post", "/api/v1/shifts/{shift_id}/cancel", {
    onSuccess: async (cancelled) => {
      await invalidate(queryClient, "/api/v1/shifts");
      toast.success("Shift cancelled", {
        description: `${cancelled.employee.full_name} · ${shiftWhen(cancelled, timeZone)}`,
      });
      onDone();
    },
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDone()}
      title="Cancel this shift?"
      description={`${shift.employee.full_name} at ${shift.building.name}, ${shiftWhen(shift, timeZone)}. The shift stays on record as cancelled and their time becomes free. A cancelled shift cannot be changed back: schedule a new one instead.`}
      confirmLabel="Cancel shift"
      cancelLabel="Keep shift"
      tone="danger"
      loading={cancel.isPending}
      error={cancel.error}
      onConfirm={() => cancel.mutate({ params: { path: { shift_id: shift.id } } })}
    />
  );
}
