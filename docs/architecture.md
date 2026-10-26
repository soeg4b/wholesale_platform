# Architecture

Modular monolith: one NestJS API (`apps/api`), one Next.js web app (`apps/web`), one PostgreSQL database. External parties (operator APIs, payment gateway, LLM) are reached only through adapters/providers. Everything described here was read from the source; see [api-reference.md](api-reference.md) for endpoints and [settings.md](settings.md) for thresholds.

## System overview

```mermaid
flowchart LR
  subgraph Browser
    WEB[Next.js 14 app<br/>Tailwind + Leaflet<br/>ID/EN dictionary]
  end
  subgraph API[NestJS API :4000 /api]
    AUTH[auth + AuthGuard<br/>JWT, roles, perms]
    EXP[explorer]
    INT[interactions]
    LNK[links + pricing]
    QUA[quality<br/>telemetry, detector, score]
    TIK[tickets]
    INS[insights]
    ADD[addons]
    RES[reservations<br/>cart, locks, payments]
    AIM[ai]
    GEO[geo KMZ/KML]
    IGR[integrations<br/>adapter + sync + webhooks]
    ADM[admin]
    MOCK[mock-operator<br/>demo only]
    COM[common: settings, ledger,<br/>crypto, prisma]
  end
  DB[(PostgreSQL 16)]
  OP1[Operator REST APIs]
  PAY[Payment gateway<br/>mock / Midtrans]
  LLM[LLM optional<br/>Anthropic / OpenAI]

  WEB -- HTTPS JSON + Bearer --> AUTH
  AUTH --> EXP & LNK & TIK & INS & ADD & RES & AIM & GEO & IGR & ADM
  EXP --> INT
  EXP --> QUA
  LNK --> QUA
  IGR -- sync ingest --> QUA
  QUA --> TIK
  INS --> INT & QUA & AIM
  RES --> INT
  COM --- DB
  IGR <--> OP1
  IGR -. demo .-> MOCK
  RES <--> PAY
  AIM -.-> LLM
```

## Modules

| Module (`apps/api/src/...`) | Responsibility |
| --- | --- |
| `common` | `SettingsService` (typed reads of `platform_settings` with defaults, 15 s cache), `LedgerService` (hash-chained append-only log), `CryptoService` (AES-256-GCM for credentials), `PrismaService`, `AuthGuard` + `@Roles`/`@Perms`, `nodes.ts` (city key normalisation), `OperatorContext`. |
| `auth` | Register, login (with throttle), `/auth/me`. JWT HS256, 8 h. |
| `admin` | Overview, operator approval, users, ledger view + verification, sync runs, settings editing. |
| `integrations` | Per-operator API configs (credentials encrypted), `GenericRestAdapter` (SSRF guard, field mapping, value maps, telemetry mapping), `SyncService` (scheduler ticking every 10 s, manual sync, ingest), operator webhooks. |
| `geo` | KMZ/KML/GeoJSON upload, parse to GeoJSON (hardened against DTD and zip bombs), attach to links. |
| `links` | Marketplace search, facets, detail, quote, public stats; operator link CRUD; `PricingService` (rule engine); pricing rule CRUD. |
| `interactions` | Demand events (`link_interactions`), dedupe, throttle, hot calculation, unmet-demand lookup, retention purge. |
| `explorer` | City graph, route search (iterative deepening, bounded), promo and capability chips, hot ranking. |
| `quality` | `TelemetryService` (writes samples during sync), `IncidentDetector` (opens/escalates/reopens/auto-resolves system tickets), `PerformanceService` (score + KPIs, scheduler every 5 min), admin recompute. |
| `tickets` | State machine, SLA stamping, role/tenant scope, ledger events, KPIs, SLA/auto-close sweeper (every 60 s). |
| `insights` | Seller report builder (demand, congestion, add-ons, improvements), optional LLM narrative, history, per-link performance table. |
| `addons` | Operator add-on catalog and public read. |
| `reservations` | Cart, checkout with operator locks, payment providers (`mock`, `midtrans`), payment webhooks, expiry sweeper (every 15 s), server-side CART_ADD/RESERVE tracking. |
| `ai` | Buyer route analysis (intent parsing, deterministic ranking, optional LLM narrative) and the shared `completeJson` used by insights. |
| `mock-operator` | Two simulated operator APIs (NusaLink bearer, Garuda API key) and the incident injector. Mounted only outside production (or `ENABLE_MOCK_OPERATOR=true`). |
| `health.controller.ts` | `GET /api/health` with a DB probe. |

