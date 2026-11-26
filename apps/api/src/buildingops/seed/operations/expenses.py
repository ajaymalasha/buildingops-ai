"""Expenses over the year: what finished work orders cost in parts and subcontractors, and
the supplies, materials and equipment bought day to day.
"""

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from buildingops.core.models import DecisionStatus, new_id
from buildingops.modules.buildings.models import Building
from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.vendors.models import Vendor, VendorCategory
from buildingops.modules.workorders.models import WorkOrderCategory
from buildingops.seed.operations.billing import Ledger
from buildingops.seed.operations.catalog import (
    EXPENSE_AMOUNTS,
    EXPENSE_DESCRIPTIONS,
    EXPENSE_REJECTIONS,
    EXPENSE_VENDORS,
    JOB_MATERIALS,
)
from buildingops.seed.operations.setting import Row, Setting
from buildingops.seed.operations.work_orders import Job

# The kinds of work that leave a bill behind, and how often a finished job did.
_WORK_WITH_COSTS = frozenset(
    {
        WorkOrderCategory.MAINTENANCE,
        WorkOrderCategory.REPAIR,
        WorkOrderCategory.HVAC,
        WorkOrderCategory.ELECTRICAL,
        WorkOrderCategory.PLUMBING,
        WorkOrderCategory.LANDSCAPING,
        WorkOrderCategory.SECURITY,
    }
)
_JOBS_WITH_COSTS = 0.30
# What is bought day to day, and how much of it is each kind.
_PURCHASES = (
    ExpenseCategory.SUPPLIES,
    ExpenseCategory.MATERIALS,
    ExpenseCategory.EQUIPMENT,
    ExpenseCategory.SUBCONTRACTOR,
)
_PURCHASE_WEIGHTS = (48, 27, 17, 8)
# How much of each kind is passed on to the customer.
_BILLABLE = {
    ExpenseCategory.SUPPLIES: 0.90,
    ExpenseCategory.MATERIALS: 0.90,
    ExpenseCategory.EQUIPMENT: 0.60,
    ExpenseCategory.SUBCONTRACTOR: 0.95,
}
_BOOKED_TO_CONTRACT = 0.85
_FROM_A_VENDOR = 0.70
_WITHOUT_REFERENCE = 0.20
# An expense is entered within a couple of days, during the working day.
_DAY_BEGINS = time(7, 0)
_DAY_MINUTES = 11 * 60
# Nothing incurred in the last two days is decided, most of the last few weeks still
# waits, and everything older has an answer.
_NEVER_DECIDED_DAYS = 2
_WAITING_DAYS = 18
_STILL_WAITING = 0.85
_REJECTED = 0.04


def build_expenses(setting: Setting, ledger: Ledger, jobs: list[Job]) -> list[Row]:
    """The year's expenses. Approved, billable ones are booked to `ledger`."""
    return _Buyer(setting, ledger).build(jobs)


