# 01 - Creator Vision (Iteration 2)

Stage 1 of the pipeline. Audience: Product Manager. Strategic level only; implementation choices belong to later agents.

## 1. Product Vision

**Problem.** Wholesale telecom capacity is sold through opaque, relationship-based channels. Buyers (Penyewa) cannot see what routes exist, which are in demand, or whether a link actually performs. Sellers (Penyelenggara) sell blind: they do not know which routes are sought, which are failing, or what else a renter would pay for.

**Vision.** The place where Indonesia's network capacity is discovered visually, bought with confidence, and where sellers grow revenue using evidence rather than intuition.

**Value proposition.**
- Buyer: "Pick A and Z on the map, see every available route, the hot ones, the promos, and proven performance."
- Seller: "A free analyst: what sells, what is congesting, what to upsell, what to fix."
- Platform: measured performance and demand data becomes a trust and liquidity moat that a plain catalog cannot copy.

**Strategic goals (this iteration).**
1. Make discovery effortless (map-first, two clicks to a route comparison).
2. Make the platform valuable to sellers, not only buyers (two-sided stickiness).
3. Turn link/ticket performance into a sales argument, not a back-office cost.

## 2. Business Requirements

**Objectives.** Higher search-to-reservation conversion; higher share of sellers with fresh, complete listings; more revenue per renter via add-ons; fewer disputes thanks to transparent performance.

**Business-facing success metrics** (targets set by PM from baseline measured in week 1; no numbers fixed here):
| Area | Metric |
| --- | --- |
| Discovery | Share of sessions reaching an A-Z comparison; time from landing to first route compared; search-to-cart and cart-to-reservation conversion |
| Demand | Share of searches with no available capacity (unmet demand) reported to sellers; repeat searches per route |
| Seller value | Weekly active sellers opening insights; share of insights acted on (price change, add-on listed, link fixed); listings with KMZ and fresh sync |
| Monetization | Add-on attach rate per reservation; revenue per renter; promo-driven bookings |
| Performance/trust | Share of links with a performance score; SLA-breach rate trend; ticket time-to-acknowledge/resolve; reservation rate of high-score vs low-score links |
| Trust | Share of buyers who report data as "useful/credible"; disputes per 100 reservations |

**Key constraints and assumptions.**
- No hardcoded business data; every figure comes from DB, operator APIs or platform settings.
- Bilingual (ID/EN) throughout.
- Assumption: operators expose enough telemetry (latency, uptime, outages) via their APIs to compute performance; where not, the platform says "no data" rather than guessing.
- Assumption: sellers will accept being scored publicly if the scoring is transparent and they can see it first.

## 3. Market Analysis (brief)

- **Segments.** Buyers: ISPs, cloud/data-center, enterprises with multi-site WAN, content providers. Sellers: backbone and fiber operators with spare capacity.
- **Context.** Archipelago geography makes route choice (direct vs multi-hop, undersea vs terrestrial) the core buying question; a map is the natural interface.
- **Competitors.** Offline sales/brokers, operator-specific catalogs, global capacity marketplaces. Few offer Indonesia-specific route discovery plus measured performance.
- **Differentiation.** (1) Map-first discovery across operators; (2) independent performance and ticket transparency; (3) seller-side intelligence that no broker provides.
- **GTM.** Seed supply side first: operators join for insights and demand visibility, buyers follow supply breadth. Insights are the hook to keep sellers' data fresh.

## 4. Business Value of the Four Requests

### 4.1 Map-first discovery (request 1)
- **Value.** Cuts the mental cost of exploring a network from "read a catalog" to "click two cities". Visible hot routes and promos create urgency and surface inventory that would otherwise sit unseen.
- **Business effect.** Higher conversion; shorter sales cycle; a landing page that sells the whole marketplace at a glance (supply breadth is the pitch to new buyers and sellers).
- **Must have.** Start on Indonesia map; choose A-End then Z-End; summary of existing routes with price range, latency, operators; hot marker; active promos; capability highlights (add-ons, redundancy, SLA, performance, KMZ).
- **Must not.** Show a route or "hot" label that is not backed by real data; hide that a route is multi-hop or multi-operator.

### 4.2 Seller-side AI value (request 2)
- **Value.** Gives sellers a reason to come back weekly and to keep their data accurate. It converts platform data (searches, rentals, performance) into decisions: price, capacity, add-ons, fixes.
- **Three jobs.** (a) Demand and trend: what sells, what congests, what is searched but unavailable. (b) Add-on advice: based on what renters actually hold, propose services the seller can attach (redundancy, upgrades, monitoring, premium SLA). (c) Improvement feedback: links that underperform on uptime, latency stability, price vs route norm, stale data, missing map.
- **Business effect.** Higher seller retention and listing quality; new revenue stream (add-ons) shared by seller and platform; unmet-demand signals turn into new supply onboarding.
- **Rule of honesty.** Facts always computed from data; an LLM may only phrase them. Anything lacking evidence is stated as "insufficient data". Label the engine so users know what produced the text.

### 4.3 Link and ticket performance as a sales differentiator (request 3)
- **Value.** "Proven quality" is the buyer's top doubt in wholesale capacity. A per-link performance score and visible ticket track record answers it, and lets good operators charge for quality.
- **Business effect.** Quality becomes a purchasing criterion (rewarding good sellers), disputes decrease because expectations are measured, and tickets become a trust asset instead of only a cost.
- **Seller view.** Scores and ticket burden tell sellers where to invest; they also see how buyers see them.
- **Principle.** Show the score with its basis (period, sample size). Links without enough data are "not yet rated", never a default-good score.

