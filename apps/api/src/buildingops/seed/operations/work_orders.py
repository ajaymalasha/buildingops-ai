"""Work orders raised over the year, each with the history that took it to where it stands.

Where each one stands today is decided first: nearly all are finished, and a set share
makes up the backlog, so that every status is there to be seen however few work orders
an organization has. A work order is then given an age that suits where it stands, and a
history that gets it there one allowed move at a time.
"""

import random
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from itertools import pairwise

from buildingops.core.models import new_id
from buildingops.modules.buildings.models import Building
from buildingops.modules.vendors.models import Vendor
from buildingops.modules.workorders.models import (
    WorkOrderActivityKind,
    WorkOrderCategory,
    WorkOrderPriority,
    WorkOrderSource,
    WorkOrderStatus,
)
from buildingops.modules.workorders.service import assignee_note, vendor_note
from buildingops.seed.operations.catalog import (
    CANCELLATION_REASONS,
    COMPLETION_NOTES,
    HOLD_REASONS,
    OCCASIONAL_VENDORS,
    REOPENING_REASONS,
    TRADE_ROLES,
    TRADE_VENDORS,
    WORK_ORDER_COMMENTS,
    WORK_ORDER_DESCRIPTIONS,
    WORK_ORDER_TITLES,
)
from buildingops.seed.operations.setting import Person, Row, Setting, Worker

_S = WorkOrderStatus

_CATEGORIES = tuple(WorkOrderCategory)
_CATEGORY_WEIGHTS = (22, 18, 16, 8, 10, 8, 8, 3, 3, 4)
_PRIORITIES = tuple(WorkOrderPriority)
_PRIORITY_WEIGHTS = (15, 55, 22, 8)
_SOURCES = tuple(WorkOrderSource)
_SOURCE_WEIGHTS = (40, 35, 10, 15)
# The share of the year's work orders that stands in each status of the backlog today,
# and the share that was cancelled. The rest are completed.
_BACKLOG = {_S.OPEN: 0.016, _S.SCHEDULED: 0.012, _S.IN_PROGRESS: 0.016, _S.ON_HOLD: 0.008}
_CANCELLED = 0.045
# How many days ago a work order in the backlog was raised. Work on hold has often been
# waiting for weeks. Everything else was raised at some point in the year.
_BACKLOG_RAISED_DAYS_AGO = {
    _S.OPEN: (1, 10),
    _S.SCHEDULED: (2, 14),
    _S.IN_PROGRESS: (1, 30),
    _S.ON_HOLD: (8, 75),
}
# A job in the backlog for longer than this keeps the due date it was first given, which
# has passed: it is overdue.
_LINGERING_AFTER_DAYS = 21
_CLOSED = (_S.COMPLETED, _S.CANCELLED)
# The ways a work order gets to each status, and how common each way is. Every step is a
# move the API allows.
_WAYS: dict[WorkOrderStatus, tuple[tuple[tuple[WorkOrderStatus, ...], int], ...]] = {
    _S.OPEN: (((_S.OPEN,), 1),),
    _S.SCHEDULED: (((_S.OPEN, _S.SCHEDULED), 1),),
    _S.IN_PROGRESS: (
        ((_S.OPEN, _S.IN_PROGRESS), 6),
        ((_S.OPEN, _S.SCHEDULED, _S.IN_PROGRESS), 4),
    ),
    _S.ON_HOLD: (
        ((_S.OPEN, _S.IN_PROGRESS, _S.ON_HOLD), 7),
        ((_S.OPEN, _S.ON_HOLD), 3),
    ),
    _S.COMPLETED: (
        ((_S.OPEN, _S.IN_PROGRESS, _S.COMPLETED), 55),
        ((_S.OPEN, _S.SCHEDULED, _S.IN_PROGRESS, _S.COMPLETED), 30),
        ((_S.OPEN, _S.IN_PROGRESS, _S.ON_HOLD, _S.IN_PROGRESS, _S.COMPLETED), 12),
        ((_S.OPEN, _S.IN_PROGRESS, _S.COMPLETED, _S.IN_PROGRESS, _S.COMPLETED), 3),
    ),
    _S.CANCELLED: (
        ((_S.OPEN, _S.CANCELLED), 6),
        ((_S.OPEN, _S.SCHEDULED, _S.CANCELLED), 4),
    ),
}
# How many hours pass before work starts on an open order, and how many days it is given.
_RESPONSE_HOURS = {
    WorkOrderPriority.LOW: (24.0, 240.0),
    WorkOrderPriority.NORMAL: (6.0, 72.0),
    WorkOrderPriority.HIGH: (2.0, 24.0),
    WorkOrderPriority.URGENT: (1.0, 4.0),
}
_DAYS_TO_DUE = {
    WorkOrderPriority.LOW: (14, 30),
    WorkOrderPriority.NORMAL: (5, 14),
    WorkOrderPriority.HIGH: (2, 5),
    WorkOrderPriority.URGENT: (1, 2),
}
_NO_DUE_DATE = 0.12
# Most of the recent backlog is in hand: if its first due date has passed, it has been
# given a new one a few days ahead.
_GIVEN_MORE_TIME = 0.65
_MORE_TIME_DAYS = (1, 7)
_DESCRIBED = 0.40
_BILLABLE = 0.85
# Work orders are raised during the working day: from seven, over eleven hours.
_DAY_BEGINS = time(7, 0)
_DAY_MINUTES = 11 * 60
_ASSIGNED_IN_HOUSE = 0.88
_ASSIGNED_BESIDE_A_VENDOR = 0.30
_SENT_TO_TRADE_VENDOR = 0.75
_SENT_TO_OCCASIONAL_VENDOR = 0.12
_REMARK_ON_FINISHING = 0.30
# How much of the time since it was raised a job has used, when its history has to be
# fitted into less time than it would have taken.
_SHARE_OF_TIME_USED = (0.40, 0.95)
_COMMENT_COUNTS = (0, 1, 2)
_COMMENT_WEIGHTS = (55, 35, 10)


