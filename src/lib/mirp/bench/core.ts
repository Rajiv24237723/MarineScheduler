/**
 * MIRPLib-style single-product maritime inventory-routing CORE, used to
 * benchmark the engine's heuristic against a provable bound.
 *
 * Scope (honest): MIRPLib instances are deterministic, single-product, deep-sea
 * MIRPs with inventory tracking at every port. This module models that core with
 * an explicit cost objective, so we can measure our heuristic's OPTIMALITY GAP:
 *
 *   lowerBound()  — a valid lower bound on any feasible plan's cost, solved with
 *                   the embedded HiGHS (LP relaxation; MILP with the P2 cut).
 *   construct()   — a feasible plan (upper bound) built with the SAME algorithmic
 *                   family the product engine uses: earliest-dry-out greedy +
 *                   seeded multi-start improvement.
 *   gap = (UB − LB) / LB  is an upper bound on the true optimality gap.
 *
 * The bound only underestimates true cost, so the gap is rigorous even though we
 * never enumerate the exact optimum.
 */

import { LpBuilder, solveLp } from '../../highs';
import { rng } from '../distance';

export interface CorePort {
  id: string;
  kind: 'S' | 'D';   // supply (produces) or demand (consumes)
  rate: number;      // MT/day produced (S) or consumed (D), rate > 0
  init: number;      // opening inventory
  smin: number;      // dry-out floor
  smax: number;      // tank-top ceiling
}
export interface CoreVessel { id: string; cap: number; }
export interface CoreInstance {
  name: string;
  horizon: number;         // planning days
  ports: CorePort[];
  vessels: CoreVessel[];
  travel: number[][];      // integer sail-days, indexed by ports order (symmetric, 0 diagonal)
  charterPerDay: number;   // cost per vessel-day (the objective's unit)
}

// --- Deficits / availabilities (monotone: demand stock falls, supply rises) ---

/** MT that must be delivered to a demand port over the horizon to avoid dry-out. */
export function demandDeficit(p: CorePort, H: number): number {
  return Math.max(0, p.rate * H - (p.init - p.smin));
}
/** MT a supply port can ship over the horizon without breaching its own floor. */
export function supplyAvail(p: CorePort, H: number): number {
  return Math.max(0, (p.init - p.smin) + p.rate * H);
}

const capMaxOf = (inst: CoreInstance) => Math.max(1, ...inst.vessels.map(v => v.cap));

/** minτ to a port = cheapest loaded leg INTO it from any other port (valid floor). */
function minInboundTau(inst: CoreInstance, di: number): number {
  let m = Infinity;
  for (let j = 0; j < inst.ports.length; j++) if (j !== di) m = Math.min(m, inst.travel[j][di]);
  return isFinite(m) ? m : 1;
}

export interface BoundResult { status: 'ok' | 'infeasible'; lb: number; cuts: boolean; }

/**
 * Valid lower bound on plan cost, via HiGHS.
 *  - Every delivered MT to demand d must ride ≥ one loaded leg of ≥ minτ_d days.
 *  - Deliveries to d take ≥ trips_d = deliveredₙ/cap trips (P2: ⌈·⌉, integer).
 *  - Loaded-leg days ≤ total fleet-days available (necessary → cannot cut feasible).
 * With cuts=false trips_d is continuous (LP relaxation); with cuts=true it is
 * integer (the trip-rounding valid inequality), which raises the bound.
 */
