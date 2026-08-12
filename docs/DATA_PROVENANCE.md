# Data provenance — seed and master data

The Marine Scheduler seed is **synthetic but calibrated**: real IOCL infrastructure, capacities and
supplier geography, with individual quantities scaled so a single from-empty 30-day plan stays
solvable. It is a high-realism demo dataset, not a historical operations ledger. Where public
disclosure runs out (per-lane monthly volumes, per-tank sizes, exact opening inventories), the
numbers are calibrated estimates that preserve the public totals and the network topology.

## Horizon and planning periods

Plans belong to a **planning period** (`plan_periods`) — one row per stream per month, carrying the
start date, horizon length and Open/Closed status. Day 0 of every day index in the app is that
period's start date; nothing in the UI hard-codes a month. The seed opens **Jul 2026** (30 days,
day 0 = 2026-07-01) as the live period for all three streams.

Replans and scenarios are rolling: they solve `[as-of day → month end]`, freezing everything
committed before the as-of day. Each period has one **baseline** version — the frozen plan the
month's cost is measured against. The first plan published into a period becomes its baseline
automatically; it can be reassigned from Cost & Variance.

## Seeded history — Apr, May and Jun 2026

Those three months are seeded **closed** so cost can be trended before anyone has run a month for
real. Each carries a start-of-month baseline, an end-of-month plan, and an actuals ledger.

**These are illustrative, not observed.** No historical operations feed exists for this dataset;
the months are generated from a per-stream anchor calibrated against a solved Jul-2026 plan, so a
historic month sits on the same cost scale as one the optimiser produces. Category shares (bunker /
freight / port DA / demurrage / changeover) are taken from that solve. Execution variance is applied
per category to give each month a distinct story — April ran a firm bunker market and congested
berths, May was soft, June was the bad month — rather than scaling every line by one number. Every
seeded actual row is tagged `source: 'SEED'`.

Actuals for the live month come from one of three places: a CSV import, manual entry, or
`POST /api/actuals/simulate`, which executes a plan version on paper with per-category slippage,
occasional cancellations and unplanned spot cover. Simulated rows are tagged `source: 'SIMULATED'`
and are reproducible from their seed. Anything from a real ops feed should be imported as `UPLOAD`.

## Crude

Modeled as five coastal import gateways, each sized to the throughput of the refinery it feeds and
supplied on a dedicated lane from IOCL's real top suppliers.

| Gateway | Feeds (via pipeline) | Source → grade | Vessel class |
|---|---|---|---|
| Vadinar SPM | Koyali + Mathura + most of Panipat (SMPL) | Ras Tanura (Saudi) → Arab Light | VLCC |
| Mundra SBM | Panipat (MPPL, secondary) | Novorossiysk (Russia) → Urals | VLCC |
| Paradip SPM | Paradip refinery (PHBPL head) | Basrah (Iraq) → Basrah Heavy | VLCC |
| Haldia jetties | Haldia (draft-limited ~14 m) | Mina al-Ahmadi (Kuwait) → Kuwait Export | Aframax |
| Chennai port | CPCL Manali | Das Island (UAE) → Murban | Suezmax |

- **Public anchors:** refinery locations and processing capacities; the Vadinar / Mundra / Paradip
  SPM–SBM systems and their tank-farm sizes (Vadinar ~1.5 MMT, Mundra ~0.6 MMT, Paradip ~1.1 MMT,
  Haldia LBT ~0.4 MMT); the SMPL / MPPL / PHBPL pipeline topology; Haldia's draft limit; and the
  FY24-25 source slate (Russia ~36% of the national basket, then Iraq, Saudi, UAE, US).
- **Synthetic / calibrated:** monthly per-lane volumes, opening inventories, and the one-grade-per-
  gateway simplification (real refineries blend several crudes). Opening stock is set to roughly the
  time each supply lane takes to replenish, so a fast Gulf-VLCC gateway starts leaner than the slow
  Aframax-Haldia or long-haul Urals lanes — the reason a fresh 30-day plan is feasible at all, and a
  realistic reflection of refineries carrying weeks of crude.
- **Deliberately out of scope:** US Gulf and West African crude (minor, largely delivered-basis) are
  present as source geography in the research but not modeled as IOCL-scheduled tonnage.

## LNG

LNG is regasified, not refined; the terminals are the demand nodes and foreign liquefaction ports
the sources. Modeled on IOCL's ~13.18 MMTPA regas portfolio.

| Terminal | Role | Send-out (modeled) |
|---|---|---|
| Ennore (Kamarajar) | IOCL-owned, 5 MMTPA nameplate, ramping | ~4,700 t/day |
| Dahej | IOCL ~3.75 MMTPA booked (Petronet) | ~7,700 t/day |
| Dhamra | IOCL ~3 MMTPA booked | ~4,800 t/day |
| Kochi | pipeline-constrained, light | ~1,000 t/day |

- **Public anchors:** Ennore ownership and berth spec (362 m LOA, 12.5 m draft, 2×180,000 m³ tanks);
  IOCL's booked capacities at Dahej / Dhamra / Jafrabad / Kochi; long-term SPAs (QatarEnergy via
  Dahej, ADNOC Das Island / Ruwais, Trafigura US-linked); Ennore's low utilisation.
- **Synthetic / calibrated:** monthly cargo counts, opening tank levels, and the split of flexible
  cargoes across terminals. Sources are Ras Laffan (Qatar), Das Island (UAE), Qalhat (Oman) and
  Sabine Pass (US Gulf); cargo parcels span conventional (~72 kt) to Q-Flex (~95 kt).

## Modeling simplifications worth knowing

- **Transit uses great-circle distance** (haversine), with no Suez / landmass routing, so the Russia
  and US hauls read a little shorter than reality. Applied consistently across every stream.
- **Volumes are demo-scaled but proportional** — the relative weight of gateways (Vadinar ≫ Mundra)
  and the supplier mix mirror reality; absolute tonnages are trimmed so the fleet can serve a
  from-empty month without dozens of simultaneous VLCC arrivals.
- **Demand is smoother than real spot-market timing** — steady daily draws rather than lumpy lifts.

## Sourcing

Grounded in two deep-research passes over public IOCL material (refining and gas-business overviews,
crude-pipeline pages), PPAC refinery-capacity tables, DGCI&S crude-import share reporting, and
operator / contract disclosures from Petronet LNG, ADNOC and Trafigura. Company-specific monthly
source-to-refinery matrices are not public; national import shares are used as the directional proxy
and are flagged as such above.
