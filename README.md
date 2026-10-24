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
  least 32 bytes; this key is required for login throttling even while password
  reset is disabled, and must remain stable across deployments
- optionally `PASSWORD_RESET_TTL` (default 30 minutes; maximum two hours)

Reset requests have the same response whether an account exists or not. Tokens
are random, single-use, stored only as SHA-256 hashes, and placed in the URL
fragment so they are not sent to the server in HTTP requests or referrers.
Email delivery runs only after the reset-token transaction commits, avoiding
SMTP-dependent response delays; delivery failures revoke the token.
Request and confirmation limits are persisted in PostgreSQL; the HMAC key used
for pseudonymous rate-limit identifiers must remain private and stable.

Password sign-in failures are also recorded as HMAC-pseudonymized account and
source-IP counters. Five failures in 15 minutes begin a 30-second cooldown;
continued failures increase this to 2, 5, and 15 minutes. After 100 consecutive
account failures, password sign-in is paused for 24 hours; successful sign-in,
password change, or reset clears the account counter. Password recovery remains
available during a login cooldown. IP-level cooldowns start at 60 failures in
15 minutes to reduce impact on shared networks. Production Caddy overwrites
`X-Forwarded-For` with the connecting client address, and the backend is only
exposed on the private Compose network; do not publish the backend port or put
an untrusted proxy in front of Caddy.

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
Run `python3 -m unittest scripts.test_deployment_helpers` to check the
deployment helper's input validation, image manifest, environment preservation,
and backup evidence rules.

## CI and image publication

The existing `CI` workflow remains the validation gate. The separate
`Publish ARM64 images` workflow runs only after a successful CI push to `main`,
checks out that exact commit, builds `linux/arm64` images, and publishes them to
GHCR with the Actions-provided `GITHUB_TOKEN`. It has package-write permission
only for that job, adds source/revision labels and BuildKit SBOM/provenance, and
produces a 90-day artifact containing immutable image digest references.
The deployment verifies the artifact's publisher workflow/run, selected source
SHA, fixed GHCR repositories, digest syntax, and the pulled images' ARM64 and
OCI revision/source labels. It does not independently cryptographically verify
a signed provenance attestation; the publisher workflow and protected `main`
history remain part of the trusted computing base.

The production Compose file consumes only those digest references. The
manually triggered [production deployment workflow](./.github/workflows/deploy-production.yml)
resolves references from the successful publisher run; digests and image URLs
are not workflow inputs. The server receives the job-scoped token with
`packages: read` only to pull those two private images. It writes Docker
credentials to a private temporary directory under `/run` and removes that
directory after deployment; no persistent GHCR credential is required.

### Manual production deployment workflow

Run **Deploy production** with a full commit SHA from the approved `main`
history. The workflow checks that the commit is an ancestor of current `main`,
has a successful push-triggered `CI` run, and has a successful `Publish ARM64
images` run with an unexpired matching artifact. It accepts only the exact
first-party backend/frontend digest references in that artifact. It checks out
no release-controlled scripts and never builds or guesses an image reference.

The job runs only when dispatched from `main`, targets the `production`
environment, and uses a non-canceling concurrency group. Configure the
environment's deployment branch rule to allow `main` only. Configure required
reviewers and disable self-review where available. GitHub environment settings
are not created by repository code; without them, the workflow's own `main`
branch condition still applies, but there is no environment approval gate.
Do not manually cancel a deployment after it has started.

#### Exact GitHub `production` environment configuration

Add these **environment-level variables** to GitHub's `production` environment:

- `DEPLOY_HOST`: Oracle server DNS name or IPv4 address (SSH port 22).
- `DEPLOY_USER`: dedicated deployment-only Linux account name.
- `DEPLOY_SSH_KNOWN_HOSTS`: the server's out-of-band verified SSH host-key
  entry with a literal, exact `DEPLOY_HOST` field (no wildcard/negated
  patterns); do not obtain/trust it with `ssh-keyscan` in a workflow run.

Add this **environment-level secret**:

- `DEPLOY_SSH_PRIVATE_KEY`: private key for the dedicated deployment identity,
  not a personal Oracle login key.

`GITHUB_TOKEN` is supplied by Actions and is not a manually created secret.
The release-resolution job has only `actions: read` and `contents: read`; the
separate deployment job has only `packages: read`. Only the latter job's
temporary token is sent to Oracle for GHCR pulls. In **each** private GHCR
backend and frontend package's package settings, grant the
`DkFarhan/DirtyDuty` repository Actions access with read/pull permission. A
repository token permission alone does not grant access to a package that has
not granted this repository access. That package setting must be verified
manually; a failed remote pull stops deployment.

