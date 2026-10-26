# 08 - Tester Results (Iteration 2)

Stage 8. Inputs: `agents/tester.agent.md`, `07-qa-test-plan.md`, `06-coder-plan.md`, source read-only (tickets, explorer, interactions, quality, insights, addons, links, reservations, i18n). Nothing under `apps/` or `scripts/` was changed; nothing was started, rebuilt or reseeded. Only `package.json` got `"test": "node --test tests/"`.

## 1. Test Files Created
Framework: Node built-in runner (`node:test`, `node:assert/strict`, global `fetch`, ESM `.mjs`), no new dependencies. The agent standard (Vitest/Supertest/Playwright) was overridden by the requester.

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `tests/helpers.mjs` (call/login/actors; registers a 2nd buyer `tester.buyer2@wnmp.test` once) | - | - | - |
| `tests/index.js` (entry so `node --test tests/` works on Node 24, see 6) | - | - | - |
| `tests/unit/i18n.test.mjs` | 32 | 30 | 2 |
| `tests/integration/tickets.test.mjs` (creation, scope, 25 from/to cells x 5 roles, updates, reopen, KPIs, races) | 51 | 50 | 1 |
| `tests/integration/rbac.test.mjs` (401/403 matrix, auth edge cases) | 71 | 71 | 0 |
| `tests/integration/explorer.test.mjs` | 14 | 11 | 3 |
| `tests/integration/performance.test.mjs` | 11 | 10 | 1 |
| `tests/integration/insights.test.mjs` | 12 | 12 | 0 |
| `tests/integration/interactions.test.mjs` | 9 | 9 | 0 |
| `tests/integration/addons.test.mjs` | 5 | 5 | 0 |
| `tests/integration/payments.test.mjs` | 5 | 5 | 0 |
| `tests/integration/zz-ledger.test.mjs` | 3 | 3 | 0 |
| `tests/e2e/README.md` (15 browser scenarios; no Playwright added) | - | - | - |
| **Total** | **213** | **206** | **7** |

Run: `npm test` / `node --test tests/` (about 21 s). Two consecutive runs gave identical results (206/7). Every ticket created is driven to CLOSED (verified: 0 OPEN/ACK/IN_PROGRESS tickets left). Index loads files in one process in fixed order, so suites never race for the buyer's per-link ticket cap.

## 2. Scenario Test Plan
- **Preconditions**: API :4000 seeded (demo accounts, `NL-JKT-SBY-N` rented by demo buyer). Ticket tests run on that link; explorer tests use the admin token and interaction tests the operator token, so no buyer demand/hot statistics are skewed. No link is reserved or locked; payment tests only replay already-final payments.
- **Matrix**: positive, negative and edge per endpoint; every expected status taken from QA 3.3, SA codes and `settings-defaults.ts`.
- **Assumption**: `ticket.maxOpenPerUserPerLink=2`, `explorer.maxHops=3`, cooldown 10 min (defaults).

## 3. Test Results (what is covered and passes)
- **Tickets**: full role x from x to matrix (buyer, other buyer, owner operator, rival operator, admin): allowed -> 201, forbidden -> 403 `TICKET_FORBIDDEN`, illegal -> 409 `TICKET_STATE_CONFLICT`, outsiders -> 404, rejected moves never change state; garbage/missing `to` -> 409 (no 5xx); parallel acknowledge -> one winner; SLA due dates SEV1/SEV3; validation 400s; non-renter 403; operator on rival link 404; cap 3rd ticket 409 `TICKET_DUPLICATE`; tenant-scoped lists; invalid status/kind/source (incl. repeated param) -> 400 `INVALID_FILTER`; reply-exists 409 (sequential and parallel); internal+public -> 400 and not stored; non-string/empty/oversized message -> 400; internal notes hidden from buyer; closed ticket rejects every update with 409 and stores nothing; reopen re-stamps `resolveDueAt`, clears `resolvedAt`/breach, keeps first `ackAt`; ledger rows written; `/links/:id/tickets/summary` aggregate-only, rival operator 404, `days` clamp.
- **Performance**: buyer/owner/admin full detail; rival operator gets only `rated`+`score` (+`basis.windowDays`), no KPIs/components/samples; `ids=bogus` -> 200 `rated:false` (D01 fixed); mixed ids match the single endpoint; empty and 700-id lists; operator table is tenant-scoped.
- **Explorer**: `SAME_NODE` (case/space variants), `NODE_NOT_FOUND`, direct Jakarta<->Surabaya route (1 aggregated route, <=5 candidates), multi-hop indicative and never hot, `maxHops` 1/2/99/0/abc, unmet Medan->Denpasar, minMbps/sort junk, graph consistency.
- **Interactions**: `CART_ADD`/`RESERVE`/junk type -> 400 `INVALID_TYPE`; unknown link/node 404; non-string/empty/oversized names 400; valid SEARCH/VIEW 204; operator rows stored uncounted; audit endpoint ADMIN-only.
- **RBAC**: 24 seller/admin endpoints x anonymous, buyer, second buyer, operator (admin ones), pending operator; garbage bearer tokens; no role escalation on register.
- **Insights**: access, cooldown 429 `COOLDOWN`, `?operatorId=` ignored for non-admins, section shape `{insufficient,needed,have}` xor `{items}`, every item has code/severity/params/non-empty evidence and bilingual text (no `undefined`/`NaN`), items reference only own links, no buyer identity or rival name.
- **Add-ons**: CRUD, validation `INVALID_ADDON`, rival PATCH/DELETE 404 with data unchanged, catalog visibility, ledger.
- **Payments**: replaying success/failure on final payments changes nothing and appends no ledger rows; other buyer 404, operator/admin 403.
- **Ledger**: hash chain valid before and after the suite.
- **i18n**: parsed dictionary (>400 keys) has id+en everywhere, equal placeholders, no duplicates; all static `t('..')` keys and every enumerated `t(\`prefix.${x}\`)` pattern exist; unknown dynamic patterns fail the test.

