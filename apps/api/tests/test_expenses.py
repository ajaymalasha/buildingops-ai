from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from buildingops.core.models import DecisionStatus, utcnow
from buildingops.core.permissions import Role
from buildingops.modules.expenses.models import ExpenseCategory
from tests.conftest import ActorFactory, Factory, audit_entries, problem

EXPENSES = "/api/v1/expenses"

APPROVED, REJECTED = DecisionStatus.APPROVED, DecisionStatus.REJECTED


def _new_expense(**overrides):
    payload = {
        "category": "supplies",
        "description": "Mop heads and bin liners",
        "amount": "245.1",
        "incurred_on": "2026-03-02",
    }
    payload.update(overrides)
    return payload


def test_an_expense_is_entered_as_pending_in_the_organizations_currency(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor(organization=factory.organization(currency="CAD"))
    organization = admin.organization
    tower = factory.building(organization, name="Tower One")
    contract = factory.contract(
        organization, buildings=[tower], contract_number="K-7", name="Cleaning"
    )
    supplier = factory.vendor(organization, name="Clearwater Supply")
    work_order = factory.work_order(organization, tower, number="WO-7", title="Restock closets")

    response = admin.post(
        EXPENSES,
        json=_new_expense(
            building_id=str(tower.id),
            contract_id=str(contract.id),
            vendor_id=str(supplier.id),
            work_order_id=str(work_order.id),
            reference="  CW-20418 ",
        ),
    )

    assert response.status_code == 201
    created = response.json()
    assert (created["amount"], created["currency"]) == ("245.10", "CAD")
    assert (created["status"], created["billable"], created["reference"]) == (
        "pending",
        True,
        "CW-20418",
    )
    assert created["building"] == {"id": str(tower.id), "name": "Tower One"}
    assert created["contract"] == {
        "id": str(contract.id),
        "contract_number": "K-7",
        "name": "Cleaning",
    }
    assert created["vendor"] == {"id": str(supplier.id), "name": "Clearwater Supply"}
    assert created["work_order"] == {
        "id": str(work_order.id),
        "number": "WO-7",
        "title": "Restock closets",
    }
    assert (created["decided_by_name"], created["decided_at"], created["rejection_reason"]) == (
        None,
        None,
        None,
    )
    assert admin.get(f"{EXPENSES}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "expense", created["id"])
    assert entry["action"] == "expense.created"
    assert entry["summary"] == "Entered expense Mop heads and bin liners (245.10 CAD)"
    assert entry["changes"]["amount"] == {"from": None, "to": "245.10"}


def test_an_expense_need_not_be_tied_to_anything(make_actor: ActorFactory):
    response = make_actor().post(EXPENSES, json=_new_expense(billable=False))

    assert response.status_code == 201
    created = response.json()
    assert (created["building"], created["contract"], created["vendor"], created["work_order"]) == (
        None,
        None,
        None,
        None,
    )
    assert created["billable"] is False


def test_an_expense_points_only_at_live_records_of_its_own_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization, elsewhere = admin.organization, factory.organization()
    archived = {"deleted_at": utcnow()}
    cases = [
        ("building_id", "Building not found.", factory.building(elsewhere)),
        ("building_id", "Building not found.", factory.building(organization, **archived)),
        ("contract_id", "Contract not found.", factory.contract(elsewhere)),
        ("vendor_id", "Vendor not found.", factory.vendor(elsewhere)),
        ("vendor_id", "Vendor not found.", factory.vendor(organization, **archived)),
        ("work_order_id", "Work order not found.", factory.work_order(elsewhere)),
    ]

    for field, message, record in cases:
        response = admin.post(EXPENSES, json=_new_expense(**{field: str(record.id)}))
        assert response.status_code == 422, (field, response.text)
        assert problem(response)["errors"] == [
            {"field": field, "message": message, "code": "not_found"}
        ]
    assert admin.get(EXPENSES).json()["total"] == 0


def test_a_contract_on_an_expense_must_cover_its_building(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    tower = factory.building(organization, name="Tower One")
    depot = factory.building(organization, name="Pier Nine Depot")
    contract = factory.contract(organization, buildings=[tower], contract_number="K-7")
    not_covered = {
        "message": "Contract K-7 does not cover Pier Nine Depot.",
        "code": "contract_does_not_cover_building",
    }

    refused = admin.post(
        EXPENSES, json=_new_expense(building_id=str(depot.id), contract_id=str(contract.id))
    )
    # A cost of the contract as a whole, for no building in particular, is fine.
    for_no_building = admin.post(EXPENSES, json=_new_expense(contract_id=str(contract.id)))

    assert refused.status_code == 422
    assert problem(refused)["errors"] == [{"field": "contract_id", **not_covered}]
    assert for_no_building.status_code == 201

    placed_wrongly = admin.patch(
        f"{EXPENSES}/{for_no_building.json()['id']}", json={"building_id": str(depot.id)}
    )
    assert placed_wrongly.status_code == 422
    assert problem(placed_wrongly)["errors"] == [{"field": "building_id", **not_covered}]


def test_updating_an_expense_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    expense = factory.expense(admin.organization, description="Floor pads", amount=Decimal("88.00"))

    response = admin.patch(
        f"{EXPENSES}/{expense.id}",
        json={"amount": "98.5", "category": "materials", "billable": False},
    )

    assert response.status_code == 200
    assert (response.json()["amount"], response.json()["billable"]) == ("98.50", False)
    (entry,) = audit_entries(admin, "expense", expense.id)
    assert entry["action"] == "expense.updated"
    assert entry["summary"] == "Updated expense Floor pads (88.00 USD): amount, billable, category"
    assert entry["changes"] == {
        "amount": {"from": "88.00", "to": "98.50"},
        "category": {"from": "supplies", "to": "materials"},
        "billable": {"from": True, "to": False},
    }


def test_an_expense_is_approved_rejected_and_reopened(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    expense = factory.expense(admin.organization, description="Floor pads", amount=Decimal("88.00"))
    url = f"{EXPENSES}/{expense.id}"

    approved = admin.post(f"{url}/approve")
    twice = admin.post(f"{url}/approve")
    reopened = admin.post(f"{url}/reopen")
    without_a_reason = admin.post(f"{url}/reject", json={"reason": ""})
    rejected = admin.post(f"{url}/reject", json={"reason": "No receipt attached."})

    assert [r.status_code for r in (approved, twice, reopened, without_a_reason, rejected)] == [
        200,
        409,
        200,
        422,
        200,
    ]
    assert (approved.json()["status"], approved.json()["decided_by_name"]) == (
        "approved",
        admin.user.full_name,
    )
    assert problem(twice)["detail"] == (
        "This expense has already been approved. Reopen it to decide again."
    )
    assert (reopened.json()["status"], reopened.json()["decided_at"]) == ("pending", None)
    assert problem(without_a_reason)["errors"][0]["field"] == "reason"
    assert (rejected.json()["status"], rejected.json()["rejection_reason"]) == (
        "rejected",
        "No receipt attached.",
    )
    entries = audit_entries(admin, "expense", expense.id)
    assert [(entry["action"], entry["summary"]) for entry in entries] == [
        ("expense.rejected", "Rejected expense Floor pads (88.00 USD)"),
        ("expense.reopened", "Reopened expense Floor pads (88.00 USD)"),
        ("expense.approved", "Approved expense Floor pads (88.00 USD)"),
    ]
    assert entries[0]["changes"]["rejection_reason"] == {
        "from": None,
        "to": "No receipt attached.",
    }
    assert entries[1]["changes"]["status"] == {"from": "approved", "to": "pending"}
    assert entries[2]["changes"]["decided_by_name"] == {"from": None, "to": admin.user.full_name}

    still_pending = factory.expense(admin.organization)
    nothing_to_reopen = admin.post(f"{EXPENSES}/{still_pending.id}/reopen")
    assert nothing_to_reopen.status_code == 409
    assert problem(nothing_to_reopen)["detail"] == (
        "This expense is still pending. There is no decision to reopen."
    )


@pytest.mark.parametrize("status", [APPROVED, REJECTED])
def test_a_decided_expense_cannot_be_edited_until_it_is_reopened(
    make_actor: ActorFactory, factory: Factory, status: DecisionStatus
):
    admin = make_actor()
    expense = factory.expense(admin.organization, amount=Decimal("88.00"), status=status)
    url = f"{EXPENSES}/{expense.id}"

    refused = admin.patch(url, json={"amount": "880.00"})

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        f"This expense has been {status.value}, and only a pending expense can be changed."
        " Reopen it first."
    )
    assert admin.get(url).json()["amount"] == "88.00"

    assert admin.post(f"{url}/reopen").status_code == 200
    assert admin.patch(url, json={"amount": "880.00"}).json()["amount"] == "880.00"


def test_supervisors_enter_expenses_but_managers_decide_on_them(
    make_actor: ActorFactory, factory: Factory
):
    organization = factory.organization()
    supervisor = make_actor(Role.SUPERVISOR, organization=organization)
    manager = make_actor(Role.OPERATIONS_MANAGER, organization=organization)

    entered = supervisor.post(EXPENSES, json=_new_expense())
    url = f"{EXPENSES}/{entered.json()['id']}"
    edited = supervisor.patch(url, json={"amount": "250"})
    decisions = [
        supervisor.post(f"{url}/approve"),
        supervisor.post(f"{url}/reject", json={"reason": "Too much"}),
        supervisor.post(f"{url}/reopen"),
    ]

    assert (entered.status_code, edited.status_code) == (201, 200)
    assert {response.status_code for response in decisions} == {403}
    assert supervisor.get(url).json()["status"] == "pending"
    assert manager.post(f"{url}/approve").json()["decided_by_name"] == manager.user.full_name


def test_listing_supports_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    tower = factory.building(organization)
    contract = factory.contract(organization, buildings=[tower])
    supplier = factory.vendor(organization)

    def add(description: str, day: int, amount: str, **fields) -> None:
        factory.expense(
            organization,
            description=description,
            incurred_on=date(2026, 3, day),
            amount=Decimal(amount),
            created_at=datetime(2026, 3, 20 - day, tzinfo=UTC),
            **fields,
        )

    add("Liners", 2, "40.00", vendor_id=supplier.id)
    add("Scrubber rental", 5, "310.00", category=ExpenseCategory.EQUIPMENT, building_id=tower.id)
    add(
        "Glass repair",
        9,
        "1250.00",
        category=ExpenseCategory.SUBCONTRACTOR,
        building_id=tower.id,
        contract_id=contract.id,
        status=APPROVED,
    )
    add("Parking", 12, "18.50", category=ExpenseCategory.TRAVEL, status=REJECTED)
    factory.expense(factory.organization(), description="Liners of Another Company")

    def descriptions(**params) -> list[str]:
        response = admin.get(EXPENSES, params=params)
        assert response.status_code == 200, response.text
        return [item["description"] for item in response.json()["items"]]

    assert admin.get(EXPENSES).json()["total"] == 4
    # Most recently incurred first.
    assert descriptions() == ["Parking", "Glass repair", "Scrubber rental", "Liners"]
    assert descriptions(sort="amount") == ["Parking", "Liners", "Scrubber rental", "Glass repair"]
    assert descriptions(sort="-amount")[0] == "Glass repair"
    assert descriptions(sort="-created_at")[0] == descriptions(sort="incurred_on")[0] == "Liners"
    assert descriptions(status="pending") == ["Scrubber rental", "Liners"]
    assert descriptions(category="travel") == ["Parking"]
    assert descriptions(building_id=str(tower.id)) == ["Glass repair", "Scrubber rental"]
    assert descriptions(contract_id=str(contract.id)) == ["Glass repair"]
    assert descriptions(vendor_id=str(supplier.id)) == ["Liners"]
    assert descriptions(**{"from": "2026-03-05", "to": "2026-03-09"}) == [
        "Glass repair",
        "Scrubber rental",
    ]
    assert descriptions(to="2026-03-02") == ["Liners"]
    backwards = admin.get(EXPENSES, params={"from": "2026-03-09", "to": "2026-03-05"})
    assert backwards.status_code == 422
    assert admin.get(EXPENSES, params={"sort": "description"}).status_code == 422


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    response = make_actor().post(
        EXPENSES,
        json={
            "category": "bribes",
            "description": "",
            "amount": "0",
            "incurred_on": "last Tuesday",
            "building_id": "not-an-id",
            "billable": "maybe",
            "reference": "x" * 101,
            # Neither of these is the client's to say.
            "currency": "EUR",
            "status": "approved",
        },
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "category",
        "description",
        "amount",
        "incurred_on",
        "building_id",
        "billable",
        "reference",
        "currency",
        "status",
    }


def test_an_amount_is_money_with_at_most_two_decimal_places(make_actor: ActorFactory):
    admin = make_actor()

    for amount in ("-5", "0.00", "12.345", "abc", "10000000000.00"):
        response = admin.post(EXPENSES, json=_new_expense(amount=amount))
        assert response.status_code == 422, amount
        assert [error["field"] for error in problem(response)["errors"]] == ["amount"]

    assert admin.post(EXPENSES, json=_new_expense(amount="0.01")).json()["amount"] == "0.01"
    assert (
        admin.post(EXPENSES, json=_new_expense(amount="9999999999.99")).json()["amount"]
        == "9999999999.99"
    )


def test_expenses_of_another_organization_are_not_found(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    foreign = factory.expense(factory.organization())
    url = f"{EXPENSES}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"description": "Taken over"}).status_code == 404
    assert admin.post(f"{url}/approve").status_code == 404
    assert admin.post(f"{url}/reject", json={"reason": "Not ours"}).status_code == 404
    assert admin.post(f"{url}/reopen").status_code == 404
    assert problem(admin.get(url))["detail"] == "Expense not found."
    assert admin.get(EXPENSES).json()["total"] == 0