class _Buyer:
    def __init__(self, setting: Setting, ledger: Ledger) -> None:
        self.setting = setting
        self.ledger = ledger
        self.rng = setting.stream("spend")
        self.expenses: list[Row] = []
        # Vendors that do work rather than sell goods.
        self.contractors = [
            vendor
            for category, vendors in setting.vendors.items()
            if category is not VendorCategory.SUPPLIES
            for vendor in vendors
        ]

    def build(self, jobs: list[Job]) -> list[Row]:
        setting, rng = self.setting, self.rng
        for job in jobs:
            had_costs = rng.random() < _JOBS_WITH_COSTS
            if job.completed_on is None or job.row["category"] not in _WORK_WITH_COSTS:
                continue
            if had_costs:
                # A vendor's work comes as their invoice. Work done in house needed parts.
                category = (
                    ExpenseCategory.SUBCONTRACTOR if job.vendor else ExpenseCategory.MATERIALS
                )
                self._expense(
                    category,
                    job.completed_on,
                    job.building,
                    contract_id=job.row["contract_id"],
                    vendor=job.vendor or self._supplier(category),
                    work_order_id=job.row["id"],
                    billable=job.row["billable"],
                )
        for _ in range(max(setting.spec.expenses - len(self.expenses), 0)):
            category = rng.choices(_PURCHASES, _PURCHASE_WEIGHTS)[0]
            incurred_on = setting.today - timedelta(days=rng.randint(1, setting.history_days))
            building = setting.site(rng)
            contract = setting.contract_for(building)
            booked = rng.random() < _BOOKED_TO_CONTRACT
            self._expense(
                category,
                incurred_on,
                building,
                contract_id=contract.id if contract and booked else None,
                vendor=self._supplier(category),
                work_order_id=None,
                billable=rng.random() < _BILLABLE[category],
            )
        return self.expenses

    def _supplier(self, category: ExpenseCategory) -> Vendor | None:
        """Who a purchase was made from: a vendor on file, or nobody, for a shop receipt."""
        if category is ExpenseCategory.SUBCONTRACTOR:
            return self.rng.choice(self.contractors) if self.contractors else None
        kind = EXPENSE_VENDORS.get(category)
        candidates = self.setting.vendors.get(kind, []) if kind else []
        from_a_vendor = self.rng.random() < _FROM_A_VENDOR
        return self.rng.choice(candidates) if from_a_vendor and candidates else None

    def _expense(
        self,
        category: ExpenseCategory,
        incurred_on: date,
        building: Building,
        *,
        contract_id: uuid.UUID | None,
        vendor: Vendor | None,
        work_order_id: uuid.UUID | None,
        billable: bool,
    ) -> None:
        setting, rng = self.setting, self.rng
        least, most = EXPENSE_AMOUNTS[category]
        # The lower of two draws, so that most amounts are near the low end. Counted in
        # whole cents throughout: the amount is never a float.
        cents = least + min(rng.randrange(most - least), rng.randrange(most - least))
        amount = Decimal(cents).scaleb(-2)
        entered_at = min(
            setting.local(incurred_on + timedelta(days=rng.randint(0, 2)), _DAY_BEGINS)
            + timedelta(minutes=rng.randrange(_DAY_MINUTES)),
            setting.latest,
        )
        status, decided_at, reason = self._ruling(incurred_on, entered_at)
        decided = status is not DecisionStatus.PENDING
        number = rng.randrange(10_000, 100_000)
        has_reference = rng.random() >= _WITHOUT_REFERENCE
        description = rng.choice(EXPENSE_DESCRIPTIONS[category])
        if work_order_id is not None and category is ExpenseCategory.MATERIALS:
            description = JOB_MATERIALS
        self.expenses.append(
            {
                "id": new_id(),
                "organization_id": setting.organization.id,
                "category": category,
                "description": description,
                "amount": amount,
                "currency": setting.organization.currency,
                "incurred_on": incurred_on,
                "building_id": building.id,
                "contract_id": contract_id,
                "vendor_id": vendor.id if vendor else None,
                "work_order_id": work_order_id,
                "billable": billable,
                # A vendor's invoice number, or else a receipt number.
                "reference": (
                    f"{_initials(vendor.name) if vendor else 'R'}-{number}"
                    if has_reference
                    else None
                ),
                "status": status,
                "decided_by_user_id": setting.lead.user_id if decided else None,
                "decided_by_name": setting.lead.name if decided else None,
                "decided_at": decided_at,
                "rejection_reason": reason,
                "created_at": entered_at,
                "updated_at": decided_at or entered_at,
            }
        )
        self.ledger.book_expense(
            contract_id, incurred_on, status, category, amount, billable=billable
        )

    def _ruling(
        self, incurred_on: date, entered_at: datetime
    ) -> tuple[DecisionStatus, datetime | None, str | None]:
        """Whether an expense has been decided on, when, and why not if it was rejected."""
        rng = self.rng
        days_ago = (self.setting.today - incurred_on).days
        still_waiting = rng.random() < _STILL_WAITING
        if days_ago <= _NEVER_DECIDED_DAYS or (days_ago <= _WAITING_DAYS and still_waiting):
            return DecisionStatus.PENDING, None, None
        decided_at = min(
            entered_at + timedelta(days=rng.randint(1, 6), minutes=rng.randrange(_DAY_MINUTES)),
            self.setting.latest,
        )
        if rng.random() < _REJECTED:
            return DecisionStatus.REJECTED, decided_at, rng.choice(EXPENSE_REJECTIONS)
        return DecisionStatus.APPROVED, decided_at, None


def _initials(name: str) -> str:
    """`Clearwater Janitorial Supply` is CJ: how that vendor's invoice numbers start."""
    words = [word for word in name.split() if word[0].isalpha()]
    return "".join(word[0] for word in words[:2]).upper()
