# Runbook

Operational notes for the local Windows demo (private PostgreSQL on port 5433) and the Docker Compose stack. Commands were taken from `scripts/start-demo.ps1`, the package scripts and the stage 7-10 artifacts. Items marked **untested** were not executed when this document was written.

## Components and ports

| Component | Local demo | Compose |
| --- | --- | --- |
| PostgreSQL 16 | private cluster `.pgdata`, `localhost:5433`, user `wnmp` (trust auth), database `wnmp` | `postgres` service, `127.0.0.1:${POSTGRES_PORT:-5432}` |
| API | `node dist/main.js` in `apps/api`, `http://localhost:4000/api` | `api` service, `127.0.0.1:${API_PORT:-4000}` |
| Web | `npx next start -p 3000` in `apps/web`, `http://localhost:3000` | `web` service, `127.0.0.1:${WEB_PORT:-3000}` |

The local PostgreSQL Windows service (port 3602 on the development machine, unknown password) is not used.

## Start and stop (Windows local)

First start of a new checkout:

```powershell
npm install                                   # several minutes
powershell -File scripts/start-demo.ps1       # creates .pgdata, starts PG on 5433, build, db:push, seed, opens API and web windows
```

`start-demo.ps1` does **not** run `npm run db:sql`, but `seed` needs the SQL functions it creates. On a fresh database use the manual sequence instead (also after every schema change):

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
& "$pgBin\pg_isready.exe" -h localhost -p 5433        # start PG first if this fails, see "Start PostgreSQL"
cd apps\api
npm run build        # prisma generate + tsc
npm run db:push
npm run db:sql
npm run seed
node dist/main.js
```

In a second terminal:

```powershell
cd apps\web
npm run build
npx next start -p 3000
```

Start PostgreSQL (private cluster). Do not pipe the output of `pg_ctl`, it hangs:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'; $pgData = '.pgdata'
Start-Process -WindowStyle Hidden -FilePath "$pgBin\pg_ctl.exe" -ArgumentList '-D', $pgData, '-o', '"-p 5433 -c listen_addresses=localhost"', '-l', "$pgData\server.log", '-w', 'start'
```

Stop the API and web (the cluster is left running):

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'dist[\\/]main\.js' -or $_.CommandLine -match 'next.*start') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

Stop the cluster: `& "$pgBin\pg_ctl.exe" -D .pgdata stop` (untested; again do not pipe it).

Health check: `GET http://localhost:4000/api/health` returns `{"status":"ok","db":true}`. Always **stop the API before `npm run build` in `apps/api`** (see Troubleshooting, Prisma EPERM). Restart the API after a build; restarting also resets the in-memory mock operator locks.

## Start and stop (Docker Compose, untested)

```powershell
Copy-Item .env.example .env   # then set secrets (see Environment variables)
docker compose up -d --build  # postgres, api (waits for DB, db push, db:sql, optional seed), web
docker compose ps
docker compose logs -f api
docker compose down           # keeps the pgdata volume; add -v to delete data
npm run db:up                 # database only, for host-run API/web
```

The compose default is `NODE_ENV=production`; the API exits at boot until `JWT_ACCESS_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` are set to random values of at least 32 characters. For a demo set `NODE_ENV=development`, `DEMO_MODE=true`, `SEED_DEMO=true`, `ALLOW_PRIVATE_OPERATOR_URLS=true`. Run one API replica only (in-memory limiter, throttle, caches and interval jobs); extra replicas need `RUN_DB_SETUP=false`. Neither the images nor `.github/workflows/ci.yml` have been built or run.

## Database

- **Schema**: `npm run db:push` (`prisma db push --skip-generate`). There are no migrations. Destructive changes make the push fail (no `--accept-data-loss`), which keeps data safe.
- **SQL objects**: `npm run db:sql` applies `apps/api/prisma/sql/*.sql` in name order with `psql` (partial unique indexes, CHECK constraints, stats functions, append-only triggers). Re-run it after **every** `db:push`, because a push drops indexes it does not know. The files are idempotent. `psql` is taken from `PSQL_BIN`, else `C:\Program Files\PostgreSQL\16\bin\psql.exe`, else `psql` on the PATH; the connection comes from `DATABASE_URL` through explicit `-h -p -U -d` flags.
- **Triggers only**: `npm run db:triggers` re-applies the ledger triggers (the seed also does this).
- **Interactive SQL**: use flags, not a `postgresql://` URL argument (that hung in this environment):

```powershell
& "$pgBin\psql.exe" -w -h localhost -p 5433 -U wnmp -d wnmp -c "select count(*) from network_links"
```

