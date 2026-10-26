# Platform settings

Runtime configuration lives in the table `platform_settings` (`key`, `value` JSON, `description`, `isSecret`). Source of truth for defaults: [`apps/api/src/common/settings-defaults.ts`](../apps/api/src/common/settings-defaults.ts) (tunable thresholds) and the `SETTINGS` map in [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts) (provider settings).

## How settings work

- **Seeding**: `npm run seed` inserts every key with its default using `upsert ... update: {}`, so re-seeding never overwrites an admin edit. Demo seeding (unless `DEMO_MODE=false`) then **overwrites** four keys, see [Demo overrides](#demo-overrides).
- **Editing**: Admin > Settings in the web app, or `GET /api/admin/settings` and `PUT /api/admin/settings/:key` with body `{ "value": <json> }` (ADMIN only; the key must already exist; every change is written to the ledger as `setting.updated`). The endpoint does not validate shapes.
- **Fallback**: threshold settings are read through `SettingsService.cfg()`. If the stored value has a different JSON type than the default (for example a string where a number is expected), the default is used and a warning is logged. Provider settings (`payment.provider`, `ai.*`, `tax.rate`, `reservation.lock_ttl_seconds`) are read with `get(key, fallback)` and are not shape-checked.
- **Cache**: values are cached in the API process for **15 seconds**; some derived data has its own cache (explorer graph `explorer.cacheSeconds`, demand statistics 60 s). After a change, allow up to about a minute before the UI reflects it.
- Units: `*Pct` are percentages 0-100, `*Min` minutes, `*Hours` hours, `*Days` days.

## Provider and checkout settings (seed.ts)

| Key | Default | Meaning |
| --- | --- | --- |
| `payment.provider` | `"mock"` | Payment provider used at checkout: `mock` or `midtrans`. `mock` lets the buyer complete their own payment and is refused when `NODE_ENV=production` unless `ALLOW_MOCK_PAYMENTS=true`. |
| `ai.provider` | `"auto"` | `auto` (Anthropic key first, then OpenAI key, else rule-based), `anthropic`, `openai` or `rule-based`. Used by buyer analysis and the seller insight narrative. |
| `ai.model.anthropic` | `"claude-sonnet-4-5"` | Anthropic model id. |
| `ai.model.openai` | `"gpt-4o-mini"` | OpenAI model id. |
| `ai.hourly_limit` | `30` | AI route analyses per buyer per rolling hour (HTTP 429 beyond it). Does not apply to seller insights. |
| `reservation.lock_ttl_seconds` | `900` | Time-to-live of an operator lock during checkout; unpaid reservations expire after it (swept every 15 s). |
| `tax.rate` | `0.11` | VAT rate applied to the cart subtotal. |

## Hot links (demand)

| Key | Default | Meaning |
| --- | --- | --- |
| `hot.windowDays` | `7` | Length of the current window; the previous window of the same length is the baseline for the trend. Also the window used by seller insight demand sections. |
| `hot.weights` | `{"RESERVE":10,"CART_ADD":4,"SEARCH":2,"VIEW":1}` | Weight per counted interaction type in the demand score. A missing type weighs 0. |
| `hot.minEvents` | `30` | Minimum counted events in the current window (`>=`). |
| `hot.minScore` | `20` | Minimum weighted score in the current window (`>=`). |
| `hot.minTrendPct` | `25` | Minimum growth versus the previous window (`>=`). A trend only counts when the previous window had a score above 0. Also the threshold of the *Rising* insight. |
| `hot.scarcityPct` | `20` | Alternative trigger: available capacity at or below this share of total capacity (`<=`). |

A target is **hot** when `events >= hot.minEvents` and `score >= hot.minScore` and (the trend condition or the scarcity condition holds). Multi-hop routes are never hot. Only buyers generate counted events (one per user, target, type and calendar day in `platform.timezone`).

## Explorer

| Key | Default | Meaning |
| --- | --- | --- |
| `explorer.maxHops` | `3` | Upper bound on route length. A request `maxHops` is capped to this value. |
| `explorer.maxRoutes` | `50` | Maximum routes returned; `basis.truncated` is `true` when more exist. Shorter routes are enumerated first. |
| `explorer.maxParallelPerEdge` | `5` | Candidate links kept per city pair (cheapest first). |
| `explorer.cacheSeconds` | `30` | TTL of the in-memory graph cache. |
| `explorer.hotRankingLimit` | `10` | Entries in the graph `hotRanking`. |
| `promo.platform` | `[]` | Platform-level promos, an array of objects such as `{"name":"...","adjustment":{"mode":"PERCENT","value":-5},"validUntil":"2026-12-31T00:00:00Z"}`. Shown in the graph `promos` list (not attached to individual routes). Operator promos come from their pricing rules instead. |

## Interactions and retention

| Key | Default | Meaning |
| --- | --- | --- |
| `interaction.maxPerMinute` | `60` | Per-user ceiling of recorded interactions per minute (`POST /interactions` returns 429 `THROTTLED`; internal tracking is dropped silently). |
| `retention.interactionDays` | `90` | Interactions older than this are purged every 6 h (non-demo rows, 10 000 per run). |
| `retention.snapshotDays` | `90` | Metric snapshots older than this are purged by the performance scheduler (non-demo rows). |
| `platform.timezone` | `"Asia/Jakarta"` | IANA zone defining a "day" for the per-user daily dedupe of interactions. |

## Telemetry, incidents and performance

| Key | Default | Meaning |
| --- | --- | --- |
| `telemetry.pollMinutes` | `15` | Minimum age of the last snapshot before another telemetry sample is stored for an unchanged link. `0` stores a sample on every sync. |
| `perf.windowDays` | `30` | Window for latency statistics, outage minutes and ticket KPIs in the score. |
| `perf.minSamples` | `50` | Minimum samples before a link can be rated (else reason `MIN_SAMPLES`). |
| `perf.minCoverageDays` | `7` | Minimum span between first and last sample (else reason `MIN_COVERAGE`). |
| `perf.previewDays` | `7` | After the first rating only the owner and admins see the score for this many days (`PREVIEW`). |
| `perf.recomputeMinutes` | `60` | Age after which the scheduler (every 5 min, 50 links per run) recomputes a link. |
| `perf.weights` | `{"latency":0.3,"availability":0.4,"tickets":0.2,"headroom":0.1}` | Component weights; components that are not available are left out and the rest is renormalised. |
| `perf.latencyP95Tolerance` | `0.5` | Latency stability component reaches 0 when `p95/p50 - 1` is at least this value. Also the threshold of the *latency unstable* improvement. |
| `perf.availabilityFloorPct` | `95` | Availability at or below this scores 0 in the availability component; 100 scores 100. |
| `perf.headroomFullPct` | `50` | Headroom component is 100 when p95 utilisation leaves at least this much free capacity. |
| `perf.ticketCap` | `5` | Buyer/operator tickets in the window at which the ticket-burden half of the ticket component saturates. |
| `perf.latencyDegradeFactor` | `1.5` | A sample is degraded when latency exceeds this factor times the baseline (`>`). |
| `perf.lossDegradePct` | `1` | A sample is degraded when packet loss is above this (`>`). |
| `perf.degradeMinSamples` | `3` | Consecutive bad samples that open a DEGRADATION system ticket. |
| `perf.outageLossPct` | `100` | A sample is an outage when status is DOWN or loss is at least this (`>=`). |
| `perf.outageMinSamples` | `2` | Consecutive outage samples that open an OUTAGE system ticket. |
| `perf.baselineMinSamples` | `20` | Older samples needed to compute the latency baseline (capped at 20 in code, so values above 20 behave like 20). |
| `sla.defaultAvailabilityPct` | `99.5` | SLA target used when a link has no `slaPercent`. |
| `sla.windowDays` | `30` | **Not read by any code today** (measured availability uses `perf.windowDays`). |
| `quality.staleSyncHours` | `24` | A synced link not updated for longer than this raises the *stale sync* improvement. |

Score components (0-100 each, weights above): latency stability, measured availability (`100 * (1 - outageMinutes / windowMinutes)`, so unmeasured time counts as up), ticket handling (SLA breach rate and buyer/operator ticket count), capacity headroom. Rated only with enough samples and coverage; SLA and ticket rates are `null` below `ticket.minForRates` tickets.

## Tickets

| Key | Default | Meaning |
| --- | --- | --- |
| `ticket.sla` | `{"SEV1":{"ackMin":15,"resolveMin":240},"SEV2":{"ackMin":60,"resolveMin":480},"SEV3":{"ackMin":240,"resolveMin":1440}}` | Acknowledge and resolve deadlines per severity, stamped at creation. |
| `ticket.severityMap` | `{"OUTAGE":"SEV1","DEGRADATION":"SEV2"}` | Severity given to system tickets by kind. |
| `ticket.transitions` | `{"OPEN":["ACKNOWLEDGED","RESOLVED"],"ACKNOWLEDGED":["IN_PROGRESS","RESOLVED"],"IN_PROGRESS":["RESOLVED"],"RESOLVED":["CLOSED","OPEN"],"CLOSED":[]}` | Allowed status moves. Who may perform a move is fixed in code: operator/admin for ACKNOWLEDGED, IN_PROGRESS and RESOLVED; reporter or admin for CLOSED; reporter, operator or admin for reopen (OPEN). |
| `ticket.autoResolveSamples` | `3` | Consecutive good samples that auto-resolve an open system ticket. |
| `ticket.flapWindowMin` | `30` | A same-kind system incident within this many minutes of a resolution reopens that ticket (flap count + 1) instead of creating a new one. |
| `ticket.autoCloseHours` | `72` | Resolved tickets are auto-closed after this many hours (sweeper every 60 s). |
| `ticket.maxOpenPerUserPerLink` | `2` | Open (OPEN, ACKNOWLEDGED, IN_PROGRESS) tickets one buyer may hold per link (409 `TICKET_DUPLICATE`). |
| `ticket.minForRates` | `5` | Minimum tickets in the window before MTTA, MTTR and breach rate are shown or used. |

## Seller insights

| Key | Default | Meaning |
| --- | --- | --- |
| `insight.minEvidence` | `10` | Minimum events for demand items (top searched, rising, unmet); below it a section is `{insufficient:true}`. |
| `insight.minRentedLinks` | `3` | Rented links an operator needs before add-on advice is produced. |
| `insight.priceDeviationPct` | `20` | Price per Gbps deviation from the route median above which *price outlier* is reported (`>`). |
| `insight.minPeers` | `3` | Links on the same route (including the operator's own) needed for the price comparison. |
| `insight.slaBreachRatePct` | `25` | Ticket SLA breach rate at or above which *SLA breaches* is reported. |
| `insight.lowScore` | `60` | Performance score below which *low score* is reported. |
| `insight.generateCooldownMin` | `10` | Minimum minutes between two reports of the same operator (429 `COOLDOWN`). |
| `insight.windowDays` | `7` | **Read but not used**: the insight window is `hot.windowDays`. |
| `insight.addonRules` | five rules (see below) | Rules mapping rented links to add-on kinds. |
| `congestion.warnPct` | `80` | Utilisation at or above this is a warning (`>=`). |
| `congestion.highPct` | `90` | Utilisation at or above this is high (`>=`). |
| `congestion.sustainHours` | `6` | Window for "sustained" warning: at least 3 snapshots spanning 80 % of it, all at or above `warnPct`. |
| `congestion.forecastDays` | `14` | History used for the daily utilisation trend. |
| `congestion.minPoints` | `7` | Days of data needed for the forecast. |
| `congestion.minSlopePctPerDay` | `0.2` | Minimum growth (percentage points per day) before a days-to-saturation estimate is given. |
| `congestion.horizonDays` | `90` | Estimates beyond this many days are dropped. The estimate is labelled indicative with its R2 and point count. |

Default `insight.addonRules`: `REDUNDANCY` when `maxRedundancy` 0.5 (redundancy score at or below 0.5), `CAPACITY_UPGRADE` when `minUtilPct` 80, `PREMIUM_SLA` when `availabilityBelowSla` is true, `MONITORING` when `minRentedLinks` 3, `DDOS_PROTECTION` when `categoriesIn` `["IP_TRANSIT"]`. The redundancy rules assume a 0-1 score (as the demo operators report); the manual link form accepts 0-100.

## Demo

| Key | Default | Meaning |
| --- | --- | --- |
| `demo.countInMetrics` | `false` | Include seeded demo rows (`isDemo`) in hot, performance and insight calculations. Responses expose `basis.includesDemo` and the UI shows a *Demo data* badge. |
| `demo.incidentInjection` | `false` | Allow `POST /api/mock-operator/incidents` (ADMIN) to inject outages or degradation into the simulated operators. Responds 404 while `false`. |

### Demo overrides

The demo seed sets `demo.countInMetrics=true`, `demo.incidentInjection=true`, `telemetry.pollMinutes=0` and `perf.previewDays=0` on **every** seed run (the seed code comment says re-seeding never overwrites tuning, which is true for all other keys but not for these four). `DEMO_MODE=false` skips the overrides. For production set `demo.countInMetrics=false` and `demo.incidentInjection=false`.

## Gaps

- `sla.windowDays` and `insight.windowDays` are defined but unused (see above).
- The design called for `hot.perUserDailyCap` and `insight.scheduleHours`; neither exists. The daily cap is fixed at one counted event per user, target, type and day, and insights are only generated on demand.
- The seed also stores a `description` of `Tunable threshold` for every threshold key; `isSecret` is `false` for all keys.
