# 10 DevOps Pipeline (Stage 10)

Nothing could be executed in this stage: no Docker build, compose run, workflow run, `tsc`, prettier or tests. Every file below is unbuilt and untested.

## 1. Deployment Pipeline Design
**CI** (`.github/workflows/ci.yml`, on push to `main` and every PR; `permissions: contents: read`, concurrency cancels superseded runs):
1. `verify` job (postgres:16 service container): `npm ci` -> `prettier --check` (same globs as the formatter run in stage 9) -> `npm run lint` (api eslint + `next lint`) -> `npm run build:api` (prisma generate + tsc) -> `npm run build:web` -> `db:push` -> `db:sql` -> `seed` -> start `node apps/api/dist/main.js` and poll `/api/health` -> `node scripts/smoke.mjs` -> `npm test` -> upload `api.log` on failure -> stop API.
2. `docker` job (needs `verify`): builds both images (no push), proving the Dockerfiles.
3. `audit` job (non-blocking): `npm audit --omit=dev --audit-level=high`. Non-blocking because Next 14.x gets no fixes for new advisories (S-13/section 4 of 09).

**CD**: not created. The brief did not ask for `deploy.yml` and no registry/host is defined. Proposed flow once they exist: tag `vX.Y.Z` -> build and push `wnmp-api` / `wnmp-web` tagged with the git SHA -> deploy to staging -> prod-mode smoke (see 6) -> manual approval -> prod. Versioning: image tag = git SHA plus semver tag; never deploy `latest`.
**Gates**: CI green, prod-mode smoke green, Security checklist (09 section 7) items 1-2 signed off, Medium S-12/S-14 accepted or fixed.

## 2. Infrastructure Configuration
- **dev**: host-run API/web, `npm run db:up` (compose `postgres` only) or the Windows private cluster from `scripts/start-demo.ps1` (port 5433, untouched).
- **demo/CI**: `NODE_ENV=development`, `DEMO_MODE=true`, `SEED_DEMO=true`, `ALLOW_PRIVATE_OPERATOR_URLS=true` (the seeded mock operators point at the API itself).
- **stage/prod**: `docker compose` on one host behind a TLS reverse proxy (not provided), `NODE_ENV=production` (compose default). Ports for postgres, api and web are published on `127.0.0.1` only; the proxy terminates TLS and sets `TRUST_PROXY_HOPS=1`.
- **Services**: `postgres` (16-alpine, `pgdata` volume, `pg_isready` healthcheck) -> `api` (waits `service_healthy`, healthcheck `GET /api/health`, 90 s start period) -> `web` (waits for api healthy). `restart: unless-stopped` everywhere.
- **Images**: node:22-bookworm-slim, multi-stage, run as the `node` user. API image keeps dev dependencies because the entrypoint needs the prisma CLI and `tsx` (db push, db:sql, seed); web image has production dependencies only. `postgresql-client` (psql 15 on bookworm) is installed in the API image for `db:sql`.
- **Scaling**: API holds the rate limiter, login throttle and explorer cache in memory and runs interval jobs (sync, sweepers, telemetry) in every instance. Run **one** API replica until jobs get a leader lock and the limiter moves to the proxy/Redis. For extra replicas set `RUN_DB_SETUP=false`.

## 3. Files Created
| File | Purpose / customisation points |
| --- | --- |
| `infra/docker/Dockerfile.api` | build (`npm ci -w apps/api`, `prisma generate` + `tsc`) -> runtime with psql, non-root, HEALTHCHECK |
| `infra/docker/Dockerfile.web` | build arg `NEXT_PUBLIC_API_URL` (baked into the bundle) -> `next start -H 0.0.0.0` |
| `infra/docker/api-entrypoint.sh` | wait for DB (`pg_isready`), `db:push` (no `--accept-data-loss`), `db:sql`, optional demo seed, `exec` API. Env: `RUN_DB_SETUP`, `SEED_DEMO`, `DB_WAIT_RETRIES` |
| `.dockerignore` (extra, needed so host `node_modules`, `.env`, `.pgdata` never enter the build context) | |
| `docker-compose.yml` (edited) | postgres + api + web, env interpolated from `.env`, healthchecks, `depends_on: service_healthy` |
| `.github/workflows/ci.yml` | pipeline above |
| `apps/api/src/health.controller.ts`, `apps/api/src/app.module.ts` (edited) | `GET /api/health` -> `{status:'ok',db:true}`; on DB failure HTTP 503 `{status:'degraded',db:false}` so healthchecks actually fail |
| `infra/monitoring/README.md` | probes, alerts mapped to endpoints/tables, SLOs |
| `.env.example` (edited) | adds `NODE_ENV`, `DEMO_MODE`, `SEED_DEMO`, `RUN_DB_SETUP`, `POSTGRES_*`, `WEB_PORT`, `PUBLIC_API_URL`, `TRUST_PROXY_HOPS`, rate limits, `ALLOW_*`/`ENABLE_MOCK_OPERATOR`, `MIDTRANS_IS_PRODUCTION` |

