from buildingops.core.models import utcnow
from buildingops.core.permissions import Role
from buildingops.modules.contracts.models import ContractStatus
from buildingops.modules.customers.models import CustomerStatus
from tests.conftest import ActorFactory, Factory, audit_entries, problem

CUSTOMERS = "/api/v1/customers"


def test_a_customer_gets_defaults_and_the_next_code_in_sequence(make_actor: ActorFactory):
    admin = make_actor(Role.COMPANY_ADMIN)

    first = admin.post(CUSTOMERS, json={"name": "Harbor Realty"})
    second = admin.post(CUSTOMERS, json={"name": "Calloway Group"})

    assert first.status_code == 201
    created = first.json()
    assert created["code"] == "CUS-0001"
    assert second.json()["code"] == "CUS-0002"
    assert (created["status"], created["country"], created["payment_terms_days"]) == (
        "active",
        "US",
        30,
    )
    assert created["building_count"] == 0
    assert admin.get(f"{CUSTOMERS}/{created['id']}").json() == created


def test_codes_are_numbered_separately_in_each_organization(make_actor: ActorFactory):
    alpha, bravo = make_actor(), make_actor()
    alpha.post(CUSTOMERS, json={"name": "Alpha's first"})

    assert bravo.post(CUSTOMERS, json={"name": "Bravo's first"}).json()["code"] == "CUS-0001"


def test_a_typed_code_is_kept_in_upper_case_and_never_issued_again(make_actor: ActorFactory):
    admin = make_actor()

    typed = admin.post(CUSTOMERS, json={"name": "Typed by hand", "code": " cus-0001 "})
    generated = admin.post(CUSTOMERS, json={"name": "Generated"})

    assert typed.json()["code"] == "CUS-0001"
    assert generated.json()["code"] == "CUS-0002"


