# Evaluator guide

Marine Scheduler plans coastal marine movements for a refiner's own fleet: which
vessel lifts what, from where, to where, and when — without any shore tank running
dry. Three streams are planned independently (**CRUDE**, **LNG**, **POL**), switched
from the sidebar.

Nothing you do here can break it permanently. Settings → Data administration resets
everything, and every destructive action says what it destroys before doing it.

## Ten minutes, in order

**1. Command Center.** The starting state has master data and a monthly plan but no
voyages. KPIs read zero because nothing has been planned yet.

**2. Operational Plan → Run optimiser.** Watch the console: it runs a seeded
multi-start search and streams its cost trajectory as it converges. POL settles
around ₹916M across 19 voyages. When it finishes you get a Gantt — each bar is one
vessel's voyage, starting in ballast, picking up and dropping off at several ports,
ending empty. Click a voyage for its stowage, leg-by-leg costs and compartment
assignments.

**3. Network Forecast.** Every tank's projected daily stock for the month, with the
dry-out floor and tank-top ceiling drawn on. The plan exists to keep every line
between those two. If a node would have dried out, that is what the voyages are for.

**4. Alerts & Actions.** This is the substantive part — see below.

**5. Cost & Variance.** Baseline versus current plan versus actual, split five ways.
Try **Simulate execution** to generate a month of actuals from the plan with
realistic slippage, then read the variance.

## Disruption scenarios

Alerts & Actions composes a scenario as a **list** of events. Add as many as you
like, of any type, in any combination — several closures and three delayed vessels
in one scenario is a normal thing to build, not an edge case.

| Event | What it tests |
|---|---|
| Demand / production revision | A node's offtake or production changes, for the month or a window of it. Enter absolute, delta or percent. |
| Spot cargo | A one-off extra lifting, or an unexpected receipt, on a single day. |
| Tank outage | A shore tank out of service — it can neither receive nor dispatch. |
| Port / berth disruption | A whole port shut, one berth of several down, or reduced pumping rate. |
| Vessel delay | A hull ready later than planned. Enter as days late, or an absolute readiness day. |
| Vessel off-hire | A hull unavailable across a window (drydock) or the whole month. |

Three buttons, escalating in cost:

- **Check impact** — no re-solve. Re-validates the *existing* plan against the new
  inputs and classifies the response L0–L4: does the plan still hold, and if not how
  large is the repair? Fast, and often the honest answer is "no replan needed."
- **Simulate recovery (draft)** — solves one recovery and saves it as a draft. Your
  operating plan is untouched until you publish.
- **3 candidates** — solves minimal-change, service-protection and lowest-cost
  recoveries side by side, so you choose the trade-off rather than accepting one.

Worth trying deliberately:

- **Two delays on the same vessel.** The scenario summary tells you which one binds
  and why, rather than silently keeping the last.
- **An inverted day range** (to day 21, from day 25). It corrects the range and says
  so instead of quietly doing nothing.
- **One berth down versus the whole port shut.** Different outcomes: a port with two
  jetties absorbs losing one; shutting it entirely makes ships wait at anchorage and
  accrues demurrage.
- **A vessel event on a hull already at sea** at your as-of day. It tells you the
  event only binds from that hull's next voyage, because you cannot recall a ship.
- **Save the scenario**, switch stream, come back and load it.

The as-of day slider matters: voyages already underway before that date are frozen,
and only the future is re-planned. That is what makes a recovery realistic rather
than a clean-sheet re-solve.

## Reading plan versus actual

A **planning period** is a month. Each holds many plan versions and exactly one
**baseline** — the frozen start-of-month plan the month is judged against. The first
plan you publish becomes the baseline automatically; reassign it with Set baseline.

Cost is attributed five ways — bunker, freight/hire, port DA, demurrage, tank
changeover — so variance can be explained rather than just measured. The voyage
reconciliation panel lists the biggest movers, including voyages that were planned
but not executed and unplanned spot fixtures that were.

**Close month** seals the record: a hash chain is written over that month's versions
and actuals, and the rows become immutable at the database level. `GET
/api/ledger/verify` recomputes every digest and walks the chain, so a later edit or
deletion is detectable. You can reopen a month afterwards if you want to keep
planning in it.

## What is real and what is not

The network is grounded in public facts about Indian Oil — refinery locations and
capacities, the Vadinar/Mundra/Paradip SPM systems, pipeline topology, port draft
limits, real vessel classes. Per-lane volumes, tank sizes and opening inventories are
calibrated estimates, because those are not public. `docs/DATA_PROVENANCE.md` is
explicit about which is which.

**Apr–Jun 2026 are illustrative history**, marked as such in the period selector, next
to the period, and in every trend row. They exist so the cost trend is not empty on
first load. They are anchored to a solved July plan so the scale is consistent, but
they are not observed results. Jul 2026 is the live month and everything in it is
genuinely computed.

## If something goes wrong

- **Everything returns an error after you closed a month.** A closed month is frozen
  by design. Cost & Variance → **Reopen for planning**.
- **The version list is full of `scenario:*` drafts.** Each candidate run leaves three
  behind. Replanning Workbench → **Discard N drafts**.
- **You want a clean slate.** Settings → Data administration → type `RESET`. This wipes
  every stream for everyone using the instance, which it tells you before you confirm.
- **First page load is slow.** The deployed demo scales to zero to stay free, so the
  first request after an idle spell waits a few seconds for the container and database
  to wake.

## Honest limits

The planner is a heuristic — seeded multi-start construction plus large-neighbourhood
search — not a proof of optimality. That is deliberate: a monolithic time-space MILP
for a 15-port, 14-grade, 18-vessel month does not solve in reasonable time. We
measured the cost of that choice rather than assuming it: on LNG, where an exact
arc-flow model does fit, a five-minute exact solve found ₹313.0M against the
heuristic's ₹322.1M on a like-for-like cost basis — **about 3%**, and it got there by
lifting only the bare no-stockout requirement with no cover. `npm run gap` and
`npm run exact` reproduce that.

Also deferred, and visible if you look for it: LNG boil-off is not modelled, tidal
windows are treated as a static daily draft rather than sub-daily, and `planLines`
quantities are informational — the solver drives off `nodeFlows` daily rates.

## Under the hood, if you are asked

Single Node process: React and Vite for the client, Express for the API, the planning
engine in TypeScript, and HiGHS compiled to WebAssembly for the LP duals and the
exact model. Postgres throughout — in-process via PGlite for development, a managed
Postgres when deployed, one schema and no dialect drift. Schema changes are committed
migrations, not a boot-time diff.
