"""What the demo organizations' master data is made of.

Everything here is invented: the companies, the people and the street addresses. Cities,
states and ZIP codes are real so that the addresses read as plausible. `master_data.py`
turns these lists into rows.
"""

from dataclasses import dataclass

from buildingops.modules.buildings.models import BuildingStatus, BuildingType
from buildingops.modules.contracts.models import BillingModel, ContractStatus
from buildingops.modules.customers.models import CustomerStatus
from buildingops.modules.vendors.models import VendorCategory, VendorStatus


@dataclass(frozen=True, slots=True)
class Place:
    city: str
    region: str
    postal_code: str
    area_code: str


@dataclass(frozen=True, slots=True)
class BuildingSpec:
    name: str
    building_type: BuildingType
    address_line1: str
    place: Place
    square_feet: int
    floors: int
    status: BuildingStatus = BuildingStatus.ACTIVE


@dataclass(frozen=True, slots=True)
class CustomerSpec:
    name: str
    email_domain: str
    buildings: tuple[BuildingSpec, ...] = ()
    status: CustomerStatus = CustomerStatus.ACTIVE


@dataclass(frozen=True, slots=True)
class VendorSpec:
    name: str
    category: VendorCategory
    email_domain: str
    # Days from the day the seed runs until the insurance certificate expires. Negative
    # means it has already lapsed, None that no certificate is on file.
    insurance_days_left: int | None
    status: VendorStatus = VendorStatus.ACTIVE


@dataclass(frozen=True, slots=True)
class JobRoleSpec:
    name: str
    description: str
    default_hourly_rate: str
    headcount: int
    is_supervisory: bool = False


@dataclass(frozen=True, slots=True)
class LoginSpec:
    """A seeded account that is also an employee, and the job role they hold."""

    email: str
    first_name: str
    last_name: str
    job_role: str


@dataclass(frozen=True, slots=True)
class ContractSpec:
    customer: str
    name: str
    billing_model: BillingModel
    status: ContractStatus
    # Months before the seed runs that the contract started. Negative starts in the future.
    started_months_ago: int
    # None for a contract with no end date.
    term_months: int | None
    markup_percent: str | None = None
    monthly_fee: str | None = None
    # How many of the customer's buildings it covers, in catalog order. None covers all.
    building_count: int | None = None


@dataclass(frozen=True, slots=True)
class DirectorySpec:
    organization_slug: str
    random_seed: int
    email_domain: str
    places: tuple[Place, ...]
    customers: tuple[CustomerSpec, ...]
    vendors: tuple[VendorSpec, ...]
    job_roles: tuple[JobRoleSpec, ...]
    logins: tuple[LoginSpec, ...]
    contracts: tuple[ContractSpec, ...]
    # How many employees are not simply active: (onboarding, on leave, terminated).
    onboarding: int
    on_leave: int
    terminated: int


FIRST_NAMES: tuple[str, ...] = (
    "Aaliyah", "Adebayo", "Agnieszka", "Alejandro", "Amara", "Andre", "Anjali", "Antonio",
    "Beatriz", "Bogdan", "Camila", "Carlos", "Chen", "Chidi", "Daniela", "Darnell", "Deja",
    "Dmitri", "Eduardo", "Elena", "Emeka", "Fatima", "Francisco", "Gabriela", "Hana", "Hector",
    "Imani", "Ivan", "Jamal", "Jasmine", "Javier", "Jin", "Jorge", "Julia", "Kareem",
    "Katarzyna", "Kwame", "Latoya", "Leila", "Lucia", "Luz", "Malik", "Mariana", "Marisol",
    "Mateo", "Mei", "Miguel", "Nadia", "Natasha", "Ngozi", "Nikhil", "Olga", "Patrice",
    "Pedro", "Rafael", "Rashida", "Rosa", "Samira", "Sergio", "Shanice", "Sofia", "Tamika",
    "Tariq", "Teresa", "Thanh", "Tomasz", "Valentina", "Victor", "Wei", "Xavier", "Yesenia",
    "Yusuf", "Zofia",
)  # fmt: skip

