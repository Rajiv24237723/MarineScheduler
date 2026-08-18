import { EngineInput } from '../types';
import { InventoryModel } from '../inventory';
import { haversineNm, dailyBunkerMt } from '../distance';
import { Model, SolveOptions, getBackend } from '../../opt';

/**
 * A provable lower bound on the cost of ANY feasible plan for the real network.
 *
 * The arc-flow MILP does not fit at POL scale, so the bound aggregates: it drops
 * routing and sequencing and keeps only what every feasible plan must pay. Each
 * coefficient is deliberately an under-charge, which is what makes the result a
 * floor rather than an estimate:
 *
 *  - laden distance into a destination is the *closest* source's distance, so
 *    consolidating several drops onto one voyage can never beat it
 *  - bunker is priced at the slowest speed any hull can steam (bunker rises with
 *    the square of speed, so slow is cheap)
 *  - freight per trip is the cheaper of (cheapest daily hire × fewest sail days)
 *    and (cheapest spot rate × the minimum parcel a trip can carry)
 *  - one port call per trip, the discharge — load calls can be shared, so they
 *    are not charged
 *  - demurrage and tank changeover are not charged at all
 *
 * It also charges ballast repositioning, which the MIRPLib-style bench bound
 * omits: every trip beyond the first per hull must be reached by a ballast leg of
 * at least the network's shortest discharge-to-load hop.
 *
 * Integer trip counts (`n`) give the trip-rounding strengthening: delivering
 * 41 kt on a lane whose largest admissible parcel is 40 kt costs two voyages,
 * not 1.025.
 */

const BUNKER_USD_PER_MT = 600, INR = 83, PORT_CALL_USD = 50000;
const SPEED_FLOOR = 0.85;
const MIN_PARCEL = 2000;
/** Bunker MT per nautical mile at speed v: dailyBunkerMt(v) / (24v). */
const bunkerMtPerNm = (v: number) => dailyBunkerMt(v) / (24 * Math.max(v, 1));

export interface BoundBreakdown { bunkerLaden: number; bunkerBallast: number; freight: number; portDA: number }

export interface BoundResult {
  /** LP relaxation of the aggregated model. */
  lpBound: number | null;
  /** Same model with integer trip counts — the tighter, still-valid floor. */
  mipBound: number | null;
  /** Whichever bound is strongest and valid. */
  bound: number | null;
  proven: boolean;
  status: string;
  solver: string;
  wallMs: number;
  /** Total MT that must be delivered for no node to dry out. */
  requiredMt: number;
  /** Minimum number of loaded voyages implied by trip rounding. */
  minTrips: number | null;
  breakdown: BoundBreakdown | null;
  size: { vars: number; binaries: number; integers: number; rows: number };
  /** Everything the bound deliberately leaves out, so the number is not over-read. */
  omits: string[];
  message?: string;
}

export interface GapReport extends BoundResult {
  /** Cost of the incumbent plan (the heuristic's) — an upper bound. */
  incumbent: number | null;
  /** (incumbent − bound) / bound, as a percentage. Upper-bounds the true gap. */
  gapPct: number | null;
  /** Most that could still be saved, in absolute terms. */
  headroom: number | null;
}

/** Nodes that must receive cargo, and how much, over the horizon. */
function requirements(input: EngineInput, inv: InventoryModel) {
  const H = input.horizonDays;
  const need: { loc: string; product: string; mt: number }[] = [];
  const supply: { loc: string; product: string; mt: number }[] = [];
  for (const t of input.tanks) {
    const n = inv.node(t.locationId, t.productId);
    if (!n) continue;
    if (n.netDaily < 0) {
      const mt = Math.max(0, n.smin - inv.stockAt(t.locationId, t.productId, H));
      if (mt > 0) need.push({ loc: t.locationId, product: t.productId, mt });
    } else {
      const mt = Math.max(0, inv.stockAt(t.locationId, t.productId, H) - n.smin);
      if (mt > 0) supply.push({ loc: t.locationId, product: t.productId, mt });
    }
  }
  return { need, supply };
}

