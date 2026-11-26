"""Handing out the next code in an organization's sequence."""

from typing import NamedTuple
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from buildingops.core.context import Context
from buildingops.modules.sequences.models import OrganizationSequence


class CodeSeries(NamedTuple):
    """A sequence and the prefix of its codes, kept together by the module that owns them:
    `CodeSeries("customer", "CUS")` numbers customers CUS-0001, CUS-0002, ..."""

    name: str
    prefix: str


def next_code(ctx: Context, name: str, prefix: str, width: int = 4) -> str:
    """The next code in one of the active organization's sequences: CUS-0001, CUS-0002, ..."""
    return allocate_code(ctx.db, ctx.organization_id, name, prefix, width)


def allocate_code(
    db: Session, organization_id: UUID, name: str, prefix: str, width: int = 4
) -> str:
    """`next_code` for callers that have no request context, such as the seed command.

    One statement creates the counter or advances it, so concurrent callers cannot be given
    the same number: the second waits for the first transaction to finish. The number is
    taken inside the caller's transaction, so a transaction that rolls back gives it back.
    """
    statement = (
        insert(OrganizationSequence)
        # A new counter starts at 1 and this call takes it, leaving 2 as the next value.
        .values(organization_id=organization_id, name=name, next_value=2)
        .on_conflict_do_update(
            index_elements=[OrganizationSequence.organization_id, OrganizationSequence.name],
            set_={
                "next_value": OrganizationSequence.next_value + 1,
                # `onupdate` does not fire for the UPDATE half of an upsert.
                "updated_at": func.now(),
            },
        )
        .returning(OrganizationSequence.next_value - 1)
    )
    value = db.execute(statement).scalar_one()
    return f"{prefix}-{value:0{width}d}"