export async function lowerBound(inst: CoreInstance, opts: { cuts?: boolean } = {}): Promise<BoundResult> {
  const cuts = !!opts.cuts;
  const H = inst.horizon;
  const cap = capMaxOf(inst);
  const charter = inst.charterPerDay;
  const supplies: number[] = [], demands: number[] = [];
  inst.ports.forEach((p, i) => (p.kind === 'S' ? supplies : demands).push(i));
  const Rd = new Map(demands.map(di => [di, demandDeficit(inst.ports[di], H)]));
  const As = new Map(supplies.map(si => [si, supplyAvail(inst.ports[si], H)]));
  const minTau = new Map(demands.map(di => [di, minInboundTau(inst, di)]));
  const totalR = [...Rd.values()].reduce((a, b) => a + b, 0);
  if (totalR <= 0) return { status: 'ok', lb: 0, cuts };

  const lp = new LpBuilder();
  const fv = (si: number, di: number) => `f_${si}_${di}`;
  const tv = (di: number) => `trips_${di}`;

  lp.setObjective('Minimize', demands.map(di => [charter * minTau.get(di)!, tv(di)] as [number, string]));

  // demand: Σ_s f_sd ≥ Rd
  for (const di of demands) lp.addRow(`dem_${di}`, supplies.map(si => [1, fv(si, di)] as [number, string]), '>=', Rd.get(di)!);
  // supply: Σ_d f_sd ≤ As
  for (const si of supplies) lp.addRow(`sup_${si}`, demands.map(di => [1, fv(si, di)] as [number, string]), '<=', As.get(si)!);
  // trips: cap·trips_d − Σ_s f_sd ≥ 0
  for (const di of demands)
    lp.addRow(`trip_${di}`, [[cap, tv(di)], ...supplies.map(si => [-1, fv(si, di)] as [number, string])], '>=', 0);
  // fleet: Σ_d minτ_d·trips_d ≤ |V|·H  (loaded-leg days ≤ fleet-days)
  lp.addRow('fleet', demands.map(di => [minTau.get(di)!, tv(di)] as [number, string]), '<=', inst.vessels.length * H);

  if (cuts) for (const di of demands) lp.general(tv(di));

  let sol;
  try { sol = await solveLp(lp.build()); } catch { return { status: 'infeasible', lb: 0, cuts }; }
  if (sol.Status !== 'Optimal') return { status: 'infeasible', lb: 0, cuts };
  return { status: 'ok', lb: sol.ObjectiveValue, cuts };
}

// --- Heuristic upper bound (earliest-dry-out greedy + seeded multi-start) ------

interface Delivery { supply: number; demand: number; loadDay: number; arriveDay: number; qty: number; }
export interface PlanResult { feasible: boolean; cost: number; vesselDays: number; deliveries: Delivery[]; note: string; }

/** Stock at a port on `day` given committed loads/discharges (deltas by arrive/load day). */
function stockAt(p: CorePort, day: number, deltas: Array<{ day: number; qty: number }>): number {
  let s = p.init + (p.kind === 'S' ? p.rate : -p.rate) * day;
  for (const d of deltas) if (d.day <= day) s += d.qty;
  return s;
}

