# 05 - Data Schema (Iteration 2)

Stage 5. Inputs: `03-sa-system-design.md` (section 8), `02-pm-roadmap.md`, `04-uiux-design.md`, current `schema.prisma`. Additive only; applied to `apps/api/prisma/schema.prisma` (the project's real schema path; `src/database/` from the agent template is not used). `prisma format` and `validate` pass; `generate` blocked (see Handoff). Convention kept: tables snake_case via `@@map`, columns camelCase (no `@map`), so raw SQL must quote columns (`"networkLinkId"`).

## 1. Entities
| Table (model) | Purpose / key columns |
| --- | --- |
| `link_interactions` (`LinkInteraction`) | Raw demand events. `userId`, `networkLinkId?`, `routeKey?` (sorted `nodeKey\|nodeKey`), `type`, `minMbps?`, `unmet`, `counted`, `countedKey? UNIQUE`, `isDemo`, `createdAt` |
| `link_tickets` (`LinkTicket`) | `ticketNo` (autoincrement, unique), `reference` (unique), link/operator/reporter?/reservation?, `source`, `kind`, `severity`, `status`, `title`, `description`, `ackDueAt`, `resolveDueAt`, `ackAt/resolvedAt/closedAt`, `ackBreachedAt/resolveBreachedAt`, `incidentStartAt/EndAt`, `flapCount`, `publicReply Json?`, `isDemo` |
| `link_ticket_updates` (`LinkTicketUpdate`) | Append-only timeline: `ticketId`, `actorUserId?`, `type`, `fromStatus?`, `toStatus?`, `message?`, `isInternal`, `isPublicReply` |
| `link_performance` (`LinkPerformance`) | One row per link (PK = `networkLinkId`): `score?`, `rated`, `reason?`, `components`, `basis`, `kpis`, `firstRatedAt?`, `computedAt` |
| `add_on_services` (`AddOnService`) | Seller catalog: `kind`, bilingual `name/description`, display-only `price/priceUnit/currency`, `applicableCategories[]`, `isActive`, `deletedAt` |
| `seller_insight_reports` (`SellerInsightReport`) | `operatorProfileId`, `windowStart/End`, `engine`, `facts`, `narrative?`, `includesDemo` |
| existing, extended | `LinkMetricSnapshot` + `lossPct?`, `opStatus? (UP/DOWN/DEGRADED)`, `plannedMaintenance`, `isDemo`; `Reservation` + `isDemo`. All new columns nullable or defaulted, so `db:push` is non-destructive |

**Enums added**: `InteractionType` (SEARCH, VIEW, CART_ADD, RESERVE), `LinkOpStatus`, `TicketSource` (BUYER, OPERATOR, SYSTEM), `TicketKind` (DEGRADATION, OUTAGE, OTHER), `TicketSeverity` (SEV1-3), `TicketStatus` (OPEN, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, CLOSED), `TicketUpdateType` (CREATED, STATUS_CHANGE, COMMENT, PUBLIC_REPLY, ESCALATED, SLA_BREACH), `AddOnKind` (7 values). `LedgerEventType` += `TICKET`, `ADDON_CHANGE`, `INSIGHT`.

## 2. Relations and cascade
- Back-fields: `User` -> interactions, reportedTickets, ticketUpdates; `OperatorProfile` -> tickets, addOns, insightReports; `NetworkLink` -> interactions, tickets, `performance?`; `Reservation` -> tickets.
- `LinkInteraction`: user Restrict, link Cascade. `LinkTicket`: link/operator/reporter Restrict (history survives soft-deleted links), reservation SetNull. `LinkTicketUpdate`: Restrict both. `LinkPerformance`, `AddOnService`, `SellerInsightReport`: Cascade from link/operator.
- Cardinality: link 1-N tickets, ticket 1-N updates, link 1-1 performance, operator 1-N add-ons/reports. Ticket.reporter null iff source SYSTEM (CHECK).

## 3. Indexes
- Prisma: interactions `(networkLinkId,type,createdAt)`, `(routeKey,createdAt)`, `(userId,createdAt)`, `(createdAt)`; tickets `(networkLinkId,status)`, `(networkLinkId,createdAt)`, `(networkLinkId,kind,incidentStartAt)`, `(operatorProfileId,status,createdAt)`, `(reporterUserId,createdAt)`, `(status,ackDueAt)`, `(status,resolveDueAt)`; updates `(ticketId,createdAt)`; snapshots + `(recordedAt)` for purge; performance `(computedAt)`; add-ons `(operatorProfileId,isActive)`, `(kind)`; reports `(operatorProfileId,createdAt)`.
- Raw SQL (`sql/001`): partial unique `link_tickets_one_open_system_per_link` (`"networkLinkId"` WHERE source='SYSTEM' AND status IN (OPEN, ACKNOWLEDGED, IN_PROGRESS)); partial unique `link_ticket_updates_one_public_reply` (`"ticketId"` WHERE `"isPublicReply"`); partial `counted` indexes for hot aggregation and for unmet demand.

## 4. Constraints (exact SQL in `sql/001_constraints_indexes.sql`)
- **Dedupe**: Prisma `countedKey String? @unique` (NULLs never collide in PostgreSQL). Coder builds `countedKey = userId|(linkId ?? routeKey)|type|YYYY-MM-DD(platform.timezone)` only when the actor is not seller/admin; on P2002 insert the same row with `countedKey=NULL, counted=false`. CHECK `link_interactions_counted_chk`: `counted = (countedKey IS NOT NULL)`; CHECK `link_interactions_target_chk`: link or routeKey present.
- Tickets: `link_tickets_reporter_chk` (SYSTEM <=> reporter null), `link_tickets_due_chk` (ackDueAt <= resolveDueAt). Snapshots: `lossPct` in 0..100. Performance: score 0..100.
- **Ticket reference**: `reference` is stored and unique. Race-free build: in the ticket transaction run `SELECT nextval(pg_get_serial_sequence('link_tickets','ticketNo'))::int AS n` , then insert with explicit `ticketNo=n` and `reference='TKT-'||year||'-'||lpad(n,6,'0')`.
- State machine and concurrency stay in the app: `updateMany({where:{id,status:from}})`, count 0 => 409.

## 5. Statistics queries (`sql/002_link_stats.sql`, SQL functions, STABLE)
- `link_latency_stats(link_ids text[], from, to, include_demo bool)` -> per link: `samples`, `latency_samples`, `mean_ms`, `p50_ms`, `p95_ms` (exact `percentile_cont`), `stddev_ms` (`stddev_samp`), `p95_util_pct`, `first_at`, `last_at`, `coverage_days`, `includes_demo`. Planned-maintenance samples are excluded; `samples` counts rows with latency or status (SA 5.5 evidence rule).
- `link_outage_minutes(link_ids, from, to, include_demo)` -> `outage_count`, `outage_minutes` from SYSTEM OUTAGE tickets clipped to the window (open incident runs to `now()`).
- Call: `prisma.$queryRaw\`SELECT * FROM link_latency_stats(${ids}::text[], ${from}, ${to}, ${includeDemo})\``. Availability `A = 100*(1 - outage_minutes/(windowMin - plannedMin))` is computed in the app.
- Index support: `(networkLinkId,recordedAt)` covers the window scan; one grouped call per 50-link batch.

## 6. Immutable ledger (`sql/003_immutability.sql`)
- Section 1 re-asserts the existing `transaction_logs` triggers byte-for-byte (new event types need no trigger change; `seed.ts` keeps calling `applyLedgerTriggers`).
- Section 2: `link_ticket_updates` rejects UPDATE and TRUNCATE; DELETE allowed only for rows of `isDemo` tickets so the seed can stay idempotent (delete order: updates, then tickets). Real ticket history is immutable.
- Ledger rows for tickets use `entityType='LinkTicket'`, `entityId=ticket.id`, no FK to the ticket (ledger stays immutable if demo tickets are purged).

## 7. Retention, partitioning, backup
- `link_interactions`: purge `createdAt < now() - retention.interactionDays` (90d) daily in batches of 10k (`DELETE ... WHERE id IN (SELECT id ... LIMIT 10000)`); aggregates only need 14d. `link_metric_snapshots`: purge by `retention.snapshotDays` (90d), same batching; keep `link_performance` as the long-term summary.
- Volume: 96 snapshots/link/day at 15 min; 1,000 links x 90d ~ 8.6M rows, fine unpartitioned. Revisit monthly range partitioning by `recordedAt` when > ~50M rows (needs a raw migration, Prisma cannot declare it; PK would become `(id,recordedAt)`).
- Never purge: tickets, ticket updates, ledger, reports (keep 180d or last 30 per operator). Demo rows: removed only via `WHERE "isDemo"`.
- Backup: standard `pg_dump` covers functions/triggers; after restore into a fresh DB run `db:push` then `sql/001..003`.

## 8. Seed guidance (Coder owns `seed.ts`)
- New permissions and `platform_settings` keys per SA sections 6-7 (`update:{}` so admin edits survive).
- Demo rows: every fabricated row `isDemo=true` with `// DEMO SEED`. Snapshots: >= 7 days at 15 min (>= 672 samples) for some links incl. one with a past OUTAGE and one DEGRADATION, none for others (exercises not-rated). Interactions spread over 14 days with a rising route (hot) and an unmet route; closed demo tickets with updates; 2-3 add-ons per demo operator; one demo insight report.
- Idempotency: delete `isDemo` rows (interactions, snapshots, ticket updates, tickets, reports) then recreate; never touch real rows.

## 9. Scalability and monitoring
- Hot spots: interaction insert rate (single insert, fire-and-forget), snapshot growth, `percentile_cont` per batch. Signals: table sizes, purge duration, p95 of `link_latency_stats`, count of `P2002` on `countedKey` (abuse signal).

## 10. Deviations from SA design
1. `LinkPerformance` gained `reason` (stores MIN_SAMPLES / MIN_COVERAGE / NO_TELEMETRY so not-rated state needs no recompute).
2. `LinkTicket.ticketNo` added next to `reference` (sequence source; see section 4).
3. `LinkTicketUpdate.type` is an enum (`TicketUpdateType`) instead of free text; added `updatedAt` on tickets.
4. Extra indexes and CHECKs beyond SA section 8; stats delivered as SQL functions instead of inline queries.
5. Recommendation: on escalation DEGRADATION -> OUTAGE set `incidentStartAt` to the start of the outage streak, otherwise `link_outage_minutes` counts the degradation period as outage.

## Handoff
- **Inputs consumed**: `.artifacts/03-sa-system-design.md`, `02-pm-roadmap.md`, `04-uiux-design.md`, `apps/api/prisma/schema.prisma`, `apply-triggers.ts`.
- **Outputs produced**: `.artifacts/05-data-schema.md`, updated `apps/api/prisma/schema.prisma`, `apps/api/prisma/sql/001_constraints_indexes.sql`, `002_link_stats.sql`, `003_immutability.sql`.
- **Apply order** (Coder): `npm run db:push` (apps/api), then each SQL file in order with `& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -h localhost -p 5433 -U wnmp -d wnmp -v ON_ERROR_STOP=1 -f prisma/sql/00N_*.sql`; re-run after every `db:push`. Suggest adding an `apply-sql.ts`/`db:sql` script and calling it from the seed.
- **Open questions**: (1) `prisma generate` failed with EPERM on `query_engine-windows.dll.node` (API process holds the lock); stop the API, rerun `npm run prisma:generate`. (2) SQL files not yet executed against a DB (tables absent until `db:push`). (3) Raw functions use camelCase quoted columns; if the Coder later adds `@map`, update them.
- **Go/No-Go**: **GO** for Coder after `prisma:generate` succeeds and SQL files are applied.
