# 06 - Coder Plan and Implementation Log (Iteration 2)

Stage 6. Inputs: `03-sa-system-design.md`, `04-uiux-design.md`, `05-data-schema.md`, `02-pm-roadmap.md`. Stack unchanged (NestJS + Prisma + PostgreSQL, Next.js 14 + Tailwind + Leaflet).

## 1. What was built (request -> implementation)
| Request | Backend | Frontend |
| --- | --- | --- |
| 1. Map-first explorer (A-End/Z-End, routes, hot, promos, capabilities) | `src/explorer` (`GET /explorer/graph`, `GET /explorer/routes`), `src/interactions` (demand + hot), `PricingService` reuse | `/explore` (default landing for buyers), `components/ExplorerMap.tsx`, selects as keyboard fallback, URL state, Indicative/Demo badges |
| 2. Seller AI (demand/congestion, add-on advice, improvement feedback) | `src/insights` (facts + bilingual text + optional LLM narrative via `AiService.completeJson`), `src/addons`, `GET /operator/performance` | Operator tabs: Insights, Performance, Add-ons |
| 3. Link performance + ticket tracking | `src/quality` (telemetry sampling, `IncidentDetector`, `PerformanceService`), `src/tickets` (state machine, SLA sweeper, KPIs), mock-operator incident injection | Performance card on link detail, report-issue modal, `/tickets`, `/tickets/[id]`, operator + admin ticket tabs, perf chip in marketplace |
| 4. Agent collaboration | Artifacts `.artifacts/00..12` | n/a |

## 2. Decisions that follow the PM/SA artifacts
- All thresholds in `platform_settings` (`src/common/settings-defaults.ts`, seeded with `update:{}`); demo overrides in seed only (`demo.countInMetrics`, `demo.incidentInjection`, `telemetry.pollMinutes=0`, `perf.previewDays=0`).
- Evidence rules: min samples/coverage before a score; insight sections return `{insufficient,needed,have}`; every payload carries `basis`/`evidence`; demo rows flagged `isDemo` and surfaced as a badge.
- Hot: per-user/target/type/day dedupe via unique `countedKey`; only buyers count; CART_ADD/RESERVE recorded server-side only.
- Multi-hop routes are `indicative`, never hot, reserved per leg.
- Ticket events use `ledger.append` inside the same transaction (rollback if the ledger write fails).

## 3. Deviations / additions
- PM "admin-created promo rules": platform-level promos are read from `promo.platform` setting (operator rules need an operator id).
- Congestion forecast ("days to saturation") is delivered as indicative, with r2 and point count.
- `GET /links/performance?ids=` and `GET /operator/performance` added (batch reads, no N+1).
- Bug found while seeding: re-running the seed orphaned links from their API config; `SyncService` now re-adopts links (`apiConfigId`) on every sync.
- `prisma/apply-sql.ts` (`npm run db:sql`) applies `prisma/sql/*.sql` via psql with explicit host/port flags.

## 4. Files created or modified
API: `src/{explorer,interactions,quality,tickets,insights,addons}/*`, `src/common/{settings-defaults,nodes}.ts`, changes in `links`, `reservations`, `integrations`, `ai`, `mock-operator`, `app.module.ts`, `prisma/{schema.prisma,seed.ts,seed-demo.ts,apply-sql.ts,sql/*.sql}`.
Web: `app/{explore,tickets}/**`, `components/{ExplorerMap,PerformanceCard,ReportIssue,SlaCountdown,TicketTable,InsightsTab,PerformanceTab,AddOnsTab}.tsx`, changes in `ui.tsx`, `Navbar`, `operator/admin/marketplace/links` pages, `lib/{api,auth,dictionary}.ts`.
Scripts: `scripts/smoke.mjs` (63 checks incl. iteration 2).

## 5. Known gaps (honest list)
- Telemetry beyond latency/loss/status/maintenance and operator-reported utilisation is not modelled; field names for non-mock operators go through `fieldMapping.telemetry`.
- Interaction purge and snapshot purge run on timers inside the API process (single instance assumed; no distributed lock besides DB claims).
- LLM narrative path is implemented but only the rule-based path was exercised (no API key in the sandbox).
- Explorer map markers are not individually keyboard-focusable; the A/Z selects are the accessible path.
- No automated frontend tests yet; coverage comes from the API smoke test and manual browser checks.

## Handoff
- **Inputs consumed**: artifacts 02-05, existing code.
- **Outputs produced**: source listed above; `.artifacts/06-coder-plan.md`.
- **Open questions for QA/Tester**: threshold boundaries (>= vs >) in hot/congestion/outage detection; dedupe races on `countedKey` and ticket creation; ledger rollback on failure; demo exclusion toggle (`demo.countInMetrics=false`).
- **Go/No-Go**: GO for QA and Tester (API :4000 and web :3000 running with seeded data; `node scripts/smoke.mjs` green).
