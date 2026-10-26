# Browser (E2E) checks

No browser automation is installed (the Tester stage was limited to the Node built-in runner, no new dependencies).
The API-level behaviour behind these flows is covered by `tests/integration/*.test.mjs`; this file lists the
checks that need a real browser. They are written so they can be turned into Playwright specs
(`tests/e2e/*.spec.ts`, Chromium, `baseURL=http://localhost:3000`) when `@playwright/test` is approved.

Preconditions: API on `:4000`, web on `:3000`, seeded demo data. Password for all demo accounts: `Demo@12345`.
Accounts: `buyer@demo.wnmp.test`, `operator@nusalink.wnmp.test`, `operator@garuda.wnmp.test`,
`admin@demo.wnmp.test`, `pending@operator.wnmp.test`. Re-login after any re-seed (JWT permissions are cached).

## Manual / Playwright scenarios

| ID | Role | Steps | Expected |
| --- | --- | --- | --- |
| E2E-01 | buyer | Sign in, land on `/explore`. Pick A-End Jakarta and Z-End Surabaya in the selects. | Map shows nodes/edges; route list shows one direct route with Hot badge, promo chips, KMZ chip and performance chip. URL contains `from=` and `to=`. |
| E2E-02 | buyer | Select Jakarta -> Makassar. | Only multi-hop routes, all flagged "Indicative"; no Hot badge. |
| E2E-03 | buyer | Select Medan -> Denpasar. | "Unmet demand" empty state, no routes, no console errors. |
| E2E-04 | buyer | Open `/explore?from=jakarta&to=jakarta` and `/explore?from=zzz&to=jakarta`. | Same-node and unknown-node messages, localised, page does not crash. |
| E2E-05 | buyer | Change A/Z quickly 5 times (throttle network to Slow 3G). | Final list matches the final selection (no stale response, QA D22). |
| E2E-06 | buyer | Open link NL-JKT-SBY-N, click "Report issue", submit SEV2 degradation. | Redirect to `/tickets/<id>`; status Open with SLA countdown; double click does not create two tickets. |
| E2E-07 | buyer | `/tickets`: filter by status and source; open a ticket; as operator reply publicly, then buyer reloads. | Public reply visible, internal notes never visible; Close button only on Resolved. |
| E2E-08 | operator (NusaLink) | `/operator` tabs Insights, Performance, Tickets, Add-ons. Generate insights twice in a row. | Second attempt shows cooldown message (429 COOLDOWN), sections show "insufficient evidence" or items with evidence; text follows the language toggle. |
| E2E-09 | operator | Tickets tab: Acknowledge -> In progress -> Resolve; post public reply twice. | Second reply shows localised "reply already exists"; illegal buttons are not offered. |
| E2E-10 | operator (Garuda) | Open `/tickets/<NusaLink ticket id>` directly. | Not-found page (no data leak). |
| E2E-11 | operator | Add-ons tab: create, toggle, delete add-on. | List refreshes; errors (e.g. negative price) are shown, not swallowed (QA D12). |
| E2E-12 | admin | `/admin` Tickets tab, Ledger tab "Verify". | All tickets listed; ledger reports valid chain. |
| E2E-13 | any | Toggle language ID/EN on `/explore`, `/tickets`, `/tickets/<id>`, `/operator` tabs, link detail. | Every label switches; no raw keys such as `status.PAUSED`; system-generated ticket text is English-only today (QA D21). |
| E2E-14 | any | Mobile viewport 390x844 on `/explore` and `/tickets`. | No horizontal scroll; selects remain usable (map markers are not keyboard-focusable, known gap). |
| E2E-15 | admin | Mock operator incident (`POST /mock-operator/incidents`, 30 min OUTAGE) then trigger 3 syncs. | A SYSTEM SEV1 ticket appears; after removing the incident and 4 syncs it auto-resolves. Needs `demo.incidentInjection`; mutates demo data, run on a throw-away DB. |

## Not automated here (needs DB or clock control)
Threshold boundaries for hot/congestion/detector/score (`>=` vs `>`), sweeper auto-close after 72 h, flap handling,
planned-maintenance streaks, `demo.countInMetrics` toggling, empty-database UI. These require direct DB inserts or
fake timers against the Nest services, which was out of scope for a black-box HTTP suite.

## Running the automated suites
`npm test` from the repository root (equivalent to `node --test tests/`). Set `API=http://host:4000/api` to target another API.
