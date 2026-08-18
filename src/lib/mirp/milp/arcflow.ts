import { EngineInput, Voyage, Stop, Op, Leg } from '../types';
import { InventoryModel } from '../inventory';
import { haversineNm, sailDays, dailyBunkerMt } from '../distance';
import { Model, SolveOptions, SolveOutcome, getBackend } from '../../opt';

/**
 * Exact arc-flow MIRP over a time-space network.
 *
 * This is the formulation the aggregated bound cannot be: vessel flow conservation
 * forces a hull to actually be somewhere on every day, so positioning legs and
 * hull-days are priced rather than wished away. That is what makes its LP
 * relaxation a bound worth quoting, and its MIP solution a plan worth publishing.
 *
 * Variables
 *   x[v,i,j,t]  1 if vessel v departs i for j on day t (arrives t + τ)
 *   w[v,i,t]    1 if vessel v is alongside/idle at i on day t
 *   c[v,i,t]    1 if v makes a cargo call at i on day t (drives port DA)
 *   l/d[v,i,p,t] load / discharge quantity
 *   o[v,p,t]    quantity of p aboard v at end of day t
 *   s[i,p,t]    shore stock
 *   u[i,p]      unmet floor at a node, heavily penalised
 *
 * It grows as |V|·|I|²·|T|, so it does not fit every instance. `formulate` reports
 * its size and `solveArcFlow` refuses anything past a guard rather than wedging a
 * WASM solver — for those, use the bound in bound.ts.
 */

const BUNKER_USD_PER_MT = 600, INR = 83, PORT_CALL_USD = 50000;
const UNSERVED_PENALTY = 500_000 * INR;   // per MT — dominates any routing saving
/** Above this many binaries, an in-process WASM solve is not a sensible use of time. */
export const ARCFLOW_BINARY_GUARD = 40_000;

export interface ArcFlowModel {
  model: Model;
  meta: {
    ports: string[]; products: string[]; vessels: string[]; horizon: number;
    arcs: number;
    tau: Map<string, number>;          // `v|i|j` -> sail days
    capOf: Map<string, number>;        // vessel -> total compartment capacity
    size: ReturnType<Model['size']>;
  };
}

const key = (...p: (string | number)[]) => p.join('|');

