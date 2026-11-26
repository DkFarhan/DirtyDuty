# DirtyDuty backend

Spring Boot 4 / Java 21 API backed by PostgreSQL 17 (Flyway migrations in
`src/main/resources/db/migration`).

## Run locally

```bash
docker compose up -d                       # Postgres "dirty-duty-postgres", dev database "dirtyduty"
set -a; . ./.env.local; set +a; ./mvnw spring-boot:run
```

## Run the tests

```bash
./scripts/test-local.sh
```

That one command creates a throwaway database (`dirtyduty_test_<timestamp>`) in the
local Postgres container, runs `./mvnw -B clean verify` against it with the `ci`
profile, and drops it afterwards. Pass Maven arguments to run less, for example
`./scripts/test-local.sh -Dtest=NotificationSchedulerLockingIntegrationTest test`.

Tests can never write into the development database: they default to the `ci`
profile, and `TestDatabaseGuard` stops any test context that runs with another
profile (for example `SPRING_PROFILES_ACTIVE=local` from `.env.local`) or whose
JDBC URL names the `dirtyduty` database, with a message pointing back here.
CI sets `SPRING_PROFILES_ACTIVE=ci` and its own `dirtyduty_ci` database.

Formatting: `./mvnw spotless:check` (fix with `./mvnw spotless:apply`).