export async function computeBound(input: EngineInput, opts: SolveOptions = {}): Promise<BoundResult> {
  const inv = new InventoryModel(input);
  const H = input.horizonDays;
  const locById = new Map(input.locations.map(l => [l.id, l]));
  const { need, supply } = requirements(input, inv);
  const requiredMt = Math.round(need.reduce((s, n) => s + n.mt, 0));

  const omits = [
    'demurrage', 'tank changeover', 'load-port calls (shareable)',
    'voyage sequencing and multi-stop routing', 'berth queueing delay',
  ];

  const emptySize = { vars: 0, binaries: 0, integers: 0, rows: 0 };
  if (!need.length) {
    return {
      lpBound: 0, mipBound: 0, bound: 0, proven: true, status: 'TRIVIAL', solver: 'none', wallMs: 0,
      requiredMt: 0, minTrips: 0, breakdown: { bunkerLaden: 0, bunkerBallast: 0, freight: 0, portDA: 0 },
      size: emptySize, omits, message: 'No node dries out over the horizon, so no lift is required.',
    };
  }

  const dests = [...new Set(need.map(n => n.loc))];
  const srcs = [...new Set(supply.map(s => s.loc))];
  if (!srcs.length) {
    return {
      lpBound: null, mipBound: null, bound: null, proven: false, status: 'INFEASIBLE', solver: 'none', wallMs: 0,
      requiredMt, minTrips: null, breakdown: null, size: emptySize, omits,
      message: 'No node has liftable surplus, so the requirement cannot be met from within the network at any cost.',
    };
  }

  // Fleet parameters. Speeds bracket the bunker charge; hire and spot rates
  // bracket the freight charge.
  const fleet = input.vessels;
  const owned = fleet.filter(v => v.pool !== 'SPOT');
  const spot = fleet.filter(v => v.pool === 'SPOT');
  const slowest = Math.max(1, Math.min(...fleet.map(v => v.speed)) * SPEED_FLOOR);
  const fastest = Math.max(...fleet.map(v => v.speed), 1);
  const cheapestHire = owned.length ? Math.min(...owned.map(v => v.charterCost || 15000)) : Infinity;
  const cheapestSpotRate = spot.length ? Math.min(...spot.map(v => v.voyageRate).filter(r => r > 0)) : Infinity;
  const capOf = (v: typeof fleet[number]) => v.compartments.reduce((a, c) => a + c.cap, 0);
  const biggestCap = Math.max(...fleet.map(capOf), MIN_PARCEL);
  const fleetDays = fleet.length * H;

  /** Largest parcel that can physically be discharged at d (draft-admissible hull). */
  const laneCap = (d: string) => {
    const berths = input.berths.filter(b => b.locationId === d);
    const maxDraft = berths.length ? Math.max(...berths.map(b => b.maxDraft)) : Infinity;
    const admissible = fleet.filter(v => v.draftLaden <= maxDraft + 1e-6);
    return Math.max(MIN_PARCEL, admissible.length ? Math.max(...admissible.map(capOf)) : biggestCap);
  };

  /** Shortest laden approach to d from any source — safe under consolidation. */
  const minNmTo = (d: string) => {
    const dl = locById.get(d); if (!dl) return 10;
    return Math.min(...srcs.map(s => { const sl = locById.get(s); return sl ? haversineNm(sl, dl) : Infinity; }));
  };
  /** Shortest ballast hop from any discharge point back to any load point. */
  const minBallastNm = (() => {
    let m = Infinity;
    for (const d of dests) for (const s of srcs) {
      const dl = locById.get(d), sl = locById.get(s);
      if (dl && sl) m = Math.min(m, haversineNm(dl, sl));
    }
    return isFinite(m) ? m : 10;
  })();

  const model = new Model('MIN');
  const bunkerPerNm = bunkerMtPerNm(slowest) * BUNKER_USD_PER_MT * INR;

  // Per-trip floors (bunker, port DA) indexed by destination. Freight is charged
  // per MT instead: a trip is either on hire — costing at least the daily rate over
  // laden days plus a day alongside at each end, spread over the largest parcel it
  // could carry — or on the spot market at the cheapest rate per MT. The lower of
  // those two per-MT rates is a valid floor whichever way the trip is actually fixed.
  const tripCost = new Map<string, { total: number; bunker: number; portDA: number; freightPerMt: number }>();
  for (const d of dests) {
    const nm = minNmTo(d);
    const bunker = nm * bunkerPerNm;
    const ladenDays = Math.max(1, Math.ceil(nm / (fastest * 24)));
    const hullDays = ladenDays + 2;                 // ≥1 day alongside to load, ≥1 to discharge
    const cap = laneCap(d);
    const hirePerMt = isFinite(cheapestHire) ? (cheapestHire * hullDays * INR) / cap : Infinity;
    const spotPerMt = isFinite(cheapestSpotRate) ? cheapestSpotRate * INR : Infinity;
    const freightPerMt = Math.min(hirePerMt, spotPerMt);
    const portDA = PORT_CALL_USD * INR;
    tripCost.set(d, { total: bunker + portDA, bunker, portDA, freightPerMt: isFinite(freightPerMt) ? freightPerMt : 0 });
  }

  // Flow variables, only where the product actually exists at both ends.
  const supplyBy = new Map<string, number>();
  for (const s of supply) supplyBy.set(`${s.loc}|${s.product}`, s.mt);
  const laneVars = new Map<string, string>();   // "s|d" -> trip-count var
  const flowsInto = new Map<string, Array<[number, string]>>();   // "d|p" -> terms
  const flowsOutOf = new Map<string, Array<[number, string]>>();  // "s|p" -> terms
  const flowsOnLane = new Map<string, Array<[number, string]>>(); // "s|d" -> terms

  for (const nd of need) {
    for (const s of srcs) {
      if (!supplyBy.has(`${s}|${nd.product}`)) continue;   // that grade is not made there
      const f = model.v(`f_${s}_${nd.loc}_${nd.product}`, { lo: 0, obj: tripCost.get(nd.loc)!.freightPerMt });
      const lane = `${s}|${nd.loc}`;
      if (!laneVars.has(lane)) laneVars.set(lane, model.v(`n_${s}_${nd.loc}`, { kind: 'INT', lo: 0, hi: Math.ceil(requiredMt / MIN_PARCEL) + 1, obj: tripCost.get(nd.loc)!.total }));
      const push = (m: Map<string, Array<[number, string]>>, k: string) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push([1, f]); };
      push(flowsInto, `${nd.loc}|${nd.product}`);
      push(flowsOutOf, `${s}|${nd.product}`);
      push(flowsOnLane, lane);
    }
  }

  // Ballast repositioning: every trip past the first per hull needs a return leg.
  const ballast = model.v('ballast_trips', { lo: 0, obj: minBallastNm * bunkerPerNm });
  model.row('ballast_link', [[1, ballast], ...[...laneVars.values()].map(n => [-1, n] as [number, string])], '>=', -fleet.length);

  // 1. Every dry-out deficit must be delivered.
  for (const nd of need) {
    const terms = flowsInto.get(`${nd.loc}|${nd.product}`);
    if (!terms?.length) {
      return {
        lpBound: null, mipBound: null, bound: null, proven: false, status: 'INFEASIBLE', solver: 'none', wallMs: 0,
        requiredMt, minTrips: null, breakdown: null, size: model.size(), omits,
        message: `No source in the network holds ${nd.product} for ${nd.loc}, so its requirement cannot be met at any cost.`,
      };
    }
    model.row(`dem_${nd.loc}_${nd.product}`, terms, '>=', nd.mt);
  }
  // 2. Cannot lift more than a source has above its floor.
  for (const [k, terms] of flowsOutOf) {
    const [loc, product] = k.split('|');
    model.row(`sup_${loc}_${product}`, terms, '<=', supplyBy.get(k) ?? 0);
  }
  // 3. Trip rounding: flow on a lane needs enough voyages to carry it.
  for (const [lane, terms] of flowsOnLane) {
    const [, d] = lane.split('|');
    model.row(`cap_${lane.replace('|', '_')}`, [...terms, [-laneCap(d), laneVars.get(lane)!]], '<=', 0);
  }
  // 4. The fleet cannot sail more laden days than it has hull-days.
  model.row('fleet_days', [...laneVars].map(([lane, n]) => {
    const [, d] = lane.split('|');
    return [Math.max(1, Math.ceil(minNmTo(d) / (fastest * 24))), n] as [number, string];
  }), '<=', fleetDays);
  // 5. Discharge berths cannot absorb more calls than they have berth-days.
  for (const d of dests) {
    const berths = input.berths.filter(b => b.locationId === d);
    if (!berths.length) continue;
    const slots = berths.reduce((a, b) => a + b.nsim, 0);
    const terms = [...laneVars].filter(([lane]) => lane.endsWith(`|${d}`)).map(([, n]) => [1, n] as [number, string]);
    model.row(`berth_${d}`, terms, '<=', slots * H);
  }

  const backend = await getBackend();
  const t0 = Date.now();
  const lp = await backend.solve(model, { ...opts, relaxIntegrality: true });
  const mip = await backend.solve(model, { timeLimitSec: opts.timeLimitSec ?? 20, ...opts, relaxIntegrality: false });
  const wallMs = Date.now() - t0;

  const lpBound = lp.objective;
  // Only a proved-optimal MIP is a valid floor; a truncated search is not.
  const mipBound = mip.proven ? mip.objective : null;
  const bound = mipBound ?? lpBound;

  let breakdown: BoundBreakdown | null = null;
  let minTrips: number | null = null;
  const src = mip.proven ? mip : lp;
  if (src.objective != null) {
    let bl = 0, fr = 0, pd = 0, trips = 0;
    for (const [lane, n] of laneVars) {
      const q = src.values[n] ?? 0;
      const [, d] = lane.split('|');
      const c = tripCost.get(d)!;
      bl += q * c.bunker; pd += q * c.portDA; trips += q;
    }
    // Freight rides on the flow variables, not the trip counts.
    for (const nd of need) for (const s of srcs) {
      const key = `f_${s}_${nd.loc}_${nd.product}`;
      if (src.values[key]) fr += src.values[key] * tripCost.get(nd.loc)!.freightPerMt;
    }
    breakdown = {
      bunkerLaden: Math.round(bl), freight: Math.round(fr), portDA: Math.round(pd),
      bunkerBallast: Math.round((src.values[ballast] ?? 0) * minBallastNm * bunkerPerNm),
    };
    minTrips = mip.proven ? Math.round(trips) : Math.ceil(trips);
  }

  return {
    lpBound, mipBound, bound,
    proven: mip.proven,
    status: mip.proven ? 'OPTIMAL' : mip.status,
    solver: backend.name, wallMs, requiredMt, minTrips, breakdown,
    size: model.size(), omits,
    message: mip.proven ? undefined : `Trip-rounding model not proved optimal (${mip.status}); falling back to the LP bound.`,
  };
}

/** Bound the instance and score a plan against it. */
export async function computeGap(input: EngineInput, incumbentCost: number | null, opts: SolveOptions = {}): Promise<GapReport> {
  const b = await computeBound(input, opts);
  const gapPct = b.bound != null && b.bound > 0 && incumbentCost != null
    ? Math.round(((incumbentCost - b.bound) / b.bound) * 1000) / 10
    : null;
  return {
    ...b, incumbent: incumbentCost, gapPct,
    headroom: b.bound != null && incumbentCost != null ? Math.round(incumbentCost - b.bound) : null,
  };
}
