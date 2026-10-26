# 02 - Product Manager Roadmap (Iteration 2)

Stage 2. Reads `01-creator-vision.md` and `00-iteration2-brief.md`. Audience: System Analyst, then Coder. All thresholds below are DEFAULTS stored in `platform_settings` (admin-editable), never in code.

## 1. Roadmap
- **Horizon**: this iteration (MVP) plus two follow-ups. **MVP release target**: demoable end-to-end on seeded demo data, `npm run build` (api+web) green and `scripts/smoke.mjs` extended.
- **Phases**:
  - **MVP (iter 2)**: explorer map, demand signals + hot, link performance score, tickets, seller insights, add-on catalog (advice only).
  - **Post-MVP (iter 3)**: seller alerts/digests, add-on bundles in checkout, operator benchmarking, capacity-exhaustion forecast, right-of-reply workflow polish.
  - **Scale**: premium analytics subscription, SLA-credit automation, external NMS integrations, more regions.
- **Sequencing**: (1) settings keys + schema (interaction, metric snapshot, ticket, add-on, insight) -> (2) interaction tracking + explorer API -> (3) metrics/ticket engine + score -> (4) insights -> (5) UI. Explorer (P1) can ship before score/insights; hot and unmet demand depend on interactions; score depends on metrics + tickets; insights depend on all three.

## 2. Product Decisions (binding; resolves Creator's open items)

### 2.1 Definitions and default thresholds (`platform_settings`)
| Term | Definition | Default key = value |
| --- | --- | --- |
| Hot | Link/route is hot if its weighted demand score over the last 7d >= `hot.minScore` AND (trend vs previous 7d >= `hot.minTrendPct` OR availability scarcity <= `hot.scarcityPct`) AND evidence >= minimum. Weights: RESERVE 10, CART_ADD 4, SEARCH 2, VIEW 1. Max 1 counted signal per user per link per type per day. Sellers' own users excluded. | `hot.windowDays=7`, `hot.minScore=20`, `hot.minTrendPct=25`, `hot.scarcityPct=20`, `hot.weights={...}`, `hot.perUserDailyCap=1` |
| Congestion risk | Utilization (reserved/total capacity) >= `congestion.warnPct`; HIGH at `congestion.highPct`; or sustained link utilization from telemetry above `congestion.warnPct` for >= `congestion.sustainHours`. If no utilization data: "no data". | `congestion.warnPct=80`, `congestion.highPct=90`, `congestion.sustainHours=6` |
| Degradation | Metric sample window where latency > `perf.latencyDegradeFactor` x link baseline (p50 of prior 7d) OR loss > `perf.lossDegradePct`, for >= `perf.degradeMinSamples` consecutive samples. | `perf.latencyDegradeFactor=1.5`, `perf.lossDegradePct=1`, `perf.degradeMinSamples=3` |
| Outage | Link unreachable/zero throughput (operator status DOWN or loss >= `perf.outageLossPct`) for >= `perf.outageMinSamples` consecutive samples. Outage minutes = first bad sample to first good sample. | `perf.outageLossPct=100`, `perf.outageMinSamples=2` |
| SLA breach | (a) Realized availability over the rolling window < the link's contracted SLA (link attribute; if absent, `sla.defaultAvailabilityPct`) or (b) ticket not acknowledged/resolved within its due time (`ticket.sla`). Planned maintenance (flagged by operator) excluded. | `sla.windowDays=30`, `sla.defaultAvailabilityPct=99.5`, `ticket.sla={SEV1:{ackMin:15,resolveMin:240},SEV2:{ackMin:60,resolveMin:480},SEV3:{ackMin:240,resolveMin:1440}}` |
| Stale sync | Last successful sync older than threshold. | `quality.staleSyncHours=24` |
| Price outlier | Link price/Mbps deviates from route median by more than threshold (only if >= minimum peers). | `insight.priceDeviationPct=20` |

### 2.2 Minimum evidence (no default-good scores)
- **Performance score** (0-100) shown only if samples >= `perf.minSamples=50` AND coverage >= `perf.minCoverageDays=7`; else badge "Not yet rated / Belum dinilai". Always show basis: window, sample count, last update. Score weights from `perf.weights` (latency stability, realized availability, ticket burden, headroom).
- **Hot flag / trend**: needs >= `hot.minEvents=30` real events in window on that route; below it, no hot label.
- **Insight items**: each needs >= `insight.minEvidence=10` underlying events/rentals (or >= 3 rented links for add-on advice); else item = "insufficient data".
- **Demo labelling**: every fabricated row carries `isDemo=true` (+ seed comment); UI shows "Demo data" badge wherever demo rows contribute. Demo rows count toward score/hot only when `demo.countInMetrics=true` (default true in seed env, false in production); the badge appears regardless.

