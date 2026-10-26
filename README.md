# Wholesale Network Marketplace Platform

Bilingual (Indonesia / English) multi-tenant B2B marketplace where network operators (Penyelenggara) sell telecom links and buyers (Penyewa) search, analyse with AI, view KMZ routes on a map, reserve and pay. Roles: `ADMIN`, `PENYELENGGARA` (operator / seller), `PENYEWA` (buyer).

## Features

- **Map-first explorer (`/explore`)**: a map of Indonesia whose nodes are cities (derived from active link endpoints). Pick an A-End and a Z-End (click the map or use the selects) and the side panel lists direct and multi-hop (up to `explorer.maxHops`, default 3) routes with price range, best latency, available capacity, hot flag, promos and capability chips (SLA, redundancy, KMZ, add-ons, performance score). Multi-hop routes are labelled *indicative* (sum of independent legs). Without a selection the panel shows the hot-link ranking and active promos. State lives in the URL (`?from=&to=&minGbps=`).
- **Hot links**: demand-weighted (search, view, cart add, reserve; one counted signal per user, target, type and day; seller and admin activity is never counted), compared with the previous period and with capacity scarcity. All thresholds are in `platform_settings` (`hot.*`).
- **Promos**: active pricing rules with a negative adjustment (type `PROMOTION` is flagged as promo) plus entries of the `promo.platform` setting.
- **Seller AI insights** (`/operator`, tab *AI insights*): (a) demand and trend (top searched routes, best selling, rising, congestion risk with an indicative days-to-saturation forecast, unmet demand), (b) add-on advice from the links buyers actually rent, matched against the operator's add-on catalog, (c) improvement feedback (low uptime, unstable latency, SLA breaches, low score, price outlier vs route median, stale sync, no KMZ, no telemetry). Facts are computed deterministically from the database; an LLM (only when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set) writes the narrative. The engine is shown on every report (`rule-based` or `llm:<model>`).
- **Per-link performance score (0-100)**: from latency stability (p95 vs p50), measured availability, ticket handling and capacity headroom, with explicit evidence rules (min samples and coverage) and a "not yet rated" state. Shown on link detail and marketplace cards; sellers get the full KPIs for their own links.
- **Ticket tracking**: buyers who rent a link open tickets; operators acknowledge, work and resolve them; the system opens and auto-resolves `SYSTEM` tickets from telemetry anomalies (outage, degradation, flap guard). SLA due times per severity, SLA breach sweeper, auto-close of resolved tickets, KPIs (MTTA, MTTR, breach rate) and a per-link summary.
- **Bilingual UI (ID/EN)**: strings in `apps/web/lib/dictionary.ts`; bilingual DB content stored as `{ "id": "...", "en": "..." }`.
- **Adapters / integrations**: per-operator REST adapter (`generic-rest`) with configurable endpoints, field mapping (including telemetry), polling and signed webhooks; two simulated operator APIs for the demo. Payments: `mock` (default) and `midtrans`.
- **Ledger**: append-only, hash-chained `transaction_logs` (DB triggers block UPDATE/DELETE/TRUNCATE); ticket, add-on and insight events are ledgered too. Verify under Admin > Ledger.
- **Buyer profile (`/profile`)**: wallet balance (append-only `wallet_entries`, top-up in demo mode, pay a checkout from balance), monthly charge of active rentals, budget usage, 6-month charge projection and alerts (`BUDGET_EXCEEDED`, `BUDGET_NEAR`, `LOW_BALANCE`, `RENTAL_EXPIRING`, also sent as in-app notifications), a map of rented links (KMZ route or straight A-Z line) with each link's performance score, provider reviews, and notification settings.
- **Notifications (`/notifications`, bell in the navbar)**: categories PROMO, DISCOUNT, EARLY_BIRD, BILLING_ALERT, LINK_REQUEST, TICKET, each with on/off, channels and filters (cities, providers, minimum discount %). New promotion/discount pricing rules, pre-build products and link requests are pushed to opted-in users. Email delivery is not wired (no SMTP); notifications are stored in-app.
- **Link requests (`/requests`)**: buyers post routes that do not exist yet (A/Z from reference locations, capacity, term, budget, needed-by); other buyers add support; every approved provider sees the board (with budget), responds with an offer or turns it into a pre-build product.
- **Provider profile (`/provider`, public page `/providers/:id`)**: income (total, 30 days, recurring), income and customer trend (new vs returning per month), top routes, onboarding progress checklist, reviews with replies, tier and benefits (`provider.tiers` setting).
- **Pre-build / early bird (`/prebuild`, operator tab *Pre-build*)**: providers publish planned routes with target date, progress, regular and early-bird price, slots and deadline; buyers pledge to lock the price; progress updates notify pledgers; *Launch* turns the product into a marketplace link.
- **Pricing maintenance**: inline single-link price edit, bulk change (% / add / set) with preview, CSV export and CSV import (all-or-nothing). Manual links get `basePrice`; API-synced links get a per-link override rule so the next sync does not undo it. KMZ files can generate draft links (one per route).
- **Filters**: marketplace by city (either end), origin, destination, several providers at once, category, capacity, latency, price, minimum SLA, minimum performance score, KMZ map present.
- **Data export**: Admin > Data export downloads any table as CSV or JSON (password hashes and encrypted credentials are stripped; each export is ledgered). Reference locations (cities/PoPs) are a database table managed under Admin.
- **Android / realtime monitoring**: the web app is an installable PWA (Add to Home screen on Android, offline shell, install banner) and `apps/web/android` is a Capacitor wrapper for a native APK. Realtime updates arrive over SSE (`GET /api/notifications/stream`): the bell badge and `/notifications` update instantly and a toast appears for new items; the 30 s polling is only a fallback. See [docs/android.md](docs/android.md).