## 4. Bug Reports (genuine product defects, all 7 failing tests)
| # | Sev | Where | Repro | Expected vs actual |
| --- | --- | --- | --- | --- |
| T1 | Med | `tickets.module.ts:166-173` (D13) | 5 parallel `POST /tickets` by the demo buyer on NL-JKT-SBY-N | cap 2 -> actual 5 x 201 (count-then-insert race; also seeds seller score gaming). |
| T2 | Low | `explorer.module.ts:321` + `common/nodes.ts:2` | `GET /explorer/routes?from=Jakarta&from=Surabaya&to=Medan` | 400 expected; actual 500 (`nodeKey` on an array). |
| T3 | Low | `links.module.ts:247` | `GET /links/performance?ids=a&ids=b` | 400/ignore expected; actual 500 (`ids.split` on an array). |
| T4 | Low | `explorer.module.ts:330,395,514` | `GET /explorer/routes?from=Jakarta&to=Makassar&maxHops=-1` | default/400 expected; actual 200, `basis.maxHops:-1`, no routes, `unmet:true`. |
| T5 | Low | `explorer.module.ts:514` | `...&maxHops=1` on a connected pair (needs 2 hops) | `unmet:false` expected (hop limit is not missing capacity); actual `unmet:true`, which is also logged as a counted SEARCH+unmet signal for sellers. UI never sends `maxHops`, so API-client only. |
| T6 | Low | `dictionary.ts`, `operator/page.tsx:328`, `integrations.module.ts:197` | Operator pauses an API integration | `status.PAUSED` missing: the badge shows the raw key in both languages. |
| T7 | Low | `insights.module.ts:621` | `NOT_FOUND` code has no `err.NOT_FOUND` entry | ID users see the English server text (QA D21 family; INVALID_TYPE/ADDON/MESSAGE are now present). |

Verified fixed since QA: D01 (bogus ids), D04 (reopen conflict handled in code), D05 (rival KPIs), D08a/b/c (internal+public, closed updates, non-string), D09 (reopen clock/ackAt), D16 (filter 400).

## 5. Edge Case Findings
- Idempotent payment completion is inconsistent in shape: first call returns the reservation, a replay returns the raw payment row (status stays correct; clients must not rely on the body).
- `POST /seller/insights/generate` for a pending (unapproved) operator is not blocked (add-ons are); not asserted, needs a product decision.
- Admin without `operatorId` gets 403 "No operator profile" on `/seller/insights/latest` (acceptable, but undocumented).
- Rival-operator `performance` also returns `basis.windowDays`; harmless but not "rated+score only".
- Demo data accumulates closed tickets per run (dozens, all CLOSED); they feed the NL-JKT-SBY-N ticket KPIs.
- `status.AUTHORIZED/REFUNDED/PARTIALLY_REFUNDED/PENDING_VERIFICATION` have no label but nothing assigns them today (excluded from the i18n test, re-add when used).

## 6. Collaboration Handoff
- **QA**: re-run `npm test` after fixes for T1-T7; `explorer`, `performance`, `tickets`, `i18n` files hold the regression tests. Update QA D13 (still open), D21 (partly open).
- **Not covered (and why)**: threshold boundaries (hot/detector/score/congestion), sweeper auto-close, flap, maintenance, degradation/escalation, SYSTEM-ticket dedupe race (need DB inserts, clock control or mock incidents that mutate demo data), demo toggle `demo.countInMetrics` (needs settings write plus 60 s cache wait), draft/suspended link visibility (needs link creation), >50 path graphs and >50 candidate ids (D02/D03, no such data), ledger rollback on forced failure, LLM fallback, sync/telemetry D07, all browser behaviour (see `tests/e2e/README.md`).
- **Environment note**: on Node 24 `node --test tests/` fails with MODULE_NOT_FOUND (directory is resolved as a module); `tests/index.js` was added so the requested script works. Do not run `smoke.mjs` concurrently (it creates tickets for the same buyer and link).

## Handoff
- **Inputs consumed**: `.artifacts/07-qa-test-plan.md`, `06-coder-plan.md`, `agents/tester.agent.md`, `apps/api/src/**`, `apps/web/{app,components,lib}/**`, `apps/api/prisma/schema.prisma` (read-only).
- **Outputs produced**: `.artifacts/08-tester-results.md`, `tests/**` (213 tests: 206 pass, 7 fail on genuine defects), root `package.json` `test` script.
- **Open questions**: Should `unmet` ignore hop-limited searches (T5)? Should unapproved operators generate insights? Cap semantics for buyer tickets under concurrency (T1: DB-level guard vs advisory lock).
- **Go/No-Go**: GO for Security with conditions: T1 (abuse vector, affects seller scores) and T2/T3 (5xx reachable by any logged-in user with a repeated query parameter) should be reviewed; no data leak, tenant-isolation or RBAC failure found in 213 checks.
