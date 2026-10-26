# 11 - Documentation (Iteration 2)

Stage 11. Inputs: `agents/documentation.agent.md`, artifacts 00-10, source read in full (all controllers, `settings-defaults.ts`, `schema.prisma`, `seed*.ts`, `scripts/*`, package files, `docker-compose.yml`, `.env.example` files, `tests/`, web pages/dictionary). No source, script or config was changed; no build, test or server was started (only `npm-test.log`/`smoke-run.log` were read: 213/213 and 63/63 passed in the last recorded runs).

## 1. Documentation Strategy
- **Audiences**: developers/operators of the platform (README, architecture, API, settings, runbook), end users in ID and EN (buyer, seller, admin guides).
- **Deviation from the agent template**: the requester asked for `architecture`, `api-reference`, `settings`, `runbook` and two user guides instead of `getting-started`, `deployment`, `contributing`, `troubleshooting`. Their content is folded into README (quick start, Docker, tests) and runbook (start/stop, backups, env vars, troubleshooting). No contributing guide was written.
- **Manifest**: `README.md` (edited), `docs/architecture.md`, `docs/api-reference.md`, `docs/settings.md`, `docs/runbook.md`, `docs/user-guide.en.md`, `docs/user-guide.id.md`, this file.
- **Rule used**: every endpoint, setting, env var and command was checked against code; gaps are marked in the text ("untested", "not read by any code").

## 2. README.md summary
Features (map explorer, hot, promos, seller AI, performance, tickets, bilingual, adapters, ledger), Windows quick start (private PG :5433, build, API :4000, web :3000, `start-demo.ps1` gap), Docker path (marked untested), demo accounts table, test order (`npm test` before `node scripts/smoke.mjs`, restart API to reset mock locks), docs index, known limitations.

## 3. API documentation summary
All controllers covered: health, public, auth, explorer, interactions, links, quality/performance, tickets, seller insights, add-ons, operator links/pricing, geo, integrations + webhooks, cart/reservations/payments, AI, admin, mock operator. Each lists method, path, permission, parameters, response shape, coded errors. Roles/permission table and the two error body shapes are documented.

## 4. Architecture summary
Mermaid: system overview, explorer sequence, telemetry-ticket-score flow, ticket state machine, insights flow, reservation/payment sequence, ER overview. Cross-cutting rules (evidence, tenant scoping, ledger, single-instance).

## 5. User guides summary
Buyer (map, A/Z selection, route card chips, hot, promos, unmet demand, reserve/pay, performance score, AI analysis, tickets), operator (insights sections, performance, tickets, add-ons, links/integrations/KMZ/pricing), admin (approvals, ledger, settings, quality recompute), troubleshooting, glossary. UI labels were taken from `dictionary.ts`.

## 6. Coverage matrix
| Requirement | Where documented | Verified against |
| --- | --- | --- |
| R1 map-first explorer, A/Z, routes, hot, promos, capabilities | README Features, api-reference Explorer, architecture flow, user guides 2.1 | `explorer.module.ts`, `explore/page.tsx`, dictionary |
| R2 seller AI (demand/trend, congestion, add-on advice, improvement feedback) | README, api-reference Seller insights, settings (insight/congestion/hot), guides 3.1 | `insights.module.ts`, `InsightsTab.tsx` |
| R3 per-link performance | api-reference Quality, settings (perf/sla), architecture, guides 2.3/3.2 | `quality.module.ts` |
| R3 ticket tracking (auto SYSTEM, SLA, KPIs) | api-reference Tickets, settings (ticket/perf), architecture state diagram, guides 2.5/3.3 | `tickets.module.ts`, `incident-detector.ts` |
| Bilingual, adapters, ledger | README, architecture, runbook | `dictionary.ts`, integrations, ledger |
| Ops (start/stop, DB, seed, backup, env, troubleshooting) | runbook | scripts, package.json, compose, entrypoint |