/** One greedy construction with a given RNG (tie-break perturbation). */
function constructOnce(inst: CoreInstance, rand: () => number): PlanResult {
  const H = inst.horizon, cap0 = capMaxOf(inst);
  const supplies: number[] = [], demands: number[] = [];
  inst.ports.forEach((p, i) => (p.kind === 'S' ? supplies : demands).push(i));
  const deltas = new Map<number, Array<{ day: number; qty: number }>>();
  inst.ports.forEach((_, i) => deltas.set(i, []));
  // vessels start at the largest supply, empty, free on day 0
  const startSupply = supplies.slice().sort((a, b) => supplyAvail(inst.ports[b], H) - supplyAvail(inst.ports[a], H))[0] ?? 0;
  const vessels = inst.vessels.map(v => ({ cap: v.cap, pos: startSupply, freeDay: 0 }));
  const deliveries: Delivery[] = [];
  let vesselDays = 0;

  const firstDryOut = (di: number): number | null => {
    const p = inst.ports[di];
    for (let d = 0; d <= H; d++) if (stockAt(p, d, deltas.get(di)!) < p.smin - 1e-6) return d;
    return null;
  };

  for (let guard = 0; guard < 100000; guard++) {
    // earliest-dry-out demand (random tie-break)
    let target = -1, crit = Infinity;
    for (const di of demands) {
      const d = firstDryOut(di);
      if (d === null) continue;
      if (d < crit - 1e-9 || (Math.abs(d - crit) < 1e-9 && rand() < 0.5)) { crit = d; target = di; }
    }
    if (target < 0) break; // no dry-out → feasible

    // best (vessel, supply): soonest arrival that beats the dry-out day
    let best: { vi: number; si: number; loadDay: number; arriveDay: number; qty: number } | null = null;
    for (let vi = 0; vi < vessels.length; vi++) {
      const v = vessels[vi];
      for (const si of supplies) {
        const loadDay = v.freeDay + inst.travel[v.pos][si];
        const arriveDay = loadDay + inst.travel[si][target];
        if (arriveDay > crit || arriveDay > H) continue;
        const sp = inst.ports[si], dp = inst.ports[target];
        const supAvail = stockAt(sp, loadDay, deltas.get(si)!) - sp.smin;
        const ullage = dp.smax - stockAt(dp, arriveDay, deltas.get(target)!);
        const need = demandDeficit(dp, H) + Math.max(0, dp.smin - stockAt(dp, H, deltas.get(target)!));
        const qty = Math.min(v.cap, Math.max(0, supAvail), Math.max(0, ullage), Math.max(1, need));
        if (qty <= 0) continue;
        const better = !best || arriveDay < best.arriveDay - 1e-9 ||
          (Math.abs(arriveDay - best.arriveDay) < 1e-9 && rand() < 0.5);
        if (better) best = { vi, si, loadDay, arriveDay, qty };
      }
    }
    if (!best) return { feasible: false, cost: Infinity, vesselDays, deliveries, note: `no vessel can serve port ${inst.ports[target].id} before day ${crit}` };

    const v = vessels[best.vi];
    vesselDays += inst.travel[v.pos][best.si] + inst.travel[best.si][target];
    deltas.get(best.si)!.push({ day: best.loadDay, qty: -best.qty });      // load removes at supply
    deltas.get(target)!.push({ day: best.arriveDay, qty: best.qty });       // discharge adds at demand
    v.pos = target; v.freeDay = best.arriveDay;
    deliveries.push({ supply: best.si, demand: target, loadDay: best.loadDay, arriveDay: best.arriveDay, qty: best.qty });
  }

  // independent feasibility re-check (mirrors validate.ts): no stock-out / tank-top anywhere
  for (let i = 0; i < inst.ports.length; i++) {
    const p = inst.ports[i];
    for (let d = 0; d <= H; d++) {
      const s = stockAt(p, d, deltas.get(i)!);
      if (s < p.smin - 1e-6) return { feasible: false, cost: Infinity, vesselDays, deliveries, note: `dry-out at ${p.id} day ${d}` };
      if (s > p.smax + 1e-6) return { feasible: false, cost: Infinity, vesselDays, deliveries, note: `tank-top at ${p.id} day ${d}` };
    }
  }
  return { feasible: true, cost: vesselDays * inst.charterPerDay, vesselDays, deliveries, note: 'feasible' };
}

/** Multi-start construction (GRASP-style): keep the cheapest feasible plan. */
export function construct(inst: CoreInstance, opts: { seed?: number; restarts?: number } = {}): PlanResult {
  const restarts = opts.restarts ?? 24;
  let best: PlanResult | null = null;
  for (let r = 0; r < restarts; r++) {
    const res = constructOnce(inst, rng((opts.seed ?? 1) + r * 7919));
    if (res.feasible && (!best || res.cost < best.cost)) best = res;
  }
  return best ?? constructOnce(inst, rng(opts.seed ?? 1));
}

export interface BenchResult {
  name: string;
  lbRelax: number;      // P1 LP relaxation bound
  lbCut: number;        // P2 MILP bound (trip-rounding valid inequality)
  ub: number;           // heuristic feasible cost
  feasible: boolean;
  gapRelaxPct: number;  // (UB − LB_relax) / LB_relax
  gapCutPct: number;    // (UB − LB_cut)   / LB_cut   ← the credible gap
  note: string;
}

/** Full benchmark for one instance: bound (P1), tightened bound (P2), heuristic UB, gaps. */
export async function benchmark(inst: CoreInstance, seed = 1): Promise<BenchResult> {
  const relax = await lowerBound(inst, { cuts: false });
  const cut = await lowerBound(inst, { cuts: true });
  const plan = construct(inst, { seed });
  const gap = (ub: number, lb: number) => (lb > 1e-9 && isFinite(ub)) ? ((ub - lb) / lb) * 100 : NaN;
  return {
    name: inst.name,
    lbRelax: relax.lb, lbCut: cut.lb, ub: plan.cost, feasible: plan.feasible,
    gapRelaxPct: gap(plan.cost, relax.lb), gapCutPct: gap(plan.cost, cut.lb),
    note: relax.status !== 'ok' ? 'bound infeasible (fleet/supply short)' : plan.note,
  };
}