- **Never run `npx prisma ...` directly.** Without a local install it prompts to download another major version. Use the npm scripts (`build` runs `prisma generate`, `db:push`, `prisma:validate`, `prisma:format`, `prisma:studio`).

## Seeding

`npm run seed` (in `apps/api`, runs through `tsx`) is idempotent: roles, permissions, settings (existing values are kept), the three demo operators, a demo buyer, KMZ routes, the two simulated-operator integrations (first sync), pricing rules, add-ons, demo telemetry/demand/tickets/reservations (`isDemo=true`), initial performance scores and the ledger triggers. Facts to know:

- Demo accounts and password: see the README. All use `Demo@12345`.
- Re-running resets the demo rows and **deletes all rows of `link_metric_snapshots`** (also non-demo ones), and re-overrides `demo.countInMetrics`, `demo.incidentInjection`, `telemetry.pollMinutes` and `perf.previewDays` unless `DEMO_MODE=false`.
- The seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.
- It calls the mock operator payloads in process; the API does not have to be running, but the seeded integrations point to `PUBLIC_API_URL` (default `http://localhost:4000`) and are synced every 30 s by the running API.
- After a seed, existing browser sessions hold stale JWT permissions: sign in again.

## Backups and restore

Local private cluster (commands follow the standard PostgreSQL tools; **untested** here):

```powershell
& "$pgBin\pg_dump.exe" -h localhost -p 5433 -U wnmp -Fc -f backup-$(Get-Date -Format yyyyMMdd).dump wnmp
# restore into an empty database
& "$pgBin\createdb.exe" -h localhost -p 5433 -U wnmp wnmp_restore
& "$pgBin\pg_restore.exe" -h localhost -p 5433 -U wnmp -d wnmp_restore backup-YYYYMMDD.dump
```

After a restore re-apply `npm run db:sql`, then verify the ledger (`GET /api/admin/ledger/verify` as admin, or Admin > Ledger > Verify). `pg_restore` of ledger tables can conflict with the immutability triggers; restore data before the triggers exist and re-apply them.

Docker (from the DevOps stage, untested): `docker compose exec -T postgres pg_dump -U wnmp -Fc wnmp > backup-<date>.dump`. Use the postgres container's `pg_dump` (version 16; the API image ships psql 15). Back up daily and before each deploy, copy off-host, encrypt, test a restore regularly. Point-in-time recovery is not set up.

Rollback: redeploy the previous image tag; if the schema changed restore the pre-deploy dump first.

## Environment variables

Loaded from `apps/api/.env` (local demo: the API runs with `apps/api` as working directory) or from the compose `.env` in the repository root. `NEXT_PUBLIC_API_URL` is read by the web build (`apps/web/.env` or compose build arg) and baked into the bundle.