export function formulate(input: EngineInput): ArcFlowModel {
  const H = input.horizonDays;
  const inv = new InventoryModel(input);
  const locById = new Map(input.locations.map(l => [l.id, l]));

  // Only nodes that hold stock matter; a port with no tank cannot load or discharge.
  const nodeKeys = new Set(input.tanks.map(t => key(t.locationId, t.productId)));
  const ports = [...new Set(input.tanks.map(t => t.locationId))];
  const products = [...new Set(input.tanks.map(t => t.productId))];
  const vessels = input.vessels.filter(v => !(input.options?.excludeVessels ?? []).includes(v.id));

  const capOf = new Map(vessels.map(v => [v.id, v.compartments.reduce((a, c) => a + c.cap, 0)]));
  const tau = new Map<string, number>();
  for (const v of vessels) for (const i of ports) for (const j of ports) {
    if (i === j) continue;
    const a = locById.get(i), b = locById.get(j);
    if (a && b) tau.set(key(v.id, i, j), sailDays(haversineNm(a, b), v.speed));
  }

  // Node roles: a net producer can load, a net consumer must receive.
  const role = new Map<string, 'SUPPLY' | 'DEMAND'>();
  for (const t of input.tanks) {
    const n = inv.node(t.locationId, t.productId);
    role.set(key(t.locationId, t.productId), (n && n.netDaily < 0) ? 'DEMAND' : 'SUPPLY');
  }
  const isSupplyPort = (i: string) => products.some(p => role.get(key(i, p)) === 'SUPPLY');
  const isDemandPort = (i: string) => products.some(p => role.get(key(i, p)) === 'DEMAND');

  const m = new Model('MIN');
  let arcs = 0;

  // --- vessel movement ------------------------------------------------------
  for (const v of vessels) {
    const cap = capOf.get(v.id)!;
    const bunkerPerNm = dailyBunkerMt(v.speed) / (24 * v.speed) * BUNKER_USD_PER_MT * INR;
    const hirePerDay = (v.pool === 'SPOT' ? 0 : (v.charterCost || 15000)) * INR;

    for (let t = 0; t <= H; t++) for (const i of ports) {
      m.v(key('w', v.id, i, t), { kind: 'BIN' });
      m.v(key('c', v.id, i, t), { kind: 'BIN', obj: PORT_CALL_USD * INR });
    }
    for (let t = 0; t <= H; t++) for (const i of ports) for (const j of ports) {
      if (i === j) continue;
      // Prune arcs that cannot serve cargo: a laden run goes supply → demand, a
      // ballast run demand → supply. Supply → supply is never useful here.
      if (isSupplyPort(i) && isSupplyPort(j) && !isDemandPort(j)) continue;
      const τ = tau.get(key(v.id, i, j))!;
      if (t + τ > H) continue;
      const a = locById.get(i)!, b = locById.get(j)!;
      const nm = haversineNm(a, b);
      m.v(key('x', v.id, i, j, t), { kind: 'BIN', obj: nm * bunkerPerNm + hirePerDay * τ });
      arcs++;
    }

    // Starts at exactly one port, on day 0.
    m.row(key('start', v.id), ports.map(i => [1, key('w', v.id, i, 0)] as [number, string]), '=', 1);
    // Cannot be in two places at once.
    for (let t = 0; t <= H; t++) {
      m.row(key('one', v.id, t), ports.map(i => [1, key('w', v.id, i, t)] as [number, string]), '<=', 1);
    }
    // Position conservation: staying put, minus departures, plus arrivals.
    for (let t = 0; t < H; t++) for (const i of ports) {
      const terms: Array<[number, string]> = [[1, key('w', v.id, i, t + 1)], [-1, key('w', v.id, i, t)]];
      for (const j of ports) {
        if (j === i) continue;
        if (m.has(key('x', v.id, i, j, t))) terms.push([1, key('x', v.id, i, j, t)]);
        const τ = tau.get(key(v.id, j, i))!;
        const dep = t + 1 - τ;
        if (dep >= 0 && m.has(key('x', v.id, j, i, dep))) terms.push([-1, key('x', v.id, j, i, dep)]);
      }
      m.row(key('pos', v.id, i, t), terms, '=', 0);
    }
    // A departure requires being there.
    for (let t = 0; t <= H; t++) for (const i of ports) for (const j of ports) {
      if (i === j || !m.has(key('x', v.id, i, j, t))) continue;
      m.row(key('dep', v.id, i, j, t), [[1, key('x', v.id, i, j, t)], [-1, key('w', v.id, i, t)]], '<=', 0);
    }

    // --- cargo aboard -------------------------------------------------------
    for (const p of products) for (let t = 0; t <= H; t++) {
      m.v(key('o', v.id, p, t), { lo: 0, hi: cap });
      if (nodeKeys.size) for (const i of ports) {
        if (nodeKeys.has(key(i, p))) {
          m.v(key('l', v.id, i, p, t), { lo: 0, hi: cap });
          m.v(key('d', v.id, i, p, t), { lo: 0, hi: cap });
        }
      }
    }
    for (const p of products) {
      m.row(key('o0', v.id, p), [[1, key('o', v.id, p, 0)]], '=', 0);   // arrives in ballast
      m.row(key('oH', v.id, p), [[1, key('o', v.id, p, H)]], '=', 0);   // and leaves empty
      for (let t = 1; t <= H; t++) {
        const terms: Array<[number, string]> = [[1, key('o', v.id, p, t)], [-1, key('o', v.id, p, t - 1)]];
        for (const i of ports) {
          if (!nodeKeys.has(key(i, p))) continue;
          terms.push([-1, key('l', v.id, i, p, t)], [1, key('d', v.id, i, p, t)]);
        }
        m.row(key('ob', v.id, p, t), terms, '=', 0);
      }
    }
    // Total aboard within capacity.
    for (let t = 0; t <= H; t++) {
      m.row(key('cap', v.id, t), products.map(p => [1, key('o', v.id, p, t)] as [number, string]), '<=', cap);
    }
    // Cargo only moves while alongside, and any movement is a port call.
    for (let t = 0; t <= H; t++) for (const i of ports) {
      const ops: Array<[number, string]> = [];
      for (const p of products) {
        if (!nodeKeys.has(key(i, p))) continue;
        ops.push([1, key('l', v.id, i, p, t)], [1, key('d', v.id, i, p, t)]);
      }
      if (!ops.length) continue;
      m.row(key('along', v.id, i, t), [...ops, [-cap, key('w', v.id, i, t)]], '<=', 0);
      m.row(key('call', v.id, i, t), [...ops, [-cap, key('c', v.id, i, t)]], '<=', 0);
    }
    // Draft: a port admits only so much cargo aboard.
    for (const i of ports) {
      const berths = input.berths.filter(b => b.locationId === i);
      if (!berths.length) continue;
      const maxDraft = Math.max(...berths.map(b => b.maxDraft));
      if (v.draftBallast > maxDraft) {
        for (let t = 0; t <= H; t++) m.row(key('nodraft', v.id, i, t), [[1, key('w', v.id, i, t)]], '=', 0);
        continue;
      }
      if (v.draftLaden <= maxDraft) continue;   // admissible fully laden
      const frac = (maxDraft - v.draftBallast) / Math.max(1e-6, v.draftLaden - v.draftBallast);
      const allowed = Math.max(0, Math.min(cap, cap * frac));
      for (let t = 0; t <= H; t++) {
        m.row(key('draft', v.id, i, t),
          [...products.map(p => [1, key('o', v.id, p, t)] as [number, string]), [cap - allowed, key('w', v.id, i, t)]],
          '<=', cap);
      }
    }
  }

  // --- shore inventory ------------------------------------------------------
  for (const tk of input.tanks) {
    const i = tk.locationId, p = tk.productId;
    const n = inv.node(i, p)!;
    const u = m.v(key('u', i, p), { lo: 0, obj: UNSERVED_PENALTY });
    for (let t = 0; t <= H; t++) m.v(key('s', i, p, t), { lo: 0, hi: tk.capacity });
    m.row(key('s0', i, p), [[1, key('s', i, p, 0)]], '=', tk.currentStock);
    for (let t = 1; t <= H; t++) {
      // Exogenous movement for the day comes from the projection's own net rate.
      const net = inv.stockAt(i, p, t) - inv.stockAt(i, p, t - 1);
      const terms: Array<[number, string]> = [[1, key('s', i, p, t)], [-1, key('s', i, p, t - 1)]];
      for (const v of vessels) {
        if (!m.has(key('d', v.id, i, p, t))) continue;
        terms.push([-1, key('d', v.id, i, p, t)], [1, key('l', v.id, i, p, t)]);
      }
      m.row(key('sb', i, p, t), terms, '=', net);
      // Floor is soft only through the penalised shortfall.
      m.row(key('floor', i, p, t), [[1, key('s', i, p, t)], [1, u]], '>=', tk.minStock);
    }
    void n;
  }

  // --- berth capacity -------------------------------------------------------
  for (const i of ports) {
    const berths = input.berths.filter(b => b.locationId === i);
    if (!berths.length) continue;
    const base = berths.reduce((a, b) => a + b.nsim, 0);
    for (let t = 0; t <= H; t++) {
      // Honour scenario closures: a shut port has no slots that day.
      let slots = base;
      for (const c of input.options?.portClosures ?? []) {
        if (c.locationId !== i || t < c.fromDay || t > c.toDay) continue;
        if (c.capacityPct != null) continue;
        if (!c.berthId) { slots = 0; break; }
        slots -= berths.find(b => b.id === c.berthId)?.nsim ?? slots;
      }
      m.row(key('berth', i, t), vessels.map(v => [1, key('c', v.id, i, t)] as [number, string]), '<=', Math.max(0, slots));
    }
  }

  return {
    model: m,
    meta: { ports, products, vessels: vessels.map(v => v.id), horizon: H, arcs, tau, capOf, size: m.size() },
  };
}