### 2.3 Visibility (who sees what)
| Data | BUYER (PENYEWA) | SELLER (PENYELENGGARA) | ADMIN |
| --- | --- | --- | --- |
| Performance score + basis, uptime %, latency stats | Yes, all published links | Own links; others' only as route-level median | All |
| Ticket aggregates (count, MTTR, SLA-breach rate, period) | Yes, aggregated only | Own, with detail | All |
| Ticket detail/text | Only tickets they opened | Own links' tickets | All |
| Individual outage list | Count and total minutes only | Own, full | All |
| Hot flag, promos | Yes | Yes | Yes |
| Demand trend, unmet demand, insights, add-on advice | No | Own only | All |
| Who rented/searched (identity) | No | No (counts only) | Yes (audit) |
- Sellers see their own score before it is public (preview period `perf.previewDays=7` at first launch); seller may add one public reply per ticket (right of reply). No public operator ranking this iteration.

### 2.4 Other decisions
- **Add-ons**: catalog + seller advice ONLY. Buyers see add-ons as capability chips ("available, contact/ask via reservation note"); no add-on purchase, pricing in checkout, or payment this iteration. Prices stored for display only.
- **Multi-hop**: direct and up to `explorer.maxHops=3`, labelled "Indicative / Indikatif"; each leg shows its own operator, price, terms; reserve per leg only; no end-to-end guarantee; total = sum of legs (not a quote).
- **Telemetry assumed from operator API** (adapter extension; absent fields => "no data"): per-link `latencyMs`, `lossPct`, `status` (UP/DOWN/DEGRADED), `utilizationPct` (optional), `timestamp`, optional `plannedMaintenance`; poll via existing sync scheduler every `telemetry.pollMinutes=15`. Outage events via webhook optional. No telemetry => no score; seller sees "connect telemetry" improvement item. Demo seed supplies synthetic snapshots (flagged).
- **Ticket sources**: BUYER (only for links they reserved), OPERATOR, SYSTEM (auto from degradation/outage, auto-resolve after `ticket.autoResolveSamples=3` good samples). SYSTEM tickets dedupe per link per open incident.
- **Promos**: sourced from existing pricing rules; owner = seller (platform promos = admin-created rules). Show only active (date/conditions valid).
- **Insights** are decision support: no automatic price changes; LLM narrative optional, engine label (`rule-based` / `llm:<model>`) always shown; facts deterministic.

## 3. Prioritized User Stories and Acceptance Criteria

**Request 1 - Map-first discovery**
- **P1-S1 (Must)** As a buyer I land on an Indonesia map and pick A then Z.
  - AC: `/explore` is the default post-login/landing view; nodes derive from DB endpoints (zero hardcoded cities); selecting two nodes calls `GET /explorer/routes` and renders results < 2 clicks from landing; clearing/swapping A-Z works; empty DB => empty state, no fake nodes.
- **P1-S2 (Must)** Route summary.
  - AC: each route shows hop count, operators, price range, best latency, available Mbps, hot flag, promos, chips (add-ons, redundancy, SLA, performance score or "Not yet rated", KMZ); multi-hop labelled "Indicative"; no-route state shows "no capacity" and records a SEARCH (unmet demand).
- **P1-S3 (Should)** Hot-link ranking + active-promo list on the explorer; filter by min Mbps. AC: ranking only lists links passing hot rules; empty when none.

**Request 2 - Seller value (AI)**
- **P2-S1 (Must)** Demand/trend and congestion. AC: insight lists top searched, best-selling, rising and congestion-risk links with counts and window; unmet-demand routes listed; each item shows basis or "insufficient data".
- **P2-S2 (Must)** Add-on advice. AC: from links rented on the seller's links, map to the seller's add-on catalog; item states how many renters hold which link/kind; seller without catalog gets "create add-on" suggestion; only own data.
- **P2-S3 (Must)** Improvement feedback. AC: flags low uptime, latency instability, price outlier, stale sync, missing KMZ, no telemetry, SLA breaches, each with evidence and bilingual text.
- **P2-S4 (Should)** Add-on catalog CRUD (operator, bilingual). AC: CRUD limited to own operator; buyers read-only chips.
- **P2-S5 (Should)** Optional LLM narrative. AC: absent key => engine `rule-based`; numbers identical either way.

