# MIRPLib benchmark harness (`bench/`)

Benchmarks the engine's heuristic against a provable bound, using the embedded
HiGHS, on MIRPLib-style **single-product, deep-sea** maritime inventory-routing
instances (Papageorgiou et al., <https://mirplib.scl.gatech.edu>).

## What's here

| File | Role |
|------|------|
| `core.ts` | Single-product MIRP core: `lowerBound()` (P1 LP bound + P2 cut), `construct()` (heuristic UB), `benchmark()` (gap). |
| `instances.ts` | Small hand-built demo instances. |
| `generate.ts` | Seeded instance generator (P3). |
| `run.ts` | P1 runner → prints the gap table (`npm run bench`). |
| `regression.ts` | P3 suite → feasibility + determinism + validity gates (`npm run bench:test`). |

## The three pieces

- **P1 — bound + gap.** `lowerBound()` builds a valid lower bound on plan cost
  (every delivered MT rides ≥ one loaded leg of ≥ `minτ` days; loaded-leg days ≤
  fleet-days) and solves it with HiGHS. `construct()` builds a feasible plan
  (earliest-dry-out greedy + seeded multi-start — the engine's own algorithmic
  family) for the upper bound. `gap = (UB − LB)/LB` upper-bounds the true
  optimality gap.
- **P2 — tighter formulation.** The trip-rounding **valid inequality**
  (`trips_d ≥ ⌈deficit_d / capacity⌉`, integer) raises the bound —
  `lowerBound({cuts:true})` vs the LP relaxation.
- **P3 — generator + regression.** `generateInstance(seed)` emits reproducible
  instances; `regression.ts` hard-asserts feasibility, `LB ≤ UB`, and
  determinism across a seeded suite (exits non-zero on any failure) and reports
  the gap distribution.

## Honest scope

The bound underestimates true cost (it omits ballast/return legs), so the gap is
**rigorous but loose** — it never understates sub-optimality; treat it as an
internal quality-and-regression signal, not a customer-facing number. MIRPLib is
single-product deep-sea, so this validates the engine's inventory-routing
*core*, not the product's coastal extensions (multi-product compartments,
berth/draft/tide, spot charters, rolling replan). The heuristic here is the
engine's *algorithmic family*, not the literal production solve (which optimises
a richer objective this stylised bound can't represent).

## Run

```bash
npm run bench        # P1 gap table (+ P2 tightened bound)
npm run bench:test   # P3 regression suite
```
