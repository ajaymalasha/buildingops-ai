"""Timesheets for the year, and the schedule around today.

Each working day of each person is either worked, which leaves a timesheet, or not. For
the last four weeks the schedule is kept as well: a completed shift behind each timesheet,
and a missed one where somebody did not come. The next two weeks are scheduled.
"""

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from buildingops.core.models import DecisionStatus, new_id
from buildingops.modules.buildings.models import Building
from buildingops.modules.scheduling.models import ShiftStatus
from buildingops.modules.timesheets.costing import labor_cost
from buildingops.modules.timesheets.models import TimesheetSource
from buildingops.seed.operations.billing import Ledger
from buildingops.seed.operations.catalog import TIMESHEET_REJECTIONS
from buildingops.seed.operations.setting import Row, Setting, Worker

# The schedule is kept for the last four weeks and laid out for the next two, which is
# also how far ahead it is published.
_SCHEDULE_KEPT_DAYS = 28
_SCHEDULE_AHEAD_DAYS = 14

_HALF_HOUR = Decimal("0.50")
_QUARTER_HOUR = Decimal("0.25")
_NO_HOURS = Decimal("0.00")
_OVERTIME_MULTIPLIER = Decimal("1.50")
# Of the days someone is due to work: how many they are away, how many of those nobody
# planned for, and how many end half an hour early.
_AWAY = 0.035
_NO_SHOW = 0.014
_SHORT_DAY = 0.10
# Of the days ahead: how many are already known to be days off.
_BOOKED_OFF = 0.03
# A day of six hours or more includes an unpaid half-hour break.
_BREAK_FROM_HOURS = Decimal("6.00")
_BREAK_MINUTES = 30
# Time is approved a building and a week at a time. Yesterday's and the day before's is
# never decided yet, everything older than a fortnight is, and in between it depends on
# how long ago the week was: this one, the last, the one before.
_NEVER_DECIDED_DAYS = 2
_ALWAYS_DECIDED_DAYS = 14
_WEEK_APPROVED = (0.10, 0.60, 0.90)
_REJECTED = 0.012


def build_time(setting: Setting, ledger: Ledger) -> tuple[list[Row], list[Row]]:
    """The shifts and the timesheets, in that order. Approved time is booked to `ledger`."""
    return _Timekeeper(setting, ledger).build()


