# API reference

Base URL: `http://localhost:4000/api` (global prefix `api`, port from `API_PORT`). JSON in and out. Every endpoint below was read from the controllers in `apps/api/src`. Anything not listed does not exist.

## Conventions

**Authentication**: `Authorization: Bearer <JWT>` obtained from `POST /auth/login` (HS256, 8 h, no refresh). The token carries roles and permissions, which are fixed until it expires: sign in again after a re-seed or role change.

| Role | Permissions (seeded) |
| --- | --- |
| `ADMIN` | all of the below |
| `PENYELENGGARA` (operator) | `link:read`, `link:write`, `apiconfig:manage`, `geo:upload`, `pricing:manage`, `ticket:manage`, `insight:read`, `addon:manage` |
| `PENYEWA` (buyer) | `link:read`, `reservation:create`, `ai:analyze`, `ticket:create` |

Other permissions held only by `ADMIN`: `operator:approve`, `user:manage`, `ledger:read`, `demo:manage`. Where a route lists several permissions the caller needs all of them. "Role" restrictions use `@Roles`. "Authenticated" means any valid token with no further check.

**Errors** (two shapes, both seen in practice):

- Coded errors thrown by the new modules: `{ "code": "TICKET_STATE_CONFLICT", "message": "..." }` (no `statusCode` field).
- Framework errors: `{ "statusCode": 403, "message": "Insufficient permission", "error": "Forbidden" }`. Validation errors of DTOs return `message` as an array.
- Rate limit (only when `NODE_ENV=production` or `RATE_LIMIT_PER_MIN` is set): `429 { "code": "RATE_LIMITED", "message": "Too many requests" }` with `Retry-After`. Heavy paths: `/api/auth/*`, `/api/explorer/*`, `/api/ai/*`, `/api/seller/insights/generate`. Webhooks are exempt.

| Status | Typical cause |
| --- | --- |
| 400 | invalid body, query or filter |
| 401 | `Missing token`, `Invalid or expired token`, bad login, login throttle (`Too many attempts, try again later`) |
| 403 | `Insufficient role`, `Insufficient permission`, `No operator profile`, `Operator account is not approved yet`, `TICKET_NOT_RENTER`, `TICKET_FORBIDDEN` |
| 404 | not found **or** not in the caller's scope (the API never answers 403 to hide existence of other tenants' rows) |
| 409 | state conflict (ticket transition, duplicate, checkout) |
| 429 | `THROTTLED`, `COOLDOWN`, `RATE_LIMITED`, AI hourly limit |

Coded error values: `SAME_NODE`, `NODE_NOT_FOUND`, `INVALID_TYPE`, `THROTTLED`, `INVALID_TICKET`, `TICKET_NOT_RENTER`, `TICKET_DUPLICATE`, `TICKET_FORBIDDEN`, `TICKET_STATE_CONFLICT`, `REPLY_EXISTS`, `INVALID_MESSAGE`, `INVALID_FILTER`, `INVALID_ADDON`, `COOLDOWN`, `NOT_FOUND` (insights), `RATE_LIMITED`.

**Pagination** (tickets, links, ledger): `page` (from 1) and `pageSize`; response `{ items, total, page, pageSize }` (the ledger returns `{ total, items }`).

**Visibility**: public reads only see links that are not deleted, `ACTIVE` and owned by an `APPROVED` operator, except where noted for `GET /links/:id`.

## Quick example

```bash
curl.exe -s -X POST http://localhost:4000/api/auth/login -H "content-type: application/json" ^
  -d "{\"email\":\"buyer@demo.wnmp.test\",\"password\":\"Demo@12345\"}"
# -> 201 { "token": "<jwt>", "user": { "id", "email", "fullName", "locale", "roles", "perms", "operator", "buyer" } }

curl.exe -s "http://localhost:4000/api/explorer/routes?from=jakarta&to=surabaya&sort=price" -H "authorization: Bearer <jwt>"
```

## Index

