from datetime import date

from buildingops.core.models import utcnow
from buildingops.modules.vendors.models import VendorCategory, VendorStatus
from tests.conftest import ActorFactory, Factory, audit_entries, problem

VENDORS = "/api/v1/vendors"


def test_a_vendor_gets_defaults_and_the_next_code_in_sequence(make_actor: ActorFactory):
    admin = make_actor()

    response = admin.post(
        VENDORS,
        json={
            "name": "Brightline Mechanical",
            "category": "hvac",
            "insurance_expires_on": "2027-03-31",
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["code"] == "VEN-0001"
    assert (created["status"], created["country"], created["payment_terms_days"]) == (
        "active",
        "US",
        30,
    )
    assert created["insurance_expires_on"] == "2027-03-31"
    assert admin.get(f"{VENDORS}/{created['id']}").json() == created
    (entry,) = audit_entries(admin, "vendor", created["id"])
    assert entry["action"] == "vendor.created"
    assert entry["summary"] == "Created vendor Brightline Mechanical (VEN-0001)"
    assert entry["changes"]["insurance_expires_on"] == {"from": None, "to": "2027-03-31"}


def test_listing_supports_search_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    factory.vendor(
        organization,
        name="Brightline Mechanical",
        category=VendorCategory.HVAC,
        insurance_expires_on=date(2027, 3, 31),
    )
    factory.vendor(
        organization,
        name="Clearwater Janitorial",
        contact_name="Rosa Marin",
        insurance_expires_on=date(2026, 12, 1),
    )
    factory.vendor(
        organization,
        name="Arbor Grounds",
        category=VendorCategory.LANDSCAPING,
        status=VendorStatus.PENDING_COMPLIANCE,
    )
    factory.vendor(organization, name="Closed Down Supply", deleted_at=utcnow())
    factory.vendor(factory.organization(), name="Brightline of Another Company")

    def names(**params) -> list[str]:
        response = admin.get(VENDORS, params=params)
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]

    assert names() == ["Arbor Grounds", "Brightline Mechanical", "Clearwater Janitorial"]
    assert names(category="hvac") == ["Brightline Mechanical"]
    assert names(status="pending_compliance") == ["Arbor Grounds"]
    assert names(q="marin") == ["Clearwater Janitorial"]
    # Soonest expiry first. A vendor with no date on file comes last.
    assert names(sort="insurance_expires_on") == [
        "Clearwater Janitorial",
        "Brightline Mechanical",
        "Arbor Grounds",
    ]


def test_invalid_input_is_reported_per_field(make_actor: ActorFactory):
    response = make_actor().post(
        VENDORS,
        json={
            "name": "Brightline Mechanical",
            "category": "catering",
            "email": "sales@",
            "insurance_expires_on": "next spring",
            "payment_terms_days": -1,
        },
    )

    assert response.status_code == 422
    assert {error["field"] for error in problem(response)["errors"]} == {
        "category",
        "email",
        "insurance_expires_on",
        "payment_terms_days",
    }


def test_a_code_that_is_taken_is_a_conflict(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    factory.vendor(admin.organization, code="BRT")
    other = factory.vendor(admin.organization)

    on_create = admin.post(VENDORS, json={"name": "Brightside", "category": "other", "code": "brt"})
    on_update = admin.patch(f"{VENDORS}/{other.id}", json={"code": "BRT"})

    assert on_create.status_code == on_update.status_code == 409
    assert problem(on_update)["errors"] == [{"field": "code", "message": "BRT is already in use."}]


def test_vendors_of_another_organization_are_not_found(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    foreign = factory.vendor(factory.organization())
    url = f"{VENDORS}/{foreign.id}"

    assert admin.get(url).status_code == 404
    assert admin.patch(url, json={"name": "Taken over"}).status_code == 404
    assert admin.delete(url).status_code == 404


def test_updating_a_vendor_records_what_changed(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    vendor = factory.vendor(
        admin.organization,
        name="Brightline Mechanical",
        code="BRT",
        status=VendorStatus.PENDING_COMPLIANCE,
    )

    response = admin.patch(
        f"{VENDORS}/{vendor.id}", json={"status": "active", "insurance_expires_on": "2027-06-30"}
    )

    assert response.status_code == 200
    assert response.json()["insurance_expires_on"] == "2027-06-30"
    (entry,) = audit_entries(admin, "vendor", vendor.id)
    assert entry["action"] == "vendor.updated"
    assert entry["summary"] == (
        "Updated vendor Brightline Mechanical (BRT): insurance expires on, status"
    )
    assert entry["changes"] == {
        "status": {"from": "pending_compliance", "to": "active"},
        "insurance_expires_on": {"from": None, "to": "2027-06-30"},
    }


def test_archiving_hides_the_vendor(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    vendor = factory.vendor(admin.organization, name="Brightline Mechanical", code="BRT")
    url = f"{VENDORS}/{vendor.id}"

    assert admin.delete(url).status_code == 204

    assert admin.get(url).status_code == 404
    assert admin.get(VENDORS).json()["total"] == 0
    (entry,) = audit_entries(admin, "vendor", vendor.id)
    assert (entry["action"], entry["summary"]) == (
        "vendor.archived",
        "Archived vendor Brightline Mechanical (BRT)",
    )