class _Timekeeper:
    def __init__(self, setting: Setting, ledger: Ledger) -> None:
        self.setting = setting
        self.ledger = ledger
        self.rng = setting.stream("time")
        self.this_week = setting.today - timedelta(days=setting.today.weekday())
        self.shifts: list[Row] = []
        self.timesheets: list[Row] = []
        self._weeks_approved: dict[tuple[uuid.UUID, date], bool] = {}

    def build(self) -> tuple[list[Row], list[Row]]:
        horizon = self.setting.today + timedelta(days=_SCHEDULE_AHEAD_DAYS)
        for worker in self.setting.workers:
            day = worker.first_day
            while day < horizon:
                building = worker.building_on(day)
                if building is not None:
                    self._day(worker, building, day)
                day += timedelta(days=1)
        return self.shifts, self.timesheets

    def _day(self, worker: Worker, building: Building, day: date) -> None:
        """One day someone is due at a building: worked, missed or still to come."""
        chance = self.rng.random()
        days_ago = (self.setting.today - day).days
        if days_ago <= 0:
            if chance >= _BOOKED_OFF:
                self._shift(worker, building, day, worker.day_hours, ShiftStatus.SCHEDULED)
            return
        on_schedule = days_ago <= _SCHEDULE_KEPT_DAYS
        if chance < _AWAY:
            # Time off that was arranged never reached the schedule. The rest of the time
            # away is a shift nobody came to.
            if on_schedule and chance < _NO_SHOW:
                self._shift(worker, building, day, worker.day_hours, ShiftStatus.MISSED)
            return
        regular, overtime = self._hours(worker)
        shift_id = None
        if on_schedule:
            hours = regular + overtime
            shift_id = self._shift(worker, building, day, hours, ShiftStatus.COMPLETED)
        self._timesheet(worker, building, day, regular, overtime, shift_id)

    def _hours(self, worker: Worker) -> tuple[Decimal, Decimal]:
        chance = self.rng.random()
        if chance < _SHORT_DAY:
            return worker.day_hours - _HALF_HOUR, _NO_HOURS
        if chance < _SHORT_DAY + worker.overtime_chance:
            # Half an hour to three hours over, in quarters.
            return worker.day_hours, self.rng.randrange(2, 13) * _QUARTER_HOUR
        return worker.day_hours, _NO_HOURS

    def _span(self, worker: Worker, day: date, hours: Decimal) -> tuple[datetime, datetime, int]:
        """When a day of `hours` starts and ends, and the break taken in it."""
        starts_at = self.setting.local(day, worker.starts)
        break_minutes = _BREAK_MINUTES if hours >= _BREAK_FROM_HOURS else 0
        ends_at = starts_at + timedelta(minutes=int(hours * 60) + break_minutes)
        return starts_at, ends_at, break_minutes

    def _shift(
        self, worker: Worker, building: Building, day: date, hours: Decimal, status: ShiftStatus
    ) -> uuid.UUID:
        starts_at, ends_at, break_minutes = self._span(worker, day, hours)
        published_at = starts_at - timedelta(days=_SCHEDULE_AHEAD_DAYS)
        shift_id = new_id()
        self.shifts.append(
            {
                "id": shift_id,
                "organization_id": self.setting.organization.id,
                "employee_id": worker.employee.id,
                "building_id": building.id,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "break_minutes": break_minutes,
                "status": status,
                "notes": None,
                "created_at": published_at,
                "updated_at": (
                    published_at
                    if status is ShiftStatus.SCHEDULED
                    else min(ends_at, self.setting.latest)
                ),
            }
        )
        return shift_id

    def _timesheet(
        self,
        worker: Worker,
        building: Building,
        day: date,
        regular: Decimal,
        overtime: Decimal,
        shift_id: uuid.UUID | None,
    ) -> None:
        _, ends_at, _ = self._span(worker, day, regular + overtime)
        submitted_at = min(
            ends_at + timedelta(minutes=self.rng.randrange(2, 40)), self.setting.latest
        )
        status, decided_at, reason = self._verdict(building, day, submitted_at)
        decided = status is not DecisionStatus.PENDING
        cost = labor_cost(regular, overtime, worker.rate, _OVERTIME_MULTIPLIER)
        contract = self.setting.contract_for(building, worker.role)
        self.timesheets.append(
            {
                "id": new_id(),
                "organization_id": self.setting.organization.id,
                "employee_id": worker.employee.id,
                "building_id": building.id,
                "contract_id": contract.id if contract else None,
                "shift_id": shift_id,
                "work_date": day,
                "hours_regular": regular,
                "hours_overtime": overtime,
                "hourly_rate": worker.rate,
                "overtime_multiplier": _OVERTIME_MULTIPLIER,
                "labor_cost": cost,
                # Time for a shift on the schedule is drawn up from it.
                "source": TimesheetSource.SCHEDULE if shift_id else TimesheetSource.MANUAL,
                "notes": None,
                "submitted_at": submitted_at,
                "status": status,
                "decided_by_user_id": worker.approver.user_id if decided else None,
                "decided_by_name": worker.approver.name if decided else None,
                "decided_at": decided_at,
                "rejection_reason": reason,
                "created_at": submitted_at,
                "updated_at": decided_at or submitted_at,
            }
        )
        self.ledger.book_time(contract, day, status, regular, overtime, cost)

    def _verdict(
        self, building: Building, day: date, submitted_at: datetime
    ) -> tuple[DecisionStatus, datetime | None, str | None]:
        """Whether a day's time has been decided on, when, and why not if it was rejected."""
        days_ago = (self.setting.today - day).days
        if days_ago <= _NEVER_DECIDED_DAYS:
            return DecisionStatus.PENDING, None, None
        week = day - timedelta(days=day.weekday())
        if days_ago <= _ALWAYS_DECIDED_DAYS:
            batch = (building.id, week)
            if batch not in self._weeks_approved:
                weeks_ago = (self.this_week - week).days // 7
                self._weeks_approved[batch] = self.rng.random() < _WEEK_APPROVED[weeks_ago]
            if not self._weeks_approved[batch]:
                return DecisionStatus.PENDING, None, None
        # A week is gone through on the Monday after it, or the day before today if that
        # Monday is still to come. Either way, some time in the working day.
        the_monday_after = self.setting.local(week + timedelta(days=7), time(9, 0))
        yesterday_afternoon = self.setting.latest - timedelta(hours=8)
        decided_at = max(min(the_monday_after, yesterday_afternoon), submitted_at) + timedelta(
            minutes=self.rng.randrange(1, 480)
        )
        if self.rng.random() < _REJECTED:
            return DecisionStatus.REJECTED, decided_at, self.rng.choice(TIMESHEET_REJECTIONS)
        return DecisionStatus.APPROVED, decided_at, None
