"""Imports every module's models so that `Base.metadata` describes the whole schema.

Alembic, the seed command and the tests import this module. A new module's models must be
added here to be migrated.
"""

from buildingops.modules.audit import models as audit_models
from buildingops.modules.buildings import models as buildings_models
from buildingops.modules.contracts import models as contracts_models
from buildingops.modules.customers import models as customers_models
from buildingops.modules.identity import models as identity_models
from buildingops.modules.sequences import models as sequences_models
from buildingops.modules.vendors import models as vendors_models
from buildingops.modules.workforce import models as workforce_models

__all__ = [
    "audit_models",
    "buildings_models",
    "contracts_models",
    "customers_models",
    "identity_models",
    "sequences_models",
    "vendors_models",
    "workforce_models",
]