## 7. Discrepancies found (docs/design vs code; code was NOT changed)
| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| X1 | Med | `scripts/start-demo.ps1` never runs `db:sql`; the seed calls `PerformanceService` which needs `link_latency_stats` (sql/002), so a fresh DB fails. Header comment cites nonexistent `npm run db:init`. | start-demo.ps1:2,22-24; seed.ts (computeMany); sql/002 |
| X2 | Med | `GET /links/:id` filters only operator approval, not link status: DRAFT/INACTIVE/MAINTENANCE links readable by any buyer (search, quote, geo, cart require ACTIVE). | links.module.ts:174-176 |
| X3 | Low | Error body shape differs from SA contract: coded errors are `{code,message}` (no `statusCode`); Nest errors are `{statusCode,message,error}`. | `err()` helpers |
| X4 | Low | `POST /seller/insights/generate` returns 201 with the full report row (SA: 202 `{reportId}`); latest report has `facts.sections` + `narrative` (SA: `sections` top level); empty 200 body when none. Pending operators may generate. | insights.module.ts |
| X5 | Low | Settings `insight.windowDays` (read, unused; window = `hot.windowDays`, insights:176) and `sla.windowDays` (never read). SA `hot.perUserDailyCap` and `insight.scheduleHours` do not exist (no scheduled insight generation). | settings-defaults.ts |
| X6 | Low | Availability KPI divides outage minutes by the whole `perf.windowDays` (unmeasured time counts as up, maintenance not removed); QA D11 still open. | quality.module.ts:94 |
| X7 | Low | `redundancyScore`: demo operators, add-on rule (`maxRedundancy 0.5`) and UI chip assume 0-1, but `POST/PATCH /operator/links` accepts 0-100. | fixtures.ts, links.module.ts:349, settings-defaults |
| X8 | Low | `seed-demo.ts:49` deletes ALL `link_metric_snapshots` (comment claims real rows are never touched); the seed re-overrides four `demo.*`/telemetry settings on every run although a comment says edits survive. | seed-demo.ts:49, seed.ts:131-140 |
| X9 | Low | `.env.example` lists `JWT_REFRESH_SECRET`, `XENDIT_SECRET_KEY`, `STRIPE_SECRET_KEY` (unused; no such providers; schema comment on `Payment.provider` also names xendit/stripe). `apps/api/.env.example` DATABASE_URL (`postgres@.../wholesale_marketplace`) differs from root `.env.example` and the demo DB. | grep of `process.env` |
| X10 | Low | `GET /links/:id/performance` and `GET /links/:id/tickets/summary` have only `AuthGuard` (no `link:read`); harmless today (all roles hold it). | quality/tickets controllers |
| X11 | Info | The landing page `/` is a marketing page, not the map; the map is the post-login home for buyers (`homeFor`). Operators/admin do not get the Tickets nav item (tickets are tabs). | page.tsx, auth.tsx, Navbar.tsx |
| X12 | Info | Previously reported QA/Tester defects now fixed in code and not documented as bugs: T1 (advisory lock), T2/T3/T4/T5 (query validation, unmet logic), T6/T7 (i18n keys), D01-D05, D07, D08, D09, D15, D16, D18-D20. Still open: D11 (X6), D13 severity abuse, D21 (English system ticket text), D22 partly. | code read |

## 8. Quality and consistency checklist
- Terminology: A-End/Z-End, route, leg, hot, unmet demand, performance score, system ticket, add-on used the same in all files; Indonesian guide uses dictionary labels.
- Gaps: docs not generated from code, so they drift; update on changes to controllers, `settings-defaults.ts`, `schema.prisma`, `dictionary.ts`, scripts or env vars. Docker/CI documented as untested. LLM narrative path undocumented by evidence (never exercised).
- Not verified by running: curl examples, backup/restore commands, `pg_ctl stop`, Docker flow.

## 9. Collaboration notes
- **Coder**: X1, X2 (one-line `status: 'ACTIVE'` in `detail`), X7 scale decision, X8, X5 (use or drop the two settings).
- **QA/Tester**: add tests for X2; mark X12 items as closed in the QA tracker.
- **DevOps**: add `db:sql` to `start-demo.ps1`; run the real `docker compose up --build`.
- **Support**: use runbook Troubleshooting and the user guides; known English-only system ticket text.

## Handoff
- **Inputs consumed**: `agents/documentation.agent.md`, `.artifacts/00-10`, `apps/api/src/**`, `apps/api/prisma/*`, `apps/web/{app,components,lib}`, `scripts/*`, package.json files, `docker-compose.yml`, `.env.example` files, `tests/`, `infra/**`.
- **Outputs produced**: `.artifacts/11-documentation.md`, `README.md` (edited), `docs/{architecture,api-reference,settings,runbook,user-guide.en,user-guide.id}.md`.
- **Open questions**: Should X2 be fixed (block non-ACTIVE detail)? Which redundancy scale is canonical (X7)? Should `sla.windowDays`/`insight.windowDays` be wired or removed? Is a contributing guide required?
- **Go/No-Go**: GO for Support. Caveat: Docker/CI instructions and backup commands are untested; the `start-demo.ps1` gap (X1) must be known by anyone setting up a fresh database.