LAST_NAMES: tuple[str, ...] = (
    "Abdi", "Acosta", "Adeyemi", "Aguilar", "Ali", "Alvarez", "Baptiste", "Bello", "Bianchi",
    "Castillo", "Chavez", "Chowdhury", "Cruz", "Dang", "Delgado", "Diallo", "Dominguez",
    "Duarte", "Espinoza", "Fernandez", "Flores", "Gashi", "Gomez", "Gutierrez", "Hassan",
    "Herrera", "Hoang", "Ibrahim", "Jankowski", "Jimenez", "Joseph", "Kamara", "Khan",
    "Kovalenko", "Kowalski", "Lewandowski", "Lin", "Lopez", "Maldonado", "Martinez", "Mensah",
    "Mohammed", "Molina", "Morales", "Moreno", "Nowak", "Nunez", "Obi", "Okonkwo", "Ortiz",
    "Osei", "Padilla", "Paredes", "Patel", "Pereira", "Petrov", "Pham", "Popescu", "Quintero",
    "Ramirez", "Ramos", "Rivera", "Rojas", "Romero", "Salazar", "Sanchez", "Santos", "Sesay",
    "Shrestha", "Silva", "Singh", "Soto", "Suarez", "Tavares", "Torres", "Tran", "Vargas",
    "Vasquez", "Vega", "Williams", "Wright", "Zhang", "Zielinski",
)  # fmt: skip

# Street names for head-office and vendor addresses. Buildings carry their own.
STREETS: tuple[str, ...] = (
    "Alder Court", "Birchfield Road", "Copperfield Street", "Dunmore Avenue", "Elmhurst Row",
    "Fenner Street", "Granite Avenue", "Harrow Street", "Juniper Street", "Kestrel Way",
    "Linden Row", "Marlow Place", "Quarry Road", "Sable Avenue", "Wexford Avenue",
)  # fmt: skip

# --- Meridian Facility Services: the New York metropolitan area --------------------------

_MANHATTAN_EAST = Place("New York", "NY", "10016", "212")
_MANHATTAN_GARMENT = Place("New York", "NY", "10018", "212")
_MANHATTAN_MIDTOWN = Place("New York", "NY", "10036", "646")
_BROOKLYN = Place("Brooklyn", "NY", "11201", "718")
_LONG_ISLAND_CITY = Place("Long Island City", "NY", "11101", "718")
_WHITE_PLAINS = Place("White Plains", "NY", "10601", "914")
_YONKERS = Place("Yonkers", "NY", "10701", "914")
_JERSEY_CITY = Place("Jersey City", "NJ", "07302", "201")
_HOBOKEN = Place("Hoboken", "NJ", "07030", "201")
_NEWARK = Place("Newark", "NJ", "07102", "973")
_SECAUCUS = Place("Secaucus", "NJ", "07094", "201")
_STAMFORD = Place("Stamford", "CT", "06901", "203")

_OFFICE = BuildingType.OFFICE
_RETAIL = BuildingType.RETAIL
_INDUSTRIAL = BuildingType.INDUSTRIAL
_MEDICAL = BuildingType.MEDICAL
_EDUCATION = BuildingType.EDUCATION
_RESIDENTIAL = BuildingType.RESIDENTIAL
_MIXED_USE = BuildingType.MIXED_USE
_OTHER = BuildingType.OTHER

_ONBOARDING = BuildingStatus.ONBOARDING
_INACTIVE = BuildingStatus.INACTIVE

