# DirtyDuty

DirtyDuty is a chore coordination application with a Next.js frontend and a Spring Boot backend.

## Production deployment foundation

Production runs on one Oracle Linux 9 ARM64 VM using Docker Compose. Caddy
terminates HTTPS and routes `https://dirtyduty.app/api/*` to Spring Boot and all
other primary-host requests to Next.js. `https://www.dirtyduty.app/*` redirects
to the primary hostname. PostgreSQL is reachable only on the private Compose
network.

The [docker-compose.production.yml](./docker-compose.production.yml) deploys
PostgreSQL 17, Caddy, and digest-pinned ARM64 frontend/backend images from GHCR
using [Caddyfile.production](./caddy/Caddyfile.production). The root
[docker-compose.yml](./docker-compose.yml) and [Caddyfile](./caddy/Caddyfile)
remain the existing local build/run workflow. The production VM does not build
application images. Production Compose keeps the existing service and volume
keys; run it from the repository root so the default Compose project name and
named volume identity remain unchanged.

### Production configuration and secrets

For a new host, copy `.env.production.example` to `.env.production` and protect
the real file (`chmod 600 .env.production`). On an existing production host,
**do not replace its server-local `.env.production` with the template**. Keep
its database credentials and all existing secrets; reconcile only values that
must change, including the canonical domain and image references. Never read
secrets into CI, commit them, or paste them into logs or support requests.

The deployment file contains:

- `BACKEND_IMAGE` and `FRONTEND_IMAGE`: full GHCR `@sha256:` references copied
  from the successful image-publish artifact. Do not deploy `latest` or mutable
  tags.
- Caddy email, database connection values, session settings, auth/SMTP settings,
  and Web Push keys required by the existing application.
- `DOMAIN=dirtyduty.app`, `APP_BASE_URL=https://dirtyduty.app`,
  `FRONTEND_ORIGINS=https://dirtyduty.app`, and
  `SERVER_FORWARD_HEADERS_STRATEGY=framework`.

The production Compose file deliberately fails if the database password or
either image reference is missing. For a new database choose a unique generated
password; on an existing database, retain the current password rather than
changing the container environment independently of the PostgreSQL role.

`NEXT_PUBLIC_*` values are public and embedded during the frontend Docker build.
They are not runtime Compose settings and are not secrets. Configure them as
GitHub Actions repository variables before publishing frontend images;
publication fails if `NEXT_PUBLIC_SUPPORT_EMAIL` is missing.
`NEXT_PUBLIC_API_BASE_URL` may remain blank to use the same-origin `/api` route.

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

## CI and image publication

The existing `CI` workflow remains the validation gate. The separate
`Publish ARM64 images` workflow runs only after a successful CI push to `main`,
checks out that exact commit, builds `linux/arm64` images, and publishes them to
GHCR with the Actions-provided `GITHUB_TOKEN`. It has package-write permission
only for that job, adds source/revision labels and BuildKit SBOM/provenance, and
produces a 90-day artifact containing immutable image digest references.

The production Compose file consumes only those digest references. The
production host needs a GHCR credential with package-pull access if the packages
are private; do not reuse a publishing token or grant write/delete access on the
host. Store Docker credentials with restrictive permissions. No production
deployment workflow, production GitHub environment, deployment credential, or
live deployment trigger is added in this phase.

### Safe manual deployment outline

#### First-time migration to the production Compose configuration

The first rollout switches the existing Caddy container's bind mount from the
server's current `caddy/Caddyfile` to the tracked
`caddy/Caddyfile.production`. Subsequent releases use that production mount
already; do not repeat the migration or recreate Caddy unless its configuration
has changed.

**1. Review the release.** Approve the release commit and image-manifest
artifact; confirm both image references target `linux/arm64`. Compare the
tracked `docker-compose.production.yml` and `caddy/Caddyfile.production` with
the server's current files first, preserving intentional server-local changes.

**2. Verify the existing project and storage before switching.** Identify the
exact running PostgreSQL and Caddy containers. Record their Compose project
labels, PostgreSQL data volume, Caddy `/data` and `/config` volumes, and current
Caddyfile bind source. These commands report container metadata only; they do
not print environment variables:

