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
- `SESSION_COOKIE_MAX_AGE`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPPORT_EMAIL`

`NEXT_PUBLIC_*` values are browser-visible; keep only safe public data in them.
Set `POSTGRES_PASSWORD` to a unique randomly generated value before running any
Compose command. The production Compose configuration intentionally fails when
it is empty instead of falling back to a known development password.

Spring Session expires sessions after 30 days without activity by default
(`SESSION_TIMEOUT=30d`). The persistent `SESSION` cookie defaults to one year
(`SESSION_COOKIE_MAX_AGE=365d`) so browser/PWA restarts do not end a login and
the cookie does not impose the same 30-day absolute limit as the sliding server
timeout. The server-side session remains authoritative; adjust the cookie
lifetime only if accepting a different browser-persistence safety limit.

## Optional authentication providers

Email/password sign-in remains available independently of the optional Google and
password-reset features. Set these values in the untracked `.env.production` file;
never put credentials in frontend build arguments or `NEXT_PUBLIC_*` variables.

### Google OpenID Connect

Create a Google OAuth web client with the `openid`, `profile`, and `email` scopes.
Register this exact authorized redirect URI:

```text
https://YOUR_DOMAIN/api/auth/oauth2/callback/google
```

Then set `GOOGLE_AUTH_ENABLED=true`, `GOOGLE_CLIENT_ID`, and
`GOOGLE_CLIENT_SECRET`. DirtyDuty validates the provider's OIDC signature and
issuer and only accepts a verified email. A Google email that matches an existing
password account is not linked automatically: the user must enter that account's
password in the sign-in screen to link it. Google access/refresh tokens are not
stored; the application uses the provider only for identity.

### Password reset email

Configure an SMTP provider that supports STARTTLS, set `MAIL_HOST`, `MAIL_PORT`,
`MAIL_USERNAME`, `MAIL_PASSWORD`, and a verified `MAIL_FROM_ADDRESS`, then set:

- `MAIL_STARTTLS_ENABLED=true`
- `MAIL_STARTTLS_REQUIRED=true`
- `MAIL_TLS_VERIFY_SERVER_IDENTITY=true`
- `PASSWORD_RESET_ENABLED=true`
- `APP_BASE_URL=https://YOUR_DOMAIN`
- `AUTH_RATE_LIMIT_HMAC_SECRET` to a private, randomly generated value of at
  least 32 characters
- optionally `PASSWORD_RESET_TTL` (default 30 minutes; maximum two hours)

Reset requests have the same response whether an account exists or not. Tokens
are random, single-use, stored only as SHA-256 hashes, and placed in the URL
fragment so they are not sent to the server in HTTP requests or referrers.
Email delivery runs only after the reset-token transaction commits, avoiding
SMTP-dependent response delays; delivery failures revoke the token.
Request and confirmation limits are persisted in PostgreSQL; the HMAC key used
for pseudonymous rate-limit identifiers must remain private and stable.

### Manual verification after enabling

1. Use a new Google account to sign up, confirm the verified email account is
   created without a local password, and sign out/in again.
2. Try Google with an existing password account's email, confirm no account is
   silently linked, then link only after signing in with that account's password.
3. Verify a wrong password, a different Google email, or an expired pending link
   does not link accounts.
4. Request a reset for both a registered and unregistered email and confirm the
   same browser response; verify a valid link works once, then test expiry/reuse.
5. Confirm password reset invalidates existing sessions and then verify signing
   in with the new password.

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
docker compose --env-file .env.production config
docker build -t dirtyduty-frontend ./frontend
docker build -t dirtyduty-backend ./backend
```

Start the full production stack:

```bash
docker compose --env-file .env.production up --build -d
```

Inspect logs:

```bash
docker compose --env-file .env.production logs -f caddy frontend backend postgres
docker compose --env-file .env.production ps
```

Stop/restart services:

```bash
docker compose --env-file .env.production down
docker compose --env-file .env.production up -d
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