## Quick start (Windows, local development)

Prerequisites: Node 20+ (Node 24 used for development), PostgreSQL 16 binaries at `C:\Program Files\PostgreSQL\16\bin` (the script and `db:sql` look there; override `psql` with `PSQL_BIN`). No Docker is needed.

```powershell
npm install   # slow on first run
```

The demo database is a private cluster in `.pgdata` (port **5433**, user `wnmp`, trust auth, database `wnmp`), independent of any Postgres service on the machine. `apps/api/.env` must contain at least `DATABASE_URL=postgresql://wnmp@localhost:5433/wnmp?schema=public`, `API_PORT=4000`, `WEB_ORIGIN=http://localhost:3000`, `JWT_ACCESS_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `PUBLIC_API_URL=http://localhost:4000` and `ALLOW_PRIVATE_OPERATOR_URLS=true` (see [docs/runbook.md](docs/runbook.md)).

Start everything with `powershell -File scripts/start-demo.ps1` (creates and starts the cluster on 5433, builds the API, `db:push`, `db:sql`, `seed`, then opens one window for the API on :4000 and one for the web on :3000). The manual steps are:

```powershell
cd apps\api
npm run build        # prisma generate + tsc. Stop the API first, otherwise Prisma generate fails with EPERM
npm run db:push
npm run db:sql       # psql with explicit -h/-p/-U/-d flags
npm run seed         # demo data; safe to re-run
node dist/main.js    # API on http://localhost:4000/api (health: /api/health)
```

```powershell
cd apps\web
npm run build
npx next start -p 3000   # web on http://localhost:3000
```

Open http://localhost:3000 and sign in with a demo account. After a re-seed, sign in again (permissions are cached in the JWT). Never run `npx prisma ...` directly; use the `npm run` scripts (a bare `npx prisma` can prompt to install a different major version). Any other PostgreSQL works: set `DATABASE_URL` in `apps/api/.env`.

## Docker Compose

`docker-compose.yml` runs `postgres` + `api` + `web` (ports bound to 127.0.0.1). Copy `.env.example` to `.env` first.

```powershell
docker compose up -d --build        # full stack
npm run db:up                       # database only (API/web on the host)
```

The compose default is `NODE_ENV=production`: the API refuses to boot until `JWT_ACCESS_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` are random values of at least 32 characters, and the mock operator, mock payments and demo seed stay off. For a local demo in containers set `NODE_ENV=development`, `DEMO_MODE=true`, `SEED_DEMO=true`, `ALLOW_PRIVATE_OPERATOR_URLS=true`. **The Docker images, compose file and `.github/workflows/ci.yml` have not been built or run yet** (see `.artifacts/10-devops-pipeline.md`); treat them as untested.