```bash
docker ps --filter label=com.docker.compose.service=postgres \
  --format '{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}'
docker ps --filter label=com.docker.compose.service=caddy \
  --format '{{.ID}} {{.Names}} {{.Label "com.docker.compose.project"}}'
docker inspect --format \
  '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}} mounts={{range .Mounts}}{{if .Name}}{{.Name}}:{{.Destination}} {{end}}{{end}}' \
  <postgres-container-id>
docker inspect --format \
  '{{.Name}} project={{index .Config.Labels "com.docker.compose.project"}} mounts={{range .Mounts}}{{if .Name}}{{.Name}}:{{.Destination}}{{else}}{{.Source}}:{{.Destination}}{{end}} {{end}}' \
  <caddy-container-id>
```

Enter the project label common to the PostgreSQL and Caddy containers when
prompted. The following prints only the resolved Compose project, volume names,
and Caddyfile mount source—not the interpolated environment values:

```bash
read -r -p "Enter the shared Compose project label shown above: " PROJECT
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production config --format json |
  python3 -c 'import json,sys; c=json.load(sys.stdin); print("project="+c["name"]); print("volumes="+", ".join(v["name"] for v in c["volumes"].values())); print("caddyfile="+next(v["source"] for v in c["services"]["caddy"]["volumes"] if v["target"]=="/etc/caddy/Caddyfile"))'
```

Use this exact `PROJECT` value explicitly for the production Compose commands
below. Confirm the observed volumes match `dirtyduty_postgres_data`, `caddy_data`,
and `caddy_config` under that project, and that the current Caddyfile bind source
is expected. **Stop if the project, containers, bind path, or any volume
identity is missing or different.** Do not infer volume identity from a
directory name.

**3. Back up PostgreSQL.** Use a protected location outside the repository,
verify the archive, and keep an off-host copy according to the operator's
backup policy. Choose a new private backup path:

```bash
umask 077
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production exec -T postgres \
  sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > /secure/backups/dirtyduty-pre-release.dump
pg_restore --list /secure/backups/dirtyduty-pre-release.dump
```

Do not store the backup in the repository or an application Docker volume.

**4. Update and validate the deployment files.** Update the deployment working
tree from the reviewed commit without blindly replacing server-local files.
Keep the existing `.env.production` and all credentials. Change only the app
image digests and separately reviewed hostname settings. Validate Compose
without displaying interpolated values:

```bash
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production config --quiet
```

Recheck the resolved project and volume names against step 2 before proceeding.

**5. Pull and update backend and frontend only.** `--no-deps` prevents Compose
from recreating PostgreSQL as part of the migration:

```bash
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production pull backend frontend
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production up -d --no-build --no-deps backend frontend
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production ps
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production exec -T backend \
  curl -fsS http://localhost:8080/actuator/health
```

Proceed only when both application services are healthy and backend logs show
no migration errors. Flyway migrations run on backend startup; never attempt an
automatic schema rollback.

**6. Validate and switch Caddy.** Before replacing the existing Caddy container,
validate the production file in a one-off container without mounting or sharing
the live Caddy certificate volumes:

```bash
docker run --rm -e CADDY_EMAIL=ops@example.com \
  -v "$PWD/caddy/Caddyfile.production:/etc/caddy/Caddyfile:ro" \
  caddy:2.9-alpine caddy validate \
  --config /etc/caddy/Caddyfile --adapter caddyfile
```

The production Compose service mounts `./caddy/Caddyfile.production` at
`/etc/caddy/Caddyfile`. The existing container still has its old bind source,
so explicitly recreate only Caddy. `--no-deps` avoids recreating PostgreSQL or
any other dependency:

```bash
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production up -d --no-deps --force-recreate caddy
```

Verify the running container's mount source is the absolute path to
`caddy/Caddyfile.production`, validate that mounted file, and inspect service
status:

```bash
CADDY_ID=$(docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production ps -q caddy)
docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' \
  "$CADDY_ID"
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -p "$PROJECT" -f docker-compose.production.yml \
  --env-file .env.production ps
```

Do not run `docker compose down -v`, prune volumes, or remove/recreate
PostgreSQL. Check HTTPS and the canonical redirect:

```bash
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code}\n' https://dirtyduty.app/
curl --silent --show-error --output /dev/null \
  --write-out '%{http_code} %{redirect_url}\n' https://www.dirtyduty.app/
```

