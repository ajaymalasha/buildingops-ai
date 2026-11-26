"""Unit tests for core building blocks that need no database."""

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import column, select

from buildingops.core.config import Settings
from buildingops.core.errors import ValidationFailedError
from buildingops.core.money import round_money
from buildingops.core.pagination import apply_sort, between_dates, check_date_range, search_pattern
from buildingops.core.permissions import (
    MEMBERSHIP_ROLES,
    ROLE_PERMISSIONS,
    Permission,
    Role,
    permissions_for,
)
from buildingops.core.schemas import (
    CountryCode,
    OptionalCode,
    OptionalEmail,
    OptionalText40,
    RequestModel,
    two_decimal_places,
)
from buildingops.core.security import (
    PasswordService,
    generate_session_token,
    hash_session_token,
)
from buildingops.modules.audit.service import changes_between, to_jsonable
from buildingops.modules.identity.organizations_service import slugify


@pytest.fixture(scope="module")
def passwords() -> PasswordService:
    return PasswordService(time_cost=1, memory_kib=64, min_length=10)


# --- passwords and tokens ----------------------------------------------------------------


def test_password_hash_verifies_only_the_right_password(passwords: PasswordService):
    hashed = passwords.hash("correct-horse-battery")

    assert hashed.startswith("$argon2id$")
    assert passwords.verify(hashed, "correct-horse-battery")
    assert not passwords.verify(hashed, "wrong")


def test_verifying_against_a_missing_or_corrupt_hash_fails_safely(passwords: PasswordService):
    assert not passwords.verify(None, "anything")
    assert not passwords.verify("not-a-hash", "anything")


def test_hashes_made_with_weaker_parameters_are_flagged_for_rehash(passwords: PasswordService):
    stronger = PasswordService(time_cost=2, memory_kib=64, min_length=10)

    assert stronger.needs_rehash(passwords.hash("correct-horse-battery"))
    assert not stronger.needs_rehash(stronger.hash("correct-horse-battery"))


@pytest.mark.parametrize(
    ("password", "code"),
    [
        ("short", "password_too_short"),
        ("x" * 129, "password_too_long"),
        ("Person@Example.com", "password_matches_email"),
    ],
)
def test_password_policy(passwords: PasswordService, password: str, code: str):
    with pytest.raises(ValidationFailedError) as raised:
        passwords.validate_new_password(password, email="person@example.com")

    assert raised.value.errors[0].code == code


def test_session_tokens_are_long_random_and_hashed_deterministically():
    first, second = generate_session_token(), generate_session_token()

    assert first != second
    assert len(first) >= 43  # 32 random bytes, base64url
    assert hash_session_token(first) == hash_session_token(first)
    assert len(hash_session_token(first)) == 64


# --- permissions -------------------------------------------------------------------------


def test_every_role_has_a_permission_set():
    assert set(ROLE_PERMISSIONS) == set(Role)
    assert Role.PLATFORM_ADMIN not in MEMBERSHIP_ROLES


def test_permission_matrix_escalates_with_seniority():
    by_role = ROLE_PERMISSIONS

    assert by_role[Role.EMPLOYEE] < by_role[Role.SUPERVISOR] < by_role[Role.OPERATIONS_MANAGER]
    assert by_role[Role.OPERATIONS_MANAGER] < by_role[Role.COMPANY_ADMIN]
    assert by_role[Role.PLATFORM_ADMIN] == frozenset(Permission)


def test_only_company_admins_manage_members_within_an_organization():
    managers = {
        role for role in MEMBERSHIP_ROLES if Permission.MEMBERS_MANAGE in ROLE_PERMISSIONS[role]
    }

    assert managers == {Role.COMPANY_ADMIN}


def test_only_managers_change_master_data_or_see_pay_and_contracts():
    managers = {Role.COMPANY_ADMIN, Role.OPERATIONS_MANAGER}
    reserved = {
        Permission.CUSTOMERS_WRITE,
        Permission.BUILDINGS_WRITE,
        Permission.VENDORS_WRITE,
        Permission.EMPLOYEES_WRITE,
        Permission.EMPLOYEES_READ_COMPENSATION,
        Permission.CONTRACTS_READ,
        Permission.CONTRACTS_WRITE,
    }

    for role in MEMBERSHIP_ROLES:
        held = reserved & ROLE_PERMISSIONS[role]
        assert held == (reserved if role in managers else set()), role