## 4. Release, Rollback, Backup
- **Release**: single host, recreate strategy (`docker compose pull/build && up -d`); brief downtime while the API runs db push and sql. Release outside business hours. Order: backup -> deploy -> health -> prod-mode smoke -> watch alerts 30 min.
- **Schema changes**: `db push` is the only mechanism (no migrations). Destructive diffs make `db push` fail and the container exit, which keeps the old data safe; resolve by hand. `db push` drops indexes/triggers it does not know, hence `db:sql` always re-runs (001 constraints/indexes, 002 link stats, 003 ledger immutability). Ledger triggers are absent between the two steps, so never expose the API to traffic in that window (healthcheck/`depends_on` handles this).
- **Backup**: `docker compose exec -T postgres pg_dump -U wnmp -Fc wnmp > backup-$(date +%F).dump` (use the postgres container's `pg_dump`, version 16; the API image has psql 15 only). Daily plus before every deploy, copied off-host, encrypted, 30-day retention, quarterly restore test.
- **Rollback (app)**: redeploy the previous image tag. If the release changed the schema, restore the pre-deploy dump first.
- **Restore**: stop api/web -> `dropdb`/`createdb` -> `pg_restore -d wnmp backup.dump` -> **re-apply `apps/api/prisma/sql/*.sql`** (`docker compose run --rm --no-deps api npm run db:sql`, or let the entrypoint do it) -> start api -> check `GET /api/admin/ledger/verify`. `pg_restore` of the ledger table can conflict with the immutability triggers; restore data before triggers exist (the dump restores in dependency order, but verify).
- **Not covered**: PITR/WAL archiving, managed Postgres, off-host backup automation (needs a target decision).

## 5. Secrets Handling
- No secret is committed: `.env` is git-ignored and `.dockerignore`d; `.env.example` has placeholders. CI uses throwaway literals marked "CI only"; production values come from GitHub environment secrets or a secret manager and are injected as env vars, never baked into images (web build arg only carries the public API URL).
- Must be set in production: `JWT_ACCESS_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` (>= 32 random chars, API refuses to boot otherwise; compose passes empty strings when unset so the failure is explicit), `POSTGRES_PASSWORD` (URL-safe chars, embedded in `DATABASE_URL`), provider keys (`MIDTRANS_SERVER_KEY`, ...). Rotating `CREDENTIALS_ENCRYPTION_KEY` makes stored operator credentials unreadable (S-21): re-enter them.
- Never set in production: `ALLOW_PRIVATE_OPERATOR_URLS`, `ENABLE_MOCK_OPERATOR`, `ALLOW_MOCK_PAYMENTS`, `ALLOW_DEMO_SEED`, `SEED_DEMO`. The entrypoint ignores `SEED_DEMO` when `NODE_ENV=production` without `ALLOW_DEMO_SEED=true`.
- Recommended additions (not done): gitleaks/secret scanning, Dependabot, environment protection rules for deploys.

## 6. Security Alignment (09 section 7)
| Item | Status |
| --- | --- |
| Postgres bound to 127.0.0.1, no public port | done in compose |
| Prod secrets enforced, demo flags off by default, no demo seed in prod | done (compose defaults to production) |
| Non-root containers, no secrets in images | done (unverified build) |
| `npm audit` in CI | added, non-blocking |
| Prod-mode smoke (headers, 404 on `/api/mock-operator`, boot refusal with default secrets) | **not automated**: `scripts/smoke.mjs` is demo-mode only and may not be edited here. Manual or a follow-up job |
| Separate DB owner/runtime role, ledger head-hash anchoring, egress firewall, edge rate limit incl. webhooks, TLS, request logging | open: need infrastructure decisions |

## 7. Unverified (could not be executed)
- Docker builds: `npm ci --workspace apps/api` with the root lockfile, Prisma engine download/openssl on bookworm-slim, `npx --no-install next start` resolving the hoisted `next`, `public/` handling (none exists; copied wholesale from the build stage).
- Compose: variable interpolation syntax, `$$` escaping in the postgres healthcheck, behaviour with no `.env` (api then exits on missing secrets by design; `npm run db:up` still works).
- CI: `next lint` without an `apps/web` ESLint config (may prompt or fail in CI), prettier `--check` on the full glob, `psql` on the runner, whether `smoke.mjs` leaves open tickets that hit the per-link cap in `npm test`, and the 7 genuine defects T1-T7 from 08 (CI fails until they are fixed).
- `GET /api/health` compile/format, the 503 behaviour, and that the rate limiter (prod 1200/min) tolerates healthchecks.
- psql 15 (bookworm) vs PostgreSQL 16 server for `db:sql`; expected fine for the plain DDL used.

## Handoff
- **Inputs consumed**: `agents/devops.agent.md`, `.artifacts/06`, `08`, `09`, root/app `package.json`, `apps/api/src/{main,app.module}.ts`, `prisma/{schema.prisma,apply-sql.ts,seed.ts}`, `docker-compose.yml`, `.env.example`, `scripts/{start-demo.ps1,smoke.mjs}`, `tests/`.
- **Outputs produced**: this artifact plus the files in section 3.
- **Open questions**: Deployment target and registry (no `deploy.yml` yet)? Single host acceptable for now? Who owns off-host backups and the reverse proxy/TLS? Should a prod-mode smoke script be added (needs permission to add under `scripts/`)? Are T1-T7 fixed before CI is turned on as a required check?
- **Go/No-Go**: CONDITIONAL GO for Documentation. Document the compose flow, env variables, backup/restore and the "unverified" list; mark the Docker/CI instructions as untested until one real run of `docker compose up --build` and the workflow succeeds.
