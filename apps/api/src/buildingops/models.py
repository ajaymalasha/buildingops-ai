"""Imports every module's models so that `Base.metadata` describes the whole schema.

Alembic, the seed command and the tests import this module. A new module's models must be
added here to be migrated.
"""

from buildingops.modules.audit import models as audit_models
from buildingops.modules.identity import models as identity_models

__all__ = ["audit_models", "identity_models"]
