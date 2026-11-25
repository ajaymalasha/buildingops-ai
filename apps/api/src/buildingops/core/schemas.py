"""Base classes for API request and response models."""

from pydantic import BaseModel, ConfigDict


class RequestModel(BaseModel):
    """Input from a client. Unknown fields are rejected rather than silently dropped."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    """Output to a client, usually built from an ORM object."""

    model_config = ConfigDict(from_attributes=True)
