"""Archiving and "this row is live" checks cannot slip past each other.

Each test holds one side's transaction open on its own session, starts the other side as
an API request on a second thread, and checks that the request waits for the first to
finish and then answers according to what it finds.
"""

from concurrent.futures import Future, ThreadPoolExecutor

import pytest
from httpx2 import Response

from buildingops.core.db import Database, DbContext
from buildingops.modules.buildings import service as buildings_service
from buildingops.modules.buildings.models import BuildingType
from buildingops.modules.buildings.schemas import BuildingCreate
from buildingops.modules.customers import service as customers_service
from tests.conftest import Actor, ActorFactory, Factory, problem

# Long enough for an unblocked request to have answered many times over.
_WAIT_SECONDS = 0.4


def _assert_waiting(request: Future[Response]) -> None:
    with pytest.raises(TimeoutError):
        request.result(timeout=_WAIT_SECONDS)


def _context(actor: Actor) -> DbContext:
    return DbContext(organization_id=actor.organization.id, user_id=actor.user.id)


def _new_building(customer_id) -> dict:
    return {
        "customer_id": str(customer_id),
        "name": "Tower One",
        "building_type": "office",
        "address_line1": "410 Hollis Street",
        "city": "New York",
    }


def test_an_archive_waits_for_a_record_being_added_under_the_row(
    app_database: Database, make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization, name="Harbor Realty")

    with ThreadPoolExecutor(max_workers=1) as pool, app_database.session(_context(admin)) as db:
        # A building is on its way in for the customer, in a transaction still open.
        buildings_service.create_building(
            admin.service_context(db),
            BuildingCreate(
                customer_id=customer.id,
                name="Tower One",
                building_type=BuildingType.OFFICE,
                address_line1="410 Hollis Street",
                city="New York",
            ),
        )
        archive = pool.submit(admin.delete, f"/api/v1/customers/{customer.id}")
        _assert_waiting(archive)
        db.commit()
        response = archive.result(timeout=10)

    # Had it not waited, it would have seen no buildings and archived the customer.
    assert response.status_code == 409
    assert "still has 1 building" in problem(response)["detail"]


def test_a_new_record_waits_for_an_archive_of_the_row_it_points_at(
    app_database: Database, make_actor: ActorFactory, factory: Factory
):
    admin = make_actor()
    customer = factory.customer(admin.organization)

    with ThreadPoolExecutor(max_workers=1) as pool, app_database.session(_context(admin)) as db:
        # The customer is being archived, in a transaction still open.
        customers_service.archive_customer(admin.service_context(db), customer.id)
        create = pool.submit(admin.post, "/api/v1/buildings", json=_new_building(customer.id))
        _assert_waiting(create)
        db.commit()
        response = create.result(timeout=10)

    # Had it not waited, it would have found the customer live and added a building to it.
    assert response.status_code == 422
    assert problem(response)["errors"][0] == {
        "field": "customer_id",
        "message": "Customer not found.",
        "code": "not_found",
    }
    assert admin.get("/api/v1/buildings").json()["total"] == 0
