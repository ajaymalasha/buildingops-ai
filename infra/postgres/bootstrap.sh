#!/usr/bin/env bash
# Creates the database roles and databases BuildingOps AI needs. Idempotent.
#
# Two roles, on purpose:
#   owner role  owns the schema and runs migrations. Table owners bypass row-level security.
#   app role    what the API and workers connect as. No superuser, no BYPASSRLS, owns nothing,
#               so every query it runs is subject to the tenant isolation policies.
#
# Runs in three places: `make db-bootstrap` (local Postgres), the Postgres container's
# init directory (docker compose), and CI.
#
# Connection: standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD) for a superuser.
set -euo pipefail

OWNER_ROLE="${BUILDINGOPS_DB_OWNER_ROLE:-buildingops_owner}"
OWNER_PASSWORD="${BUILDINGOPS_DB_OWNER_PASSWORD:-buildingops_owner}"
APP_ROLE="${BUILDINGOPS_DB_APP_ROLE:-buildingops_app}"
APP_PASSWORD="${BUILDINGOPS_DB_APP_PASSWORD:-buildingops_app}"
DATABASES="${BUILDINGOPS_DATABASES:-buildingops buildingops_test}"

# Inside the official Postgres image the superuser is POSTGRES_USER.
SUPERUSER="${POSTGRES_USER:-${PGUSER:-$(id -un)}}"
MAINTENANCE_DB="${BUILDINGOPS_MAINTENANCE_DB:-postgres}"

run_psql() {
  psql --no-psqlrc --set ON_ERROR_STOP=1 --username "$SUPERUSER" "$@"
}

run_psql --dbname "$MAINTENANCE_DB" \
  --set owner="$OWNER_ROLE" --set owner_pw="$OWNER_PASSWORD" \
  --set app="$APP_ROLE" --set app_pw="$APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec

SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
              :'owner', :'owner_pw') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L',
              :'app', :'app_pw') \gexec
SQL

for db in $DATABASES; do
  exists="$(run_psql --dbname "$MAINTENANCE_DB" --tuples-only --no-align \
    --set db="$db" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'db';
SQL
)"
  if [ "$exists" != "1" ]; then
    run_psql --dbname "$MAINTENANCE_DB" --set db="$db" --set owner="$OWNER_ROLE" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner') \gexec
SQL
    echo "created database $db"
  else
    echo "database $db already exists"
  fi

  run_psql --dbname "$MAINTENANCE_DB" --set db="$db" --set app="$APP_ROLE" <<'SQL'
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'db', :'app') \gexec
SQL
done

echo "roles ready: $OWNER_ROLE (owner, runs migrations), $APP_ROLE (runtime, subject to RLS)"
