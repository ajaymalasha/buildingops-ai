import uuid

from buildingops.core.models import utcnow
from buildingops.modules.buildings.models import BuildingStatus, BuildingType
from buildingops.modules.contracts.models import ContractStatus
from buildingops.modules.customers.models import Customer
from tests.conftest import ActorFactory, Factory, audit_entries, problem

BUILDINGS = "/api/v1/buildings"


def _new_building(customer: Customer, **overrides):
    payload = {
        "customer_id": str(customer.id),
        "name": "Tower One",
        "building_type": "office",
        "address_line1": "410 Hollis Street",
        "city": "New York",
    }
    payload.update(overrides)
    return payload


def test_a_building_is_created_for_a_customer_with_the_next_code(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty", code="HBR")

    response = admin.post(
        BUILDINGS, json=_new_building(customer, square_feet=182_000, floors=14, region="NY")
    )

    assert response.status_code == 201
    created = response.json()
    assert created["code"] == "BLD-0001"
    assert created["customer"] == {"id": str(customer.id), "name": "Harbor Realty", "code": "HBR"}
    assert (created["status"], created["country"], created["square_feet"], created["floors"]) == (
        "active",
        "US",
        182_000,
        14,
    )
    assert admin.get(f"{BUILDINGS}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "building", created["id"])
    assert entry["action"] == "building.created"
    assert entry["summary"] == "Created building Tower One (BLD-0001) for Harbor Realty"
    assert entry["changes"]["customer_id"] == {"from": None, "to": str(customer.id)}


def test_listing_supports_search_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    factory.building(organization, harbor, name="Tower One", city="New York", square_feet=182_000)
    factory.building(
        organization,
        harbor,
        name="Pier Nine Depot",
        city="Jersey City",
        address_line1="9 Wharf Road",
        building_type=BuildingType.INDUSTRIAL,
        status=BuildingStatus.ONBOARDING,
    )
    factory.building(
        organization, calloway, name="Calloway Clinic", city="Albany", square_feet=24_000
    )
    factory.building(organization, harbor, name="Demolished Annex", deleted_at=utcnow())
    factory.building(factory.organization(), name="Tower of Another Company")

    def names(**params) -> list[str]:
        response = admin.get(BUILDINGS, params=params)
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]

    assert names() == ["Calloway Clinic", "Pier Nine Depot", "Tower One"]
    assert names(customer_id=str(harbor.id)) == ["Pier Nine Depot", "Tower One"]
    assert names(building_type="industrial") == names(status="onboarding") == ["Pier Nine Depot"]
    assert names(q="wharf") == ["Pier Nine Depot"]
    assert names(q="calloway group") == ["Calloway Clinic"]  # the customer's name matches too
    assert names(sort="city") == ["Calloway Clinic", "Pier Nine Depot", "Tower One"]
    # Buildings without a figure come last, whichever way the list is sorted.
    assert names(sort="square_feet") == ["Calloway Clinic", "Tower One", "Pier Nine Depot"]
    assert names(sort="-square_feet") == ["Tower One", "Calloway Clinic", "Pier Nine Depot"]


def test_a_building_needs_a_live_customer_from_the_same_organization(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.customer(factory.organization())
    archived = factory.customer(admin.organization, deleted_at=utcnow())

    responses = [admin.post(BUILDINGS, json=_new_building(c)) for c in (foreign, archived)]
    responses.append(
        admin.post(BUILDINGS, json={**_new_building(foreign), "customer_id": str(uuid.uuid4())})
    )

    for response in responses:
        assert response.status_code == 422
        assert problem(response)["errors"] == [
            {"field": "customer_id", "message": "Customer not found.", "code": "not_found"}
        ]
    assert admin.get(BUILDINGS).json()["total"] == 0


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)

    response = admin.post(
        BUILDINGS,
        json={
            "customer_id": str(customer.id),
            "name": "Tower One",
            "building_type": "castle",
            "city": "",
            "square_feet": 0,
            "floors": -2,
            "country": "U1",
        },
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "building_type",
        "address_line1",
        "city",
        "square_feet",
        "floors",
        "country",
    }


def test_a_code_that_is_taken_is_a_conflict(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)
    factory.building(admin.organization, customer, code="HQ")
    other = factory.building(admin.organization, customer)

    on_create = admin.post(BUILDINGS, json=_new_building(customer, code="hq"))
    on_update = admin.patch(f"{BUILDINGS}/{other.id}", json={"code": "HQ"})

    assert on_create.status_code == on_update.status_code == 409
    assert problem(on_update)["errors"] == [{"field": "code", "message": "HQ is already in use."}]


def test_buildings_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.building(factory.organization())
    url = f"{BUILDINGS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"name": "Taken over"}).status_code == 404
    assert admin.delete(url).status_code == 404


def test_updating_a_building_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    building = factory.building(admin.organization, name="Tower One", code="T1", floors=12)

    response = admin.patch(
        f"{BUILDINGS}/{building.id}", json={"status": "inactive", "floors": 14, "notes": "Annex"}
    )

    assert response.status_code == 200
    assert (response.json()["status"], response.json()["floors"]) == ("inactive", 14)
    (entry,) = audit_entries(admin, "building", building.id)
    assert entry["action"] == "building.updated"
    assert entry["summary"] == "Updated building Tower One (T1): floors, notes, status"
    assert entry["changes"] == {
        "status": {"from": "active", "to": "inactive"},
        "floors": {"from": 12, "to": 14},
        "notes": {"from": None, "to": "Annex"},
    }


def test_required_fields_cannot_be_cleared(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    building = factory.building(admin.organization)

    response = admin.patch(
        f"{BUILDINGS}/{building.id}", json={"customer_id": None, "address_line1": None}
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "customer_id",
        "address_line1",
    }


def test_a_building_moves_to_another_customer_only_when_off_its_contracts(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    seller = factory.customer(organization, name="Harbor Realty")
    buyer = factory.customer(organization, name="Calloway Group")
    building = factory.building(organization, seller, name="Tower One")
    contract = factory.contract(organization, seller, buildings=[building], contract_number="K-7")
    url = f"{BUILDINGS}/{building.id}"

    refused = admin.patch(url, json={"customer_id": str(buyer.id)})

    assert refused.status_code == 422
    assert problem(refused)["errors"] == [
        {
            "field": "customer_id",
            "message": (
                "Tower One is on 1 contract of its current customer (K-7)."
                " Take it off before moving it to another customer."
            ),
            "code": "building_under_contract",
        }
    ]

    admin.patch(f"/api/v1/contracts/{contract.id}", json={"building_ids": []})
    moved = admin.patch(url, json={"customer_id": str(buyer.id)})

    assert moved.status_code == 200
    assert moved.json()["customer"]["name"] == "Calloway Group"
    assert audit_entries(admin, "building", building.id)[0]["changes"] == {
        "customer_id": {"from": str(seller.id), "to": str(buyer.id)}
    }


def test_a_building_in_use_cannot_be_archived(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization)
    building = factory.building(organization, customer, name="Tower One", code="T1")
    employee = factory.employee(organization)
    assignment = factory.assignment(employee, building)
    contract = factory.contract(
        organization, customer, buildings=[building], status=ContractStatus.ACTIVE
    )
    url = f"{BUILDINGS}/{building.id}"

    refused = admin.delete(url)

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        "Tower One still has 1 open assignment and 1 active contract."
        " Before archiving, end its assignments and take it off its active contracts."
    )

    # An ended assignment and a contract that is no longer active do not hold it.
    admin.patch(
        f"/api/v1/employees/{employee.id}/assignments/{assignment.id}",
        json={"ends_on": "2026-06-30"},
    )
    admin.patch(f"/api/v1/contracts/{contract.id}", json={"status": "expired"})

    assert admin.delete(url).status_code == 204
    assert admin.get(url).status_code == 404
    assert admin.get(BUILDINGS).json()["total"] == 0
    entry = audit_entries(admin, "building", building.id)[0]
    assert (entry["action"], entry["summary"]) == (
        "building.archived",
        "Archived building Tower One (T1)",
    )
