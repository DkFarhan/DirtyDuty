#!/usr/bin/env bash
# Runs the backend tests against a throwaway database, never the dev database "dirtyduty".
#
#   ./scripts/test-local.sh                    # ./mvnw -B clean verify
#   ./scripts/test-local.sh -Dtest=Foo test    # any Maven arguments
#
# Creates dirtyduty_test_<timestamp> in the local Postgres container (backend/docker-compose.yml),
# runs Maven with the ci profile pointed at it, and drops it afterwards, even on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${TEST_DB_CONTAINER:-dirty-duty-postgres}"
DB_USER="${TEST_DB_USERNAME:-dirtyduty_user}"
DB_PASS="${TEST_DB_PASSWORD:-dirtyduty_dev_password}"
DB_NAME="dirtyduty_test_$(date +%s)_$$"

psql_admin() { docker exec "$CONTAINER" psql -q -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "$1"; }

psql_admin "CREATE DATABASE $DB_NAME"
trap 'psql_admin "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" || true' EXIT

if [ "$#" -eq 0 ]; then set -- clean verify; fi
env -u SPRING_PROFILES_ACTIVE \
  SPRING_PROFILES_ACTIVE=ci \
  DB_URL="jdbc:postgresql://localhost:5432/$DB_NAME" \
  DB_USERNAME="$DB_USER" \
  DB_PASSWORD="$DB_PASS" \
  ./mvnw -B "$@"