def test_a_code_that_is_taken_is_a_conflict_on_the_code_field(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    existing = factory.customer(admin.organization, code="ACME")
    other = factory.customer(admin.organization)

    on_create = admin.post(CUSTOMERS, json={"name": "Another", "code": "acme"})
    on_update = admin.patch(f"{CUSTOMERS}/{other.id}", json={"code": "ACME"})
    keeping_its_own = admin.patch(
        f"{CUSTOMERS}/{existing.id}", json={"code": "ACME", "name": "Acme Holdings"}
    )

    assert on_create.status_code == on_update.status_code == 409
    assert problem(on_create)["errors"] == [{"field": "code", "message": "ACME is already in use."}]
    assert keeping_its_own.status_code == 200


def test_listing_supports_search_filters_sorting_and_paging(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(
        organization, name="Harbor Realty", code="HBR", contact_name="Ana Sol"
    )
    factory.customer(
        organization, name="Calloway Group", code="CLW", status=CustomerStatus.PROSPECT
    )
    factory.customer(organization, name="Zenith Holdings", code="ZEN")
    factory.customer(organization, name="Archived Estates", deleted_at=utcnow())
    factory.customer(factory.organization(), name="Harbor of Another Company")
    factory.building(organization, harbor)
    factory.building(organization, harbor)
    factory.building(organization, harbor, deleted_at=utcnow())

    def names(**params) -> list[str]:
        return [item["name"] for item in admin.get(CUSTOMERS, params=params).json()["items"]]

    everything = admin.get(CUSTOMERS).json()
    assert everything["total"] == 3
    assert names() == ["Calloway Group", "Harbor Realty", "Zenith Holdings"]
    assert names(q="harbor") == names(q="ana sol") == names(q="hbr") == ["Harbor Realty"]
    assert names(status="prospect") == ["Calloway Group"]
    assert names(sort="-code") == ["Zenith Holdings", "Harbor Realty", "Calloway Group"]
    assert names(page_size=1, page=2) == ["Harbor Realty"]
    # Archived buildings are not counted.
    assert {item["name"]: item["building_count"] for item in everything["items"]} == {
        "Calloway Group": 0,
        "Harbor Realty": 2,
        "Zenith Holdings": 0,
    }


def test_sorting_by_an_unknown_field_is_rejected(make_actor: ActorFactory):
    response = make_actor().get(CUSTOMERS, params={"sort": "notes"})

    assert response.status_code == 422
    assert problem(response)["errors"][0]["field"] == "sort"


def test_customers_of_another_organization_are_not_found(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    foreign = factory.customer(factory.organization(), name="Someone Else's")
    url = f"{CUSTOMERS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"name": "Taken over"}).status_code == 404
    assert admin.delete(url).status_code == 404
    assert problem(admin.get(url))["detail"] == "Customer not found."


def test_creating_a_customer_is_audited_with_its_starting_values(make_actor: ActorFactory):
    admin = make_actor()

    created = admin.post(
        CUSTOMERS, json={"name": "Harbor Realty", "email": "AP@harbor.example", "phone": ""}
    ).json()

    (entry,) = audit_entries(admin, "customer", created["id"])
    assert entry["action"] == "customer.created"
    assert entry["summary"] == "Created customer Harbor Realty (CUS-0001)"
    assert entry["changes"] == {
        "name": {"from": None, "to": "Harbor Realty"},
        "code": {"from": None, "to": "CUS-0001"},
        "status": {"from": None, "to": "active"},
        "email": {"from": None, "to": "AP@harbor.example"},
        "country": {"from": None, "to": "US"},
        "payment_terms_days": {"from": None, "to": 30},
    }


def test_updating_a_customer_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(
        admin.organization, name="Harbor Realty", code="HBR", phone="212-555-0100"
    )

    response = admin.patch(
        f"{CUSTOMERS}/{customer.id}",
        # An empty text field clears the value. The name is sent but not changed.
        json={"name": "Harbor Realty", "phone": "", "payment_terms_days": 45, "status": "inactive"},
    )

    assert response.status_code == 200
    updated = response.json()
    assert (updated["phone"], updated["payment_terms_days"], updated["status"]) == (
        None,
        45,
        "inactive",
    )
    (entry,) = audit_entries(admin, "customer", customer.id)
    assert entry["action"] == "customer.updated"
    assert entry["summary"] == (
        "Updated customer Harbor Realty (HBR): payment terms days, phone, status"
    )
    assert entry["changes"] == {
        "phone": {"from": "212-555-0100", "to": None},
        "payment_terms_days": {"from": 30, "to": 45},
        "status": {"from": "active", "to": "inactive"},
    }


def test_an_update_that_changes_nothing_writes_no_audit_entry(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty")

    response = admin.patch(f"{CUSTOMERS}/{customer.id}", json={"name": "Harbor Realty"})

    assert response.status_code == 200
    assert audit_entries(admin, "customer", customer.id) == []


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    response = make_actor().post(
        CUSTOMERS,
        json={
            "name": "  ",
            "email": "not-an-email",
            "country": "USA",
            "payment_terms_days": 181,
            "status": "vip",
            "surprise": True,
        },
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "name",
        "email",
        "country",
        "payment_terms_days",
        "status",
        "surprise",
    }


def test_a_required_field_cannot_be_cleared(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    customer = factory.customer(admin.organization)

    response = admin.patch(f"{CUSTOMERS}/{customer.id}", json={"name": None, "country": None})

    assert response.status_code == 422
    assert problem(response)["errors"] == [
        {"field": "name", "message": "This field cannot be empty.", "code": "required"},
        {"field": "country", "message": "This field cannot be empty.", "code": "required"},
    ]


def test_archiving_hides_the_customer_and_frees_its_code(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty", code="HBR")
    url = f"{CUSTOMERS}/{customer.id}"

    assert admin.delete(url).status_code == 204

    assert admin.get(url).status_code == 404
    assert admin.get(CUSTOMERS).json()["total"] == 0
    assert admin.delete(url).status_code == 404  # there is nothing left to archive
    (entry,) = audit_entries(admin, "customer", customer.id)
    assert entry["action"] == "customer.archived"
    assert entry["summary"] == "Archived customer Harbor Realty (HBR)"
    assert entry["changes"]["deleted_at"]["from"] is None
    reused = admin.post(CUSTOMERS, json={"name": "Harbor Realty Partners", "code": "HBR"})
    assert reused.status_code == 201


def test_a_customer_with_buildings_or_open_contracts_cannot_be_archived(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty")
    building = factory.building(admin.organization, customer)
    contract = factory.contract(admin.organization, customer, status=ContractStatus.EXPIRED)
    url = f"{CUSTOMERS}/{customer.id}"

    refused = admin.delete(url)

    assert refused.status_code == 409
    assert problem(refused)["detail"] == (
        "Harbor Realty still has 1 building and 1 contract not yet terminated."
        " Before archiving, archive its buildings or move them to another customer"
        " and terminate its contracts."
    )
    assert admin.get(url).status_code == 200

    # Once nothing live depends on it, it can go.
    assert admin.delete(f"/api/v1/buildings/{building.id}").status_code == 204
    assert (
        admin.patch(f"/api/v1/contracts/{contract.id}", json={"status": "terminated"}).status_code
        == 200
    )
    assert admin.delete(url).status_code == 204