def test_supervisors_read_the_directory_and_lower_roles_do_not():
    directory = {
        Permission.CUSTOMERS_READ,
        Permission.BUILDINGS_READ,
        Permission.VENDORS_READ,
        Permission.EMPLOYEES_READ,
    }

    assert directory <= ROLE_PERMISSIONS[Role.SUPERVISOR]
    for role in (Role.EMPLOYEE, Role.CUSTOMER, Role.VENDOR):
        assert not directory & ROLE_PERMISSIONS[role]


def test_whoever_reads_the_audit_log_may_also_see_pay_rates():
    """The audit log records a changed pay rate in full, so reading it reveals the rate."""
    for role in MEMBERSHIP_ROLES:
        granted = ROLE_PERMISSIONS[role]
        if Permission.AUDIT_READ in granted:
            assert Permission.EMPLOYEES_READ_COMPENSATION in granted, role


def test_supervisors_run_their_sites_and_managers_keep_spending_and_billing():
    site = {
        Permission.WORK_ORDERS_READ,
        Permission.WORK_ORDERS_WRITE,
        Permission.SCHEDULE_READ,
        Permission.SCHEDULE_WRITE,
        Permission.TIMESHEETS_READ,
        Permission.TIMESHEETS_WRITE,
        Permission.TIMESHEETS_APPROVE,
        Permission.EXPENSES_READ,
        Permission.EXPENSES_WRITE,
    }
    reserved = {Permission.EXPENSES_APPROVE, Permission.INVOICES_READ}
    held = {role: (site | reserved) & ROLE_PERMISSIONS[role] for role in MEMBERSHIP_ROLES}

    assert held == {
        Role.COMPANY_ADMIN: site | reserved,
        Role.OPERATIONS_MANAGER: site | reserved,
        Role.SUPERVISOR: site,
        Role.EMPLOYEE: set(),
        Role.CUSTOMER: set(),
        Role.VENDOR: set(),
    }


def test_whoever_sees_invoices_may_also_see_pay_rates_and_contracts():
    """An invoice shows what labor cost and what a contract adds to it."""
    for role in MEMBERSHIP_ROLES:
        granted = ROLE_PERMISSIONS[role]
        if Permission.INVOICES_READ in granted:
            assert {Permission.EMPLOYEES_READ_COMPENSATION, Permission.CONTRACTS_READ} <= granted


def test_platform_permissions_never_come_from_a_membership_role():
    for role in MEMBERSHIP_ROLES:
        assert Permission.PLATFORM_ORGANIZATIONS not in permissions_for(
            role, is_platform_admin=False
        )

    assert permissions_for(None, is_platform_admin=False) == frozenset()
    assert permissions_for(None, is_platform_admin=True) == {Permission.PLATFORM_ORGANIZATIONS}
    assert Permission.PLATFORM_ORGANIZATIONS in permissions_for(
        Role.EMPLOYEE, is_platform_admin=True
    )


# --- list helpers ------------------------------------------------------------------------


def test_search_text_is_matched_literally():
    assert search_pattern("50%_off\\now") == "%50\\%\\_off\\\\now%"


def test_sorting_is_limited_to_whitelisted_fields():
    allowed = {"name": column("name")}
    statement = select(column("name"))

    ordered = apply_sort(
        statement, "-name", allowed=allowed, default="name", tiebreaker=column("id")
    )
    assert "ORDER BY name DESC NULLS LAST, id" in str(ordered)

    with pytest.raises(ValidationFailedError):
        apply_sort(statement, "secret", allowed=allowed, default="name", tiebreaker=column("id"))


def test_a_sort_field_can_stand_for_several_columns():
    allowed = {"name": (column("last_name"), column("first_name"))}

    ordered = apply_sort(
        select(column("id")), "-name", allowed=allowed, default="name", tiebreaker=column("id")
    )

    assert "ORDER BY last_name DESC NULLS LAST, first_name DESC NULLS LAST, id" in str(ordered)


def test_a_date_range_includes_both_ends_and_either_can_be_left_open():
    statement = select(column("day"))

    both = between_dates(statement, column("day"), date(2026, 3, 1), date(2026, 3, 31))
    from_only = between_dates(statement, column("day"), date(2026, 3, 1), None)
    neither = between_dates(statement, column("day"), None, None)

    assert "WHERE day >= :day_1 AND day <= :day_2" in str(both)
    assert str(from_only).endswith("WHERE day >= :day_1")
    assert "WHERE" not in str(neither)


