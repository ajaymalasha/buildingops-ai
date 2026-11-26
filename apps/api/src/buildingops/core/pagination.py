"""List conventions shared by every collection endpoint: paging, sorting, search, date ranges."""

from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any, cast

from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, Row, Select, asc, desc, func, nulls_last, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from buildingops.core.errors import ValidationFailedError

MAX_PAGE_SIZE = 200

type SortColumn = InstrumentedAttribute[Any] | ColumnElement[Any]
# What a sort field orders by: one column, or several in order of significance.
type SortKey = SortColumn | tuple[SortColumn, ...]


class PageParams(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=MAX_PAGE_SIZE)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


def count_rows[*Ts](db: Session, statement: Select[*Ts]) -> int:
    return db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0


def paginate_rows[*Ts](
    db: Session, statement: Select[*Ts], params: PageParams
) -> tuple[Sequence[Row[*Ts]], int]:
    total = count_rows(db, statement)
    rows = db.execute(statement.limit(params.page_size).offset(params.offset)).all()
    return rows, total


def paginate_scalars[M](
    db: Session, statement: Select[M], params: PageParams
) -> tuple[Sequence[M], int]:
    total = count_rows(db, statement)
    items = db.scalars(statement.limit(params.page_size).offset(params.offset)).all()
    return items, total


def apply_sort[*Ts](
    statement: Select[*Ts],
    sort: str | None,
    *,
    allowed: Mapping[str, SortKey],
    default: str,
    tiebreaker: SortColumn,
) -> Select[*Ts]:
    """Order by a whitelisted field. `-name` sorts descending. Ties break on `tiebreaker`
    so that pages are stable. A field may stand for several columns, such as a person's
    name sorted by last name and then first name."""
    requested = sort or default
    descending = requested.startswith("-")
    key = requested.removeprefix("-")
    columns = allowed.get(key)
    if columns is None:
        raise ValidationFailedError.for_field(
            "sort",
            f"Cannot sort by '{key}'. Allowed: {', '.join(sorted(allowed))}.",
            "invalid_sort",
        )
    if not isinstance(columns, tuple):
        columns = (columns,)
    # For a single column these return a UnaryExpression; the wider declared type only
    # covers tuple arguments, which are never passed here.
    order = [
        nulls_last(cast("ColumnElement[Any]", desc(column) if descending else asc(column)))
        for column in columns
    ]
    return statement.order_by(*order, tiebreaker)


def check_date_range(first: date | None, last: date | None, *, max_days: int | None = None) -> None:
    """Refuse `from` and `to` filters that are the wrong way round, or further apart than
    `max_days` counting both ends. The problem is reported on `to`."""
    if first is None or last is None:
        return
    if last < first:
        raise ValidationFailedError.for_field(
            "to",
            f"The end of the range cannot be before its start ({first.isoformat()}).",
            "invalid_range",
        )
    if max_days is not None and (last - first).days >= max_days:
        raise ValidationFailedError.for_field(
            "to", f"Ask for at most {max_days} days at a time.", "range_too_long"
        )


def between_dates[*Ts](
    statement: Select[*Ts], column: SortColumn, first: date | None, last: date | None
) -> Select[*Ts]:
    """Keep the rows whose date is from `first` to `last`, both included. Either end may
    be left open."""
    check_date_range(first, last)
    if first is not None:
        statement = statement.where(column >= first)
    if last is not None:
        statement = statement.where(column <= last)
    return statement


def search_pattern(query: str) -> str:
    """An ILIKE pattern that treats the user's text literally."""
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
