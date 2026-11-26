"""Code sequences, exercised against PostgreSQL as the app role."""

import threading
from concurrent.futures import ThreadPoolExecutor

from buildingops.core.db import Database, DbContext
from buildingops.modules.sequences import service as sequences
from tests.conftest import Actor, ActorFactory


def _context(actor: Actor) -> DbContext:
    return DbContext(organization_id=actor.organization.id, user_id=actor.user.id)


def test_each_sequence_counts_on_its_own(app_database: Database, make_actor: ActorFactory):
    alpha, bravo = make_actor(), make_actor()

    with app_database.session(_context(alpha)) as db:
        ctx = alpha.service_context(db)
        customers = [sequences.next_code(ctx, "customer", "CUS") for _ in range(3)]
        first_building = sequences.next_code(ctx, "building", "BLD")
        wide = sequences.next_code(ctx, "ticket", "TKT", width=6)
        db.commit()
    with app_database.session(_context(bravo)) as db:
        other_organization = sequences.next_code(bravo.service_context(db), "customer", "CUS")

    assert customers == ["CUS-0001", "CUS-0002", "CUS-0003"]
    assert (first_building, wide, other_organization) == ("BLD-0001", "TKT-000001", "CUS-0001")


def test_a_run_of_codes_is_taken_in_one_step(app_database: Database, make_actor: ActorFactory):
    actor = make_actor()
    organization_id = actor.organization.id

    with app_database.session(_context(actor)) as db:
        first_run = sequences.allocate_codes(db, organization_id, "work_order", "WO", count=3)
        single = sequences.next_code(actor.service_context(db), "work_order", "WO")
        second_run = sequences.allocate_codes(
            db, organization_id, "work_order", "WO", count=2, width=6
        )
        nothing = sequences.allocate_codes(db, organization_id, "work_order", "WO", count=0)
        after = sequences.next_code(actor.service_context(db), "work_order", "WO")

    assert first_run == ["WO-0001", "WO-0002", "WO-0003"]
    assert single == "WO-0004"
    assert second_run == ["WO-000005", "WO-000006"]
    assert (nothing, after) == ([], "WO-0007")


def test_a_number_goes_back_when_its_transaction_rolls_back(
    app_database: Database, make_actor: ActorFactory
):
    actor = make_actor()

    with app_database.session(_context(actor)) as db:
        ctx = actor.service_context(db)
        abandoned = sequences.next_code(ctx, "customer", "CUS")
        db.rollback()
        kept = sequences.next_code(ctx, "customer", "CUS")
        db.commit()
        following = sequences.next_code(ctx, "customer", "CUS")

    assert (abandoned, kept, following) == ("CUS-0001", "CUS-0001", "CUS-0002")


def test_codes_issued_at_the_same_moment_are_all_different(
    app_database: Database, make_actor: ActorFactory
):
    actor = make_actor()
    rounds = 25
    start = threading.Barrier(2)

    def issue_codes() -> list[str]:
        codes = []
        start.wait(timeout=10)
        for _ in range(rounds):
            # One transaction per code, as each request would have.
            with app_database.session(_context(actor)) as db:
                codes.append(sequences.next_code(actor.service_context(db), "customer", "CUS"))
                db.commit()
        return codes

    with ThreadPoolExecutor(max_workers=2) as pool:
        workers = [pool.submit(issue_codes), pool.submit(issue_codes)]
        issued = [code for worker in workers for code in worker.result(timeout=60)]

    # Nothing handed out twice, and nothing skipped.
    assert sorted(issued) == [f"CUS-{number:04d}" for number in range(1, 2 * rounds + 1)]