| Variable | Default / example | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local demo: `postgresql://wnmp@localhost:5433/wnmp?schema=public` | Prisma, seed and `db:sql`. Compose builds its own from `POSTGRES_*`. |
| `API_PORT` | `4000` | API listen port. |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS origins (comma separated) and payment return URL. |
| `PUBLIC_API_URL` | `http://localhost:4000` | Origin stored by the seed for the simulated operator APIs. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Browser-visible API origin (web build time). |
| `NODE_ENV` | `development` (compose: `production`) | `production` enforces secrets and turns the mock operator, mock payments and demo seed off. |
| `JWT_ACCESS_SECRET` | `change-me` in `.env.example` | JWT signing key; production needs >= 32 random characters. |
| `CREDENTIALS_ENCRYPTION_KEY` | `change-me` in `.env.example` | Key for operator credentials (AES-256-GCM). Rotating it makes stored credentials unreadable. |
| `TRUST_PROXY_HOPS` | unset | Number of reverse proxies in front of the API (correct `req.ip` for limiter and throttle). |
| `RATE_LIMIT_PER_MIN` / `RATE_LIMIT_HEAVY_PER_MIN` | production 1200 / 120, else off | Per-IP limits (heavy: auth, explorer, ai, insight generation). |
| `ALLOW_PRIVATE_OPERATOR_URLS` | `true` in the demo | Lets operator integrations target private/loopback addresses (needed for the simulated operators). Never in production. |
| `ENABLE_MOCK_OPERATOR` | unset | Mounts the simulated operator and incident endpoints in production. Never in production. |
| `ALLOW_MOCK_PAYMENTS` | unset | Lets buyers self-complete mock payments in production. Never in production. |
| `ALLOW_DEMO_SEED` | unset | Allows the seed when `NODE_ENV=production`. |
| `DEMO_MODE` | `true` in `.env.example` | Only read by the seed: `false` keeps the safe `demo.*` defaults. |
| `SEED_DEMO`, `RUN_DB_SETUP`, `DB_WAIT_RETRIES` | `false`, `true`, `60` | Docker entrypoint only: seed after push, run `db:push` + `db:sql`, DB wait attempts. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | unset | Enable LLM narratives (`ai.provider` selects). Without a key the engine is `rule-based`. |
| `MIDTRANS_SERVER_KEY` / `MIDTRANS_IS_PRODUCTION` | unset | Midtrans provider (`payment.provider=midtrans`); sandbox unless `true`. |
| `PSQL_BIN` | auto | Path of `psql` used by `db:sql`. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`, `WEB_PORT` | `wnmp`, `wnmp`, `wnmp`, `5432`, `3000` | Compose only. |

Defined but unused by the code: `JWT_REFRESH_SECRET` (no refresh tokens), `XENDIT_SECRET_KEY`, `STRIPE_SECRET_KEY` (no such providers). `apps/api/.env.example` still shows `postgres:postgres@localhost:5432/wholesale_marketplace`, which differs from the root `.env.example` and the demo database.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `npm run build` in `apps/api` fails in `prisma generate` with **EPERM** (rename of the query engine DLL) | The running API holds the Prisma engine file. Stop the API (see Stop), build, start again. |
| `npx prisma ...` asks to install `prisma@8` | Do not use `npx prisma`; use the npm scripts, which use the locally installed version. |
| `psql postgresql://...` hangs or prompts for a password | Use `-w -h localhost -p 5433 -U wnmp -d wnmp` flags (trust auth, no password). |
| `pg_ctl` seems to hang | It was piped or its console attached; start it with `Start-Process` as above and do not pipe output. |
| Seed or the performance endpoints fail with `function link_latency_stats(...) does not exist` | `npm run db:sql` was never applied (it is missing from `start-demo.ps1`). Run it, then seed again. |
| Ledger verify / immutability triggers missing after `db:push` | Re-run `npm run db:sql` (or `npm run db:triggers`). Do not expose the API to traffic between push and sql. |
| API exits at boot: `JWT_ACCESS_SECRET must be a random value of at least 32 characters in production` | Production mode (the compose default) with placeholder secrets. Set real secrets or `NODE_ENV=development`. |
| 403 `Insufficient permission` on `/tickets` or insights right after seeding | The JWT predates the new permissions. Sign out and in. |
| `npm test` fails at the start with module errors on Node >= 21 | `tests/index.js` exists for this; run `npm test` (not `node --test tests/*.mjs`). |
| `npm test` ticket/explorer tests fail after several runs | Demo data accumulates closed tickets; links consumed by `smoke.mjs` are `LOCKED/RESERVED`. Restart the API (resets mock operator locks, the next sync restores availability) or re-seed. Never run `smoke.mjs` concurrently with the tests. |
| `smoke.mjs` reservation steps fail on a second run | Each run reserves a demo link. Run `npm test` first, then `smoke.mjs`, restart the API to restore inventory. |
| Hot, performance or insight numbers do not change after editing a setting | Settings are cached 15 s, demand statistics 60 s, the explorer graph `explorer.cacheSeconds`. |
| Operator integration rejected with "Operator URL resolves to a private address" | The SSRF guard. For the simulated operators set `ALLOW_PRIVATE_OPERATOR_URLS=true`; keep it off in production. |
| Links show no performance score | Not enough telemetry: needs `perf.minSamples` samples over `perf.minCoverageDays` days, and a `fieldMapping.telemetry` mapping for real operators. Buyers additionally wait `perf.previewDays` after the first rating. |
| No auto tickets during an injected incident | Needs `demo.incidentInjection=true`, `telemetry.pollMinutes=0` (or wait the poll interval) and 2-3 syncs (30 s polling). |
| Many `Too many attempts` 401 on login | In-memory login throttle (8 per IP+email, 15 min). Restart the API to clear it. |
| `npm install` very slow | Normal for the first install (several minutes); run it asynchronously. |
| Web build `next lint` asks for ESLint setup in CI (DevOps note) | `apps/web` has no ESLint config of its own; this is untested in CI. |
| Web shows English-only text on system tickets | Known gap: system ticket titles and timeline messages are not localised. |
| `GET /api/health` returns 503 | Database unreachable; check `pg_isready -h localhost -p 5433` and `DATABASE_URL`. |

## Monitoring and security notes

Probes, alerts and SQL checks are in [../infra/monitoring/README.md](../infra/monitoring/README.md). The production hardening checklist and open findings are in `.artifacts/09-security-review.md` (sections 6 and 7). In production also set `payment.provider=midtrans`, `demo.incidentInjection=false`, `demo.countInMetrics=false`, delete `*@demo.wnmp.test` users if the demo seed ever ran, and keep every `ALLOW_*`/`ENABLE_MOCK_OPERATOR` flag unset.