@dataclass(slots=True)
class Job:
    """A work order on its way to being a row, with its history and what an expense made
    for it needs to know. Its number is given once all of them are in order."""

    row: Row
    activities: list[Row]
    building: Building
    vendor: Vendor | None
    completed_on: date | None


def build_jobs(setting: Setting) -> list[Job]:
    """The year's work orders, in the order they were raised."""
    builder = _JobBuilder(setting)
    jobs = [builder.job(status) for status in _standings(setting.spec.work_orders)]
    return sorted(jobs, key=lambda job: job.row["created_at"])


def _standings(count: int) -> list[WorkOrderStatus]:
    """Where each of `count` work orders stands today: at least one in every status of the
    backlog, a few cancelled, and the rest completed."""
    standings = [
        status for status, share in _BACKLOG.items() for _ in range(max(1, round(count * share)))
    ]
    standings += [_S.CANCELLED] * round(count * _CANCELLED)
    standings += [_S.COMPLETED] * (count - len(standings))
    return standings[:count]


class _JobBuilder:
    def __init__(self, setting: Setting) -> None:
        self.setting = setting
        self.rng = setting.stream("work")

    def job(self, status: WorkOrderStatus) -> Job:
        setting, rng = self.setting, self.rng
        raised_within = _BACKLOG_RAISED_DAYS_AGO.get(status, (1, setting.history_days))
        days_ago = rng.randint(*raised_within)
        raised_on = setting.today - timedelta(days=days_ago)
        raised_at = setting.local(raised_on, _DAY_BEGINS) + timedelta(
            minutes=rng.randrange(_DAY_MINUTES)
        )
        building = setting.site(rng)
        category = rng.choices(_CATEGORIES, _CATEGORY_WEIGHTS)[0]
        priority = rng.choices(_PRIORITIES, _PRIORITY_WEIGHTS)[0]
        source = rng.choices(_SOURCES, _SOURCE_WEIGHTS)[0]
        vendor = self._vendor_for(category)
        assignee = self._assignee_for(category, building, vendor)
        contract = setting.contract_for(building)

        ways = _WAYS[status]
        path = rng.choices([way for way, _ in ways], [weight for _, weight in ways])[0]
        moments = self._moments(raised_at, priority, path)
        scheduled_for = None
        if status is _S.SCHEDULED:
            scheduled_for = setting.local(
                setting.today + timedelta(days=rng.randint(1, 10)),
                time(rng.randint(7, 15), rng.choice((0, 30))),
            )
        elif _S.SCHEDULED in path:
            # It was started, or called off, at the time it had been booked for.
            scheduled_for = moments[path.index(_S.SCHEDULED)]
        started_at = next(
            (at for at, after in zip(moments, path[1:], strict=True) if after is _S.IN_PROGRESS),
            None,
        )
        completed_at = moments[-1] if status is _S.COMPLETED else None

        due_on = self._due_on(raised_on, days_ago, priority, status, scheduled_for)
        described = rng.random() < _DESCRIBED
        description = rng.choice(WORK_ORDER_DESCRIPTIONS)

        work_order_id = new_id()
        history = self._history(raised_at, status, path, moments, building, assignee, vendor)
        activities = [
            {
                "id": new_id(),
                "organization_id": setting.organization.id,
                "work_order_id": work_order_id,
                **entry,
                "author_user_id": author.user_id,
                "author_name": author.name,
                "created_at": moment,
                "updated_at": moment,
            }
            for moment, author, entry in history
        ]
        row = {
            "id": work_order_id,
            "organization_id": setting.organization.id,
            "title": rng.choice(WORK_ORDER_TITLES[category]),
            "description": description if described else None,
            "building_id": building.id,
            "contract_id": contract.id if contract else None,
            "category": category,
            "priority": priority,
            "status": status,
            "source": source,
            "assigned_employee_id": assignee.employee.id if assignee else None,
            "vendor_id": vendor.id if vendor else None,
            "requested_by": (
                setting.contacts.get(building.customer_id)
                if source is WorkOrderSource.CUSTOMER_REQUEST
                else None
            ),
            "due_on": due_on,
            "scheduled_for": scheduled_for,
            "started_at": started_at,
            "completed_at": completed_at,
            "billable": rng.random() < _BILLABLE,
            "created_at": raised_at,
            "updated_at": history[-1][0] if history else raised_at,
        }
        completed_on = completed_at.astimezone(setting.zone).date() if completed_at else None
        return Job(row, activities, building, vendor, completed_on)

    def _due_on(
        self,
        raised_on: date,
        days_ago: int,
        priority: WorkOrderPriority,
        status: WorkOrderStatus,
        scheduled_for: datetime | None,
    ) -> date | None:
        """The day a work order is due by, if it was given one.

        Finished work keeps the date it was first given. So does a job that has lingered
        for weeks, which is what makes it overdue. The rest of the backlog has mostly
        been given more time, and a job booked for a day is not due before that day.
        """
        setting, rng = self.setting, self.rng
        due_on = raised_on + timedelta(days=rng.randint(*_DAYS_TO_DUE[priority]))
        no_due_date = rng.random() < _NO_DUE_DATE
        given_more_time = rng.random() < _GIVEN_MORE_TIME
        more_time = timedelta(days=rng.randint(*_MORE_TIME_DAYS))
        if status in _CLOSED:
            return None if no_due_date else due_on
        if days_ago > _LINGERING_AFTER_DAYS:
            return due_on
        if no_due_date:
            return None
        if due_on < setting.today and given_more_time:
            due_on = setting.today + more_time
        if status is _S.SCHEDULED and scheduled_for is not None:
            due_on = max(due_on, scheduled_for.astimezone(setting.zone).date())
        return due_on

    def _moments(
        self, raised_at: datetime, priority: WorkOrderPriority, path: Sequence[WorkOrderStatus]
    ) -> list[datetime]:
        """When a work order made each move along `path`."""
        gaps = [
            timedelta(hours=self.rng.uniform(*_hours_between(priority, before, after)))
            for before, after in pairwise(path)
        ]
        room = (self.setting.latest - raised_at) * self.rng.uniform(*_SHARE_OF_TIME_USED)
        needed = sum(gaps, timedelta())
        if needed > room:
            # A job raised yesterday cannot have taken a week. Its history is fitted into
            # part of the time there has been.
            gaps = [gap * (room / needed) for gap in gaps]
        moments, moment = [], raised_at
        for gap in gaps:
            moment = min(moment + gap, self.setting.latest)
            moments.append(moment)
        return moments

    def _history(
        self,
        raised_at: datetime,
        status: WorkOrderStatus,
        path: Sequence[WorkOrderStatus],
        moments: Sequence[datetime],
        building: Building,
        assignee: Worker | None,
        vendor: Vendor | None,
    ) -> list[tuple[datetime, Person, Row]]:
        """What was written into a work order's history, when and by whom, oldest first."""
        rng = self.rng
        supervisor = self.setting.supervisor_of(building)
        doer = assignee.person if assignee else supervisor
        history: list[tuple[datetime, Person, Row]] = []
        # Who it is given to is settled as it is raised, as when it is entered by hand.
        if assignee is not None:
            note = assignee_note(None, assignee.employee.full_name)
            history.append((raised_at, supervisor, _entry(WorkOrderActivityKind.ASSIGNMENT, note)))
        if vendor is not None:
            note = vendor_note(None, vendor.name)
            history.append((raised_at, supervisor, _entry(WorkOrderActivityKind.ASSIGNMENT, note)))
        for (before, after), moment in zip(pairwise(path), moments, strict=True):
            # Whoever does the work says when it starts and ends. The rest is the supervisor's.
            author = doer if after in (_S.IN_PROGRESS, _S.COMPLETED) else supervisor
            remark = _remark(rng, before, after)
            entry = _entry(WorkOrderActivityKind.STATUS_CHANGE, remark, before, after)
            history.append((moment, author, entry))
        # People comment while a job is live: up to its last move, or to now if it still is.
        until = moments[-1] if status in _CLOSED else self.setting.latest
        for _ in range(rng.choices(_COMMENT_COUNTS, _COMMENT_WEIGHTS)[0]):
            moment = raised_at + (until - raised_at) * rng.random()
            entry = _entry(WorkOrderActivityKind.COMMENT, rng.choice(WORK_ORDER_COMMENTS))
            history.append((moment, rng.choice((supervisor, doer)), entry))
        return sorted(history, key=lambda item: item[0])

    def _vendor_for(self, category: WorkOrderCategory) -> Vendor | None:
        trade = TRADE_VENDORS.get(category)
        kind = trade or OCCASIONAL_VENDORS[category]
        chance = _SENT_TO_TRADE_VENDOR if trade else _SENT_TO_OCCASIONAL_VENDOR
        candidates = self.setting.vendors.get(kind, [])
        sent_out = self.rng.random() < chance
        return self.rng.choice(candidates) if sent_out and candidates else None

    def _assignee_for(
        self, category: WorkOrderCategory, building: Building, vendor: Vendor | None
    ) -> Worker | None:
        chance = _ASSIGNED_BESIDE_A_VENDOR if vendor else _ASSIGNED_IN_HOUSE
        if self.rng.random() >= chance:
            return None
        crew = self.setting.crew_at.get(building.id, [])
        if category is WorkOrderCategory.CLEANING:
            candidates = [worker for worker in crew if worker.role not in TRADE_ROLES]
        else:
            # Someone on site if there is one, or else whoever covers the area.
            on_site = [worker for worker in crew if worker.role in TRADE_ROLES]
            candidates = on_site or list(self.setting.trades)
        return self.rng.choice(candidates) if candidates else None


