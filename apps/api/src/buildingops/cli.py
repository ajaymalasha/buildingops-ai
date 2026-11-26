"""Operational commands: `buildingops seed`, `buildingops openapi`, `buildingops create-admin`.

Commands that write data connect as the owner role (`DATABASE_ADMIN_URL`), the same role
that runs migrations.
"""

import argparse
import getpass
import json
import sys
from pathlib import Path

from sqlalchemy import select

from buildingops.core.config import Settings, get_settings
from buildingops.core.db import Database
from buildingops.core.errors import ValidationFailedError
from buildingops.core.security import PasswordService
from buildingops.modules.identity.models import User
from buildingops.seed import demo, master_data


def _passwords(settings: Settings) -> PasswordService:
    return PasswordService(
        time_cost=settings.password_hash_time_cost,
        memory_kib=settings.password_hash_memory_kib,
        min_length=settings.password_min_length,
    )


def _admin_database(settings: Settings) -> Database:
    return Database(settings.database_admin_url, pool_size=1, max_overflow=0)


def cmd_seed(args: argparse.Namespace) -> int:
    settings = get_settings()
    if settings.is_production and not args.allow_production:
        print("Refusing to seed demo data in production. Pass --allow-production to override.")
        return 2

    database = _admin_database(settings)
    try:
        with database.session() as db:
            report = demo.seed_identity(db, _passwords(settings), settings.seed_demo_password)
            directories = master_data.seed_master_data(db)
            db.commit()
    finally:
        database.dispose()

    print(
        f"Seed complete: {report.organizations_created} organizations, "
        f"{report.users_created} users, {report.memberships_created} memberships created."
    )
    for directory in directories:
        print(
            f"  {directory.organization_slug}: {directory.customers} customers, "
            f"{directory.buildings} buildings, {directory.vendors} vendors, "
            f"{directory.job_roles} job roles, {directory.employees} employees, "
            f"{directory.assignments} building assignments, "
            f"{directory.contracts} contracts created."
        )
    print(f"\nDemo accounts (password: {settings.seed_demo_password})")
    for account in demo.ACCOUNTS:
        if account.is_platform_admin:
            access = "platform administrator"
        else:
            access = "; ".join(
                f"{role.value.replace('_', ' ')} at {slug}" for slug, role, _ in account.memberships
            )
        print(f"  {account.email:<40} {access}")
    return 0


def cmd_openapi(args: argparse.Namespace) -> int:
    """Write the OpenAPI document. The web app generates its typed client from it."""
    from buildingops.main import create_app

    document = json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"
    if args.output:
        Path(args.output).write_text(document)
        print(f"Wrote {args.output}")
    else:
        sys.stdout.write(document)
    return 0


def cmd_create_admin(args: argparse.Namespace) -> int:
    """Create a platform administrator. Use this instead of the seed on a real deployment."""
    settings = get_settings()
    passwords = _passwords(settings)
    email = args.email.strip().lower()
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords do not match.")
        return 2
    try:
        passwords.validate_new_password(password, email=email)
    except ValidationFailedError as exc:
        print(exc.detail)
        return 2

    database = _admin_database(settings)
    try:
        with database.session() as db:
            if db.scalar(select(User.id).where(User.email == email)) is not None:
                print(f"A user with email {email} already exists.")
                return 2
            db.add(
                User(
                    email=email,
                    full_name=args.name,
                    password_hash=passwords.hash(password),
                    is_platform_admin=True,
                )
            )
            db.commit()
    finally:
        database.dispose()
    print(f"Created platform administrator {email}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="buildingops", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    seed = commands.add_parser(
        "seed", help="Load demo organizations, accounts and their master data"
    )
    seed.add_argument("--allow-production", action="store_true")
    seed.set_defaults(handler=cmd_seed)

    openapi = commands.add_parser("openapi", help="Print or write the OpenAPI document")
    openapi.add_argument("--output", "-o", help="File to write instead of stdout")
    openapi.set_defaults(handler=cmd_openapi)

    admin = commands.add_parser("create-admin", help="Create a platform administrator")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    admin.set_defaults(handler=cmd_create_admin)

    args = parser.parse_args(argv)
    exit_code: int = args.handler(args)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