### 4.4 Whole-pipeline collaboration (request 4)
- **Value.** Each function checks its own area (security of tickets/insights, data integrity, QA, support runbooks), so the new capabilities are credible enough to put in front of operators. This is a quality gate, not a feature.

## 5. Risk Analysis

| # | Risk | Type | Mitigation |
| --- | --- | --- | --- |
| 1 | **Fabricated vs real data.** Demo history, tickets and interactions look real and could be mistaken for measured facts, destroying trust (or misleading a demo audience). | Trust | Mark all demo-seed data visibly (in data and in UI); never mix with real data silently; show data basis and "demo" badge; empty state beats invented numbers. |
| 2 | **Seller adoption.** Sellers may resist public scoring, or not feed telemetry, leaving scores empty. | Adoption | Sellers see their scores/insights first; transparent method; rewards for good scores (visibility, badges); positive framing ("opportunities" before "problems"). |
| 3 | **"Hot" gaming.** Inflated views/searches (by sellers or bots) distort hotness and demand trends. | Integrity | Weigh reservation-level signals higher than views; discount repeats from one user; keep raw interactions auditable. |
| 4 | **Thin data early.** Few searches/rentals make trends noisy; AI advice appears confident without basis. | Credibility | Minimum-evidence thresholds from settings; explicit confidence/"insufficient data" states. |
| 5 | **Multi-hop route misrepresentation.** Combined routes imply an offer that no seller actually guarantees end-to-end. | Legal/Trust | Present multi-hop as indicative composition with each leg's own seller and terms; reservation per leg. |
| 6 | **Disclosure sensitivity.** Showing a seller's outage history may cause operator pushback or dispute. | Relationship | Agreed disclosure policy and definitions (what counts as outage/SLA breach); right of reply on tickets. |
| 7 | **Insight/advice liability.** Sellers act on wrong advice (price cuts, wrong upsell). | Reputational | Advice is decision support with stated evidence; no automatic price changes. |
| 8 | **Competitive.** Operators bypass the platform for direct deals, or a larger marketplace copies map UX. | Market | Moat = cross-operator performance and demand data; seller tools make staying on-platform worthwhile. |
| 9 | **Scope creep.** Route search, tickets, insights and promos in one iteration may dilute quality. | Execution | Priority order below; ship each value story end-to-end before adding breadth. |

## 6. Product Scope Direction

**MVP (this iteration), priority order.**
1. Map-first explorer: two-click A-Z selection, route summary, hot, promos, capability chips.
2. Demand signals feeding hotness and unmet-demand reporting.
3. Link performance score visible to buyers and sellers, with basis shown.
4. Ticket tracking (buyer/operator/system opened) feeding the score; ticket events in the audit ledger.
5. Seller insight report with three sections (demand/congestion, add-ons, improvements) and an add-on catalog.

**Out of scope now.** Automatic repricing, buyer-facing public rankings of operators, payment for add-ons beyond existing checkout flow, SLA credit/penalty automation, external NMS integrations beyond existing operator adapter.

**Post-MVP.** Alerts/digests to sellers; add-on bundles in checkout; operator benchmarking; forecast of capacity exhaustion; subscription/premium seller analytics; more countries/regions.

**Decision gates.**
- Gate A: Enough real (non-demo) interaction volume per route for trend claims; else show demo-only labelling.
- Gate B: At least a defined share of active links produce performance data from operator telemetry; else score shown only where evidence exists.
- Gate C: Seller feedback confirms insights are actionable before investing in monetization of analytics.

## 7. Guidance to Product Manager

**Immediate decisions.**
- Define "hot" (demand trend vs absolute demand vs scarcity) and "congestion risk" in business terms; thresholds go in settings.
- Define outage, degradation, SLA breach and the visibility policy for performance/tickets.
- Decide who sees what: buyer sees score and basis; seller sees own detail plus the same buyer view; admin sees all.
- Decide whether multi-hop routes are shown as bookable or indicative only (recommendation: indicative, bookable per leg).
- Choose the score minimum-evidence rule and how "not yet rated" appears.

**Questions for stakeholders.**
- Will operators accept public performance scores? What right of reply do they need?
- Which telemetry can operators actually supply (latency, uptime, outage events)?
- Are add-ons sold through the platform, or only advertised with contact?
- What promo types exist and who owns them (seller, platform)?

**Checkpoints.** After UX prototype (is two-click discovery obvious?); after first demo with seeded data (is demo labelling unmistakable?); after pilot sellers see their first insight (do they act on it?).

## Handoff

- **Inputs consumed**: `.artifacts/00-iteration2-brief.md`, `agents/creator.agent.md`, `README.md`.
- **Outputs produced**: `.artifacts/01-creator-vision.md`.
- **Decisions on the Coder's proposed design (business view)**:
  - Accept the map-first explorer, interaction-based demand tracking, performance score, tickets, seller insights and add-on catalog as the right scope.
  - Challenge: multi-hop routes must be labelled indicative with per-leg operator/terms; never presented as one guaranteed offer.
  - Challenge: weight reservations and carts above views in "hot" scoring and discount repeat signals from the same user.
  - Require: every score, trend and insight shows its basis (period, sample size) and an "insufficient data" state; no default-good scores.
  - Require: all fabricated history/tickets/interactions flagged as demo seed data in seed code and visible in the UI.
  - Require: thresholds, weights, SLA times and minimum-evidence limits come from settings/DB (consistent with the no-hardcoding rule).
- **Open questions**: operator acceptance of public scoring and right of reply; available telemetry fields; add-on sales channel; promo ownership; definition of "hot" and "congestion".
- **Go/No-Go**: **GO** for the Product Manager, conditional on the demo-data labelling and evidence-basis requirements above.
