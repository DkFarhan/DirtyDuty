# DirtyDuty

DirtyDuty is a chore coordination application with a Next.js frontend and a Spring Boot backend.

## Production deployment foundation

This repository now includes a production-oriented Docker/Compose setup for a single Linux VM behind Caddy. The public edge terminates TLS and routes:

- `https://DOMAIN/` -> Next.js frontend
- `https://DOMAIN/api/*` -> Spring Boot backend
- backend PostgreSQL traffic stays on the Docker private network only

The deployment stack is:

- Caddy (`caddy/Caddyfile`)
- Next.js frontend (`frontend/Dockerfile`)
- Spring Boot backend (`backend/Dockerfile`)
- PostgreSQL 17 (`docker-compose.yml`)

## Required environment variables

Create a real `.env.production` file from `.env.production.example` before starting the stack. Required values include:

```bash
cp .env.production.example .env.production
```

The file includes:

- `DOMAIN`
- `CADDY_EMAIL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `FRONTEND_ORIGINS`
- `SESSION_COOKIE_SECURE`
- `SESSION_TIMEOUT`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPPORT_EMAIL`

`NEXT_PUBLIC_*` values are browser-visible; keep only safe public data in them.

## Local validation

Before pushing to `main`, run the following locally:

### Frontend environment

For local development, create or update `frontend/.env.local` and set your support contact:

```bash
NEXT_PUBLIC_SUPPORT_EMAIL=your-public-support-email@example.com
```

`frontend/.env.local` is ignored by Git. The committed `frontend/.env.local.example` leaves this value blank; without it, support messages can still be copied but email links are unavailable.

### Frontend

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test -- --run
pnpm build
```

### Backend

```bash
cd backend
./mvnw spotless:check
./mvnw clean verify
```

Use the Docker Compose setup in `backend/docker-compose.yml` if you need a local PostgreSQL 17 database for backend verification.

## Docker operations

Build and validate locally from the repository root:

```bash
docker compose config
docker build -t dirtyduty-frontend ./frontend
docker build -t dirtyduty-backend ./backend
```

Start the full production stack:

```bash
docker compose --env-file .env.production up --build -d
```

Inspect logs:

```bash
docker compose logs -f caddy frontend backend postgres
docker compose ps
```

Stop/restart services:

```bash
docker compose down
docker compose up -d
```

## Deployment notes

- PostgreSQL data, Caddy data, and Caddy config are persisted in named Docker volumes.
- Flyway applies schema migrations automatically on backend startup against the configured PostgreSQL database.
- Spring Boot runs behind Caddy with `server.forward-headers.strategy=framework` enabled so forwarded TLS headers are trusted in the intended proxy layout.
- The frontend uses the same-origin default when `NEXT_PUBLIC_API_BASE_URL` is left blank so the browser talks to `https://DOMAIN/api/*` without exposing the backend host.
- `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_SUPPORT_EMAIL` are supplied as frontend Docker build arguments because Next.js embeds these values in the client bundle. The Compose file derives Spring datasource settings from the PostgreSQL variables to avoid mismatches.
- Only `/actuator/health` is exposed by Spring Actuator; the security configuration permits that health endpoint for internal monitoring. Caddy routes `/api/*` to the backend and does not proxy `/actuator/*`, and the backend has no published host port.
- Local validation of a real public-domain HTTPS certificate is not performed automatically; that step remains a manual deployment exercise for the target VM.

## Branch protection

Main is expected to be protected by GitHub branch protection rules and required status checks. This repository enforces CI-only checks and intentionally avoids deployment automation in this phase.
