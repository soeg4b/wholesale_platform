# User guide (English)

Wholesale Network Marketplace: buyers (Penyewa) find and rent telecom links, operators (Penyelenggara) sell them and get AI advice, admins run the platform. The interface is bilingual: switch **ID / EN** in the top bar at any time (the choice follows your profile language after sign-in). Indonesian version: [user-guide.id.md](user-guide.id.md).

Parts of the screens marked **Demo data** contain automatically generated demo records (history, searches, tickets), so numbers there are illustrative.

## 1. Getting started

1. Open the web app (local demo: http://localhost:3000) and choose **Sign in**, or **Register** (pick *buyer* or *operator*; operators must be approved by an admin before they can publish).
2. After sign-in you land on: buyers **Map** (`/explore`), operators **Operator Dashboard**, admins **Admin**.
3. Demo accounts (password `Demo@12345`): buyer `buyer@demo.wnmp.test`, operators `operator@nusalink.wnmp.test` and `operator@garuda.wnmp.test`, admin `admin@demo.wnmp.test`.
4. If a screen says you lack permission right after the system was re-seeded, sign out and in again.

## 2. Buyer

### 2.1 Find routes on the map (Map)

1. Open **Map**. The map of Indonesia shows a dot for every city with active links; line thickness shows connectivity between two cities.
   - Solid blue line: capacity available. Dashed grey line: no capacity. Thick yellow line with **HOT**: hot link or route. Hollow dot: no capacity available at that city. Lines are straight connectivity lines, not the physical cable path (the KMZ route is on the link detail page). Open **Map legend** under the map for the same explanation.
2. Click a city for the **A-End** (origin), then a second city for the **Z-End** (destination). Click a selected city again to unselect it. Prefer the keyboard? Use the **A-End** and **Z-End** selects above the map (the number in brackets is the number of links); **Swap A and Z** and **Clear** are next to them. **Min. capacity** (Gbps) filters out links that cannot supply it. **View as list** opens the marketplace list instead. The selection is kept in the page address, so you can bookmark or share a view.
3. The right-hand panel (**Route summary**) lists the routes found. Sort by *Recommended* (fewest hops, then price), *Lowest price*, *Lowest latency*, *Performance score* or *Hottest*.

Each route card shows:

| Element | Meaning |
| --- | --- |
| **Direct** / **n hops** | a single link, or a chain of links through intermediate cities (at most 3 hops by default) |
| **Indicative** | multi-hop routes: price, latency and capacity are sums over separate legs, not an offer and not an end-to-end guarantee |
| **HOT +n%** | many buyers are looking at this link or route compared with the previous period, or capacity is scarce. Multi-hop routes are never marked hot |
| **Price / month** | cheapest to most expensive combination of the leg options, after the operator's pricing rules (12-month term) |
| **Best latency**, **Available capacity** | from operator data; "no data" when the operator does not report it |
| Promo chips (star) | active promotions and discounts that apply to the route's operators or links |
| Performance chip | the performance score (see 2.3) or **Not yet rated** |
| `SLA n%`, **Redundancy**, **KMZ**, `+ Backup path / Monitoring / Premium SLA ...` | capabilities: contractual availability, redundancy level, physical route available, add-on services the operators offer |

**Show legs & options** expands each leg with the candidate links (operator, price, latency, capacity, score); click a candidate to open the link. Reservations are made **per leg**.

With nothing selected, the panel shows **Hot links right now** (with trend and price) and **Active promotions**. If no route has capacity you see "No capacity is available for A to Z yet" - the search is recorded anonymously as unmet demand so operators can add capacity. A high **Min. capacity** can also produce this state: lower it to see smaller options.

### 2.2 Compare, reserve and pay

1. **Marketplace** lists links with filters (origin, destination, operator, category, minimum capacity, maximum latency, maximum price, available only) and sorting. Cards show the performance chip and a map badge when a KMZ route exists.
2. Open a link: route on the map (from the operator's KMZ), specifications, latency trend, **performance** card, price tiers for 1, 12, 24 and 36 months. Choose the term and **Add to cart** (buyers only; one currency per cart).
3. **Cart** shows subtotal, tax and total. **Checkout** re-prices at the current rules and asks each operator to hold (lock) the links for a limited time (default 15 minutes). You are sent to the payment page (in the demo a sandbox page where you can simulate success or failure). Pay before the hold expires (**Pay now** on the reservation page): unpaid reservations expire and the links are released.
4. **Reservations** shows status: *Awaiting payment*, *Paid*, *Confirmed*, *Expired*, *Cancelled*, *Failed*. You can cancel while awaiting payment.

### 2.3 Understand the performance score

On every rated link (detail page, marketplace card, route chip) you see a score from 0 to 100 built from four parts: **Latency stability**, **Measured availability**, **Ticket handling**, **Capacity headroom**. The detail card also shows measured uptime against the SLA target, latency mean/p50/p95/jitter, outages, and ticket statistics (count, open, MTTA response time, MTTR resolution time, SLA breach rate).

- **Not yet rated** means there is not enough measurement history (enough samples over several days), or the operator does not report telemetry. This is not a bad score.
- Right after the first rating the score is shown only to the seller for a preview period; buyers see it afterwards.
- Ticket rates only appear when there are enough tickets to be meaningful.
- "Measured" values come from automatic telemetry collected during synchronisation with the operator, not from customer reports. Days without telemetry are not counted as downtime, so a young history can look better than it is.
- The **Demo data** badge tells you that demo records are included.

### 2.4 AI analysis

Open **AI Analysis**, describe your need in plain language (for example "best route for 10 Gbps from Jakarta to Surabaya with latency under 10 ms" or the Indonesian equivalent) and press **Analyze**. You get ranked options from live platform data, a recommended and a backup path, cost-benefit, redundancy advice, latency prediction and risks. Options can be shown on the map. The **Engine** label tells whether the text was written by a language model or by the built-in rule-based engine; numbers always come from the platform data. There is an hourly limit per user.

### 2.5 Report a problem and track tickets

You can open a ticket for a link you rent (a paid or confirmed reservation):

1. On the link detail page press **Report an issue**, choose type (*Degradation*, *Outage*, *Other*) and severity (SEV1 most urgent to SEV3), enter a title (3-160 characters) and a description (at least 10 characters), and **Submit ticket**.
2. You are taken to the ticket page: status stepper (*Open - Acknowledged - In progress - Resolved - Closed*), response and resolution deadlines with a countdown, and the timeline. The operator may add an **Operator public reply** (visible to you, one per ticket). Internal notes of the operator are never shown to you.
3. When the operator marks it *Resolved*, press **Confirm resolved** to close it, or **Reopen** if the problem persists. Resolved tickets are closed automatically after 72 hours.
4. **Tickets** in the top bar lists your tickets with filters (status, type, source).

Limits: you can have at most 2 open tickets per link. If the platform itself detects an outage or degradation, a *System* ticket is created automatically for the operator; you do not need to report the same incident.

## 3. Operator (seller)

Open **Operator Dashboard**. A banner tells you if your account is waiting for approval or was rejected (with the reason). Tabs: **AI insights**, **My links**, **Performance**, **Tickets**, **API integrations**, **KMZ / Maps**, **Pricing rules**, **Add-ons**.

### 3.1 AI insights

Press **Generate now** (one report per 10 minutes by default). The report has an **AI summary** (an *Engine* badge shows `rule-based` or the language model name) with up to five prioritised actions, and three sections. Every finding has an **Evidence** disclosure with the numbers behind it, and a severity (information, needs attention, high priority). Sections show "Not enough data yet: X needed, Y so far" instead of guessing.

1. **Demand, trends and congestion risk**: *Most searched routes*, *Best-selling links*, *Rising demand* (trend versus the previous 7 days), *Congestion risk* (utilisation warning/high, sustained load, and an indicative days-to-saturation estimate with its fit quality), *Unmet demand* (routes at your cities that buyers searched for but where no capacity is available).
2. **Add-on opportunities from rented links**: based on which of your links are rented (needs at least 3 rented links), the system suggests add-on kinds (for example backup path for low-redundancy links, capacity upgrade for highly utilised links, premium SLA where uptime fell below the SLA, monitoring, DDoS protection for IP transit). It shows only the **number** of renters, never who they are. The button says **Open add-on catalog** when you already have a matching add-on (offer it to those renters) or **Create add-on** when you do not.
3. **Links that need improvement**: low uptime versus SLA, unstable latency, SLA breaches in tickets, low performance score, price far above or below the route median (with at least 3 comparable links), data not synchronised for 24 hours, no KMZ route uploaded, no telemetry.

All thresholds are platform settings. Facts are computed from platform data; a language model, if configured, only writes the summary text.

### 3.2 Performance

The **Performance** tab is a table of all your links: utilisation, score with components, uptime, latency, ticket KPIs and demand (events, trend, **HOT**). Use it to see which links buyers see as strong or weak. You see full details for your own links; for competitors' links you can only see the headline score.

### 3.3 Tickets

The **Tickets** tab lists tickets on your links (from buyers, from you, and automatic *System* tickets). Open a ticket to act:

- **Acknowledge** (stops the response clock), **Start work**, **Mark resolved**. Respect the due times: missing them is recorded as an SLA breach, which lowers your ticket-handling score.
- Add comments, internal notes (hidden from buyers) or one **Operator public reply** for the buyer.
- System tickets are opened when telemetry shows an outage (2 consecutive failed samples by default) or degradation (3 by default), escalate from degradation to outage, and resolve themselves after 3 good samples. A recurrence within 30 minutes reopens the same ticket.
- You can also open a ticket yourself for one of your links.

### 3.4 Add-ons

In **Add-ons** create, edit, enable/disable and delete add-on services (kind, bilingual name and description, display price, unit). Buyers see them as capability chips on routes of your operator. Add-ons are for display and advice only: there is no purchase flow, the buyer asks through the reservation.

### 3.5 Links, integrations, KMZ and pricing

- **My links**: manual links (editable) and API-managed links (technical fields come from the operator API; you can change status, name, description). Needs an approved account to create.
- **API integrations**: connect your inventory API (base URL, authentication, endpoints, field mapping, optional telemetry mapping, polling or webhook). Use **Test connection** for a dry run, **Sync now**, and **Sync history**. Credentials are stored encrypted and never shown again. Without a telemetry mapping your links cannot be rated.
- **KMZ / Maps**: upload a KMZ, KML or GeoJSON file (max 20 MB), pick the feature and attach it to a link so buyers can see the physical route.
- **Pricing rules**: base override, volume or term discounts, capacity tiers, surcharges and **promotions** (optionally valid from/until, per link or for all links). Rules apply by priority. Discounts and promotions feed the explorer promo chips.

## 4. Admin

Open **Admin**. Tabs: **Overview**, **Operators**, **Users**, **Ledger**, **Sync runs**, **Tickets**, **Settings**.

- **Operators**: approve or reject new operators (rejection needs a reason). Only approved operators' links are visible to buyers.
- **Users**: suspend or reactivate accounts (not your own). A suspension takes effect at the next sign-in.
- **Ledger**: browse the tamper-evident transaction log by event type and press **Verify hash chain** to check it.
- **Sync runs**: health of operator API synchronisation.
- **Tickets**: all tickets platform-wide; **Recompute quality** recalculates scores and runs incident detection for all active links.
- **Settings**: edit runtime settings (thresholds for hot links, performance, tickets/SLA, congestion, insights, explorer, demo switches, payment and AI providers, tax, lock time). Changes apply within about a minute. See [settings.md](settings.md) for every key. Wrong JSON shapes are ignored with a warning and the default is used.
- Platform-wide promotions can be added through the setting `promo.platform`.

## 5. Troubleshooting

| Situation | What to do |
| --- | --- |
| The map is empty | There are no active links of approved operators, or the operator data has no coordinates. |
| A city is missing from the selects | Only cities with coordinates on active links of approved operators appear. |
| "Not yet rated" for a long time | The operator reports no telemetry, or the history is too short (default: 50 samples over 7 days). |
| I cannot report an issue | Only buyers with a paid or confirmed reservation on that link can; you may also have reached 2 open tickets. |
| Reservation expired | The payment was not completed within the hold time; add the link to the cart again. |
| Insights say "Not enough data yet" | Not enough searches, rentals or rented links yet; the thresholds are configurable. |
| Labels look English in Indonesian mode | Automatic System ticket titles and timeline messages are English only (known gap). |
| Permission error after a platform update | Sign out and sign in again. |

## 6. Glossary

**A-End / Z-End**: origin / destination city of a route. **Leg**: one link between two cities in a multi-hop route. **Hot**: unusually high and growing demand, or scarce capacity. **Unmet demand**: searches for routes without available capacity. **SLA**: promised availability and response times. **MTTA / MTTR**: mean time to acknowledge / to resolve a ticket. **Telemetry**: automatic latency, packet loss and status measurements. **Ledger**: append-only hash-chained audit log.