The existing `NEXT_PUBLIC_*` build variables remain repository-level variables
for image publication; they are public build-time values, not production
deployment credentials.

#### Required Oracle host setup

Before using the workflow, manually establish and verify the following on the
existing Oracle VM. This repository does not connect to or configure the host:

- Keep the reviewed production Compose tree at `/opt/dirtyduty`, owned by
  `root:root` and not writable by the deployment account. The production
  Compose file must resolve project name `dirtyduty` and exactly the four
  services `backend`, `frontend`, `postgres`, and `caddy`.
- Provide Python 3.9 or newer, Docker Engine with the Compose v2 plugin, and
  host `curl`; the root entry point uses these fixed system tools.
- Keep `/opt/dirtyduty/.env.production` root-owned with mode `0600`. Preserve
  its existing database credentials, Google OAuth, Resend SMTP, session
  settings, Web Push keys, and all other local configuration. Define exactly
  one valid digest-pinned `BACKEND_IMAGE` and `FRONTEND_IMAGE`; the workflow
  changes only those two lines.
- Verify the live `dirtyduty` Compose project and its PostgreSQL data, Caddy
  `/data`, and Caddy `/config` named volumes match the production Compose
  configuration. The root entry point checks this before pulling. It refuses
  to continue on any mismatch, and checks the PostgreSQL and Caddy container
  identities again after the app update.
- Install `scripts/production-deploy.py` as the root-owned executable
  `/usr/local/sbin/dirtyduty-deploy`. The deployment account must not belong
  to the `docker` group, have Docker socket access, write to deployment files,
  or have general sudo rights. Docker daemon control is root-equivalent; the
  root-owned entry point is deliberately limited to fixed paths and only
  `backend`/`frontend` pulls and updates.
- Restrict the dedicated SSH public key in the deployment account's
  `authorized_keys` to the forced command and no interactive/forwarded access.
  For example, the options should include
  `command="sudo -n /usr/local/sbin/dirtyduty-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc`.
  Add a `sudoers` rule granting only that exact executable with **no
  arguments**. Keep its wrapper, sudoers file, public key, and executable
  root-owned and non-writable by the deployment account. Confirm the root
  script runs as UID 0 and can use the Docker daemon. Never reuse a personal
  SSH key or give the deployment account a shell-capable Docker privilege.
- Obtain and verify the SSH server host key out of band, then put its exact
  `known_hosts` entry in the environment variable. The workflow enforces
  `StrictHostKeyChecking=yes`, disables global/updated host keys, and requires
  the entry to match `DEPLOY_HOST`.
- Install the independently managed root-owned executable
  `/usr/local/sbin/dirtyduty-backup-verify`. If absent, untrusted, stale, or
  unsuccessful, the deployment fails closed. It must perform an actual check
  of the newest PostgreSQL 17 custom-format backup and its off-host recovery
  copy—not read a checkbox or accept a local file as off-host evidence. In
  particular, it must retrieve/verify the off-host object, verify its
  integrity, restore it into an isolated disposable PostgreSQL 17 instance
  (never the production database), validate the restored result, and emit
  JSON only after that test succeeds. The command contract is:

  ```bash
  /usr/local/sbin/dirtyduty-backup-verify \
    --json --max-age-hours 24 --require-offsite-restore-verification
  ```

  Its JSON must include non-empty `backup_id`, `backup_created_at`,
  `offsite_copy_id`, `offsite_restore_verified_at`, and `restore_test_id`. The
  backup and successful restore test must both be no more than 24 hours old,
  the restore test must refer to a copy created from that backup, and failures
  must return non-zero. The command and its backup-system credentials/config
  must be root-owned and not group/world-writable. No such off-host backup
  integration is present in this repository today, so the workflow is not
  deployable until this real verifier and its underlying backup/restore
  process have been provisioned and tested.
- Allow the root entry point to use `/run` for its short-lived private Docker
  credential configuration and deployment lock, and
  `/var/lib/dirtyduty-deploy` for its root-only deployment ledger. The ledger
  records the requested commit and digests, timestamps, success or failure,
  backup evidence IDs, and previous successful application references.

#### Deployment and safety behavior

- The restricted SSH process accepts one validated JSON request over stdin.
  SHA and digest formats, the two exact GHCR repositories, and registry
  username/token shape are checked again on the server. The token is passed
  to `docker login --password-stdin`; it is never placed in a command-line
  argument, printed, or persisted outside a mode-`0700` temporary Docker
  configuration under `/run`, which is removed after the deployment.