def test_a_date_range_must_run_forwards_and_can_be_limited_in_length():
    check_date_range(date(2026, 3, 1), date(2026, 3, 1))
    check_date_range(date(2026, 3, 1), date(2026, 3, 31), max_days=31)
    check_date_range(None, date(2026, 3, 1), max_days=1)

    with pytest.raises(ValidationFailedError) as backwards:
        check_date_range(date(2026, 3, 2), date(2026, 3, 1))
    with pytest.raises(ValidationFailedError) as too_long:
        check_date_range(date(2026, 3, 1), date(2026, 4, 1), max_days=31)

    assert (backwards.value.errors[0].field, backwards.value.errors[0].code) == (
        "to",
        "invalid_range",
    )
    assert (too_long.value.errors[0].field, too_long.value.errors[0].code) == (
        "to",
        "range_too_long",
    )


# --- request field types -----------------------------------------------------------------


class _Form(RequestModel):
    code: OptionalCode = None
    phone: OptionalText40 = None
    email: OptionalEmail = None
    country: CountryCode = "US"


def test_an_optional_input_left_empty_means_no_value():
    form = _Form(code="  ", phone="", email=" ")

    assert (form.code, form.phone, form.email) == (None, None, None)


def test_codes_are_trimmed_and_stored_in_upper_case():
    assert _Form(code=" bld-7 ").code == "BLD-7"


@pytest.mark.parametrize("country", ["USA", "U", "U1", "üs"])
def test_a_country_is_two_letters(country: str):
    assert _Form(country="ca").country == "CA"
    with pytest.raises(ValidationError):
        _Form(country=country)


def test_amounts_keep_two_decimal_places():
    assert str(two_decimal_places(Decimal("18.5"))) == "18.50"
    assert str(two_decimal_places(Decimal("18"))) == "18.00"


# --- money -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "rounded"),
    [
        ("2.344", "2.34"),
        ("2.345", "2.35"),  # half a cent goes up
        ("2.355", "2.36"),  # whichever digit comes before it: this is not banker's rounding
        ("2.3449999", "2.34"),
        ("0.005", "0.01"),
        ("0.0049", "0.00"),
        ("1", "1.00"),
        ("1234567890.125", "1234567890.13"),
        # Away from zero, so that a credit rounds like the charge it reverses.
        ("-2.345", "-2.35"),
    ],
)
def test_money_is_rounded_half_up_to_cents(amount: str, rounded: str):
    assert str(round_money(Decimal(amount))) == rounded


def test_rounding_money_never_goes_through_a_float():
    # As floats, 0.1 + 0.2 is 0.30000000000000004 and 1.005 is a little less than 1.005.
    assert round_money(Decimal("0.1") + Decimal("0.2")) == Decimal("0.30")
    assert str(round_money(Decimal("1.005"))) == "1.01"


# --- audit helpers -----------------------------------------------------------------------


def test_changes_between_reports_only_what_changed():
    before = {"role": Role.EMPLOYEE, "title": "Porter", "rate": Decimal("18.50")}
    after = {"role": Role.SUPERVISOR, "title": "Porter", "rate": Decimal("21.00")}

    assert changes_between(before, after) == {
        "role": {"from": "employee", "to": "supervisor"},
        "rate": {"from": "18.50", "to": "21.00"},
    }


def test_audit_values_are_json_safe():
    identifier = uuid.uuid4()

    assert to_jsonable(identifier) == str(identifier)
    assert to_jsonable(Decimal("10.10")) == "10.10"  # a string: money never becomes a float
    assert to_jsonable(date(2026, 3, 1)) == "2026-03-01"
    assert to_jsonable(datetime(2026, 3, 1, 9, 30, tzinfo=UTC)) == "2026-03-01T09:30:00+00:00"
    assert to_jsonable(None) is None


# --- misc --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Meridian Facility Services", "meridian-facility-services"),
        ("  Harbor & Co.  ", "harbor-co"),
        ("Ünïcode Cleaning", "n-code-cleaning"),
        ("!!!", ""),
    ],
)
def test_slugify(name: str, slug: str):
    assert slugify(name) == slug


def test_production_refuses_development_database_passwords():
    with pytest.raises(ValidationError, match="development-only password"):
        Settings(_env_file=None, environment="production")


def test_production_requires_separate_owner_and_app_roles():
    same = "postgresql+psycopg://one_role:long-secret@db:5432/buildingops"

    with pytest.raises(ValidationError, match="different roles"):
        Settings(
            _env_file=None, environment="production", database_url=same, database_admin_url=same
        )