**Request 3 - Performance and tickets**
- **P3-S1 (Must)** Per-link score. AC: computed per 2.2; shows basis; not-rated state; visible on link detail and marketplace card; recomputed by schedule; weights from settings.
- **P3-S2 (Must)** Ticket lifecycle. AC: create (buyer/operator/system), status OPEN->ACKNOWLEDGED->IN_PROGRESS->RESOLVED->CLOSED with legal transitions only; SLA due times from `ticket.sla`; every event appended to ledger as TICKET; RBAC per 2.3 (`ticket:create`, `ticket:manage`).
- **P3-S3 (Must)** Auto tickets. AC: degradation/outage detection per 2.1 opens one SYSTEM ticket per incident and auto-resolves on recovery; planned maintenance does not open tickets.
- **P3-S4 (Should)** Ticket KPIs (MTTA, MTTR, breach rate) in score and seller view; seller reply visible to buyers.
- **P3-S5 (Could)** Buyer-facing "quality filter" on marketplace (min score).

**Request 4 - Pipeline**
- **P4-S1 (Must)** Each agent artifact reviews its own area (security of ticket/insight RBAC, data integrity of seed flags, QA/test plan, support runbook). AC: every artifact ends with `## Handoff`; Security confirms no buyer can read other buyers' tickets or seller insights of other operators.

## 4. MVP Cut
- **IN (Must)**: P1-S1, P1-S2, P2-S1, P2-S2, P2-S3, P3-S1, P3-S2, P3-S3, P4-S1, demo labelling, settings keys.
- **IN if capacity (Should)**: P1-S3, P2-S4 (catalog CRUD - minimum is seeded catalog + read API), P2-S5, P3-S4.
- **OUT**: P3-S5, add-on purchase, alerts/digests, public operator rankings, automatic repricing, SLA credits, external NMS.
- **Cut order if time runs short**: P2-S5 -> P3-S4 -> P1-S3 -> P2-S4 CRUD (keep read) -> multi-hop beyond 2 hops. Never cut: evidence basis, demo badge, RBAC on tickets/insights.

## 5. Tasks, Critical Path, Risks
| Work package | Owner | DoD |
| --- | --- | --- |
| WP1 Settings + schema + seed (flagged demo) | System Analyst, Data, Coder | migration applies; seed idempotent; `isDemo` present |
| WP2 Interaction tracking + explorer API | Coder | AC P1-S1/S2; hot per 2.1 |
| WP3 Telemetry ingest + score + tickets | Coder | AC P3-S1..S3; ledger TICKET events |
| WP4 Insights + add-ons | Coder | AC P2-S1..S3 |
| WP5 Explorer UI, link score, insight page, ID/EN dictionary | UI/UX, Coder | no hardcoded strings; empty/insufficient states |
| WP6 QA/Tester/Security/DevOps/Docs/Support | respective agents | builds green, smoke extended, RBAC tests, runbook |
- **Critical path**: WP1 -> WP3 -> WP4 (score and tickets feed insights); WP2 runs in parallel after WP1.
- **Risks**: thin data (mitigated by evidence rules and demo flag); operators lack telemetry (Gate B: score only where evidence exists); hot gaming (caps, seller exclusion); scope (cut order above).
- **Gates**: A real interaction volume per route; B share of links with telemetry; C seller feedback before monetizing analytics.

## 6. Collaboration Plan
- **System Analyst**: data model incl. `isDemo`, indexes for interaction aggregation, formulas for hot/score using keys in 2.1/2.2, adapter telemetry contract, ticket state machine, RBAC matrix per 2.3.
- **Others**: UI/UX (states: not rated, insufficient data, demo badge, indicative route); Data (aggregation jobs, retention of interactions/snapshots); Security (ticket/insight isolation, interaction abuse); QA/Tester (threshold edge cases); Support (ticket runbook).
- **Leadership log**: public scoring + right of reply; add-ons advice-only; demo counting policy.

## Handoff
- **Inputs consumed**: `.artifacts/01-creator-vision.md`, `.artifacts/00-iteration2-brief.md`, `agents/product-manager.agent.md`.
- **Outputs produced**: `.artifacts/02-pm-roadmap.md`.
- **Open questions**: (1) operator acceptance of public scoring/preview period; (2) real telemetry fields per operator (assumed in 2.4); (3) default thresholds to be validated against week-1 baseline; (4) whether production should ever count demo rows (default: no).
- **Go/No-Go**: **GO** for System Analyst, conditional on evidence-basis, demo labelling, settings-driven thresholds and ticket/insight RBAC.