export interface ArcFlowResult {
  status: SolveOutcome['status'];
  objective: number | null;
  bound: number | null;
  gapPct: number | null;
  proven: boolean;
  voyages: Voyage[];
  unservedMt: number;
  size: ReturnType<Model['size']>;
  solver: string;
  wallMs: number;
  skipped?: string;
  message?: string;
}

/** Solve exactly (or bound, with relaxIntegrality) and decode into voyages. */
export async function solveArcFlow(input: EngineInput, opts: SolveOptions & { force?: boolean } = {}): Promise<ArcFlowResult> {
  const built = formulate(input);
  const size = built.meta.size;
  if (!opts.force && size.binaries > ARCFLOW_BINARY_GUARD) {
    return {
      status: 'ERROR', objective: null, bound: null, gapPct: null, proven: false,
      voyages: [], unservedMt: 0, size, solver: 'none', wallMs: 0,
      skipped: `${size.binaries.toLocaleString()} binaries exceeds the ${ARCFLOW_BINARY_GUARD.toLocaleString()} guard for an in-process solve`,
      message: 'Instance too large for the exact model here — use the aggregated bound, or point SOLVER_URL at a licensed solver and pass force.',
    };
  }
  const backend = await getBackend();
  const out = await backend.solve(built.model, opts);
  const voyages = out.status === 'INFEASIBLE' || out.status === 'ERROR' ? [] : decode(input, built, out);
  let unservedMt = 0;
  for (const t of input.tanks) unservedMt += out.values[key('u', t.locationId, t.productId)] ?? 0;
  return {
    status: out.status, objective: out.objective, bound: out.bound, gapPct: out.gapPct,
    proven: out.proven, voyages, unservedMt: Math.round(unservedMt), size,
    solver: out.solver, wallMs: out.wallMs, message: out.message,
  };
}

/**
 * Split a parcel across compartments so no single op exceeds a compartment's
 * capacity. A remainder means the quantity the model chose cannot physically be
 * stowed, which the caller reports as a non-implementable solution.
 */
