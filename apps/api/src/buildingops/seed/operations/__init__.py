"""A year of work for the seeded organizations, on top of their master data.

Timesheets and shifts for the people assigned to buildings, work orders with their
history, expenses, and the invoices and payments that follow from them. Like the rest of
the seed it runs as the owner role and writes rows directly: nobody did these things, so
nothing goes into the audit log.

The result is deterministic. Every choice comes from a `random.Random` seeded per
organization, and every date is placed relative to the day the seed runs, so the demo
always has time waiting for approval, work in hand and invoices coming due. Nothing is
dated after the midnight that day began with, except what is plainly still to come:
shifts on the schedule and work booked ahead.

`seeder.py` runs it. `setting.py` reads the master data it is built on, and one module
each builds the time, the work orders, the expenses and the invoices. `catalog.py` holds
the wording, and `billing.py` the arithmetic behind the invoices.
"""

from buildingops.seed.operations.seeder import OperationsReport, seed_operations

__all__ = ["OperationsReport", "seed_operations"]
