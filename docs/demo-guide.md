# Demo guide (web version)

Everything needed to run and present the platform as a web app, on this PC or for an audience on the same network.

## 1. Start (one command)

```powershell
powershell -File scripts\start-demo.ps1
```

Creates/starts the private PostgreSQL cluster (port 5433), builds the API, applies schema + SQL, seeds the demo data, then starts:

- API: http://localhost:4000/api (health: `/api/health`)
- Web: http://localhost:3000

Both are production builds (`node dist/main.js`, `next start`). The demo works with no external services.

## 2. Demo from another device (LAN)

The web build calls the API on the same host automatically when it is opened from another machine, so no rebuild is needed:

1. Find the PC's IP: `ipconfig` (e.g. 192.168.1.10).
2. Allow inbound ports 3000 and 4000 in Windows Firewall (once, as admin):
   `New-NetFirewallRule -DisplayName "WNMP demo" -Direction Inbound -LocalPort 3000,4000 -Protocol TCP -Action Allow`
3. Open `http://192.168.1.10:3000` on the other device/phone. On Android, Chrome offers "Add to Home screen" (PWA).

## 3. Sign in

The login page lists every demo account (password `Demo@12345`). Quick roles:

| Flow | Account |
| --- | --- |
| Buyer, healthy | buyer@demo.wnmp.test |
| Buyer, low balance / over budget / early bird / new | buyer.lowbalance@ / buyer.overbudget@ / buyer.earlybird@ / buyer.new@ demo.wnmp.test |
| Provider (API-fed) | operator@nusalink.wnmp.test, operator@garuda.wnmp.test |
| Provider (manual + pre-build) | operator@borneo.wnmp.test |
| Admin | admin@demo.wnmp.test |

## 4. Suggested 10-minute flow

1. **Map-first discovery** (`/explore`): pick A-End Jakarta, Z-End Surabaya → routes, hot links, promo chips, per-route performance score.
2. **Link detail + rent**: open a link → price tiers, metrics, KMZ route → add to cart → checkout → pay (mock gateway or wallet balance).
3. **Buyer profile** (`/profile`): balance, monthly charge vs budget, alerts, rented links on a map with performance, review the provider, notification settings.
4. **Link requests** (`/requests`): post a route that does not exist; other buyers support it.
5. **Provider side** (`/operator`, `/provider`): AI insights (demand, congestion, add-on advice, improvements), links/pricing (single edit, bulk %, CSV export/import), KMZ upload → draft links, pre-build product with early-bird price, tickets with SLA.
6. **Realtime**: with two browsers open, create a promo pricing rule as the provider → the buyer's bell/toast updates within seconds (SSE stream).
7. **Admin** (`/admin`): operators (approve the pending one), ledger + verify, sync runs, settings, reference locations, data export (CSV/JSON).

## 5. Reset between demos

- Re-run `npm run seed` in `apps/api` to restore the full demo story (all `isDemo` rows are rebuilt).
- Restart the API to release the simulated operators' in-memory locks (smoke test reserves one link per run).
- Everyone must sign in again after a re-seed (permissions are inside the token).

## 6. If something fails

| Symptom | Fix |
| --- | --- |
| `npm run build` fails with EPERM on prisma | Stop the API process, then build again |
| Port 4000/3000 already in use | Stop the old `node dist/main.js` / `next start` process first |
| Other device cannot open the page | Firewall rule (step 2) and same Wi-Fi; the API must listen on the PC |
| Login works but data is old | Re-seed and sign in again |
| Full health checklist | `node scripts/smoke.mjs` (63 checks) and `npm test` (246 tests) |