## Demo accounts (password `Demo@12345`)

| Role | Email | Lands on / notes |
| --- | --- | --- |
| Admin (`ADMIN`) | admin@demo.wnmp.test | `/admin`: overview, operators, users, ledger, sync runs, tickets, settings |
| Operator (`PENYELENGGARA`, NusaLink Backbone) | operator@nusalink.wnmp.test | `/operator`: AI insights, links, performance, tickets, integrations, KMZ, pricing, add-ons |
| Operator (`PENYELENGGARA`, Garuda Fiber Nusantara) | operator@garuda.wnmp.test | same as above, second tenant |
| Operator (pending approval, Samudra Net) | pending@operator.wnmp.test | can sign in; cannot publish until an admin approves |
| Buyer (`PENYEWA`) | buyer@demo.wnmp.test | `/explore`; has demo rentals and tickets, healthy balance, budget 300M |
| Buyer, low balance | buyer.lowbalance@demo.wnmp.test | `/profile` shows `LOW_BALANCE` |
| Buyer, over budget | buyer.overbudget@demo.wnmp.test | `/profile` shows `BUDGET_EXCEEDED` |
| Buyer, early bird | buyer.earlybird@demo.wnmp.test | pledges on pre-build products, a rental ending within 30 days |
| Buyer, new | buyer.new@demo.wnmp.test | no rentals, owns link requests, custom promo filters |
| Buyer, suspended | buyer.suspended@demo.wnmp.test | login refused |
| Operator, manual + pre-build (Borneo Link) | operator@borneo.wnmp.test | manual links, pre-build products, answers link requests |
| Operator, rejected | rejected@operator.wnmp.test | sees the rejection reason; cannot publish |
| Operator, suspended | suspended@operator.wnmp.test | profile suspended |

The login page lists these accounts from the `demo.accounts` setting (shown only when `demo.showAccounts` is true, which the demo seed sets).

Seeded data marked as demo (`isDemo`: telemetry history, interactions, tickets, reservations, 14 non-login demo buyers) is shown with a *Demo data* badge. `DEMO_MODE=false` at seed time keeps the production-like defaults for `demo.*` settings. Never seed demo accounts in production (the seed refuses unless `ALLOW_DEMO_SEED=true`).

## Tests

Order matters. Run the integration suite first, then the smoke script:

```powershell
npm test                 # node --test tests/ (239 tests; needs the API running on :4000 with seeded data)
node scripts/smoke.mjs   # 63 end-to-end checks
```

`scripts/smoke.mjs` reserves a demo link on every run and consumes inventory, and it creates tickets on the same buyer and link as the suite, so do not run both at once. To get the inventory back, restart the API: the simulated operators keep their locks in memory and the next sync restores availability. Set `API=http://host:4000/api` to target another API. Browser (E2E) scenarios are only listed in `tests/e2e/README.md` (no browser automation is installed). Last recorded results: `npm-test.log` 239 passed / 0 failed, smoke 63 passed / 0 failed.

## Architecture

- `apps/web` Next.js 14 + Tailwind + Leaflet. ID/EN dictionary in `lib/dictionary.ts`; bilingual DB content stored as `{ id, en }`.
- `apps/api` NestJS modules: `auth`, `admin`, `integrations` (adapter pattern + sync scheduler + webhooks), `geo` (KMZ/KML to GeoJSON), `links` (marketplace, pricing engine, operator CRUD), `ai` (buyer route analysis), `reservations` (cart, operator locks, payment providers), `interactions` (demand and hot), `explorer` (graph and routes), `quality` (telemetry, incident detector, performance score), `tickets`, `insights` (seller AI), `addons`, `mock-operator` (two simulated operator APIs; demo only).
- `apps/api/prisma/schema.prisma` PostgreSQL schema; `apps/api/prisma/sql/*.sql` holds what Prisma cannot express (constraints, partial unique indexes, stats functions, append-only triggers) and must be re-applied after every `db:push`.
- Details and diagrams: [docs/architecture.md](docs/architecture.md).

