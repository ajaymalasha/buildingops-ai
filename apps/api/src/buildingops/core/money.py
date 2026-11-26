"""Money: exact decimal amounts, rounded one way everywhere.

Amounts are `Decimal` in Python and `NUMERIC` in the database, and never pass through a
float on the way. Arithmetic that can leave more than two decimal places (hours times a
rate, a percentage of a cost) ends with `round_money`, so that a single rule decides which
way half a cent goes.
"""

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def round_money(amount: Decimal) -> Decimal:
    """Round to cents, half up: 2.345 becomes 2.35 and 2.344 becomes 2.34."""
    return amount.quantize(CENT, rounding=ROUND_HALF_UP)
