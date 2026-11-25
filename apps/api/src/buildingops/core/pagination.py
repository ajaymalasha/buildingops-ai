"""List conventions shared by every collection endpoint: paging, sorting, search."""

from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, Row, Select, asc, desc, func, nulls_last, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from buildingops.core.errors import ValidationFailedError

MAX_PAGE_SIZE = 200

type SortColumn = InstrumentedAttribute[Any] | ColumnElement[Any]


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
    allowed: Mapping[str, SortColumn],
    default: str,
    tiebreaker: SortColumn,
) -> Select[*Ts]:
    """Order by a whitelisted field. `-name` sorts descending. Ties break on `tiebreaker`
    so that pages are stable."""
    requested = sort or default
    descending = requested.startswith("-")
    key = requested.removeprefix("-")
    column = allowed.get(key)
    if column is None:
        raise ValidationFailedError.for_field(
            "sort",
            f"Cannot sort by '{key}'. Allowed: {', '.join(sorted(allowed))}.",
            "invalid_sort",
        )
    # For a single column these return a UnaryExpression; the wider declared type only
    # covers tuple arguments, which are never passed here.
    direction = cast("ColumnElement[Any]", desc(column) if descending else asc(column))
    return statement.order_by(nulls_last(direction), tiebreaker)


def search_pattern(query: str) -> str:
    """An ILIKE pattern that treats the user's text literally."""
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
