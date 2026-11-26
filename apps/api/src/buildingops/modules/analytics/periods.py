"""The periods the dashboard reports on.

A period is a run of calendar days where the organization is, both ends included. Nothing
here knows what time it is: the caller says which day is today.
"""

from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True, slots=True)
class Period:
    """A run of calendar days, from `start` to `end`, both included."""

    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> Period:
        """The period of the same length that ends the day before this one starts: what
        this one is compared with."""
        return Period(self.start - timedelta(days=self.days), self.start - timedelta(days=1))


def first_of_month(day: date, *, months_back: int = 0) -> date:
    """The first day of the month `day` is in, or of the month that many months earlier."""
    months = day.year * 12 + day.month - 1 - months_back
    return date(months // 12, months % 12 + 1, 1)


def last_of_month(day: date) -> date:
    return first_of_month(day, months_back=-1) - timedelta(days=1)


def months_to_date(today: date, count: int) -> list[Period]:
    """The last `count` calendar months, oldest first, ending with the one `today` is in.

    That last month is still running, so it stops at `today`: it never claims days that
    have not happened yet.
    """
    starts = [first_of_month(today, months_back=back) for back in range(count - 1, -1, -1)]
    return [Period(start, min(last_of_month(start), today)) for start in starts]
