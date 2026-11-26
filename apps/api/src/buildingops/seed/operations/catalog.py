"""The wording and the habits behind the demo organizations' year of work.

What gets reported, bought and said in a building services company, written out so that
the seeded history reads like one. Like the master data's catalog it is invented. The
modules beside this one turn it into rows.
"""

from datetime import time

from buildingops.modules.expenses.models import ExpenseCategory
from buildingops.modules.vendors.models import VendorCategory
from buildingops.modules.workorders.models import WorkOrderCategory

_C = WorkOrderCategory

# What a work order of each category is typically about. One title can come up at several
# buildings over a year, as the same fault does.
WORK_ORDER_TITLES: dict[WorkOrderCategory, tuple[str, ...]] = {
    _C.CLEANING: (
        "Deep clean the lobby restrooms",
        "Strip and wax the main corridor floor",
        "Carpet extraction in the conference rooms",
        "Clean up a spill at the loading dock",
        "Pressure wash the trash room",
        "Clean the interior glass at the main entrance",
        "Post-event cleanup in the cafeteria",
        "Dust the high ledges and vents in the atrium",
        "Shampoo the elevator cab carpets",
        "Disinfect the fitness room after a complaint",
    ),
    _C.MAINTENANCE: (
        "Replace burnt-out lamps in the east stairwell",
        "Adjust the door closer on the rear exit",
        "Repaint scuffed walls in the 2nd floor corridor",
        "Replace stained ceiling tiles in the break room",
        "Lubricate the loading dock roll-up door",
        "Tighten loose handrails in the west stairwell",
        "Replace worn entrance mats in the main lobby",
        "Re-caulk the windows on the south side",
        "Replace damaged corner guards in the service corridor",
        "Touch up the line markings on the parking level",
    ),
    _C.REPAIR: (
        "Fix the leaking faucet in the 3rd floor restroom",
        "Repair the broken partition latch in the lobby restroom",
        "Replace the cracked floor tile at the main entrance",
        "Repair the damaged drywall outside suite 210",
        "Fix the sticking lock on the supply closet",
        "Replace the broken soap dispensers on the 5th floor",
        "Repair the dock leveler at bay 2",
        "Fix the automatic door at the side entrance",
        "Repair the torn carpet seam in the reception area",
        "Replace the broken window blind in the corner office",
    ),
    _C.INSPECTION: (
        "Monthly fire extinguisher check",
        "Quarterly emergency lighting test",
        "Roof drain inspection",
        "Annual backflow preventer inspection",
        "Pest inspection of the loading dock and trash room",
        "Slip hazard walk-through of the entrances",
        "Inspect the stairwell doors and closers",
        "Elevator pit and machine room inspection",
        "Eyewash station check",
        "Quality inspection of the nightly cleaning",
    ),
    _C.HVAC: (
        "No cooling on the 4th floor",
        "Replace the air handler filters",
        "Thermostat reading high in the conference room",
        "Rattling noise from the rooftop unit",
        "Condensate leak above the corridor ceiling",
        "Too hot in the reception area",
        "Clean the supply diffusers in the open office",
        "Seasonal boiler start-up",
        "Exhaust fan not running in the restroom",
        "Check the server room cooling alarm",
    ),
    _C.ELECTRICAL: (
        "Outlet not working at the reception desk",
        "Replace the flickering light fixtures in the garage",
        "Reset the tripped breaker for the kitchen circuit",
        "Exit sign not lit by the west stairwell",
        "Replace the failed ballasts on the 2nd floor",
        "Install an occupancy sensor in the storage room",
        "Repair the exterior pole light by the entrance",
        "Emergency light failed its test on level P1",
        "Power strip overheating in the copy room",
        "Replace the photocell on the loading dock lights",
    ),
    _C.PLUMBING: (
        "Clogged toilet in the 2nd floor restroom",
        "Slow drain in the break room sink",
        "Water heater not keeping temperature",
        "Replace the flush valve in the lobby restroom",
        "Leak under the mop sink in the janitor closet",
        "Urinal running constantly on the 6th floor",
        "Low pressure at the drinking fountain",
        "Floor drain backing up in the mechanical room",
        "Replace the leaking hose bib at the dock",
        "Sewer smell in the basement restroom",
    ),
    _C.LANDSCAPING: (
        "Trim the hedges along the front walk",
        "Clear storm debris from the parking lot islands",
        "Replace the dead shrubs by the entrance sign",
        "Repair the broken sprinkler head near the curb",
        "Seasonal planting in the entry beds",
        "Remove the fallen branch behind the building",
        "Mulch the beds along the east side",
        "Salt and clear the walkways after snow",
    ),
    _C.SECURITY: (
        "Card reader not responding at the side door",
        "Replace the broken camera over the loading dock",
        "Rekey the suite after a tenant moved out",
        "Door-held-open alarm at the stairwell",
        "Repair the damaged gate arm at the garage exit",
        "Replace the batteries in the lobby panic button",
        "Intercom not working at the rear entrance",
        "Set up a visitor badge printer at the front desk",
    ),
    _C.OTHER: (
        "Move furniture for a tenant fit-out",
        "Set up the conference center for an event",
        "Dispose of old furniture from the storage room",
        "Hang signage in the lobby",
        "Deliver and stock the supply closets",
        "Assemble the new shelving in the mail room",
        "Retrieve keys locked in the janitor closet",
        "Remove graffiti from the rear wall",
    ),
}