| Area | Endpoints |
| --- | --- |
| [Health and public](#health-and-public) | `GET /health`, `GET /public/stats` |
| [Auth](#auth) | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| [Explorer](#explorer) | `GET /explorer/graph`, `GET /explorer/routes` |
| [Interactions](#interactions) | `POST /interactions`, `GET /admin/interactions` |
| [Links](#links-marketplace) | `GET /links`, `/links/facets`, `/links/performance`, `/links/:id`, `/links/:id/quote` |
| [Quality / performance](#quality-and-performance) | `GET /links/:id/performance`, `POST /admin/quality/recompute`, `GET /operator/performance` |
| [Tickets](#tickets) | `POST/GET /tickets`, `GET /tickets/:id`, `POST /tickets/:id/updates`, `POST /tickets/:id/transition`, `GET /links/:id/tickets/summary` |
| [Seller insights](#seller-insights) | `GET /seller/insights/latest`, `POST /seller/insights/generate`, `GET /seller/insights` |
| [Add-ons](#add-ons) | `GET /addons`, `GET/POST /operator/addons`, `PATCH/DELETE /operator/addons/:id` |
| [Operator links and pricing](#operator-links-and-pricing) | `/operator/overview`, `/operator/links`, `/operator/pricing-rules` |
| [Geo (KMZ/KML)](#geo-kmzkml) | `POST /geo/upload`, `GET /geo`, `POST /geo/:id/attach`, `GET /geo/link/:linkId` |
| [Integrations](#integrations-and-webhooks) | `/operator/api-configs/*`, `POST /webhooks/operators/:configId` |
| [Cart, reservations, payments](#cart-reservations-and-payments) | `/cart*`, `/reservations*`, `POST /payments/mock/:id/complete`, `POST /webhooks/payments/:provider` |
| [AI (buyer)](#ai-buyer-route-analysis) | `POST /ai/analyze`, `GET /ai/history` |
| [Admin](#admin) | `/admin/overview`, `operators`, `users`, `ledger`, `ledger/verify`, `sync-runs`, `settings` |
| [Mock operator (demo)](#mock-operator-demo-only) | `/mock-operator/*` |

---

## Health and public

### `GET /health`
No auth. `200 { "status": "ok", "db": true }`; `503 { "status": "degraded", "db": false }` when `SELECT 1` fails.

### `GET /public/stats`
No auth. `200 { "links", "operators", "availableLinks", "routes" }` (counts of active links, approved operators, available links, distinct origin/destination pairs).

## Auth

### `POST /auth/register`
No auth. Body: `email` (email), `password` (8-100), `fullName` (2-120), `companyName` (2-160), `role` (`PENYEWA` | `PENYELENGGARA`), optional `locale` (`ID` | `EN`, default `ID`). Operators start with approval `PENDING`. `201` same payload as login. `409 Email already registered`.

### `POST /auth/login`
No auth. Body: `email`, `password`. `201 { token, user: { id, email, fullName, locale, roles[], perms[], operator: { id, approvalStatus, displayName } | null, buyer: { id, companyName } | null } }`. `401 Invalid credentials` (also for suspended users). Throttle: 8 failures per IP+email, 50 per IP, 30 per email within 15 minutes, in memory, answered with `401 Too many attempts, try again later`.

### `GET /auth/me`
Authenticated. Same `{ token, user }` payload with a fresh token.

## Explorer

Both require `link:read`.

### `GET /explorer/graph`
Query: `minMbps` (optional, positive number). Cached for `explorer.cacheSeconds` per `minMbps` and demo flag. Response:

```json
{
  "nodes": [{ "key": "jakarta", "name": "Jakarta", "lat": -6.2, "lng": 106.8, "linkCount": 5, "availableCount": 4 }],
  "edges": [{ "a": "jakarta", "b": "surabaya", "linkCount": 3, "availableCount": 3, "availableMbps": 130000,
              "minPrice": 41000000, "currency": "IDR", "bestLatencyMs": 7.9, "hot": true, "hotScore": 52,
              "trendPct": 40, "hasGeometry": true }],
  "hotRanking": [{ "linkId": "...", "name": { "id": "...", "en": "..." }, "from": "Jakarta", "to": "Surabaya",
                   "operator": "NusaLink Backbone", "score": 52, "trendPct": 40, "priceFrom": 41000000, "currency": "IDR" }],
  "promos": [{ "ruleId": "...", "operator": "NusaLink Backbone", "operatorId": "...", "linkId": "..." , "name": "...",
               "type": "PROMOTION", "isPromotion": true, "adjustment": { "mode": "PERCENT", "value": -7 },
               "conditions": null, "validUntil": "2026-11-17T00:00:00.000Z" }],
  "basis": { "includesDemo": true, "windowDays": 7, "generatedAt": "..." }
}
```

`key` is the lower-cased, whitespace-normalised city name; nodes without coordinates are omitted. An edge groups all links of one city pair (undirected, `a` < `b` alphabetically). `availableCount`/`availableMbps`/`minPrice`/`bestLatencyMs` only consider eligible links (`availability=AVAILABLE`, price set, `availableMbps >= minMbps`). `hotRanking` lists hot links only. `promos` contains every active pricing rule with a negative adjustment plus entries of `promo.platform`. Values in the numeric example are illustrative.

### `GET /explorer/routes`
Query: `from`, `to` (node keys or city names, required, single values), `minMbps` (>= 0), `maxHops` (positive integer, capped to `explorer.maxHops`), `sort` (`price` | `latency` | `score` | `hot`; default hops ascending then lowest price).

```json
{
  "from": "jakarta", "to": "surabaya", "unmet": false,
  "routes": [{
    "id": "jakarta>surabaya", "hops": 1, "indicative": false,
    "legs": [{ "from": "jakarta", "to": "surabaya", "candidates": [{
      "linkId": "...", "operator": { "id": "...", "displayName": "..." }, "priceFrom": 41000000, "currency": "IDR",
      "latencyMs": 7.9, "availableMbps": 80000, "slaPercent": 99.9, "redundancyScore": 0.82,
      "performance": { "rated": true, "score": 84 }, "hot": true, "hasGeometry": true }] }],
    "operators": ["NusaLink Backbone"],
    "priceRange": { "min": 41000000, "max": 52000000, "currency": "IDR" },
    "bestLatencyMs": 7.9, "availableMbps": 80000, "hot": true,
    "hotInfo": { "score": 52, "prevScore": 30, "events": 41, "trendPct": 73, "hot": true, "scarcityPct": 35.2 },
    "promos": [], "chips": { "addOns": ["MONITORING"], "redundancy": { "min": 0.82, "max": 0.9 }, "slaPercent": 99.9,
      "performance": { "rated": true, "minScore": 84 }, "kmz": true } }],
  "basis": { "includesDemo": true, "generatedAt": "...", "maxHops": 3, "truncated": false }
}
```

- Eligible links: ACTIVE, approved operator, `availability=AVAILABLE`, price set, capacity at least `minMbps`. Up to `explorer.maxParallelPerEdge` cheapest candidates per leg, up to `explorer.maxRoutes` routes, shorter routes first.
- `hops > 1` means `indicative: true`: the price range is the sum of the legs' minima/maxima, latency the sum of the legs' best latencies, capacity the minimum over legs. Multi-hop routes are never `hot` and `hotInfo` is `null`.
- `unmet: true` when no route exists at the full search depth; this is also recorded as an unmet-demand SEARCH signal for sellers. A request with `maxHops` below the platform maximum is never flagged unmet.
- Each call records a SEARCH interaction (fire and forget).
- Errors: `400 SAME_NODE`; `404 NODE_NOT_FOUND`; plain `400` for missing/array `from`/`to`, invalid `minMbps`, invalid `maxHops`.

## Interactions

### `POST /interactions`
`link:read`. Client-reported demand signal; `204` with no body. Body: `{ "type": "SEARCH" | "VIEW", "linkId"?, "from"?, "to"?, "minMbps"? }`. `CART_ADD` and `RESERVE` are recorded by the server only and are rejected here. At least a link or a `from`+`to` pair must be present to store anything. Errors: `400 INVALID_TYPE`, `400 NODE_NOT_FOUND` (empty/non-string/too long node name), `404 NODE_NOT_FOUND` (unknown link or city), `429 THROTTLED` (`interaction.maxPerMinute`). Seller and admin interactions are stored but never counted.

### `GET /admin/interactions`
Role `ADMIN`. Query: `userId`, `linkId`, `type`. Returns up to the latest 100 raw `link_interactions` rows (the only place where user identity is visible).

## Links (marketplace)

All `link:read`. Out-of-range or non-numeric numeric filters are ignored.

### `GET /links`
Query: `q`, `origin`, `destination` (case-insensitive contains), `category`, `operatorId`, `minCapacityMbps`, `maxLatencyMs`, `minPrice`, `maxPrice`, `availableOnly=true`, `sort` (`price_asc` | `price_desc` | `latency_asc` | `capacity_desc` | `newest`, default newest), `page`, `pageSize` (max 50, default 12). Response `{ items, total, page, pageSize }`; each item is the link row plus `operator { id, displayName, slug }`, `hasGeometry`, `priceFrom` (12-month unit price after rules) and `performance { rated, score, reason? }`. Note the item carries internal columns (`apiConfigId`, `externalId`, `syncChecksum`, `attributes`, security finding S-24).

### `GET /links/facets`
`{ operators: [{id,displayName}], cities: [], categories: [], ranges: { price, latencyMs, capacityMbps: { min, max } } }`.

### `GET /links/performance?ids=a,b,c`
Batch score lookup (comma separated, or repeated `ids`; up to 500 unique ids, processed in chunks of 50). `200 { "<id>": { "rated": true, "score": 84 } | { "rated": false, "score": null, "reason": "MIN_SAMPLES|MIN_COVERAGE|NO_TELEMETRY|PREVIEW" } }`. Unknown or invisible ids come back as not rated.

### `GET /links/:id`
Link detail: the link row, `operator { id, displayName, slug, description }`, `performance` (see below), `hasGeometry`, `metrics` (last 60 snapshots, oldest first: `at`, `latencyMs`, `availableMbps`, `utilizationPct`), `priceTiers` (quotes for 1, 12, 24, 36 months). Records a VIEW interaction. Only the operator must be approved; the link status is not filtered, so DRAFT/INACTIVE/MAINTENANCE links of approved operators are readable (inconsistent with search, quote and geo, see the artifact). `404` otherwise.

### `GET /links/:id/quote`
Query: `termMonths` (default 12), `mbps`. `{ basePrice, unitPrice, currency, termMonths, applied: [{ ruleId, name, mode, value, before, after }] }`. `404` unless the link is ACTIVE with an approved operator.

## Quality and performance

### `GET /links/:id/performance`
Authenticated (no permission check). Visible links only (owner and admin also see their drafts), `404` otherwise.

- Not rated: `{ "rated": false, "reason": "NO_TELEMETRY|MIN_SAMPLES|MIN_COVERAGE|PREVIEW", "basis": {...} | null }`. `PREVIEW` means rated but still in the owner-only window (`perf.previewDays`).
- Rated, caller is buyer, admin or the owner: `{ rated, reason, score, components: { latency, availability, tickets, headroom }, basis: { windowDays, samples, coverageDays, computedAt, includesDemo }, kpis: { uptimePct, slaTargetPct, slaAvailabilityBreach, latencyMs: { mean, p50, p95, stddev }, outages: { count, totalMinutes }, tickets: { count, openCount, mttaMin, mttrMin, slaBreachRatePct } } }`. The owner and admin also get `outageList` (last 10 system outage tickets: `reference`, `incidentStartAt`, `incidentEndAt`, `status`).
- Rated, caller is a competing operator: `{ rated: true, score, basis: { windowDays } }` only.
- `mttaMin`, `mttrMin` and `slaBreachRatePct` are `null` below `ticket.minForRates` tickets; `components.headroom` is `null` without utilisation data.

### `POST /admin/quality/recompute`
Role `ADMIN`. Body `{ "linkIds"?: string[] }` (default all active links, at most 200 are scored). Runs the incident detector then the score computation. `202 { "recomputed": <n> }`.

### `GET /operator/performance`
`insight:read` (operator; an admin without an operator profile gets `403 No operator profile`). `{ items: [{ linkId, name, originName, destinationName, availability, utilizationPct, rated, score, reason, components, kpis, basis, demand: { score, events, trendPct, hot } }], includesDemo }` for the operator's own links (including drafts).

## Tickets

Ticket status flow: `OPEN -> ACKNOWLEDGED -> IN_PROGRESS -> RESOLVED -> CLOSED`, plus `OPEN`/`ACKNOWLEDGED -> RESOLVED` and reopen `RESOLVED -> OPEN` (matrix in setting `ticket.transitions`). Kinds `DEGRADATION | OUTAGE | OTHER`, severities `SEV1 | SEV2 | SEV3`, sources `BUYER | OPERATOR | SYSTEM`. Reference format `TKT-<year>-<6 digits>`. Every creation, comment, reply and transition writes a ledger row (`eventType TICKET`) in the same transaction.

### `POST /tickets`
Needs `ticket:create` (buyer) or `ticket:manage` (operator, admin). Body: `{ linkId, kind, severity, title (3-160), description (10-4000), reservationId? }`. `201` the ticket row. A buyer must hold the link in a `PAID` or `CONFIRMED` reservation. An operator may only open tickets for own links; an admin for any. Due times come from `ticket.sla`.
Errors: `400 INVALID_TICKET`, `403 TICKET_NOT_RENTER`, `404` (unknown link, or operator on a rival link), `409 TICKET_DUPLICATE` (more than `ticket.maxOpenPerUserPerLink` open tickets per buyer and link; guarded by an advisory lock).

### `GET /tickets`
Authenticated. Scope: admin all; operator tickets on own links; buyer own reported tickets. Query: `status`, `kind`, `source` (enum values, otherwise `400 INVALID_FILTER`), `linkId`, `page`, `pageSize` (max 50, default 20). Newest first; items include `networkLink { id, name, originName, destinationName }` and `operatorProfile { displayName }`.

### `GET /tickets/:id`
Authenticated, scope as above (`404` otherwise). The ticket plus `updates: [{ id, at, type, fromStatus, toStatus, message, isInternal, isPublicReply, actor: { name, role } }]` (system actor `{ name: "System", role: "SYSTEM" }`). Internal notes are hidden from buyers.

### `POST /tickets/:id/updates`
Authenticated, scope as above. Body `{ message (1-2000), isInternal?, isPublicReply? }`. `isInternal` and `isPublicReply` are for the owning operator or admin only (`403`), cannot be combined (`400 INVALID_MESSAGE`), and a ticket accepts one public reply (`409 REPLY_EXISTS`). Closed tickets reject updates (`409 TICKET_STATE_CONFLICT`). `201` the update row.

### `POST /tickets/:id/transition`
Authenticated, scope as above. Body `{ to, note? }`. Allowed by role: `ACKNOWLEDGED`, `IN_PROGRESS`, `RESOLVED` owning operator or admin; `CLOSED` reporter or admin; `OPEN` (reopen from `RESOLVED`) reporter, owning operator or admin. Returns the updated ticket. `409 TICKET_STATE_CONFLICT` for a move not in the matrix, a concurrent change, or a reopen blocked because another system incident ticket is open on the link; `403 TICKET_FORBIDDEN` when the role may not perform it. The first acknowledgement time is kept on reopen; reopen restarts the resolution deadline.

### `GET /links/:id/tickets/summary`
Authenticated. Query `days` (1-180, default 30). `{ periodDays, count, openCount, byKind: { DEGRADATION?: n, ... }, mttaMin, mttrMin, slaBreachRatePct, minForRates }`; the three rates are `null` below `ticket.minForRates` tickets. A competing operator receives `404`.

System behaviour (no endpoint): the incident detector opens one `SYSTEM` ticket per link when `perf.outageMinSamples` consecutive samples are outages or `perf.degradeMinSamples` are degraded, escalates degradation to outage, reopens within `ticket.flapWindowMin`, and auto-resolves after `ticket.autoResolveSamples` good samples. The sweeper (every 60 s) flags SLA breaches and closes tickets `ticket.autoCloseHours` after resolution.

## Seller insights

All need `insight:read` (operator or admin). Reports are persisted per operator.

### `GET /seller/insights/latest`
Query `operatorId` (admin only; ignored for operators). Returns the latest report row or an empty `200` body when none exists. Admins without `operatorId` and without an operator profile get `403`.

### `POST /seller/insights/generate`
Body `{ "operatorId"?: string }` (admin only). Builds and stores a report, then `201` with the stored row:

```json
{
  "id": "...", "operatorProfileId": "...", "windowStart": "...", "windowEnd": "...",
  "engine": "rule-based", "includesDemo": true, "createdAt": "...",
  "narrative": { "summary": { "id": "...", "en": "..." }, "actions": [{ "id": "...", "en": "..." }] },
  "facts": { "params": { "windowDays": 7, "minEvidence": 10 },
    "sections": {
      "demand": { "topSearched": {}, "bestSelling": {}, "rising": {}, "congestionRisk": {}, "unmetDemand": {} },
      "addOns": {}, "improvements": {} } }
}
```

Each section is either `{ "insufficient": true, "needed": n, "have": m }` or `{ "items": [{ "code", "severity": "info|warn|high", "linkId?", "linkName?", "params", "text": { "id", "en" }, "evidence" }] }`. Codes: `TOP_SEARCHED`, `BEST_SELLING`, `RISING`, `CONGESTION`, `UNMET_DEMAND`, `ADDON_OPPORTUNITY` (`params.action` is `LIST_ADDON` or `CREATE_ADDON`), `LOW_UPTIME`, `LATENCY_UNSTABLE`, `SLA_BREACHES`, `LOW_SCORE`, `PRICE_OUTLIER`, `STALE_SYNC`, `NO_KMZ`, `NO_TELEMETRY`. Add-on items carry only a renter count, never identities. `engine` is `rule-based` or `llm:<model>`; the LLM (when configured) only writes `narrative`. `429 COOLDOWN` (with `reportId` of the last report) within `insight.generateCooldownMin`. Not blocked for operators that are still pending approval.

### `GET /seller/insights`
Last 20 reports, metadata only: `[{ id, engine, createdAt, includesDemo }]`.

## Add-ons

### `GET /addons`
`link:read`. Query `operatorId`. Active add-ons of approved operators: `[{ id, operatorProfileId, kind, name: {id,en}, description, price, priceUnit, currency, applicableCategories, isActive, createdAt, updatedAt, deletedAt }]`. Display only: there is no purchase flow.

### `GET /operator/addons`, `POST /operator/addons`, `PATCH /operator/addons/:id`, `DELETE /operator/addons/:id`
`addon:manage`. Body: `{ kind, name: { id?, en? }, description?: { id?, en? }, price? (0..1e12), priceUnit? (<=32), currency? (<=8, default operator currency), applicableCategories? (<=50 strings), isActive? }`. `kind` is one of `REDUNDANCY | CAPACITY_UPGRADE | MONITORING | PREMIUM_SLA | DDOS_PROTECTION | MANAGED_SERVICE | OTHER`. A missing language is filled from the other. Writes need an approved operator (`403` otherwise). `DELETE` is a soft delete. Errors: `400 INVALID_ADDON`, `404` for other operators' rows. Ledger: `addon.created|updated|deleted`.

## Operator links and pricing

### `GET /operator/overview`
`link:write`. `{ profile: { id, displayName, approvalStatus, rejectionReason }, links, available, activeIntegrations, pendingReservations, revenue }`.

### `GET /operator/links`, `POST /operator/links`, `PATCH /operator/links/:id`, `DELETE /operator/links/:id`
`link:write` (writes need an approved operator). `POST` body: `name: { id?, en? }`, `originName`, `destinationName` (required), optional `description`, `category`, `status` (`DRAFT | ACTIVE | INACTIVE | MAINTENANCE`, default `ACTIVE`), `availability` (`AVAILABLE | UNAVAILABLE`), coordinates, `distanceKm`, `capacityMbps`, `availableMbps`, `latencyMs`, `slaPercent` (0-100), `redundancyScore` (0-100 accepted; demo operators and the insight rules use 0-1), `basePrice`, `currency`. Types and ranges are checked (`400 Invalid link fields`). `PATCH` on an API-managed link only changes `status`, `name` and `description` (the rest is owned by the sync). `DELETE` is soft (`{ ok: true }`).

### `GET /operator/pricing-rules`, `POST /operator/pricing-rules`, `PATCH /operator/pricing-rules/:id`, `DELETE /operator/pricing-rules/:id`
`pricing:manage`. Body: `{ name, type, networkLinkId? (own link or null for all), conditions?, adjustment: { mode: "PERCENT" | "FIXED" | "OVERRIDE", value }, priority?, validFrom?, validUntil?, isActive? }`. `type`: `BASE_OVERRIDE | VOLUME_DISCOUNT | TERM_DISCOUNT | CAPACITY_TIER | SURCHARGE | PROMOTION`. `conditions` keys: `minCapacityMbps`, `minTermMonths`, `maxTermMonths`, `minRequestedMbps`. Rules apply in ascending `priority`. A negative adjustment shows up as a promo in the explorer; `type=PROMOTION` is flagged as a promotion.

## Geo (KMZ/KML)

All `geo:upload` except the last route.

- `POST /geo/upload`: approved operators only. Multipart form, field `file` (KMZ, KML or GeoJSON, max 20 MB) and optional `name`. `201 { id, name, featureCount, totalLengthKm, parseStatus }`; `400 Could not parse file: ...` (DOCTYPE/entity KML is rejected).
- `GET /geo`: the operator's uploads with `features: [{ id, name }]`.
- `POST /geo/:id/attach`: body `{ linkId, featureId? }`; attaches an upload (and optionally one feature) to an own link. Needs an approved operator. `{ ok: true }`.
- `GET /geo/link/:linkId`: authenticated. GeoJSON `FeatureCollection` of the link's route (empty collection when none). Visible for ACTIVE links of approved operators; owner and admin also see drafts; `404` otherwise.

## Integrations and webhooks

### `/operator/api-configs` (`apiconfig:manage`)
- `GET /operator/api-configs`: list (secrets are never returned: `hasCredentials`, `hasWebhookSecret`, `linkCount`).
- `POST /operator/api-configs`: approved operators only. Body: `name`, `baseUrl`, `authType` (`NONE | API_KEY | BEARER | BASIC | OAUTH2_CLIENT_CREDENTIALS | HMAC`), `credentials`, `staticHeaders`, `endpoints` (`listLinks.path` required and starting with `/`; `lock`, `confirm`, `release`), `fieldMapping` (`fields.externalId`, `originName`, `destinationName` required; optional `valueMaps`, `unit`, `telemetry`), `syncMode` (`POLLING | WEBHOOK | HYBRID`), `pollingIntervalSec` (min 30), `timeoutMs` (1000-30000), `webhookSecret`, `adapterKey` (only `generic-rest` exists), `isActive`. The base URL must not resolve to a private address unless `ALLOW_PRIVATE_OPERATOR_URLS=true`.
- `PATCH /operator/api-configs/:id`, `DELETE /operator/api-configs/:id` (pauses: `isActive=false`, status `PAUSED`).
- `POST /operator/api-configs/:id/test`: dry run `{ httpStatus, totalItems, sample }`.
- `POST /operator/api-configs/:id/sync`: runs a sync now, `{ skipped, seen, created, updated, failed, durationMs }`.
- `GET /operator/api-configs/:id/runs`: last 20 sync runs.

Telemetry mapping lives in `fieldMapping.telemetry` (`lossPct`, `status` with `statusMap`, `plannedMaintenance`, optional utilisation); without it a link has no telemetry and is never rated. The scheduler ticks every 10 s and polls due configs (20 per tick).

### `POST /webhooks/operators/:configId`
No JWT. Headers `x-signature` (hex HMAC-SHA256 of the raw body with the config's webhook secret) and optional `x-event-id` (deduplication). `202` ingest stats, or `{ "duplicate": true }`. `404` for an inactive config, a config not in `WEBHOOK`/`HYBRID` mode or one without a secret; `401 Invalid signature`.

## Cart, reservations and payments

- `GET /cart`, `POST /cart/items`, `DELETE /cart/items/:id`, `POST /cart/checkout`: `reservation:create`.
  - `POST /cart/items` body `{ linkId, termMonths? (1-120, default 12), requestedMbps? }`. `409` link not available; `400` no price or mixed currency; `404` unknown link. Records CART_ADD.
  - `POST /cart/checkout`: re-prices, locks each link at the operator (TTL `reservation.lock_ttl_seconds`), creates a payment with the active provider, returns the reservation with `status: "AWAITING_PAYMENT"` and `payments[0].checkoutUrl`. `409` on any failure (link gone, operator refused, provider unavailable). Records RESERVE.
- `GET /reservations`: buyer own, operator reservations that contain own links, admin all (latest 100, not carts). `GET /reservations/:id`: owner, an involved operator or admin, else `404`. Operators currently see the whole reservation, including other operators' items (S-16).
- `POST /reservations/:id/cancel`: `reservation:create`; only `AWAITING_PAYMENT` reservations of the caller; releases locks.
- `POST /payments/mock/:id/complete`: role `PENYEWA`, body `{ "outcome": "success" | "failure" }`; only for the caller's `mock` payments and refused in production unless `ALLOW_MOCK_PAYMENTS=true` (`403`). A replay on a final payment returns the raw payment row instead of the reservation and changes nothing.
- `POST /webhooks/payments/:provider`: no JWT, `200 { ok: true }` or `{ duplicate: true }`; providers `mock` (always `401`) and `midtrans` (SHA-512 `signature_key` check); `404` unknown provider.

Reservation statuses: `CART, LOCKED, AWAITING_PAYMENT, PAID, CONFIRMED, EXPIRED, CANCELLED, FAILED`. Unpaid reservations expire after the lock TTL.

## AI (buyer route analysis)

`ai:analyze` (buyers and admin).

- `POST /ai/analyze`: body `{ prompt (5-1000 chars), locale?: "ID" | "EN" }`. Parses origin, destination, capacity and latency from the text, ranks options from live data and adds a narrative. `{ id, engine, model, fallbackReason?, intent, options: [{ rank, linkIds, ... }], summary, recommendedRank, redundancyRank, costBenefit, redundancyAdvice, latencyPrediction, risks }`. `engine` is `rule-based` or an LLM label. `429` after `ai.hourly_limit` analyses per hour; `400` for a short or long prompt.
- `GET /ai/history`: last 20 analyses of the caller.

## Admin

Role `ADMIN` for the whole controller.

- `GET /admin/overview`: `{ users, operators, pendingOperators, links, reservations, paidPayments, grossVolume, ledgerEntries, syncFailures24h }`.
- `GET /admin/operators?status=`: operator profiles with `user { email, fullName }` and counts. `POST /admin/operators/:id/approve`; `POST /admin/operators/:id/reject` body `{ reason }` (required). Ledger `OPERATOR_APPROVAL`.
- `GET /admin/users` (latest 200). `PATCH /admin/users/:id/status` body `{ status: "ACTIVE" | "SUSPENDED" }` (not your own account). Suspension blocks the next login but not tokens already issued.
- `GET /admin/ledger?eventType=&page=&pageSize=` (max 100): `{ total, items }`, newest first, secrets redacted. `GET /admin/ledger/verify`: `{ valid, checked, brokenAtSequence }` (checks the first 5000 rows).
- `GET /admin/sync-runs`: last 50 runs with the integration and operator names.
- `GET /admin/settings`: all non-secret settings. `PUT /admin/settings/:key` body `{ value }`: updates an existing key (`404` for unknown or secret keys); no shape validation. See [settings.md](settings.md).
- `GET /admin/interactions`, `POST /admin/quality/recompute`: see above.

## Mock operator (demo only)

Mounted only when `NODE_ENV` is not `production` or `ENABLE_MOCK_OPERATOR=true`; in production they are `404`.

- `GET /mock-operator/nusalink/v1/links`, `POST .../links/:id/lock`, `POST .../locks/:lockId/confirm|release` (bearer token from the fixtures) and `GET /mock-operator/garuda/api/inventory`, `POST .../inventory/:id/hold`, `POST .../holds/:holdId/commit|release` (API key header `X-Garuda-Key`): two simulated operators with different payload shapes, used by the seeded integrations. Locks are held in process memory and vanish on restart.
- `POST /mock-operator/incidents`, `GET /mock-operator/incidents`, `DELETE /mock-operator/incidents/:id`: permission `demo:manage` (ADMIN) and setting `demo.incidentInjection=true`, else `404`. Body of `POST`: `{ operator: "nusalink" | "garuda", linkId (the operator's external id, e.g. "NL-JKT-SBY-N"), kind: "DEGRADATION" | "OUTAGE" | "MAINTENANCE", durationMin? (1-240, default 10), lossPct? (default 3), latencyFactor? (1-10, default 2) }` -> `{ id, expiresAt }`. The next syncs report the fault and the detector opens a SYSTEM ticket.