def _hours_between(
    priority: WorkOrderPriority, before: WorkOrderStatus, after: WorkOrderStatus
) -> tuple[float, float]:
    """The least and the most hours a work order spends in `before` on its way to `after`."""
    if after is _S.SCHEDULED:
        return 0.5, 6.0
    if after is _S.IN_PROGRESS:
        if before is _S.OPEN:
            return _RESPONSE_HOURS[priority]
        # The wait for whatever held the job up, or else for a booked visit, or for the
        # customer to say that it is not fixed after all.
        return (24.0, 240.0) if before is _S.ON_HOLD else (12.0, 96.0)
    if after is _S.ON_HOLD:
        return 0.5, 24.0
    if after is _S.COMPLETED:
        return 1.0, 30.0
    return 2.0, 72.0


def _remark(rng: random.Random, before: WorkOrderStatus, after: WorkOrderStatus) -> str | None:
    """What is said with a change of status, where something usually is."""
    on_finishing = rng.random() < _REMARK_ON_FINISHING
    if after is _S.ON_HOLD:
        return rng.choice(HOLD_REASONS)
    if after is _S.CANCELLED:
        return rng.choice(CANCELLATION_REASONS)
    if before is _S.COMPLETED:
        return rng.choice(REOPENING_REASONS)
    if after is _S.COMPLETED and on_finishing:
        return rng.choice(COMPLETION_NOTES)
    return None


def _entry(
    kind: WorkOrderActivityKind,
    body: str | None,
    before: WorkOrderStatus | None = None,
    after: WorkOrderStatus | None = None,
) -> Row:
    return {
        "kind": kind,
        "body": body,
        "from_status": before.value if before else None,
        "to_status": after.value if after else None,
    }
