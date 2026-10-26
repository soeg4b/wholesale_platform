# 12 Support Playbook (Stage 12, final)

Inputs: artifacts 00-11, `docs/{runbook,user-guide.en}.md`, README, `infra/monitoring/README.md`; facts re-checked in `apps/api/src` (health, auth, reservations, tickets, quality, explorer, insights, sync, mock-operator, ledger), `settings-defaults.ts`, `dictionary.ts`. Nothing was executed; commands are copied from the runbook/package scripts. Response targets in section 1 are **proposals** (no support contract exists in the artifacts). Buyer-facing wording: `docs/support-faq.md`.

## 0. Application overview for support
- **Services**: web `:3000`, API `:4000/api`, PostgreSQL (`:5433` local demo, compose `postgres`). External: operator inventory APIs (sync/webhooks `/api/webhooks/operators/:configId`), payment gateway (`mock` default, `midtrans` webhook `/api/webhooks/payments/:provider`), optional LLM (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`).
- **Health**: `GET /api/health` -> `200 {status:'ok',db:true}`, `503 {status:'degraded',db:false}` = DB unreachable. No `/metrics`, no request logs (S-23): diagnose with admin endpoints (`/api/admin/{overview,sync-runs,ledger/verify}`), read-only SQL (see `infra/monitoring/README.md`) and API stdout.
- **Journeys to watch**: login; `/explore` routes; cart -> checkout -> pay -> CONFIRMED; operator sync; ticket create/ack/resolve; insights generate.
- **Background jobs (one API process)**: sync tick 10 s, lock-expiry sweeper 15 s, ticket SLA sweeper 60 s, quality recompute 5 min, interaction purge 6 h. All in memory/process: an API restart resets mock operator locks, login throttle, rate limiter, caches.

## 1. Severity matrix
| Sev | Definition (this app) | Examples | Ack / update / target |
| --- | --- | --- | --- |
| SEV1 | Platform unusable or money/integrity at risk | `/api/health` fails, DB down, ledger `valid=false`, paid payments not confirmed, data leak | 15 min / 30 min / mitigate 4 h (mirrors `ticket.sla` SEV1 15/240) |
| SEV2 | Core journey broken for many users or one tenant | all syncs failing, checkout 5xx, expiry sweeper stalled, `[ledger] append failed` | 1 h / 2 h / 8 h (mirrors SEV2 60/480) |
| SEV3 | Feature degraded, workaround exists | wrong/empty insights, "Not yet rated", one operator sync ERROR, English-only system text | 4 h / daily / 1 business day (SEV3 240/1440) |
| SEV4 | Question, cosmetic, enhancement | FAQ, i18n label, doc gap | next business day / n.a. / backlog |
Raise one level when: security/PII suspected, more than one tenant affected, no workaround after 2x the target. Lower when mitigated; keep the ticket open until QA verifies. Not to be confused with link-ticket SEV1-3 (`ticket.sla`, buyer/operator links): those are customer-facing SLAs handled by operators.

## 2. Tiers and escalation
| Tier | Who | Handles | Escalate when |
| --- | --- | --- | --- |
| L1 | Support (this agent) | FAQ, login/permission, "no routes", status checks, health probe, collect evidence | no fix from a runbook in 15 min, any SEV1/2, suspected security |
| L2 | DevOps (infra, DB, restart, backup/restore, CI), QA/Tester (reproduce, regression) | stack down, DB, sync infra, reproduce defect, data checks | code defect or data corruption |
| L3 | Coder (fix), System Analyst (design/threshold questions), Data (schema/SQL), Security (leaks, ledger, tokens), UI/UX (screens/copy) | root cause and patch | n/a (PM decides priority/scope) |
Component owners: API/sync/tickets/insights/explorer -> Coder; schema, `prisma/sql`, ledger triggers -> Data (+Security for tamper); containers, backups, CI, TLS -> DevOps; thresholds/product questions -> PM + System Analyst; docs -> Documentation; strings/labels -> UI/UX + Coder. Decision authority: L1 may restart/clear in-memory state and re-seed **demo only**; DevOps approves restore/rollback/deploy freeze; Security approves any ledger action; PM approves scope/priority. Operators own their own operator-API outages: contact the operator via Admin > Operators.

## 3. Triage checklist
1. Record who/role/tenant, time (WIB), URL, language, release/image tag, environment (demo vs production).
2. `GET /api/health`; web `GET /`. 503 -> RB-2. Connection refused -> API process down.
3. Reproduce with the same role; check the HTTP status and body `code` (section 7).
4. Scope: one user / one tenant / all. Compare with `buyer@demo.wnmp.test` (demo only).
5. Admin > Overview, Sync runs, Ledger > Verify; look for recent deploy, re-seed, setting edit (cache 15 s), restart.
6. Read API log for: `[ledger] append failed`, `ticket sweep failed`, `performance recompute failed`.
7. Classify severity (section 1), mitigate first, then open a bug (section 9) with evidence.

## 4. Runbooks
**RB-1 Login / permissions**
- 401 "Invalid credentials": wrong password, suspended, deleted or password-less account. `demo.buyer01..14@demo.wnmp.test` have no password hash and can never log in by design; use `buyer@demo.wnmp.test`. 401 "Too many attempts": throttle (8 per IP+email, 50 per IP, 30 per email, 15 min); wait, or restart API (clears it).
- 403 "Insufficient permission/role" after a re-seed, role or permission change: the JWT (8 h) embeds permissions and is never re-checked -> sign out and sign in. Pending operators can sign in but cannot publish until approved (Admin > Operators). A suspended user keeps a valid token up to 8 h (S-12) while new logins fail.
**RB-2 API down / DB down**
- Refused: Windows local, check/start `node dist/main.js` in `apps/api`; Compose: `docker compose ps`, `docker compose logs -f api`. Boot exit "JWT_ACCESS_SECRET must be a random value..." = production with placeholder secrets: set >= 32 char secrets (never switch off checks).
- 503 `db:false`: `pg_isready -h localhost -p 5433`; start the cluster with `Start-Process` (runbook, never pipe `pg_ctl`); Compose: check the `postgres` health. After the DB is back confirm health 200; if still 503, restart the API (recovery without restart is not verified). Never run `npm run build` in `apps/api` while the API runs (RB-9).
- Missing SQL objects (`link_latency_stats ... does not exist`, triggers absent after `db:push`): DevOps runs `npm run db:sql` in `apps/api`, no traffic meanwhile.
**RB-3 Sync failures / mock operator locks**
- See Admin > Sync runs (`GET /api/admin/sync-runs`) and `GET /api/operator/api-configs/:id/runs`; `dynamic_api_configs.lastError`. Backoff = min(pollingIntervalSec x 2^failures, 3600 s); config status `ERROR` after 5 consecutive failures. Typical causes: operator API down/401, credentials unreadable after `CREDENTIALS_ENCRYPTION_KEY` rotation (re-enter), SSRF guard "resolves to a private address" (`ALLOW_PRIVATE_OPERATOR_URLS` is demo only), bad field mapping.
- After the cause is fixed: operator presses **Sync now** (`POST /api/operator/api-configs/:id/sync`); do not touch tables. Webhook problems: `webhook_events` where `source='OPERATOR_API'` (`signatureOk`, `status`, `error`).
- Simulated operators keep locks in API memory: a **restart resets all locks** and the next sync (about 30 s) restores availability. Use this only on demo/CI.
**RB-4 Reservation / payment stuck**
- AWAITING_PAYMENT expires after the lock TTL (default 15 min); the sweeper (15 s, 50 per tick) sets reservation + PENDING payments EXPIRED and releases locks. A late `PAID` is still accepted: reservation becomes PAID and the ledger gets `reservation.paid-after-release` (FAILED, "manual review/refund required"). L1 -> L2 (finance/ops); no automated refund exists.
- Webhook idempotency: duplicate `eventId` -> `{duplicate:true}`; payments are claimed by status, so replays change nothing. Bad signature -> 401 and a FAILED `webhook_events` row. Midtrans amount is not compared with the payment (S-14): verify amounts manually for disputes.
- `reservation.confirm-incomplete` in the ledger or item `lockStatus='FAILED'`: operator confirm failed; L2 contacts the operator. Production: mock provider/self-completion refused (409/403); `payment.provider` must be `midtrans`.
**RB-5 Ticket SLA breaches and SYSTEM tickets**
- Sweeper (60 s) stamps `ackBreachedAt`/`resolveBreachedAt`; targets from `ticket.sla`; breaches lower the operator's ticket score. Sweeper stalled = log `ticket sweep failed:` (SEV2). RESOLVED auto-closes after 72 h.
- SYSTEM tickets: outage after 2 consecutive samples with loss >= 100 %, degradation after 3 (loss > 1 % or latency > 1.5x baseline); never from demo samples or planned maintenance; auto-resolve after 3 good samples; recurrence within 30 min reopens the same ticket; one open SYSTEM ticket per link. No SYSTEM ticket during a real outage -> check telemetry mapping and `link_metric_snapshots` (RB-6).
- Buyer cannot open a ticket: needs a PAID/CONFIRMED reservation on that link (`TICKET_NOT_RENTER`), max 2 open per link (`TICKET_DUPLICATE`). Never edit ticket rows in SQL.
**RB-6 Performance score looks wrong**
- "Not yet rated" needs >= `perf.minSamples` 50 samples over >= `perf.minCoverageDays` 7 days, and operator telemetry (`fieldMapping.telemetry`). Buyers see the score only after `perf.previewDays` (7). Demo rows count only if `demo.countInMetrics=true`. Ticket rates stay empty below `ticket.minForRates` 5 tickets.
- Maths (D11/X6, known limitation): uptime = 100 x (1 - outage minutes / (`perf.windowDays` x 1440)); unmeasured days count as up and planned maintenance is not removed, so young history can look better than reality. Availability component = clamp((uptime - 95) / 5); weights latency 0.3, availability 0.4, tickets 0.2, headroom 0.1. Explain it, do not "correct" it.
- Refresh: Admin > Tickets > **Recompute quality** (`POST /api/admin/quality/recompute`); settings cache 15 s.
**RB-7 AI insights empty or "rule-based"**
- Engine `rule-based` is the expected result without an LLM key (or `ai.provider=rule-based`), and also when the LLM reply cannot be parsed; numbers always come from the DB. LLM path is untested.
- "Not enough data yet: X needed, Y so far": thresholds `insight.minEvidence` 10, `insight.minRentedLinks` 3, `insight.minPeers` 3, window `hot.windowDays` 7; seeded/demo activity is excluded by default. `COOLDOWN` (429) = one report per `insight.generateCooldownMin` 10 min. Admin without operator -> 403 "No operator profile". No scheduled generation.
**RB-8 Explorer returns no routes**
- A route needs links that are AVAILABLE, priced, with capacity >= Min. capacity, within `explorer.maxHops` 3. Check: lower Min. capacity; marketplace list; link `availability`; empty map = no ACTIVE links of approved operators/no coordinates. `unmet` searches are logged for sellers (only at full hop depth).
- Demo: `scripts/smoke.mjs` reserves a demo link per run and consumes inventory. Restart the API (locks reset, next sync restores) or `npm run seed` in `apps/api` (resets demo rows, then everyone signs in again). Run `npm test` before smoke; never concurrently. Caches: graph `explorer.cacheSeconds` 30 s, demand 60 s.
**RB-9 Prisma generate EPERM / build errors**
- Running API locks the Prisma engine DLL: stop node (runbook Stop command), `npm run build` (or `npm run prisma:generate`) in `apps/api`, start API. Never `npx prisma ...` (use npm scripts). `db:push` then always `db:sql`.
**RB-10 Ledger verification failure**
- `GET /api/admin/ledger/verify` -> `{valid,checked,brokenAtSequence}` (first 5000 rows only, S-20). `valid=false` = SEV1: freeze deploys, `pg_dump` for evidence first, notify Security and DevOps; triggers block UPDATE/DELETE so rows cannot be "fixed". Known benign cause to rule out: restore/trigger gaps (re-apply `npm run db:sql`, compare with the last backup).
- `[ledger] append failed` (swallowed by `appendSafe`): audit row missing for a business event = SEV2; cross-check PAID payments without a ledger row (monitoring README).

## 5. Monitoring and templates
Probes, SQL checks, alert thresholds, log patterns and SLOs: `infra/monitoring/README.md` (adopt as-is). Incident report: `ID | sev | detected | impact (tenants/users) | timeline (UTC+7) | mitigation | root cause | follow-ups (owner/date)`. Internal update: `[SEVx] <service> <symptom>; impact; next update HH:MM`. User notice (ID/EN): "Kami sedang menangani gangguan pada <fitur>. Data Anda aman; pembaruan berikutnya pukul HH:MM. / We are working on an issue with <feature>. Your data is safe; next update at HH:MM." (state "safe" only after evidence). Post-mortem within 3 working days for SEV1/2: facts, 5-whys, what worked, actions.

## 6. Error codes (API body `{code,message}`; the web shows `err.<CODE>` from `dictionary.ts`)
| Code (HTTP) | Meaning | User answer ID / EN |
| --- | --- | --- |
| `SAME_NODE` (400) | A-End = Z-End | A-End dan Z-End harus berbeda. / A-End and Z-End must differ. |
| `NODE_NOT_FOUND` (404/400) | unknown city or link in explorer/interaction | Titik tidak ditemukan. / Node not found. |
| `TICKET_NOT_RENTER` (403) | no paid/confirmed reservation on the link | Hanya penyewa link ini yang dapat membuat tiket. / Only customers of this link can open a ticket. |
| `TICKET_DUPLICATE` (409) | >= 2 open tickets by you on this link | Terlalu banyak tiket terbuka untuk link ini. / Too many open tickets for this link. |
| `TICKET_STATE_CONFLICT` (409) | illegal/concurrent move, or ticket closed | Status tiket sudah berubah; muat ulang. / The ticket status changed; please refresh. |
| `TICKET_FORBIDDEN` (403) | role may not do this transition | Peran Anda tidak dapat melakukan aksi ini. / Your role cannot perform this action. |
| `INVALID_TICKET` (400) | title 3-160 / description 10-4000 / kind / severity invalid | Data tiket tidak valid. / Invalid ticket data. |
| `INVALID_MESSAGE` (400) | empty, > 2000 chars, or internal+public | Pesan tidak valid (wajib diisi, maks. 2000 karakter). / Invalid message (required, max 2000 characters). |
| `REPLY_EXISTS` (409) | public reply already sent | Balasan publik sudah ada. / A public reply already exists. |
| `INVALID_FILTER` (400) | bad status/kind/source query | Filter tidak valid. / Invalid filter. |
| `THROTTLED` (429) | > `interaction.maxPerMinute` events | Terlalu cepat, coba lagi sebentar. / Too fast, please try again shortly. |
| `RATE_LIMITED` (429) | per-IP limiter (production) | Terlalu banyak permintaan, coba lagi nanti. / Too many requests, please try again later. |
| `COOLDOWN` (429) | insight report requested within 10 min | Tunggu beberapa menit sebelum membuat analisis lagi. / Wait a few minutes before generating again. |
| `INVALID_TYPE` / `INVALID_ADDON` (400) | bad interaction type / add-on data | Jenis aktivitas tidak valid. / Invalid activity type. ; Data add-on tidak valid. / Invalid add-on data. |
| `NOT_FOUND` (404) | operator/data not found (also 404 for out-of-scope objects) | Data tidak ditemukan. / Not found. |
| no code, 401 | "Invalid credentials", "Too many attempts, try again later", "Invalid or expired token" | Email/kata sandi salah atau terlalu banyak percobaan; coba lagi 15 menit. / Wrong email or password, or too many attempts; retry in 15 min. Expired token: masuk kembali / sign in again. |
| no code, 403 | "Insufficient permission/role" | Keluar lalu masuk lagi; jika tetap, hubungi admin. / Sign out and in; if it persists contact an admin. |
| no code, 409 | "Link is not available", "Checkout already in progress", cart currency mix | Link sudah tidak tersedia / checkout sedang diproses / satu mata uang per keranjang. / Link no longer available / checkout in progress / one currency per cart. |
| 503 (`/api/health`) | database unreachable | Layanan sedang gangguan, kami menanganinya. / Service is temporarily unavailable; we are working on it. |
Gaps (not translated in `dictionary.ts`): plain 401/403/409 texts above are English server messages; system ticket titles/timeline are English only (D21).

## 7. FAQ
Buyer/operator FAQ (ID/EN, 10 entries): `docs/support-faq.md`. Longer guidance: `docs/user-guide.{en,id}.md` section Troubleshooting.

## 8. Known issues (open at time of writing) and workaround
| Item | Impact | Workaround | Owner |
| --- | --- | --- | --- |
| S-12 no token revocation; S-13 JWT in localStorage, no CSP nonce | suspended/demoted user keeps access <= 8 h; XSS = takeover | restart does not help; suspend + rotate `JWT_ACCESS_SECRET` (logs out everyone) only in emergencies | Coder, Security |
| S-14 webhook replay, Midtrans amount unchecked, bad-signature bodies stored | possible fraud/bloat | verify amounts manually; watch `webhook_events` | Coder, DevOps (edge limit) |
| S-15 DNS rebinding; S-16 operator sees rival lines in shared reservations; S-17 LLM prompt steering via names | tenant leakage / odd narratives | egress firewall; do not share reservation payloads; ignore narrative, trust numbers | DevOps, Coder, Security |
| S-10 remaining untyped bodies, S-24, S-26 | 4xx expected, some 500s on bad enums/ids | report with request; no workaround | Coder |
| S-20 ledger trust rests on DB role; verify checks 5000 rows; S-23 no request/auth logging | tamper/diagnosis gaps | RB-10, proxy logs | DevOps, Security |
| D11/X6 availability counts unmeasured days as up | young scores overstated | explain (RB-6) | Coder, SA |
| D13 buyer-chosen SEV1 forces 15 min ack SLA | seller score gaming | Admin reviews ticket abuse by user | PM (decision), Coder |
| D21 English-only system ticket text, `NODE_NOT_FOUND` etc. only for coded errors; D22 stale route UI on fast A/Z changes (partly) | cosmetic | reload | UI/UX, Coder |
| X1 `scripts/start-demo.ps1` omits `db:sql` (fresh DB fails seed) | broken first setup | manual sequence in README/runbook | DevOps, Coder |
| X5 unused settings `insight.windowDays`, `sla.windowDays`; X7 `redundancyScore` scale 0-1 vs 0-100; X8 seed deletes all `link_metric_snapshots` | editing them has no effect / odd chips / lost real samples | do not re-seed a database with real telemetry | Coder, SA |
| Tester notes: replay of a finished payment returns the payment row, not the reservation; pending operators can generate insights | client assumptions | do not rely on that body | Coder, PM |
| DevOps: Docker/CI/compose untested, no CD, one API replica only, no off-host backup/PITR, no prod-mode smoke automation, no `/metrics` | release and recovery risk | follow runbook; deploy outside business hours; backup before each deploy | DevOps |
| Security prerequisites not done: Security 09 section 7 checklist (secrets, flags off, `demo.*`, delete demo users, TLS, role split) | release gate | confirm before go-live | DevOps, Security |
| Demo data: `ALLOW_PRIVATE_OPERATOR_URLS=true` in dev `.env`; seed overrides `demo.*`; smoke consumes inventory | wrong data in prod if copied | never copy dev `.env`/seed to production | DevOps |

## 9. Feedback loop
Every L2/L3 escalation becomes a bug ticket: `ID | sev | env/release | steps | expected/actual | evidence (status, code, log line, ledger/ticket id) | tenant impact | workaround | related known issue`. Weekly digest (recurring questions, error-code counts, SLA breach share, unmet-demand routes, "Not yet rated" share) goes to PM (priority/scope, open questions Q1-Q5 and T5) and Coder (defects, with QA regression test name); settings/threshold complaints go to PM + SA; copy/i18n to UI/UX; doc gaps to Documentation. SEV1/2 post-mortem actions are tracked until QA verifies the fix and Tester adds a regression test; update this playbook and `docs/support-faq.md` on every change of error codes, settings or runbook steps.

## Handoff
- **Inputs consumed**: `.artifacts/00` to `11`, `agents/support.agent.md`, `docs/{runbook,user-guide.en}.md`, `README.md`, `infra/monitoring/README.md`, API source (listed above) and `dictionary.ts` error keys.
- **Outputs produced**: `.artifacts/12-support-playbook.md`, `docs/support-faq.md`.
- **Pipeline Status**: COMPLETE (stage 12 of 12).
- **Production Readiness**: CONDITIONAL. Functionally verified earlier (213/213 tests, 63/63 smoke per recorded logs); but release gates remain: Docker/CI never run, Security checklist items 1-2 and Mediums S-12/S-14 not accepted or fixed, no request logging/alerting (S-23), single instance only, backup/restore untested. Playbook commands are untested here.
- **Remaining Items**: (1) DevOps: first real `docker compose up --build`, backup/restore drill, proxy/TLS, alert wiring. (2) Security/Coder: S-12, S-14, S-16, S-23. (3) PM: decide D13 severity rule, support SLAs/contact channels (names, pager) in section 1-2. (4) Coder: X1 script fix, D21 localisation. (5) Support: replace proposed response targets with agreed ones.
