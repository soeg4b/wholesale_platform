# Monitoring and alerting

The API has no `/metrics` endpoint and no structured logs. Everything below is built from what exists today:
`GET /api/health`, three admin endpoints (ADMIN JWT, 8h lifetime, so a probe must log in each run), read-only SQL on the
tables, and stdout/stderr log lines. Run SQL checks with a **read-only** Postgres role (for example through
`postgres_exporter` custom queries or a cron + `psql` script), never with the application role.

## Probes

| Probe | Source | Healthy | Frequency |
| --- | --- | --- | --- |
| Liveness + DB | `GET /api/health` (no auth) returns `{status:'ok',db:true}`; `503 {status:'degraded',db:false}` when `SELECT 1` fails | HTTP 200 | 15 s (Docker healthcheck already does this) |
| Web | `GET /` on the web container | status < 500 | 15 s |
| Security posture (prod) | `GET /api/mock-operator/incidents` must be 404; `curl -I` shows `Strict-Transport-Security` | as stated | after each deploy |

## Metrics and alerts

Severity: P1 page now, P2 within the working day, P3 ticket.

| Signal | How to measure (existing endpoint / table) | Alert | Sev |
| --- | --- | --- | --- |
| Sync failures | `GET /api/admin/sync-runs` (last 50) or `api_sync_runs`: `SELECT count(*) FROM api_sync_runs WHERE status='FAILED' AND "startedAt" > now() - interval '15 minutes'`. Per operator: `dynamic_api_configs."consecutiveFailures"`, `status='ERROR'`, `"lastError"` | any config with `consecutiveFailures >= 3` or `status='ERROR'` for 15 min (P2); every active config failing (P1) | P1/P2 |
| Poll lag | `SELECT id,name FROM dynamic_api_configs WHERE "isActive" AND "syncMode" IN ('POLLING','HYBRID') AND status<>'PAUSED' AND "nextSyncAt" < now() - 3 * ("pollingIntervalSec" * interval '1 second')`. The scheduler (`SyncService.tick`, every 10 s, 20 configs per tick) falls behind when this returns rows | rows for 10 min | P2 |
| Telemetry/perf lag | `SELECT max("computedAt") FROM link_performance` and `SELECT max("recordedAt") FROM link_metric_snapshots` (non-demo). Recompute runs every 5 min (`QualityService.scheduled`) | newest row older than 3 x `perf.recomputeMinutes` / `telemetry.pollMinutes` | P2 |
| Ticket SLA breaches | `SELECT count(*) FILTER (WHERE "ackBreachedAt" IS NOT NULL OR "resolveBreachedAt" IS NOT NULL) FROM link_tickets WHERE "createdAt" > now() - interval '24 hours' AND NOT "isDemo"`; admin KPIs via the tickets API. Breach marking is done by the 60 s sweeper | breach rate > 20 % of tickets in 24 h (P2); a SYSTEM OUTAGE ticket open > its resolve SLA (P1) | P1/P2 |
| Ticket sweeper stalled | Overdue and unmarked: `SELECT count(*) FROM link_tickets WHERE status='OPEN' AND "ackAt" IS NULL AND "ackBreachedAt" IS NULL AND "ackDueAt" < now() - interval '3 minutes'`. Log line `ticket sweep failed:` | count > 0 for 5 min, or the log line appears | P2 |
| Ledger integrity | `GET /api/admin/ledger/verify` returns `{valid, checked, brokenAtSequence}` (checks only the first 5000 rows, S-20) | `valid=false` (P1, treat as tampering until proven otherwise); also alert when `checked` stops growing for a day while `SELECT max(sequence) FROM transaction_logs` grows | P1 |
| Ledger write failures | stderr line `[ledger] append failed` (`appendSafe` swallows the error, business flow continues without an audit row). Cross-check: `SELECT count(*) FROM payments WHERE status='PAID' AND NOT EXISTS (SELECT 1 FROM transaction_logs t WHERE t."paymentId"=payments.id)` | any occurrence | P1 |
| Lock expiry sweeper | Overdue: `SELECT count(*) FROM reservations WHERE status='AWAITING_PAYMENT' AND "expiresAt" < now() - interval '2 minutes'` (sweeper runs every 15 s, 50 per tick). Stuck item locks: `SELECT count(*) FROM reservation_items WHERE "lockStatus"='ACQUIRED' AND "lockExpiresAt" < now() - interval '5 minutes'`. Failed releases: `lockStatus='FAILED'` | count > 0 for 5 min | P2 |
| Payment webhook failures | `SELECT status, "signatureOk", count(*) FROM webhook_events WHERE source='PAYMENT_GATEWAY' AND "receivedAt" > now() - interval '1 hour' GROUP BY 1,2`. Bad signatures: `signatureOk=false`; processing errors: `status='FAILED'` (`error` column). Same query with `source='OPERATOR_API'` covers operator webhooks | any `FAILED` (P2); > 5 bad signatures/hour (P2, possible probing or wrong secret); no PAID payment webhooks while `payments` has PENDING rows older than 30 min (P1) | P1/P2 |
| Payment state | `SELECT count(*) FROM payments WHERE status='PENDING' AND "createdAt" < now() - interval '1 hour'` | rising trend | P3 |
| Auth abuse / rate limiting | HTTP 429 and 401 counts at the reverse proxy (the API logs neither, S-23) | 429 > 1 % of requests (P2); sudden 401 spike | P2 |
| DB | `pg_isready`, connections, disk of the `pgdata` volume, replication/backup age | disk > 80 %, last successful `pg_dump` > 26 h | P1/P2 |
| API process | container restarts, memory, event-loop lag (needs an APM/OTel agent, not present) | restart loop (> 3 in 10 min) | P1 |

## Logging requirements

- Collect container stdout/stderr (JSON driver with rotation, then ship). Grep-able lines to alert on today:
  `[ledger] append failed`, `ticket sweep failed`, `performance recompute failed`, `[security] TRUST_PROXY_HOPS unset`.
- Log request ID, user ID, status and latency at the proxy until the API logs them itself (S-23).
- Never log request bodies on `/api/auth/*` or `/api/webhooks/*` (credentials, signatures).

## Suggested SLOs (starting points, tune after 30 days of data)

- API availability (health 200): 99.5 % monthly. Marketplace search p95 < 800 ms.
- Operator sync freshness: 95 % of active configs synced within 2 x their polling interval.
- Locks released within 2 minutes of `expiresAt`: 99.9 %.
- Ledger verification valid: 100 % (zero tolerance).

## Escalation

P1: page on-call, open an incident, freeze deploys, start from the runbook in `.artifacts/10-devops-pipeline.md`.
P2: owner acknowledges the same day. P3: backlog. A ledger `valid=false` additionally goes to Security.
