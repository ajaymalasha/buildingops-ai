from datetime import date
from decimal import Decimal

from buildingops.core.models import utcnow
from buildingops.modules.contracts.models import BillingModel, ContractStatus
from buildingops.modules.customers.models import Customer
from tests.conftest import ActorFactory, Factory, audit_entries, problem

CONTRACTS = "/api/v1/contracts"


def _new_contract(customer: Customer, **overrides):
    payload = {
        "customer_id": str(customer.id),
        "name": "Janitorial services",
        "billing_model": "time_and_materials",
        "start_date": "2026-01-01",
    }
    payload.update(overrides)
    return payload


def test_a_contract_is_created_with_its_buildings(make_actor: ActorFactory, factory: Factory):
    admin = make_actor(organization=factory.organization(currency="CAD"))
    organization = admin.organization
    customer = factory.customer(organization, name="Harbor Realty")
    tower = factory.building(organization, customer, name="Tower One", code="T1")
    depot = factory.building(organization, customer, name="Pier Nine Depot", code="P9")

    response = admin.post(
        CONTRACTS, json=_new_contract(customer, building_ids=[str(tower.id), str(depot.id)])
    )

    assert response.status_code == 201
    created = response.json()
    assert created["contract_number"] == "CTR-0001"
    assert created["customer"] == {"id": str(customer.id), "name": "Harbor Realty"}
    # A draft, in the organization's currency, unless the request says otherwise.
    assert (created["status"], created["currency"], created["payment_terms_days"]) == (
        "draft",
        "CAD",
        30,
    )
    assert created["building_count"] == 2
    assert created["buildings"] == [
        {"id": str(depot.id), "name": "Pier Nine Depot", "code": "P9"},
        {"id": str(tower.id), "name": "Tower One", "code": "T1"},
    ]
    assert admin.get(f"{CONTRACTS}/{created['id']}").json() == created

    buildings_changed, contract_created = audit_entries(admin, "contract", created["id"])
    assert contract_created["action"] == "contract.created"
    assert contract_created["summary"] == (
        "Created contract CTR-0001 (Janitorial services) for Harbor Realty"
    )
    assert buildings_changed["action"] == "contract.buildings_changed"
    assert buildings_changed["summary"] == (
        "Changed the buildings on contract CTR-0001 (Janitorial services):"
        " added Pier Nine Depot, Tower One"
    )
    assert buildings_changed["changes"] == {
        "building_ids": {"from": [], "to": sorted([str(tower.id), str(depot.id)])}
    }


def test_each_billing_model_needs_the_figure_it_bills_from(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization)

    def create(**fields):
        return admin.post(CONTRACTS, json=_new_contract(customer, **fields))

    no_markup = create(billing_model="cost_plus", monthly_fee="900")
    no_fee = create(billing_model="fixed_fee", markup_percent="10")
    cost_plus = create(billing_model="cost_plus", markup_percent=12.5)
    fixed_fee = create(billing_model="fixed_fee", monthly_fee="4800")

    assert no_markup.status_code == no_fee.status_code == 422
    assert problem(no_markup)["errors"] == [
        {
            "field": "markup_percent",
            "message": "A cost-plus contract needs a markup percentage.",
            "code": "required",
        }
    ]
    assert problem(no_fee)["errors"] == [
        {
            "field": "monthly_fee",
            "message": "A fixed-fee contract needs a monthly fee.",
            "code": "required",
        }
    ]
    assert (cost_plus.status_code, cost_plus.json()["markup_percent"]) == (201, "12.50")
    assert (fixed_fee.status_code, fixed_fee.json()["monthly_fee"]) == (201, "4800.00")


