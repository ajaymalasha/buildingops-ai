"""Month arithmetic for the seed. Its dates are all placed relative to the day it runs."""

from datetime import date, timedelta


def first_of_month(day: date, *, months_ago: int = 0) -> date:
    """The first day of the month `day` is in, or of one that many months before it. A
    negative number of months goes forward."""
    months = day.year * 12 + day.month - 1 - months_ago
    return date(months // 12, months % 12 + 1, 1)


def last_of_month(day: date) -> date:
    return first_of_month(day, months_ago=-1) - timedelta(days=1)