## Configuration (no hardcoded business data)

- Roles, permissions and runtime settings live in the database (`platform_settings`); admins edit them under Admin > Settings. Every key with its default and meaning: [docs/settings.md](docs/settings.md). Iteration 3 keys: `billing.*`, `notification.*`, `linkRequest.*`, `prebuild.*`, `provider.tiers`, `provider.trendMonths`, `export.maxRows`, `integration.template`, `demo.showAccounts`, `demo.accounts`.
- Reference locations (city name, province, coordinates) are the `reference_locations` table, seeded from `apps/api/prisma/data/reference-locations.json` and managed under Admin > Reference locations.
- Not moved to the database: UI labels (they are translations in `dictionary.ts`), enum values (schema), and the fixtures of the two *simulated* operator APIs in `apps/api/src/mock-operator/fixtures.ts`, which stand in for external systems and are never read by the platform itself.
- Operator API URL, auth, endpoints and field mapping are stored per integration (credentials AES-256-GCM encrypted).
- AI: set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `apps/api/.env` to use an LLM for narratives. Without a key the engine is labelled `rule-based` and the output is computed deterministically from live database data. Only the rule-based path has been exercised in testing.
- Payments: `payment.provider = mock` (hosted sandbox page) by default; `midtrans` is implemented (set `MIDTRANS_SERVER_KEY`, point the Midtrans notification URL to `/api/webhooks/payments/midtrans`). Additional providers implement `PaymentProvider`. `XENDIT_SECRET_KEY` and `STRIPE_SECRET_KEY` appear in `.env.example` but no such provider exists.
- `ALLOW_PRIVATE_OPERATOR_URLS=true` is demo-only; it lets the aggregator call localhost. Leave it unset in production to block SSRF to private addresses.

## Documentation

- **Presenting the app: [docs/demo-guide.md](docs/demo-guide.md)** (one-command start, LAN access, 10-minute demo flow, reset)

| Document | Content |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | modules, data flow, diagrams, data model overview |
| [docs/api-reference.md](docs/api-reference.md) | every HTTP endpoint with auth, parameters, responses, error codes |
| [docs/settings.md](docs/settings.md) | every `platform_settings` key, default and meaning |
| [docs/runbook.md](docs/runbook.md) | start/stop, database, seeding, backups, environment variables, troubleshooting |
| [docs/user-guide.en.md](docs/user-guide.en.md) / [docs/user-guide.id.md](docs/user-guide.id.md) | buyer, operator and admin guides (English / Indonesian) |
| [tests/e2e/README.md](tests/e2e/README.md) | browser test scenarios (not automated) |
| [infra/monitoring/README.md](infra/monitoring/README.md) | probes and alerts |

## Known limitations

- `scripts/start-demo.ps1` does not run `db:sql` (see Quick start); its header comment mentions an `npm run db:init` script that does not exist.
- Measured availability counts days without telemetry as up (the denominator is the whole `perf.windowDays` window; planned maintenance is not removed), so a young history can overstate uptime.
- Login throttle, rate limiter, explorer cache and interval jobs (sync, ticket sweeper, telemetry, purge) live in API process memory: run a single API instance.
- Auth is a bearer JWT (8 h) kept in `localStorage`, with no refresh or revocation: a suspended user keeps access until the token expires.
- Seller insights are generated on demand only (no scheduler); LLM narratives are untested; no automated browser tests; map markers are not keyboard-focusable (use the A/Z selects).
- System-generated ticket titles and timeline messages are English only.
- Docker images, compose file and the CI workflow are unbuilt/untested.
- Open security findings are listed in `.artifacts/09-security-review.md` (for example S-12 token revocation, S-13 token storage, S-14 webhook replay and amount check, S-15 DNS rebinding, S-16 reservation payload scope).

## Scripts

`npm run lint`, `npm run format`, `npm run build:api`, `npm run build:web`, `npm run db:up`, `npm test`. In `apps/api`: `build`, `db:push`, `db:sql`, `db:triggers`, `seed`, `start`, `dev`.