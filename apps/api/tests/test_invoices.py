from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from buildingops.core.models import utcnow
from buildingops.modules.invoicing.models import InvoiceLineKind, InvoiceStatus, PaymentMethod
from tests.conftest import ActorFactory, Factory, problem

INVOICES = "/api/v1/invoices"

DRAFT, ISSUED, PAID, VOID = (
    InvoiceStatus.DRAFT,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PAID,
    InvoiceStatus.VOID,
)


def _line(kind: InvoiceLineKind, description: str, amount: str) -> dict:
    return {
        "kind": kind,
        "description": description,
        "quantity": Decimal("1.00"),
        "unit_price": Decimal(amount),
        "amount": Decimal(amount),
    }


def _paid(amount: str, received_on: date, **fields) -> dict:
    return {
        "amount": Decimal(amount),
        "received_on": received_on,
        "method": PaymentMethod.ACH,
        **fields,
    }


def test_an_invoice_is_read_with_its_lines_its_payments_and_what_is_still_owed(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    customer = factory.customer(organization, name="Harbor Realty", code="HBR")
    contract = factory.contract(organization, customer, contract_number="K-7", name="Cleaning")
    invoice = factory.invoice(
        organization,
        customer,
        number="INV-0042",
        contract_id=contract.id,
        status=ISSUED,
        issue_date=date(2026, 3, 3),
        due_date=date(2030, 4, 2),
        subtotal=Decimal("10000.00"),
        markup_amount=Decimal("1250.00"),
        lines=[
            _line(InvoiceLineKind.LABOR, "Labor", "8200.00"),
            _line(InvoiceLineKind.MATERIALS, "Materials and supplies", "1800.00"),
            _line(InvoiceLineKind.MARKUP, "Markup at 12.50%", "1250.00"),
        ],
        payments=[
            _paid("5000.00", date(2026, 3, 20), reference="ACH 88213"),
            _paid("1250.00", date(2026, 3, 12), method=PaymentMethod.CHECK),
        ],
    )

    detail = admin.get(f"{INVOICES}/{invoice.id}").json()
    (listed,) = admin.get(INVOICES).json()["items"]

    assert detail["number"] == "INV-0042"
    assert detail["customer"] == {"id": str(customer.id), "name": "Harbor Realty", "code": "HBR"}
    assert detail["contract"] == {
        "id": str(contract.id),
        "contract_number": "K-7",
        "name": "Cleaning",
    }
    assert (detail["period_start"], detail["period_end"]) == ("2026-02-01", "2026-02-28")
    # Amounts are strings, to the cent.
    assert (detail["subtotal"], detail["markup_amount"], detail["tax_amount"], detail["total"]) == (
        "10000.00",
        "1250.00",
        "0.00",
        "11250.00",
    )
    assert (detail["amount_paid"], detail["balance_due"], detail["is_overdue"]) == (
        "6250.00",
        "5000.00",
        False,
    )
    assert [
        (line["position"], line["kind"], line["quantity"], line["amount"])
        for line in detail["lines"]
    ] == [
        (1, "labor", "1.00", "8200.00"),
        (2, "materials", "1.00", "1800.00"),
        (3, "markup", "1.00", "1250.00"),
    ]
    # Oldest payment first.
    assert [
        (payment["received_on"], payment["amount"], payment["method"], payment["reference"])
        for payment in detail["payments"]
    ] == [
        ("2026-03-12", "1250.00", "check", None),
        ("2026-03-20", "5000.00", "ach", "ACH 88213"),
    ]
    # The list carries everything but the lines and the payments.
    assert {key: value for key, value in detail.items() if key not in {"lines", "payments"}} == (
        listed
    )


def test_an_invoice_is_overdue_when_it_is_issued_owed_and_past_its_due_date(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    organization = admin.organization
    today = datetime.now(ZoneInfo(organization.timezone)).date()
    past, ahead = today - timedelta(days=2), today + timedelta(days=2)

    def add(number: str, **fields) -> None:
        factory.invoice(organization, number=number, issue_date=date(2026, 3, 3), **fields)

    add("LATE", status=ISSUED, due_date=past)
    add("LATE-IN-PART", status=ISSUED, due_date=past, payments=[_paid("400.00", past)])
    add("NOT-YET-DUE", status=ISSUED, due_date=ahead)
    add("PAID-LATE", status=PAID, due_date=past, payments=[_paid("1000.00", today)])
    add("VOIDED", status=VOID, due_date=past)
    factory.invoice(organization, number="DRAFT")

    def numbers(overdue: str) -> list[str]:
        items = admin.get(INVOICES, params={"overdue": overdue}).json()["items"]
        return sorted(item["number"] for item in items)

    owed = {
        item["number"]: (item["balance_due"], item["is_overdue"])
        for item in admin.get(INVOICES).json()["items"]
    }
    assert owed == {
        "LATE": ("1000.00", True),
        "LATE-IN-PART": ("600.00", True),
        "NOT-YET-DUE": ("1000.00", False),
        "PAID-LATE": ("0.00", False),
        "VOIDED": ("1000.00", False),
        "DRAFT": ("1000.00", False),
    }
    assert numbers("true") == ["LATE", "LATE-IN-PART"]
    assert numbers("false") == ["DRAFT", "NOT-YET-DUE", "PAID-LATE", "VOIDED"]


def test_overdue_is_judged_by_the_date_where_the_organization_is(
    make_actor: ActorFactory, factory: Factory
):
    # The two zones are 26 hours apart, so the later one is always at least a day ahead.
    earliest, latest = "Etc/GMT+12", "Pacific/Kiritimati"
    due_date = datetime.now(ZoneInfo(latest)).date() - timedelta(days=1)
    overdue = {}
    for timezone in (earliest, latest):
        admin = make_actor(organization=factory.organization(timezone=timezone))
        invoice = factory.invoice(
            admin.organization, status=ISSUED, issue_date=date(2026, 3, 3), due_date=due_date
        )
        overdue[timezone] = admin.get(f"{INVOICES}/{invoice.id}").json()["is_overdue"]

    # The same date is yesterday in one place and not yet past in the other.
    assert overdue == {earliest: False, latest: True}


def test_listing_supports_filters_and_sorting(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    organization = admin.organization
    harbor = factory.customer(organization, name="Harbor Realty")
    calloway = factory.customer(organization, name="Calloway Group")
    contract = factory.contract(organization, harbor)
    factory.invoice(
        organization,
        harbor,
        number="INV-0002",
        contract_id=contract.id,
        status=PAID,
        issue_date=date(2026, 1, 5),
        due_date=date(2026, 2, 4),
        subtotal=Decimal("3000.00"),
        payments=[_paid("3000.00", date(2026, 2, 1))],
    )
    factory.invoice(
        organization,
        calloway,
        number="INV-0010",
        status=ISSUED,
        issue_date=date(2026, 2, 3),
        due_date=date(2030, 3, 5),
        subtotal=Decimal("500.00"),
    )
    factory.invoice(
        organization,
        harbor,
        number="INV-9999",
        status=ISSUED,
        issue_date=date(2026, 3, 3),
        due_date=date(2030, 4, 2),
        subtotal=Decimal("8000.00"),
        payments=[_paid("2000.00", date(2026, 3, 20))],
    )
    factory.invoice(organization, harbor, number="INV-10000", subtotal=Decimal("1200.00"))
    factory.invoice(factory.organization(), number="INV-0002")

    def numbers(**params) -> list[str]:
        response = admin.get(INVOICES, params=params)
        assert response.status_code == 200, response.text
        return [item["number"].removeprefix("INV-") for item in response.json()["items"]]

    assert admin.get(INVOICES).json()["total"] == 4
    # Latest number first, read as a number: INV-10000 comes after INV-9999.
    assert numbers() == ["10000", "9999", "0010", "0002"]
    assert numbers(sort="number") == ["0002", "0010", "9999", "10000"]
    assert numbers(status="issued") == ["9999", "0010"]
    assert numbers(customer_id=str(calloway.id)) == ["0010"]
    assert numbers(contract_id=str(contract.id)) == ["0002"]
    # A draft has not been issued, so no range of issue dates includes it.
    assert numbers(**{"from": "2026-02-01"}) == ["9999", "0010"]
    assert numbers(to="2026-02-03") == ["0010", "0002"]
    assert numbers(**{"from": "2026-01-06", "to": "2026-02-28"}) == ["0010"]
    # An invoice with no date comes last, whichever way the list is sorted.
    assert numbers(sort="issue_date") == ["0002", "0010", "9999", "10000"]
    assert numbers(sort="-issue_date") == ["9999", "0010", "0002", "10000"]
    assert numbers(sort="due_date") == ["0002", "0010", "9999", "10000"]
    assert numbers(sort="total") == ["0010", "10000", "0002", "9999"]
    # What is owed: 6,000.00, then 1,200.00, 500.00 and nothing.
    assert numbers(sort="-balance_due") == ["9999", "10000", "0010", "0002"]
    backwards = admin.get(INVOICES, params={"from": "2026-03-01", "to": "2026-02-01"})
    assert backwards.status_code == 422
    assert problem(backwards)["errors"][0]["field"] == "to"
    assert admin.get(INVOICES, params={"sort": "customer"}).status_code == 422


def test_an_invoice_keeps_showing_a_customer_archived_since(
    make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty", deleted_at=utcnow())
    invoice = factory.invoice(admin.organization, customer)

    assert admin.get(f"{INVOICES}/{invoice.id}").json()["customer"]["name"] == "Harbor Realty"
    assert admin.get(INVOICES, params={"customer_id": str(customer.id)}).json()["total"] == 1


def test_invoices_and_payments_can_only_be_read(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    invoice = factory.invoice(admin.organization)
    url = f"{INVOICES}/{invoice.id}"

    assert admin.post(INVOICES, json={"customer_id": str(invoice.customer_id)}).status_code == 405
    assert admin.patch(url, json={"status": "issued"}).status_code == 405
    assert admin.delete(url).status_code == 405
    assert admin.post(f"{url}/payments", json={"amount": "100.00"}).status_code == 404
    assert admin.get(url).json()["status"] == "draft"


def test_invoices_of_another_organization_are_not_found(make_actor: ActorFactory, factory: Factory):
    admin = make_actor()
    foreign = factory.invoice(
        factory.organization(), lines=[{}], payments=[_paid("10.00", date(2026, 3, 20))]
    )
    response = admin.get(f"{INVOICES}/{foreign.id}")

    assert response.status_code == 404
    assert problem(response)["detail"] == "Invoice not found."
    assert admin.get(INVOICES).json()["total"] == 0