Web (`apps/web`): pages under `app/` (`/`, `/login`, `/register`, `/explore`, `/marketplace`, `/links/[id]`, `/ai`, `/cart`, `/reservations`, `/reservations/[id]`, `/pay/mock/[paymentId]`, `/tickets`, `/tickets/[id]`, `/operator`, `/admin`), shared components in `components/`, API client, auth context and i18n in `lib/`. All UI text comes from `lib/dictionary.ts` (ID and EN keys) or from `{id,en}` JSON in the database.

## Data flow: map explorer

```mermaid
sequenceDiagram
  participant U as Buyer (browser)
  participant W as /explore
  participant A as API explorer
  participant I as interactions
  participant P as quality (performance)
  participant D as PostgreSQL
  U->>W: open /explore
  W->>A: GET /explorer/graph
  A->>D: active links + pricing rules + grouped demand
  A-->>W: nodes, edges, hotRanking, promos
  U->>W: pick A-End then Z-End (map or selects)
  W->>A: GET /explorer/routes?from=&to=
  A->>P: batch scores for candidate links
  A->>D: add-on catalog, demand stats
  A-->>W: routes (direct + up to maxHops), chips, hot, unmet
  A--)I: record SEARCH (unmet flag when no route)
  I--)D: link_interactions (counted once per user, target, type, day)
```

Nodes are not a table: a node is the normalised city name (`trim`, lower case, collapsed spaces) of an endpoint of an active link of an approved operator. Edges aggregate all links of an undirected city pair. A route is a simple path of at most `explorer.maxHops` hops; per leg the cheapest `explorer.maxParallelPerEdge` links are candidates.

## Data flow: telemetry, tickets, performance

```mermaid
flowchart TD
  S[SyncService: poll or webhook] --> N[normalise link + telemetry]
  N --> U[upsert link]
  U --> T{telemetry present<br/>and sample due?}
  T -- yes --> M[(link_metric_snapshots)]
  M --> E[IncidentDetector.evaluate]
  E -- streak of bad samples --> ST[system ticket<br/>OUTAGE or DEGRADATION]
  E -- good samples --> AR[auto-resolve]
  ST --> L[(ledger TICKET)]
  AR --> L
  BT[buyer / operator ticket] --> L
  M --> P[PerformanceService<br/>link_latency_stats, link_outage_minutes]
  ST --> P
  BT --> P
  P --> LP[(link_performance)]
  LP --> UI[link detail, marketplace chip,<br/>explorer chips, operator tab]
  SW[sweeper every 60 s] --> SLA[SLA breach flags,<br/>auto-close after autoCloseHours]
```

Ticket lifecycle:

```mermaid
stateDiagram-v2
  [*] --> OPEN
  OPEN --> ACKNOWLEDGED: operator/admin
  OPEN --> RESOLVED: operator/admin or system (recovery)
  ACKNOWLEDGED --> IN_PROGRESS: operator/admin
  ACKNOWLEDGED --> RESOLVED
  IN_PROGRESS --> RESOLVED
  RESOLVED --> CLOSED: reporter, admin or sweeper after 72 h
  RESOLVED --> OPEN: reopen (reporter, operator, admin) or flap
  CLOSED --> [*]
```

The transition matrix is the setting `ticket.transitions`; who may do which move is fixed in `TicketsService.transition`. A partial unique index allows only one open `SYSTEM` ticket per link; a second partial unique index allows one public operator reply per ticket (both in `prisma/sql/001_constraints_indexes.sql`).

## Data flow: seller AI insights

```mermaid
flowchart LR
  I[(link_interactions)] --> F
  M[(metric snapshots)] --> F
  R[(reservations: PAID/CONFIRMED)] --> F
  LPf[(link_performance)] --> F
  C[(add_on_services)] --> F
  F[InsightsService.build<br/>deterministic facts + bilingual texts] --> NARR{LLM key set?}
  NARR -- no --> RB[rule-based narrative]
  NARR -- yes --> LL[LLM writes narrative only]
  LL -- invalid JSON or error --> RB
  RB --> SAVE[(seller_insight_reports)]
  LL --> SAVE
  SAVE --> LED[(ledger INSIGHT)]
```