Expect a successful primary-site response and a `308` redirect to
`https://dirtyduty.app/`. Review backend logs for migration errors and
notification scheduler startup.

#### Subsequent releases

Once the production Caddy mount is confirmed, later releases normally update
only backend and frontend. Back up PostgreSQL and validate the Compose project
and volume identities as above, then pull and update those two services with
the same `pull` and `up -d --no-build --no-deps backend frontend` commands.
Do not recreate Caddy unless its configuration changed. When it does change,
validate the production file and explicitly recreate only Caddy with
`up -d --no-deps --force-recreate caddy`, then recheck its mounted source,
health, and public HTTPS routes. PostgreSQL remains in place in every case.

#### Recovery

If the project or volume identity checks do not match, stop before pulling or
starting services and have the operator reconcile the deployment directory,
project name, and actual volume mappings. If Caddy validation or HTTPS checks
fail after the first-time switch, restore the last-known-good Caddyfile from
the protected server copy, temporarily point the production Compose Caddy bind
mount back to that file, and recreate only Caddy using
`up -d --no-deps --force-recreate caddy`. Verify the restored mount and HTTPS
routes before continuing. If an application health check fails, restore the
previous application image digests and update only backend/frontend with
`up -d --no-build --no-deps backend frontend`. Never remove volumes or
automatically roll back database schema; retain Flyway changes and escalate
database recovery to an operator using the verified backup.

### Rollback and migrations

Record the current image digests before each release. To roll back application
code, restore the previous frontend/backend digest references in the existing
`.env.production`, then repeat the pull and `up -d --no-build` commands above.
Do not roll back or drop the database volume. Flyway applies migrations
automatically on backend startup and this repository does not configure an
automatic schema rollback.

V12 adds a nullable timestamp column to `push_subscriptions`; it does not rewrite
existing subscription data. The prior backend does not reference the column and
can run against the migrated database, so application rollback can retain the
schema. Always take and verify a database backup before applying any migration.

### Future production release workflow proposal

This phase does not implement or enable deployment automation. Before adding a
future release workflow, configure a protected GitHub `production` environment
with required human reviewers and prevent self-approval where supported. A
manual `workflow_dispatch` release should accept only a commit-specific image
manifest, serialize deployments with a non-canceling `production` concurrency
group, and use a narrowly scoped read-only SSH user. Provision and verify the
host public key out of band, then require strict SSH host-key checking; do not
trust `ssh-keyscan` output fetched during a release job. Keep any deployment
private key and host information in the protected environment, not repository
files.

The future release workflow should back up before migration, deploy only the
digest-pinned app images, poll backend and public frontend/redirect health, and
write the commit, image digests, migration result, health outcome, and rollback
reference to the Actions summary. A failed health check should stop rollout and
report the prior image digests for an operator-approved application rollback;
it must not automatically revert database schema or volumes.

### Deployment behavior and constraints

- PostgreSQL data and Caddy certificate/configuration state are persisted in
  named volumes. Never use `docker compose down -v` or volume-pruning commands.
- Flyway migration occurs on backend startup. Deploy exactly one backend
  instance: scheduled notifications run in-process, so horizontal backend
  scaling could duplicate scheduled work unless a distributed scheduler lock
  is introduced separately.
- Spring Boot trusts forwarded TLS headers using
  `server.forward-headers.strategy=framework`. The Caddy routes preserve the
  explicit `X-Forwarded-*` headers, and `/actuator/*` is not exposed publicly.
- The frontend same-origin API default reaches `/api/*` through Caddy. The
  frontend and backend have container health checks; PostgreSQL readiness gates
  backend startup and application health gates Caddy startup.
- A single Compose backend replacement can cause a short API interruption.
  Perform the first release during a low-traffic window and monitor health.
- The production certificate, DNS, Oracle host, firewall, server-local
  configuration, and actual backup restoration must be verified by an operator;
  none are tested or changed by repository CI.

## Branch protection

Configure GitHub branch protection or a ruleset to require the `CI` workflow
before merging to `main`. The workflow defines validation checks, but branch
protection is a GitHub-side setting and is not configured by this repository.
Verify that setting before treating CI as a merge gate.