WORK_ORDER_DESCRIPTIONS: tuple[str, ...] = (
    "Reported during the morning walk-through.",
    "The tenant asked for this to be done after business hours.",
    "Second report this month. Please check for an underlying cause.",
    "Access is through the loading dock. Check in with security first.",
    "Photos are in the building file.",
    "Needs a lift. Coordinate with the building engineer.",
    "The customer asked to be called when the work is finished.",
)

# Things said about a job along the way. They fit whatever stage it is at, because where
# a comment falls in a job's history is left to chance.
WORK_ORDER_COMMENTS: tuple[str, ...] = (
    "Spoke with the property manager. Access is arranged.",
    "Checked on site. This needs a second person.",
    "The tenant has been told when to expect us.",
    "Photos added to the building file.",
    "The front desk knows about this and will let us through.",
    "Called the customer back with an update.",
    "Left a note for the next shift.",
    "The work area is taped off for now.",
)

# What is said when a work order is put on hold, cancelled, reopened or finished.
HOLD_REASONS: tuple[str, ...] = (
    "Waiting for parts.",
    "Waiting for the customer to approve the quote.",
    "No access until the tenant returns.",
    "Waiting for the vendor's next available visit.",
    "On hold until the weather clears.",
)
CANCELLATION_REASONS: tuple[str, ...] = (
    "Duplicate of an earlier request.",
    "The customer withdrew the request.",
    "No longer needed after the tenant moved out.",
    "Covered by another work order.",
)
REOPENING_REASONS: tuple[str, ...] = (
    "The customer reported the same problem again.",
    "The fix did not hold. Returning to finish it.",
)
COMPLETION_NOTES: tuple[str, ...] = (
    "Completed and checked with the property manager.",
    "Done. The area was left clean.",
    "Completed. No further action needed.",
    "Finished and tested.",
)

# Trades that are usually sent out, and the kind of vendor each goes to.
TRADE_VENDORS: dict[WorkOrderCategory, VendorCategory] = {
    _C.HVAC: VendorCategory.HVAC,
    _C.ELECTRICAL: VendorCategory.ELECTRICAL,
    _C.PLUMBING: VendorCategory.PLUMBING,
    _C.LANDSCAPING: VendorCategory.LANDSCAPING,
    _C.SECURITY: VendorCategory.SECURITY,
}
# Work that is usually done in house, and the kind of vendor that is now and then called in.
OCCASIONAL_VENDORS: dict[WorkOrderCategory, VendorCategory] = {
    _C.CLEANING: VendorCategory.JANITORIAL,
    _C.MAINTENANCE: VendorCategory.OTHER,
    _C.REPAIR: VendorCategory.OTHER,
    _C.INSPECTION: VendorCategory.PEST_CONTROL,
    _C.OTHER: VendorCategory.WASTE,
}
# The job roles that take maintenance and repair work. Cleaning goes to the cleaning crew.
TRADE_ROLES: frozenset[str] = frozenset({"Maintenance Technician", "Building Engineer"})