function pack(compartments: { id: string; cap: number }[], productId: string, qty: number, op: 'LOAD' | 'DISCHARGE'): Op[] {
  const out: Op[] = [];
  let left = qty;
  for (const c of compartments) {
    if (left <= 0) break;
    const take = Math.min(left, c.cap);
    if (take > 0) { out.push({ op, productId, qty: Math.round(take), compartmentId: c.id }); left -= take; }
  }
  if (left > 1 && compartments.length) {
    // Overflow: attribute it to the last compartment so the validator sees the breach
    // rather than the quantity silently vanishing from the plan.
    out.push({ op, productId, qty: Math.round(left), compartmentId: compartments[compartments.length - 1].id });
  }
  return out;
}

/** Walk each vessel's chosen arcs into a voyage: ballast out, cargo calls, ends empty. */
function decode(input: EngineInput, built: ArcFlowModel, out: SolveOutcome): Voyage[] {
  const { ports, products, horizon: H, tau } = built.meta;
  const on = (n: string) => (out.values[n] ?? 0) > 0.5;
  const qty = (n: string) => out.values[n] ?? 0;
  const locById = new Map(input.locations.map(l => [l.id, l]));
  const voyages: Voyage[] = [];

  for (const v of input.vessels) {
    if (!built.meta.vessels.includes(v.id)) continue;
    // Days on which this hull did cargo work, and where.
    const stops: Stop[] = [];
    let seq = 0;
    for (let t = 0; t <= H; t++) for (const i of ports) {
      // The model tracks only total cargo aboard, not which compartment holds what,
      // so a parcel has to be packed across compartments here. If it will not fit,
      // the solution is not implementable — recorded rather than papered over.
      const ops: Op[] = [];
      for (const p of products) {
        const l = qty(key('l', v.id, i, p, t)), d = qty(key('d', v.id, i, p, t));
        if (l > 1) ops.push(...pack(v.compartments, p, Math.round(l), 'LOAD'));
        if (d > 1) ops.push(...pack(v.compartments, p, Math.round(d), 'DISCHARGE'));
      }
      if (!ops.length) continue;
      const kinds = new Set(ops.map(o => o.op));
      stops.push({
        seq: seq++, locationId: i, arriveDay: t, departDay: t,
        kind: kinds.size > 1 ? 'LOAD_DISCHARGE' : (kinds.has('LOAD') ? 'LOAD' : 'DISCHARGE'),
        ops,
      });
    }
    if (!stops.length) continue;

    const legs: Leg[] = [];
    for (let t = 0; t <= H; t++) for (const i of ports) for (const j of ports) {
      if (i === j || !on(key('x', v.id, i, j, t))) continue;
      const a = locById.get(i), b = locById.get(j);
      legs.push({
        fromLoc: i, toLoc: j, departDay: t, arriveDay: t + (tau.get(key(v.id, i, j)) ?? 1),
        // A leg is ballast when nothing is aboard on departure.
        ballast: products.every(p => qty(key('o', v.id, p, t)) < 1),
        distanceNm: a && b ? Math.round(haversineNm(a, b)) : 0,
      });
    }
    legs.sort((x, y) => x.departDay - y.departDay);

    const startDay = Math.min(...stops.map(s => s.arriveDay), ...legs.map(l => l.departDay));
    const endDay = Math.max(...stops.map(s => s.departDay), ...legs.map(l => l.arriveDay));
    // Re-price with the engine's cost model, not the MILP objective's.
    //
    // The objective charges hire only on sailing arcs, which understates it: a hull
    // on time charter is paid for every day it is committed, port days included.
    // Comparing the raw objective against a heuristic plan that does charge those
    // days would flatter the MILP. Costing the decoded plan the way the engine costs
    // its own makes the two numbers mean the same thing.
    const bunkerPerNm = dailyBunkerMt(v.speed) / (24 * v.speed) * BUNKER_USD_PER_MT * INR;
    const bunker = legs.reduce((s, l) => s + l.distanceNm * bunkerPerNm, 0);
    const committedDays = Math.max(1, endDay - startDay + 1);
    const lifted = stops.reduce((s, st) => s + st.ops.reduce((a, o) => a + (o.op === 'DISCHARGE' ? o.qty : 0), 0), 0);
    const freight = v.pool === 'SPOT' ? v.voyageRate * lifted * INR : (v.charterCost || 15000) * committedDays * INR;
    const portDA = stops.length * PORT_CALL_USD * INR;
    const costBreakdown = { bunker: Math.round(bunker), freight: Math.round(freight), portDA, demurrage: 0, changeover: 0 };

    voyages.push({
      id: `milp_${v.id}`, stream: input.stream, vesselId: v.id, vesselName: v.name,
      vesselClass: v.class, pool: v.pool, startDay, endDay, stops, legs,
      cost: Object.values(costBreakdown).reduce((a, b) => a + b, 0), costBreakdown,
    });
  }
  return voyages;
}