def test_the_billing_rules_also_hold_when_a_contract_changes(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    contract = factory.contract(
        admin.organization,
        billing_model=BillingModel.COST_PLUS,
        markup_percent=Decimal("15.00"),
    )
    url = f"{CONTRACTS}/{contract.id}"

    dropped_markup = admin.patch(url, json={"markup_percent": None})
    switched_without_fee = admin.patch(url, json={"billing_model": "fixed_fee"})
    switched = admin.patch(url, json={"billing_model": "fixed_fee", "monthly_fee": "2500"})

    assert dropped_markup.status_code == switched_without_fee.status_code == 422
    assert problem(dropped_markup)["errors"][0]["field"] == "markup_percent"
    assert problem(switched_without_fee)["errors"][0]["field"] == "monthly_fee"
    assert switched.status_code == 200
    assert (switched.json()["billing_model"], switched.json()["monthly_fee"]) == (
        "fixed_fee",
        "2500.00",
    )


def test_a_contract_cannot_end_before_it_starts(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)
    contract = factory.contract(admin.organization, customer, end_date=date(2026, 12, 31))

    on_create = admin.post(CONTRACTS, json=_new_contract(customer, end_date="2025-12-31"))
    on_update = admin.patch(f"{CONTRACTS}/{contract.id}", json={"start_date": "2027-01-01"})

    assert on_create.status_code == on_update.status_code == 422
    assert problem(on_update)["errors"] == [
        {
            "field": "end_date",
            "message": "The end date cannot be before the start date (2027-01-01).",
            "code": "ends_before_start",
        }
    ]


def test_a_contract_covers_only_live_buildings_of_its_own_customer(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    own = factory.building(organization, customer, name="Tower One")
    someone_elses = factory.building(organization, name="Calloway Clinic")
    archived = factory.building(organization, customer, name="Old Annex", deleted_at=utcnow())
    foreign = factory.building(factory.organization())

    def refusal(*buildings) -> list[str]:
        ids = [str(building.id) for building in buildings]
        response = admin.post(CONTRACTS, json=_new_contract(customer, building_ids=ids))
        assert response.status_code == 422, response.text
        errors = problem(response)["errors"]
        assert {error["field"] for error in errors} == {"building_ids"}
        return [error["message"] for error in errors]

    assert refusal(own, someone_elses) == ["Calloway Clinic belongs to another customer."]
    assert refusal(archived) == ["Old Annex has been archived."]
    assert refusal(foreign) == ["Building not found."]
    assert admin.get(CONTRACTS).json()["total"] == 0


def test_replacing_the_buildings_records_what_was_added_and_removed(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    tower = factory.building(organization, customer, name="Tower One")
    depot = factory.building(organization, customer, name="Pier Nine Depot")
    clinic = factory.building(organization, customer, name="Harbor Clinic")
    contract = factory.contract(
        organization, customer, buildings=[tower, depot], contract_number="K-7", name="Cleaning"
    )
    url = f"{CONTRACTS}/{contract.id}"

    replaced = admin.patch(url, json={"building_ids": [str(depot.id), str(clinic.id)]})

    assert replaced.status_code == 200
    assert [building["name"] for building in replaced.json()["buildings"]] == [
        "Harbor Clinic",
        "Pier Nine Depot",
    ]
    assert replaced.json()["updated_at"] > replaced.json()["created_at"]
    (entry,) = audit_entries(admin, "contract", contract.id)
    assert entry["action"] == "contract.buildings_changed"
    assert entry["summary"] == (
        "Changed the buildings on contract K-7 (Cleaning): added Harbor Clinic; removed Tower One"
    )
    assert entry["changes"] == {
        "building_ids": {
            "from": sorted([str(tower.id), str(depot.id)]),
            "to": sorted([str(depot.id), str(clinic.id)]),
        }
    }

    # Leaving the list out keeps it, sending the same list changes nothing, and an empty
    # list clears it.
    untouched = admin.patch(url, json={"notes": "Renewal due in the autumn"})
    same = admin.patch(url, json={"building_ids": [str(clinic.id), str(depot.id)]})
    assert untouched.json()["building_count"] == same.json()["building_count"] == 2
    assert admin.patch(url, json={"building_ids": []}).json()["buildings"] == []
    assert [entry["action"] for entry in audit_entries(admin, "contract", contract.id)] == [
        "contract.buildings_changed",
        "contract.updated",
        "contract.buildings_changed",
    ]


def test_a_long_list_of_buildings_is_summarized_as_a_count(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization)
    buildings = [factory.building(admin.organization, customer) for _ in range(4)]
    contract = factory.contract(
        admin.organization, customer, contract_number="K-7", name="Cleaning"
    )

    admin.patch(
        f"{CONTRACTS}/{contract.id}",
        json={"building_ids": [str(building.id) for building in buildings]},
    )

    (entry,) = audit_entries(admin, "contract", contract.id)
    assert entry["summary"] == "Changed the buildings on contract K-7 (Cleaning): added 4 buildings"
    assert len(entry["changes"]["building_ids"]["to"]) == 4


def test_contract_numbers_are_unique(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)
    other = factory.contract(admin.organization, customer)

    typed = admin.post(CONTRACTS, json=_new_contract(customer, contract_number="ctr-0001"))
    duplicate = admin.post(CONTRACTS, json=_new_contract(customer, contract_number="CTR-0001"))
    renumbered = admin.patch(f"{CONTRACTS}/{other.id}", json={"contract_number": "CTR-0001"})
    generated = admin.post(CONTRACTS, json=_new_contract(customer))

    assert typed.json()["contract_number"] == "CTR-0001"
    assert duplicate.status_code == renumbered.status_code == 409
    assert problem(duplicate)["errors"] == [
        {"field": "contract_number", "message": "CTR-0001 is already in use."}
    ]
    assert generated.json()["contract_number"] == "CTR-0002"  # the typed number is skipped


def test_listing_supports_search_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    tower = factory.building(organization, harbor)
    factory.contract(
        organization,
        harbor,
        buildings=[tower],
        name="Cleaning",
        contract_number="K-1",
        status=ContractStatus.ACTIVE,
        start_date=date(2025, 7, 1),
        end_date=date(2027, 6, 30),
    )
    factory.contract(
        organization,
        harbor,
        name="Window washing",
        contract_number="K-2",
        billing_model=BillingModel.FIXED_FEE,
        monthly_fee=Decimal("1200.00"),
        start_date=date(2026, 1, 1),
    )
    factory.contract(
        organization,
        calloway,
        name="Grounds",
        contract_number="K-3",
        status=ContractStatus.TERMINATED,
        start_date=date(2024, 4, 1),
        end_date=date(2025, 3, 31),
    )
    factory.contract(factory.organization(), name="Cleaning for Another Company")

    def names(**params) -> list[str]:
        response = admin.get(CONTRACTS, params=params)
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]

    listed = admin.get(CONTRACTS).json()
    assert listed["total"] == 3
    assert names() == ["Cleaning", "Grounds", "Window washing"]
    assert names(customer_id=str(harbor.id)) == ["Cleaning", "Window washing"]
    assert names(status="active") == ["Cleaning"]
    assert names(billing_model="fixed_fee") == ["Window washing"]
    assert names(q="k-3") == names(q="calloway") == ["Grounds"]
    assert names(sort="-start_date") == ["Window washing", "Cleaning", "Grounds"]
    # An open-ended contract has no end date, and comes last.
    assert names(sort="end_date") == ["Grounds", "Cleaning", "Window washing"]
    assert [(item["name"], item["building_count"]) for item in listed["items"]] == [
        ("Cleaning", 1),
        ("Grounds", 0),
        ("Window washing", 0),
    ]
    assert "buildings" not in listed["items"][0]


def test_listing_can_be_narrowed_to_the_contracts_that_cover_a_building(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    tower = factory.building(organization, harbor, name="Tower One")
    depot = factory.building(organization, harbor, name="Pier Nine Depot")
    garage = factory.building(organization, harbor, name="Harbor Garage")
    factory.contract(organization, harbor, buildings=[tower, depot], name="Cleaning")
    factory.contract(
        organization, harbor, buildings=[tower], name="Day porters", status=ContractStatus.EXPIRED
    )
    factory.contract(organization, harbor, name="Grounds")
    elsewhere = factory.organization()
    their_building = factory.building(elsewhere)
    factory.contract(elsewhere, buildings=[their_building], name="Cleaning for Another Company")

    def names(building_id: object, **params) -> list[str]:
        response = admin.get(CONTRACTS, params={"building_id": str(building_id), **params})
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]

    # What work at a building can be booked to, whatever state the contract is in.
    assert names(tower.id) == ["Cleaning", "Day porters"]
    assert names(depot.id) == ["Cleaning"]
    assert names(garage.id) == []
    assert names(tower.id, status="expired") == ["Day porters"]
    # Another organization's building is covered by nothing here.
    assert names(their_building.id) == []
    assert admin.get(CONTRACTS, params={"building_id": "tower"}).status_code == 422


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)

    response = admin.post(
        CONTRACTS,
        json=_new_contract(
            customer,
            name="",
            billing_model="barter",
            start_date="January",
            markup_percent="500.01",
            monthly_fee="-1",
            currency="usd",
            payment_terms_days=365,
            building_ids="all",
        ),
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "name",
        "billing_model",
        "start_date",
        "markup_percent",
        "monthly_fee",
        "currency",
        "payment_terms_days",
        "building_ids",
    }


def test_contracts_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.contract(factory.organization())
    foreign_customer = factory.customer(factory.organization())
    url = f"{CONTRACTS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"status": "terminated"}).status_code == 404
    refused = admin.post(CONTRACTS, json=_new_contract(foreign_customer))
    assert refused.status_code == 422
    assert problem(refused)["errors"][0] == {
        "field": "customer_id",
        "message": "Customer not found.",
        "code": "not_found",
    }


def test_contracts_end_by_status_and_cannot_be_deleted(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    contract = factory.contract(
        admin.organization, contract_number="K-7", name="Cleaning", status=ContractStatus.ACTIVE
    )
    url = f"{CONTRACTS}/{contract.id}"

    assert admin.delete(url).status_code == 405

    ended = admin.patch(url, json={"status": "terminated", "end_date": "2026-09-30"})

    assert ended.status_code == 200
    (entry,) = audit_entries(admin, "contract", contract.id)
    assert entry["action"] == "contract.updated"
    assert entry["summary"] == "Updated contract K-7 (Cleaning): end date, status"
    assert entry["changes"] == {
        "status": {"from": "active", "to": "terminated"},
        "end_date": {"from": None, "to": "2026-09-30"},
    }


def test_changing_the_customer_takes_the_buildings_with_it(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    tower = factory.building(organization, harbor, name="Tower One")
    clinic = factory.building(organization, calloway, name="Calloway Clinic")
    contract = factory.contract(organization, harbor, buildings=[tower])
    url = f"{CONTRACTS}/{contract.id}"

    customer_only = admin.patch(url, json={"customer_id": str(calloway.id)})
    with_buildings = admin.patch(
        url, json={"customer_id": str(calloway.id), "building_ids": [str(clinic.id)]}
    )

    assert customer_only.status_code == 422
    assert problem(customer_only)["errors"] == [
        {"field": "customer_id", "message": "Tower One belongs to another customer."}
    ]
    assert with_buildings.status_code == 200
    assert with_buildings.json()["customer"]["name"] == "Calloway Group"
    assert [b["name"] for b in with_buildings.json()["buildings"]] == ["Calloway Clinic"]


def test_a_contract_cannot_become_active_while_one_of_its_buildings_is_archived(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    tower = factory.building(organization, customer, name="Tower One")
    draft = factory.contract(organization, customer, buildings=[tower])
    url = f"{CONTRACTS}/{draft.id}"
    # A draft does not hold a building in place, and keeps it listed once it is archived.
    assert admin.delete(f"/api/v1/buildings/{tower.id}").status_code == 204
    assert admin.get(url).json()["building_count"] == 1

    refused = admin.patch(url, json={"status": "active"})
    accepted = admin.patch(url, json={"status": "active", "building_ids": []})

    assert refused.status_code == 422
    assert problem(refused)["errors"] == [
        {"field": "status", "message": "Tower One has been archived."}
    ]
    assert accepted.status_code == 200


def test_reopening_a_contract_checks_its_buildings_again(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    tower = factory.building(organization, harbor, name="Tower One")
    ended = factory.contract(
        organization, harbor, buildings=[tower], status=ContractStatus.TERMINATED
    )
    url = f"{CONTRACTS}/{ended.id}"
    # A terminated contract no longer ties a building to its customer.
    sold = admin.patch(f"/api/v1/buildings/{tower.id}", json={"customer_id": str(calloway.id)})
    assert sold.status_code == 200

    reopened = admin.patch(url, json={"status": "draft"})
    reopened_without_it = admin.patch(url, json={"status": "draft", "building_ids": []})

    assert reopened.status_code == 422
    assert problem(reopened)["errors"] == [
        {"field": "status", "message": "Tower One belongs to another customer."}
    ]
    assert reopened_without_it.status_code == 200


def test_a_terminated_contract_of_an_archived_customer_stays_terminated(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty")
    contract = factory.contract(admin.organization, customer, status=ContractStatus.TERMINATED)
    url = f"{CONTRACTS}/{contract.id}"
    assert admin.delete(f"/api/v1/customers/{customer.id}").status_code == 204

    reopened = admin.patch(url, json={"status": "active"})
    annotated = admin.patch(url, json={"notes": "Closed out in full"})

    assert reopened.status_code == 422
    assert problem(reopened)["errors"] == [
        {
            "field": "status",
            "message": "This contract's customer has been archived, so it cannot be reopened.",
            "code": "customer_archived",
        }
    ]
    # It is still on record, with the customer it was for.
    assert annotated.status_code == 200
    assert annotated.json()["customer"] == {"id": str(customer.id), "name": "Harbor Realty"}
    # And no new contract can be written for a customer that is gone.
    assert admin.post(CONTRACTS, json=_new_contract(customer)).status_code == 422
