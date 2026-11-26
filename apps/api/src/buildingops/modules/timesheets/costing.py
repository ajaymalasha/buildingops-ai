"""What the hours on a timesheet cost.

The one place this is worked out. The service calls it on every write and never takes a
cost from a client, and the demo data is costed with it too.
"""

from decimal import Decimal

from buildingops.core.money import round_money


def labor_cost(
    hours_regular: Decimal,
    hours_overtime: Decimal,
    hourly_rate: Decimal,
    overtime_multiplier: Decimal,
) -> Decimal:
    """Regular hours at the hourly rate, plus overtime hours at that rate times the multiplier.

    Rounded once, on the sum. Rounding each part first can move the result by a cent.
    """
    return round_money(
        hours_regular * hourly_rate + hours_overtime * hourly_rate * overtime_multiplier
    )