- Before pulling, the root entry point requires the verified backup, validates
  the existing Compose project and named volume identities, and checks one
  running backend instance. It pulls only the selected backend and frontend
  digest references, checks each local image is `linux/arm64`, then runs
  Compose only for `backend frontend` with `--no-build --no-deps`. It never
  runs `down`, prunes/deletes volumes, or invokes PostgreSQL or Caddy as
  Compose targets. It refuses if the running PostgreSQL/Caddy identities
  change.
- The backend and frontend images have Docker health checks. The server waits
  with bounded timeouts for backend and frontend Docker health,
  Spring Boot `/actuator/health` to report `UP`, `https://dirtyduty.app/` to
  return success, and `https://www.dirtyduty.app/` to return the expected
  `308` redirect. The backend remains one instance because its scheduled
  notification jobs run in-process.
- Failed health checks are recorded and fail the workflow. There is no
  automatic application or Flyway schema rollback. The deployment ledger
  records the previous successful release and digest references for an
  operator-authorized rollback. Since publisher artifacts expire after 90
  days, a rollback through this workflow requires the previous release's
  successful publication artifact to remain available. If it has expired,
  stop rather than rebuild or guess the old digest.
- Caddy is never a target of this workflow, even if a Caddy configuration
  change is committed. Validate and authorize any Caddy change separately;
  do not restart Caddy unless its configuration genuinely changed and the
  update has been independently validated.

For an application rollback, an authorized operator manually dispatches this
same workflow with the previous successful release commit recorded in the
server ledger. The workflow revalidates its main ancestry, CI, and publisher
artifact and deploys only those historical digests. Review database migration
compatibility first: rollback changes application images only, never attempts
Flyway rollback, and never recreates or deletes PostgreSQL data. If validation
or publication evidence is unavailable, do not bypass the checks with mutable
tags or arbitrary image URLs.

The manual host migration/recovery instructions below are for
operator-approved one-time setup or incident recovery only, not routine
releases. Ordinary releases must use the protected workflow.

#### Manual host migration/recovery runbook (not routine releases)

Use only for the one-time Compose transition or operator-approved recovery.
The deployment workflow above does not execute these commands.

##### First-time migration to the production Compose configuration

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
below. Compare each resolved Compose volume source and Caddyfile bind source
with the actual container mounts. Do not assume the generated volume name from
the key in the Compose file. **Stop if the project, containers, bind path, or
any volume identity is missing or different.** Do not infer volume identity
from a directory name.

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

##### Emergency manual application recovery

Use these manual application commands only for an operator-approved emergency
when the protected workflow is unavailable. Confirm the backup, project, and
volume identity preconditions above, then update only backend and frontend with
`pull` and `up -d --no-build --no-deps backend frontend`. Do not recreate
Caddy unless its configuration changed and was separately validated.
PostgreSQL remains in place.

##### Host recovery checks

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

V12 adds a nullable timestamp column to `push_subscriptions`; it does not rewrite
existing subscription data. The prior backend does not reference the column and
can run against the migrated database, so application rollback can retain the
schema. Always take and verify a database backup before applying any migration.

### Deployment behavior and constraints

- PostgreSQL data and Caddy certificate/configuration state are persisted in
  named volumes. Never use `docker compose down -v` or volume-pruning commands.
- Flyway migration occurs on backend startup. Deploy exactly one backend
  instance: scheduled notifications run in-process, so horizontal backend
  scaling could duplicate scheduled work unless a distributed scheduler lock
  is introduced separately.
- Spring Boot trusts forwarded TLS headers using
  `server.forward-headers.strategy=framework`. Production Caddy uses the
  standard `reverse_proxy` behavior for forwarded headers without overriding
  client address headers; `/actuator/*` is not exposed publicly.
- The frontend same-origin API default reaches `/api/*` through Caddy. The
  frontend and backend have container health checks; PostgreSQL readiness gates
  backend startup and application health gates Caddy startup.
- A single Compose backend replacement can cause a short API interruption.
  Monitor the first workflow deployment and schedule it for an appropriate
  traffic window.
- The production certificate, DNS, Oracle host, firewall, server-local
  configuration, and actual backup restoration must be verified by an operator;
  none are tested or changed by repository CI.

## Branch protection

Configure GitHub branch protection or a ruleset for `main` to require pull
requests, at least one trusted review, successful `CI`, and no force pushes or
unreviewed bypasses. The workflows define validation checks, but branch
protection is a GitHub-side setting and is not configured by this repository.
Verify those settings before treating the `main` history as approved.
