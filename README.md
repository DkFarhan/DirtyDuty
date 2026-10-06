# DirtyDuty

DirtyDuty is a chore coordination application with a Next.js frontend and a Spring Boot backend.

## CI and quality gates

CI runs on pull requests to `main`, pushes to `main`, and can be triggered manually with `workflow_dispatch`.

The required checks are:

- Frontend CI
- Backend CI
- Database Migration Check
- CodeQL
- Dependency Review

The repository intentionally does not include the deployment pipeline yet. This task covers continuous integration only.

## Local validation

Before pushing to `main`, run the following locally:

### Frontend environment

For local development, create or update `frontend/.env.local` and set your support contact:

```bash
NEXT_PUBLIC_SUPPORT_EMAIL=your-public-support-email@example.com
```

`frontend/.env.local` is ignored by Git. The committed `frontend/.env.local.example` leaves this
value blank; without it, support messages can still be copied but email links are unavailable.

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

## Branch protection

Main is expected to be protected by GitHub branch protection rules and required status checks. This repository enforces CI-only checks and intentionally avoids deployment automation in this phase.
