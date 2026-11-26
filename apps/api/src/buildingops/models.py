"""Imports every module's models so that `Base.metadata` describes the whole schema.

Alembic, the seed command and the tests import this module. A new module's models must be
added here to be migrated.
"""

from buildingops.modules.audit import models as audit_models
from buildingops.modules.buildings import models as buildings_models
from buildingops.modules.contracts import models as contracts_models
from buildingops.modules.customers import models as customers_models
from buildingops.modules.expenses import models as expenses_models
from buildingops.modules.identity import models as identity_models
from buildingops.modules.invoicing import models as invoicing_models
from buildingops.modules.scheduling import models as scheduling_models
from buildingops.modules.sequences import models as sequences_models
from buildingops.modules.timesheets import models as timesheets_models
from buildingops.modules.vendors import models as vendors_models
from buildingops.modules.workforce import models as workforce_models
from buildingops.modules.workorders import models as workorders_models

__all__ = [
    "audit_models",
    "buildings_models",
    "contracts_models",
    "customers_models",
    "expenses_models",
    "identity_models",
    "invoicing_models",
    "scheduling_models",
    "sequences_models",
    "timesheets_models",
    "vendors_models",
    "workforce_models",
    "workorders_models",
]