MERIDIAN = DirectorySpec(
    organization_slug="meridian",
    random_seed=20_261_126,
    email_domain="meridianfs.example",
    places=(
        _MANHATTAN_EAST,
        _MANHATTAN_GARMENT,
        _MANHATTAN_MIDTOWN,
        _BROOKLYN,
        _LONG_ISLAND_CITY,
        _WHITE_PLAINS,
        _YONKERS,
        _JERSEY_CITY,
        _HOBOKEN,
        _NEWARK,
        _SECAUCUS,
        _STAMFORD,
    ),
    customers=(
        CustomerSpec(
            "Calloway Property Group",
            "callowaypg.example",
            (
                BuildingSpec(
                    "Calloway Tower", _OFFICE, "410 Hollis Street", _MANHATTAN_EAST, 412_000, 28
                ),
                BuildingSpec(
                    "One Granite Plaza",
                    _OFFICE,
                    "88 Granite Avenue",
                    _MANHATTAN_GARMENT,
                    265_000,
                    19,
                ),
                BuildingSpec(
                    "Calloway Annex", _OFFICE, "418 Hollis Street", _MANHATTAN_EAST, 64_000, 6
                ),
                BuildingSpec(
                    "Marlow Place Offices",
                    _OFFICE,
                    "25 Marlow Place",
                    _JERSEY_CITY,
                    180_000,
                    12,
                    _ONBOARDING,
                ),
            ),
        ),
        CustomerSpec(
            "Larkspur Medical Partners",
            "larkspurmedical.example",
            (
                BuildingSpec(
                    "Larkspur Medical Pavilion",
                    _MEDICAL,
                    "300 Fenner Street",
                    _WHITE_PLAINS,
                    142_000,
                    5,
                ),
                BuildingSpec(
                    "Larkspur Outpatient Center", _MEDICAL, "72 Alder Court", _STAMFORD, 58_000, 3
                ),
                BuildingSpec(
                    "Larkspur Imaging Suite",
                    _MEDICAL,
                    "615 Wexford Avenue",
                    _MANHATTAN_MIDTOWN,
                    21_000,
                    2,
                ),
            ),
        ),
        CustomerSpec(
            "Bramwell & Finch Realty",
            "bramwellfinch.example",
            (
                BuildingSpec(
                    "The Finch Building",
                    _OFFICE,
                    "129 Copperfield Street",
                    _MANHATTAN_MIDTOWN,
                    198_000,
                    16,
                ),
                BuildingSpec(
                    "Bramwell Commons", _MIXED_USE, "54 Linden Row", _BROOKLYN, 231_000, 11
                ),
                BuildingSpec(
                    "Harrow Street Lofts",
                    _MIXED_USE,
                    "210 Harrow Street",
                    _BROOKLYN,
                    96_000,
                    7,
                    _INACTIVE,
                ),
            ),
        ),
        CustomerSpec(
            "Saltmarsh Logistics Holdings",
            "saltmarshlogistics.example",
            (
                BuildingSpec(
                    "Saltmarsh Distribution Center",
                    _INDUSTRIAL,
                    "1200 Quarry Road",
                    _SECAUCUS,
                    540_000,
                    1,
                ),
                BuildingSpec(
                    "Saltmarsh Cross-Dock North",
                    _INDUSTRIAL,
                    "75 Sable Avenue",
                    _NEWARK,
                    310_000,
                    1,
                ),
                BuildingSpec(
                    "Saltmarsh Cold Storage",
                    _INDUSTRIAL,
                    "81 Sable Avenue",
                    _NEWARK,
                    125_000,
                    2,
                    _ONBOARDING,
                ),
            ),
        ),
        CustomerSpec(
            "Ashcombe Academy",
            "ashcombeacademy.example",
            (
                BuildingSpec(
                    "Ashcombe Upper School", _EDUCATION, "40 Kestrel Way", _YONKERS, 118_000, 4
                ),
                BuildingSpec(
                    "Ashcombe Lower School", _EDUCATION, "44 Kestrel Way", _YONKERS, 72_000, 3
                ),
                BuildingSpec(
                    "Ashcombe Athletics Center", _EDUCATION, "50 Kestrel Way", _YONKERS, 49_000, 2
                ),
            ),
        ),
        CustomerSpec(
            "Northlight Retail Properties",
            "northlightretail.example",
            (
                BuildingSpec(
                    "Northlight Galleria", _RETAIL, "500 Birchfield Road", _WHITE_PLAINS, 385_000, 3
                ),
                BuildingSpec("Shops at Linden Row", _RETAIL, "70 Linden Row", _BROOKLYN, 74_000, 2),
                BuildingSpec(
                    "Northlight Outlet Court", _RETAIL, "900 Quarry Road", _SECAUCUS, 160_000, 1
                ),
            ),
        ),
        CustomerSpec(
            "Fenwick Residential Trust",
            "fenwickresidential.example",
            (
                BuildingSpec(
                    "The Fenwick", _RESIDENTIAL, "27 Dunmore Avenue", _LONG_ISLAND_CITY, 284_000, 31
                ),
                BuildingSpec(
                    "Fenwick Court", _RESIDENTIAL, "18 Juniper Street", _HOBOKEN, 152_000, 12
                ),
                BuildingSpec(
                    "Fenwick Gardens", _RESIDENTIAL, "303 Marlow Place", _JERSEY_CITY, 133_000, 9
                ),
            ),
        ),
        CustomerSpec(
            "Quillhaven Partners",
            "quillhaven.example",
            (
                BuildingSpec(
                    "500 Hollis Street", _OFFICE, "500 Hollis Street", _MANHATTAN_EAST, 322_000, 24
                ),
                BuildingSpec(
                    "Hollis Street Garage", _OTHER, "512 Hollis Street", _MANHATTAN_EAST, 88_000, 6
                ),
            ),
        ),
        CustomerSpec(
            "Osgood Life Sciences",
            "osgoodls.example",
            (
                BuildingSpec(
                    "Osgood Research Building A", _OTHER, "150 Alder Court", _STAMFORD, 205_000, 6
                ),
                BuildingSpec(
                    "Osgood Research Building B", _OTHER, "160 Alder Court", _STAMFORD, 176_000, 5
                ),
            ),
        ),
        CustomerSpec(
            "Penhallow Square Associates",
            "penhallowsquare.example",
            (
                BuildingSpec(
                    "Penhallow Financial Center",
                    _OFFICE,
                    "2 Penhallow Square",
                    _JERSEY_CITY,
                    468_000,
                    34,
                ),
                BuildingSpec(
                    "Penhallow Data Hall", _INDUSTRIAL, "60 Elmhurst Row", _SECAUCUS, 92_000, 2
                ),
            ),
        ),
        CustomerSpec(
            "Wexcombe Hospitality Group",
            "wexcombe.example",
            (
                BuildingSpec(
                    "Wexcombe House",
                    _MIXED_USE,
                    "233 Wexford Avenue",
                    _MANHATTAN_GARMENT,
                    158_000,
                    14,
                    _INACTIVE,
                ),
                BuildingSpec(
                    "Wexcombe Conference Center",
                    _OTHER,
                    "9 Dunmore Avenue",
                    _STAMFORD,
                    67_000,
                    3,
                    _INACTIVE,
                ),
            ),
            CustomerStatus.INACTIVE,
        ),
        CustomerSpec(
            "Thornbury Civic Foundation", "thornburycivic.example", (), CustomerStatus.PROSPECT
        ),
    ),
    vendors=(
        VendorSpec(
            "Dovemoor Mechanical Services", VendorCategory.HVAC, "dovemoormech.example", 212
        ),
        VendorSpec("Winterbourne Refrigeration", VendorCategory.HVAC, "winterbourne.example", 21),
        VendorSpec(
            "Voltaic Electrical Contractors",
            VendorCategory.ELECTRICAL,
            "voltaicelectric.example",
            340,
        ),
        VendorSpec("Tallow Creek Plumbing", VendorCategory.PLUMBING, "tallowcreek.example", 96),
        VendorSpec(
            "Arbor & Stone Landscaping",
            VendorCategory.LANDSCAPING,
            "arborstone.example",
            -18,
            VendorStatus.PENDING_COMPLIANCE,
        ),
        VendorSpec(
            "Sentinel Ridge Security", VendorCategory.SECURITY, "sentinelridge.example", 401
        ),
        VendorSpec("Upright Elevator Works", VendorCategory.ELEVATOR, "uprightelevator.example", 9),
        VendorSpec(
            "Harborview Pest Management", VendorCategory.PEST_CONTROL, "harborviewpest.example", 155
        ),
        VendorSpec(
            "Loopline Waste & Recycling", VendorCategory.WASTE, "looplinewaste.example", 287
        ),
        VendorSpec(
            "Clearwater Janitorial Supply", VendorCategory.SUPPLIES, "clearwatersupply.example", 180
        ),
        VendorSpec(
            "Polished Stone Floor Care", VendorCategory.JANITORIAL, "polishedstone.example", 63
        ),
        VendorSpec(
            "Highpane Window Cleaning",
            VendorCategory.JANITORIAL,
            "highpane.example",
            -64,
            VendorStatus.INACTIVE,
        ),
        VendorSpec(
            "Nightingale Overnight Cleaning",
            VendorCategory.JANITORIAL,
            "nightingaleclean.example",
            None,
            VendorStatus.PENDING_COMPLIANCE,
        ),
        VendorSpec("Ironclad Door & Lock", VendorCategory.OTHER, "ironcladdoor.example", 248),
    ),
    job_roles=(
        JobRoleSpec(
            "Operations Manager",
            "Runs service delivery across all accounts.",
            "46.00",
            2,
            is_supervisory=True,
        ),
        JobRoleSpec(
            "Area Supervisor",
            "Oversees the site supervisors in one part of the region.",
            "34.00",
            3,
            is_supervisory=True,
        ),
        JobRoleSpec(
            "Site Supervisor",
            "Leads the crews at a group of buildings and inspects their work.",
            "29.50",
            9,
            is_supervisory=True,
        ),
        JobRoleSpec("Lead Custodian", "Sets the pace for a cleaning crew on shift.", "24.00", 8),
        JobRoleSpec("Custodian", "Evening and overnight cleaning.", "19.50", 34),
        JobRoleSpec(
            "Day Porter", "Keeps lobbies, restrooms and common areas in order by day.", "20.50", 12
        ),
        JobRoleSpec(
            "Floor Care Technician", "Strips, waxes, buffs and extracts floors.", "22.75", 7
        ),
        JobRoleSpec(
            "Maintenance Technician", "General repairs and preventive maintenance.", "28.00", 8
        ),
        JobRoleSpec("Window Cleaner", "Interior and exterior glass.", "24.50", 4),
        JobRoleSpec("Building Engineer", "Operates and maintains building systems.", "38.00", 4),
    ),
    logins=(
        LoginSpec("marcus.okafor@meridianfs.example", "Marcus", "Okafor", "Operations Manager"),
        LoginSpec("priya.raman@meridianfs.example", "Priya", "Raman", "Site Supervisor"),
        LoginSpec("luis.ortega@meridianfs.example", "Luis", "Ortega", "Maintenance Technician"),
    ),
    contracts=(
        ContractSpec(
            "Calloway Property Group",
            "Janitorial Services Agreement",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            20,
            36,
            markup_percent="12.50",
        ),
        ContractSpec(
            "Calloway Property Group",
            "Day Porter Program",
            BillingModel.FIXED_FEE,
            ContractStatus.ACTIVE,
            8,
            24,
            monthly_fee="18400.00",
            building_count=2,
        ),
        ContractSpec(
            "Larkspur Medical Partners",
            "Clinical Cleaning Services",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            14,
            36,
            markup_percent="15.00",
        ),
        ContractSpec(
            "Bramwell & Finch Realty",
            "Janitorial Services Agreement",
            BillingModel.FIXED_FEE,
            ContractStatus.ACTIVE,
            26,
            36,
            monthly_fee="31250.00",
            building_count=2,
        ),
        ContractSpec(
            "Saltmarsh Logistics Holdings",
            "Warehouse Sanitation Services",
            BillingModel.TIME_AND_MATERIALS,
            ContractStatus.ACTIVE,
            5,
            12,
        ),
        ContractSpec(
            "Ashcombe Academy",
            "Campus Custodial Services",
            BillingModel.FIXED_FEE,
            ContractStatus.ACTIVE,
            16,
            24,
            monthly_fee="22900.00",
        ),
        ContractSpec(
            "Northlight Retail Properties",
            "Common Area Maintenance",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            11,
            24,
            markup_percent="10.00",
        ),
        ContractSpec(
            "Fenwick Residential Trust",
            "Residential Common Area Cleaning",
            BillingModel.FIXED_FEE,
            ContractStatus.ACTIVE,
            30,
            36,
            monthly_fee="27600.00",
        ),
        ContractSpec(
            "Quillhaven Partners",
            "Janitorial and Engineering Services",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            3,
            None,
            markup_percent="14.00",
        ),
        ContractSpec(
            "Osgood Life Sciences",
            "Laboratory Support Cleaning",
            BillingModel.TIME_AND_MATERIALS,
            ContractStatus.ACTIVE,
            9,
            24,
        ),
        ContractSpec(
            "Penhallow Square Associates",
            "Janitorial Services Agreement",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            22,
            36,
            markup_percent="11.50",
        ),
        ContractSpec(
            "Penhallow Square Associates",
            "Window Cleaning Program",
            BillingModel.FIXED_FEE,
            ContractStatus.EXPIRED,
            27,
            24,
            monthly_fee="6800.00",
            building_count=1,
        ),
        ContractSpec(
            "Wexcombe Hospitality Group",
            "Housekeeping Support Services",
            BillingModel.TIME_AND_MATERIALS,
            ContractStatus.TERMINATED,
            19,
            12,
        ),
        ContractSpec(
            "Thornbury Civic Foundation",
            "Custodial Services Proposal",
            BillingModel.FIXED_FEE,
            ContractStatus.DRAFT,
            -2,
            12,
            monthly_fee="9500.00",
        ),
    ),
    onboarding=4,
    on_leave=3,
    terminated=5,
)