Facts never come from the LLM. Every item carries `evidence`; sections with too little data return `{insufficient, needed, have}`. Sellers only see their own links; add-on advice exposes a renter count, not identities.

## Data flow: reservation and payment

```mermaid
sequenceDiagram
  participant B as Buyer
  participant R as reservations
  participant O as Operator API (adapter)
  participant G as Payment provider
  B->>R: POST /cart/items
  B->>R: POST /cart/checkout
  R->>O: lock each link (TTL reservation.lock_ttl_seconds)
  R->>G: create charge
  R-->>B: AWAITING_PAYMENT + checkoutUrl
  alt paid (webhook or mock completion)
    G->>R: webhook / mock complete
    R->>O: confirm locks
    R-->>B: CONFIRMED (links RESERVED)
  else failed, cancelled or expired (sweeper 15 s)
    R->>O: release locks
  end
```

Every step appends to the ledger (`LINK_LOCK`, `RESERVATION`, `PAYMENT`).

## Data model overview

```mermaid
erDiagram
  User ||--o| OperatorProfile : "is"
  User ||--o| BuyerProfile : "is"
  OperatorProfile ||--o{ NetworkLink : owns
  OperatorProfile ||--o{ DynamicApiConfig : configures
  OperatorProfile ||--o{ PricingRule : defines
  OperatorProfile ||--o{ AddOnService : offers
  OperatorProfile ||--o{ SellerInsightReport : receives
  DynamicApiConfig ||--o{ NetworkLink : syncs
  GeospatialData ||--o{ NetworkLink : "route of"
  NetworkLink ||--o{ LinkMetricSnapshot : "telemetry"
  NetworkLink ||--o| LinkPerformance : "score cache"
  NetworkLink ||--o{ LinkTicket : "tickets"
  NetworkLink ||--o{ LinkInteraction : "demand"
  LinkTicket ||--o{ LinkTicketUpdate : timeline
  User ||--o{ Reservation : places
  Reservation ||--o{ ReservationItem : contains
  NetworkLink ||--o{ ReservationItem : "reserved in"
  Reservation ||--o{ Payment : "paid by"
  User ||--o{ LinkInteraction : generates
  TransactionLog }o--o| NetworkLink : "audits"
```

Tables are snake_case via `@@map` (for example `network_links`, `link_tickets`, `transaction_logs`). Money is `Decimal(18,2)`. Bilingual text is `Json` `{id,en}`. Business entities are soft-deleted (`deletedAt`); `transaction_logs` and `link_ticket_updates` are append-only through triggers (`sql/003_immutability.sql`; the ticket update trigger permits deleting rows of demo tickets). Seeded fabricated rows carry `isDemo=true`.

Database objects Prisma cannot express live in `apps/api/prisma/sql/`:

| File | Content |
| --- | --- |
| `001_constraints_indexes.sql` | one open SYSTEM ticket per link, one public reply per ticket, interaction partial indexes, CHECK constraints (loss 0-100, score range, due dates, interaction target) |
| `002_link_stats.sql` | functions `link_latency_stats(...)` and `link_outage_minutes(...)` used by the performance score |
| `003_immutability.sql` | append-only triggers for `transaction_logs` and `link_ticket_updates` |

`prisma db push` is the only schema mechanism (there are no migrations), and these files must be re-applied after every push (`npm run db:sql`).

## Cross-cutting rules

- **No hardcoded business data**: prices, availability and attributes come from the database or operator APIs; thresholds from `platform_settings`; UI strings from `dictionary.ts`.
- **Evidence and honesty**: ratings need minimum samples and coverage; rates need minimum tickets; every analytic payload has a `basis` (window, includesDemo); engines are labelled `rule-based` or `llm:<model>`.
- **Tenant isolation**: scoping is part of the Prisma `where` (not a post-filter); out-of-scope rows return 404.
- **Ledger**: security- and money-relevant events are appended to a hash chain. Ticket events use `ledger.append` inside the same transaction (a failed ledger write rolls the ticket change back); most other modules use `appendSafe`, which logs and swallows a ledger failure.
- **Security hardening** (`main.ts`): security headers, JSON body limit 100 kb, optional per-IP rate limiter (default on in production), production refuses to boot with placeholder secrets, SSRF guard on operator URLs, mock operator/payments/demo seed off in production.
- **Single-instance assumption**: login throttle, rate limiter, explorer/demand caches and all `@Interval` jobs run inside the API process.
