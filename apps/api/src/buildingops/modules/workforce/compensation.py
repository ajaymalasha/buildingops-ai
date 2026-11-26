"""Who may see and set pay rates.

Rates sit on employees and on job roles, and a timesheet carries the rate its time was
entered at and what that time cost. They all follow one rule: a caller without
`employees:read_compensation` gets null in their place, and cannot set a rate either.
"""

from decimal import Decimal

from pydantic import BaseModel

from buildingops.core.context import Context
from buildingops.core.errors import FieldProblem, PermissionDeniedError
from buildingops.core.permissions import Permission


def visible(ctx: Context, amount: Decimal | None) -> Decimal | None:
    """A rate, or what time cost, for a caller who may see compensation, and nothing for
    anyone else."""
    return amount if ctx.principal.has(Permission.EMPLOYEES_READ_COMPENSATION) else None


def ensure_may_set(ctx: Context, data: BaseModel, field: str) -> None:
    """Refuse a request that sends a rate when the caller is not allowed to see rates.

    Even a null counts: it would erase a figure the caller cannot see.
    """
    if field in data.model_fields_set and not ctx.principal.has(
        Permission.EMPLOYEES_READ_COMPENSATION
    ):
        message = "You do not have permission to set pay rates."
        raise PermissionDeniedError(message, errors=[FieldProblem(field=field, message=message)])