# --- Northgate Building Services: Chicago and its suburbs --------------------------------

_LOOP = Place("Chicago", "IL", "60601", "312")
_WEST_LOOP = Place("Chicago", "IL", "60607", "312")
_LINCOLN_PARK = Place("Chicago", "IL", "60614", "773")
_EVANSTON = Place("Evanston", "IL", "60201", "847")
_OAK_BROOK = Place("Oak Brook", "IL", "60523", "630")
_SCHAUMBURG = Place("Schaumburg", "IL", "60173", "847")
_NAPERVILLE = Place("Naperville", "IL", "60540", "630")
_ELK_GROVE = Place("Elk Grove Village", "IL", "60007", "847")

NORTHGATE = DirectorySpec(
    organization_slug="northgate",
    random_seed=20_261_127,
    email_domain="northgatebs.example",
    places=(
        _LOOP,
        _WEST_LOOP,
        _LINCOLN_PARK,
        _EVANSTON,
        _OAK_BROOK,
        _SCHAUMBURG,
        _NAPERVILLE,
        _ELK_GROVE,
    ),
    customers=(
        CustomerSpec(
            "Lakeshore Commons Management",
            "lakeshorecommons.example",
            (
                BuildingSpec(
                    "Lakeshore Commons East", _OFFICE, "200 Larch Street", _LOOP, 356_000, 26
                ),
                BuildingSpec(
                    "Lakeshore Commons West", _OFFICE, "210 Larch Street", _LOOP, 298_000, 22
                ),
                BuildingSpec(
                    "Riverbend Offices",
                    _OFFICE,
                    "1450 Foundry Street",
                    _WEST_LOOP,
                    121_000,
                    8,
                    _ONBOARDING,
                ),
            ),
        ),
        CustomerSpec(
            "Prairieview Medical Group",
            "prairieviewmedical.example",
            (
                BuildingSpec(
                    "Prairieview Medical Center",
                    _MEDICAL,
                    "820 Orchard Avenue",
                    _EVANSTON,
                    132_000,
                    5,
                ),
                BuildingSpec(
                    "Prairieview Clinic Oak Brook",
                    _MEDICAL,
                    "15 Windrow Court",
                    _OAK_BROOK,
                    38_000,
                    2,
                ),
            ),
        ),
        CustomerSpec(
            "Anvilgate Distribution",
            "anvilgate.example",
            (
                BuildingSpec(
                    "Anvilgate Fulfillment Center",
                    _INDUSTRIAL,
                    "2400 Lathe Road",
                    _ELK_GROVE,
                    610_000,
                    1,
                ),
                BuildingSpec(
                    "Anvilgate Parts Depot", _INDUSTRIAL, "75 Anvil Drive", _SCHAUMBURG, 144_000, 1
                ),
            ),
        ),
        CustomerSpec(
            "Kinsley Academy Network",
            "kinsleyacademy.example",
            (
                BuildingSpec(
                    "Kinsley Academy North Campus",
                    _EDUCATION,
                    "3100 Cedar Lake Avenue",
                    _LINCOLN_PARK,
                    96_000,
                    4,
                ),
            ),
        ),
        CustomerSpec(
            "Halsted & Wren Properties",
            "halstedwren.example",
            (
                BuildingSpec(
                    "Wren Market Square", _RETAIL, "410 Millrace Street", _NAPERVILLE, 187_000, 2
                ),
            ),
        ),
    ),
    vendors=(
        VendorSpec("Lakefront Mechanical", VendorCategory.HVAC, "lakefrontmech.example", 175),
        VendorSpec(
            "Windy Plains Landscaping", VendorCategory.LANDSCAPING, "windyplains.example", 12
        ),
        VendorSpec(
            "Northbranch Elevator Service",
            VendorCategory.ELEVATOR,
            "northbranchelevator.example",
            300,
        ),
        VendorSpec(
            "Stockyard Supply Company", VendorCategory.SUPPLIES, "stockyardsupply.example", 90
        ),
        VendorSpec(
            "Blue Lantern Security",
            VendorCategory.SECURITY,
            "bluelantern.example",
            -30,
            VendorStatus.PENDING_COMPLIANCE,
        ),
    ),
    job_roles=(
        JobRoleSpec(
            "Operations Manager",
            "Runs service delivery across all accounts.",
            "44.00",
            1,
            is_supervisory=True,
        ),
        JobRoleSpec(
            "Site Supervisor",
            "Leads the crews at a group of buildings and inspects their work.",
            "28.00",
            3,
            is_supervisory=True,
        ),
        JobRoleSpec("Custodian", "Evening and overnight cleaning.", "18.75", 11),
        JobRoleSpec(
            "Day Porter", "Keeps lobbies, restrooms and common areas in order by day.", "19.50", 4
        ),
        JobRoleSpec(
            "Maintenance Technician", "General repairs and preventive maintenance.", "27.00", 3
        ),
        JobRoleSpec(
            "Floor Care Technician", "Strips, waxes, buffs and extracts floors.", "21.50", 2
        ),
    ),
    logins=(LoginSpec("omar.haddad@northgatebs.example", "Omar", "Haddad", "Operations Manager"),),
    contracts=(
        ContractSpec(
            "Lakeshore Commons Management",
            "Janitorial Services Agreement",
            BillingModel.COST_PLUS,
            ContractStatus.ACTIVE,
            15,
            36,
            markup_percent="13.00",
        ),
        ContractSpec(
            "Prairieview Medical Group",
            "Clinical Cleaning Services",
            BillingModel.FIXED_FEE,
            ContractStatus.ACTIVE,
            7,
            24,
            monthly_fee="14200.00",
        ),
        ContractSpec(
            "Anvilgate Distribution",
            "Warehouse Sanitation Services",
            BillingModel.TIME_AND_MATERIALS,
            ContractStatus.ACTIVE,
            4,
            12,
        ),
        ContractSpec(
            "Kinsley Academy Network",
            "Campus Custodial Services",
            BillingModel.FIXED_FEE,
            ContractStatus.EXPIRED,
            26,
            24,
            monthly_fee="8750.00",
        ),
        ContractSpec(
            "Halsted & Wren Properties",
            "Common Area Maintenance",
            BillingModel.COST_PLUS,
            ContractStatus.DRAFT,
            -1,
            24,
            markup_percent="9.50",
        ),
    ),
    onboarding=1,
    on_leave=1,
    terminated=2,
)

DIRECTORIES: tuple[DirectorySpec, ...] = (MERIDIAN, NORTHGATE)
