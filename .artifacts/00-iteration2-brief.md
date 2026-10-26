# Iteration 2 brief (shared context for all agents)

Project folder: `c:\Users\soega\Project BAru\run\Wholesale platform` (this IS the `/run/YYYYMMDD_Application_Theme/` folder; artifacts go in `.artifacts/`).
Product: bilingual (Indonesia/English) multi-tenant B2B wholesale telecom link marketplace. Roles: ADMIN, PENYELENGGARA (operator/seller), PENYEWA (buyer).
Already built and running (see README.md, `apps/api`, `apps/web`, `scripts/smoke.mjs`): RBAC, operator API adapter + sync scheduler + webhooks, KMZ/KML to GeoJSON, marketplace filters, pricing rules, cart with operator locks, payments (mock + Midtrans), hash-chained append-only ledger, buyer AI route analysis (rule-based unless LLM key), admin console.

## User requests for this iteration (verbatim intent, Indonesian)
1. Tampilan dimulai dari Peta Indonesia; user tinggal memilih titik A-End dan Z-End. Secara summary ditampilkan rute-rute yang ada, kemudian hot link mana, promo-nya apa, serta kemampuan-kemampuan lainnya.
2. AI function tidak hanya untuk kebutuhan pembeli; platform harus memberi nilai tambah ke penjual: (a) analisa & trend link yang laris, berpotensi congest tinggi, sering dicari orang; (b) advice berdasarkan link yang selama ini disewa orang untuk menawarkan add-on services; (c) feedback link mana yang perlu improvement.
3. Setiap link dianalisa performanya; jika memungkinkan semua tiket yang ada dilacak performanya sehingga bisa jadi nilai tambah penjualan.
4. Kolaborasi seluruh agent (Creator -> PM -> System Analyst -> UI/UX -> Data -> Coder -> QA -> Tester -> Security -> DevOps -> Documentation -> Support) agar masing-masing memeriksa fungsi yang terkait dengannya.

## Constraints (unchanged)
- NO HARDCODING of business data (prices, availability, link attributes, credentials, thresholds): from DB, external APIs, or `platform_settings`. UI strings go in `apps/web/lib/dictionary.ts` (ID + EN). Bilingual DB content is `{ "id": "...", "en": "..." }`.
- Modular: web (Next.js 14 + Tailwind + Leaflet) / api (NestJS + Prisma + PostgreSQL) / integrations (payment, maps, AI) decoupled.
- AI honesty: facts are computed from DB deterministically; an LLM (if `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` set) only writes narrative; otherwise engine is labelled `rule-based`.
- Demo data that is fabricated (history, tickets, interactions) must be clearly marked as demo seed data in seed code.
- Build checks: `npm run build` in `apps/api` and `apps/web`; API smoke test `node scripts/smoke.mjs`. DB: private Postgres on port 5433 (`apps/api/.env`).

## Proposed design from the Coder (agents: refine or challenge it with explicit decisions; the Coder will follow your artifacts)
Map-first explorer (`/explore`): full-width Leaflet map of Indonesia. Nodes = cities (PoPs) derived from link endpoints; edges = existing links aggregated per city pair. Click node = A-End, click second node = Z-End. API `GET /explorer/graph` (nodes + edges with link count, availability, min price, best latency, hot score) and `GET /explorer/routes?from=&to=&minMbps=` (direct + up to 3-hop routes with price range, latency, operators, hot flag, promos from pricing rules, capability chips: add-ons, redundancy, SLA, performance score, KMZ available). Summary panel lists routes; hot-link ranking; active promos.
Demand tracking: append-only `LinkInteraction` (VIEW, SEARCH, CART_ADD, RESERVE) with optional route pair; hotness = weighted last-7-days vs previous-7-days trend; unmet demand = searches for routes with no available capacity.
Performance: per-link score 0-100 from latency stability (mean/p95/stddev from `LinkMetricSnapshot`), realized availability vs SLA (from outage ticket minutes), ticket burden (MTTA/MTTR/SLA-breach rate), utilization headroom. Shown to buyers on link detail and marketplace as a sales value-add.
Tickets: `LinkTicket` (+ `LinkTicketUpdate`) with severity, status OPEN/ACKNOWLEDGED/IN_PROGRESS/RESOLVED/CLOSED, SLA due times from `platform_settings` (`ticket.sla`), sources BUYER/OPERATOR/SYSTEM; system auto-opens DEGRADATION/OUTAGE tickets from sync anomalies and auto-resolves on recovery; every ticket event goes to the ledger (new event type TICKET).
Seller AI: `SellerInsightReport` persisted; deterministic facts + bilingual item texts (demand/congestion, add-on opportunities from rented links mapped to the operator's `AddOnService` catalog, improvement feedback incl. price vs route median, stale sync, no KMZ, low uptime), optional LLM narrative. New permission `insight:read` (operators/admin), `ticket:create` (buyers), `ticket:manage` (operators).
Add-on catalog: `AddOnService` per operator (kind REDUNDANCY, CAPACITY_UPGRADE, MONITORING, PREMIUM_SLA, DDOS_PROTECTION, MANAGED_SERVICE, OTHER; bilingual name/description; price; currency).