# When a shift starts, by job role, on the clocks where the organization works. Cleaning
# crews come in as the offices empty. Everyone else starts at eight.
SHIFT_STARTS: dict[str, time] = {
    "Site Supervisor": time(14, 0),
    "Lead Custodian": time(16, 30),
    "Custodian": time(17, 0),
    "Floor Care Technician": time(18, 0),
    "Day Porter": time(7, 0),
    "Maintenance Technician": time(7, 30),
    "Building Engineer": time(7, 0),
    "Window Cleaner": time(6, 30),
}
DEFAULT_SHIFT_START = time(8, 0)

TIMESHEET_REJECTIONS: tuple[str, ...] = (
    "Hours do not match the sign-in sheet.",
    "Entered for the wrong building.",
    "Duplicate of another entry for this day.",
    "The overtime was not authorized.",
    "The break was not deducted.",
)

_E = ExpenseCategory

EXPENSE_DESCRIPTIONS: dict[ExpenseCategory, tuple[str, ...]] = {
    _E.SUPPLIES: (
        "Mop heads and bin liners",
        "Restroom paper and soap refills",
        "Floor finish and stripper",
        "Microfiber cloths and dusters",
        "Disinfectant and glass cleaner",
        "Trash can liners, assorted sizes",
        "Vacuum bags and belts",
        "Gloves and safety glasses",
        "Hand sanitizer refills",
        "Ice melt",
    ),
    _E.MATERIALS: (
        "Ceiling tiles",
        "Paint and patching compound",
        "Light fixtures and lamps",
        "Door hardware",
        "Plumbing fittings and valves",
        "Air filters",
        "Caulk and sealant",
        "Carpet tiles",
        "Fasteners and anchors",
        "Replacement dispensers",
    ),
    _E.EQUIPMENT: (
        "Floor scrubber rental",
        "Scissor lift rental",
        "Backpack vacuum",
        "Carpet extractor repair",
        "Pressure washer rental",
        "Wet floor signs and barriers",
        "Battery pack for the auto scrubber",
        "Window cleaning poles and squeegees",
    ),
    _E.SUBCONTRACTOR: (
        "Service call and repair",
        "Quarterly preventive maintenance visit",
        "Emergency call-out",
        "Quoted repair, parts and labor",
        "Scheduled service visit",
        "Inspection and report",
    ),
}

# What the parts for a work order are entered as. The work order says what they were for.
JOB_MATERIALS = "Parts and materials"

# The least and the most an expense of each category comes to, in cents. Most are near
# the low end.
EXPENSE_AMOUNTS: dict[ExpenseCategory, tuple[int, int]] = {
    _E.SUPPLIES: (2_500, 65_000),
    _E.MATERIALS: (4_000, 180_000),
    _E.EQUIPMENT: (9_000, 320_000),
    _E.SUBCONTRACTOR: (25_000, 780_000),
}
# The kind of vendor a purchase of each category comes from, where it comes from one.
EXPENSE_VENDORS: dict[ExpenseCategory, VendorCategory] = {
    _E.SUPPLIES: VendorCategory.SUPPLIES,
    _E.MATERIALS: VendorCategory.SUPPLIES,
}

EXPENSE_REJECTIONS: tuple[str, ...] = (
    "No receipt attached.",
    "Not a business expense.",
    "Duplicate of an earlier claim.",
    "Booked to the wrong contract. Please enter it again.",
)
