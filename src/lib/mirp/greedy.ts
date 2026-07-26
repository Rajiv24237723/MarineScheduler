import { EngineInput, Vessel, Voyage, Stop, Leg, Op, CostBreakdown, CharterRecommendation, Unserved } from './types';
import { InventoryModel } from './inventory';
import { haversineNm, sailDays, dailyBunkerMt } from './distance';

// Cost constants (kept consistent with earlier engine so figures compare).
const BUNKER_USD_PER_MT = 600, INR = 83, PORT_CALL_USD = 50000, DEM_USD_PER_DAY = 20000;
const MIN_PARCEL = 2000;

interface VesselState {
  v: Vessel; locId: string; freeDay: number;
  compHist: Record<string, string[]>; // compartment -> recent cargo history (last carried is last)
}
interface Need { locId: string; productId: string; }
// A compartment loaded with one product from one source (a parcel may span several stows).
interface Stow { compartmentId: string; productId: string; sourceLoc: string; qty: number; }
// A quantity of one product to deliver to one destination (drawn from one or more stows).
interface Delivery { destLoc: string; productId: string; qty: number; deadline: number; }

export interface GreedyOutput {
  voyages: Voyage[];
  recommendations: CharterRecommendation[];
  unserved: Unserved[];
}

export function runGreedy(input: EngineInput, inv: InventoryModel, rand: () => number = () => 0.5): GreedyOutput {
  const locById = new Map(input.locations.map(l => [l.id, l]));
  // Per-run ranking jitter so multi-start explores different constructions
  // (affects ORDER/selection only — never the real distances used for cost).
  const jitter = new Map<string, number>();
  for (const l of input.locations) jitter.set(l.id, 1 + (rand() - 0.5) * 0.4);
  const jf = (loc: string) => jitter.get(loc) ?? 1;
  const excluded = new Set(input.options?.excludeVessels ?? []);
  const owned = input.vessels.filter(v => v.pool !== 'SPOT' && !excluded.has(v.id));
  const spot = input.vessels.filter(v => v.pool === 'SPOT');
  const berthsByLoc = groupBy(input.berths, b => b.locationId);
  const berthUsage = new Map<string, number>(); // `${loc}|${day}` -> count

  // Compartment compatibility lookup.
  const compat = new Map<string, { allowed: boolean; hours: number; cost: number }>();
  for (const c of input.compatibility.filter(c => c.scope === 'COMPARTMENT'))
    compat.set(`${c.fromProduct}|${c.toProduct}`, { allowed: c.allowed === 1, hours: c.changeoverHours, cost: c.changeoverCost });
  const transition = (from: string | null, to: string) => {
    if (!from || from === to) return { allowed: true, hours: 0, cost: 0 };
    return compat.get(`${from}|${to}`) ?? { allowed: true, hours: 0, cost: 0 };
  };
  // Jet/ATF grades enforce the EI/JIG 1530 "last-three-cargoes" rule: a disqualifying
  // prior (e.g. residual FO) anywhere in the last 3 cargoes blocks the load.
  const classOf = new Map(input.products.map(p => [p.id, p.cargoClass])); // product → cargo class
  const jetIds = new Set(input.products.filter(p => /ATF|JET/i.test(p.name)).map(p => p.id));
  const lastOf = (h?: string[]) => (h && h.length ? h[h.length - 1] : null);
  const canLoad = (hist: string[] | undefined, to: string) => {
    const h = hist ?? [];
    const imm = transition(lastOf(h), to);
    if (!imm.allowed) return { allowed: false, hours: 0, cost: 0 };
    if (jetIds.has(to)) for (const p of h.slice(-3)) if (transition(p, to).allowed === false) return { allowed: false, hours: 0, cost: 0 };
    return imm;
  };

  const vstates = new Map<string, VesselState>();
  // Vessels start at coastal ports (terminals/sources/SPMs), never at an inland
  // refinery, and are distributed round-robin so day-0 positions are realistic.
  const homePorts = input.locations.filter(l => l.type !== 'REFINERY').map(l => l.id);
  const fallback = input.locations[0]?.id;
  const allVessels = [...owned, ...spot];
  allVessels.forEach((v, i) => vstates.set(v.id, { v, locId: (homePorts.length ? homePorts[i % homePorts.length] : fallback), freeDay: 0, compHist: {} }));

  const voyages: Voyage[] = [];
  const recommendations: CharterRecommendation[] = [];
  const unserved: Unserved[] = [];
  const unservable = new Set<string>(); // `${loc}|${p}` needs we've given up on
  let voyageSeq = 0; // monotonic, unique per created voyage (even non-selected candidates)

  const dist = (a: string, b: string) => haversineNm(locById.get(a)!, locById.get(b)!);

  // --- Rolling-horizon replan: freeze committed voyages ---------------------
  // Preserve voyages already underway ("today" = asOf): lock their inventory
  // effects and their vessel's end position / free-day / compartment state, so
  // the replan only touches the future — minimal disruption, not a clean sheet.
  const asOf = Math.max(0, input.options?.asOfDay ?? 0);
  for (const fv of input.options?.frozenVoyages ?? []) {
    voyages.push(fv);
    for (const s of fv.stops) for (const op of s.ops) inv.addOp(s.locationId, op.productId, s.arriveDay, op.op === 'LOAD' ? -op.qty : op.qty);
    const vs = fv.vesselId ? vstates.get(fv.vesselId) : [...vstates.values()].find(x => x.v.name === fv.vesselName);
    if (vs) {
      const last = fv.stops[fv.stops.length - 1];
      if (last) vs.locId = last.locationId;
      vs.freeDay = Math.max(vs.freeDay, fv.endDay);
      for (const s of fv.stops) for (const op of s.ops) if (op.op === 'LOAD') vs.compHist[op.compartmentId] = [...(vs.compHist[op.compartmentId] ?? []), op.productId].slice(-4);
    }
  }
  // Idle vessels can only act from "today" onward.
  if (asOf > 0) for (const vs of vstates.values()) if (vs.freeDay < asOf) vs.freeDay = asOf;

  // Which (loc,product) are consumers (potential demand nodes)?
  const demandNodes: Need[] = [];
  for (const t of input.tanks) {
    const n = inv.node(t.locationId, t.productId)!;
    const isConsumer = n.netDaily < 0 ||
      input.planLines.some(pl => pl.kind === 'DEMAND' && pl.locationId === t.locationId && pl.productId === t.productId);
    if (isConsumer) demandNodes.push({ locId: t.locationId, productId: t.productId });
  }

  // Sources: (loc,product) that stay above dry-out and carry surplus.
  const sourcesFor = (p: string): string[] =>
    input.tanks.filter(t => t.productId === p && inv.node(t.locationId, p) &&
      inv.node(t.locationId, p)!.netDaily >= 0 && inv.firstDryOut(t.locationId, p) === null)
      .map(t => t.locationId);

  let guard = 0;
  while (guard++ < 500) {
    // Find the most urgent unmet dry-out among demand nodes.
    let urgent: { need: Need; day: number } | null = null;
    let bestScore = Infinity;
    for (const nd of demandNodes) {
      if (unservable.has(`${nd.locId}|${nd.productId}`)) continue;
      const d = inv.firstDryOut(nd.locId, nd.productId);
      if (d === null) continue;
      const score = d + (jf(nd.locId) - 1) * 3; // jitter tie-break for exploration
      if (score < bestScore) { bestScore = score; urgent = { need: nd, day: d }; }
    }
    if (!urgent) break; // feasible: no remaining dry-out

    // A node already below floor at "today" is recovered ASAP (a few days out),
    // not declared impossible against a past deadline.
    const deadline = urgent.day < asOf ? asOf + 5 : urgent.day;
    const built = buildBestVoyage(urgent.need, deadline);
    if (!built) {
      // Even a spot charter can't serve (no compatible source / unreachable): report shortfall.
      const day = urgent.day;
      const short = Math.round(inv.node(urgent.need.locId, urgent.need.productId)!.smin - inv.stockAt(urgent.need.locId, urgent.need.productId, day));
      const hasSource = sourcesFor(urgent.need.productId).length > 0;
      unserved.push({
        locationId: urgent.need.locId, productId: urgent.need.productId, day,
        shortfallMt: Math.max(short, 0),
        reason: hasSource
          ? 'No vessel (owned, TC, or spot) can reach in the delivery window'
          : 'No compatible source with surplus for this product',
      });
      // Fleet/timing shortfall with a valid source ⇒ recommend contracting more spot tonnage.
      if (hasSource && spot.length) {
        const cls = spot[0].class;
        const src = nearestSource(urgent.need.productId, urgent.need.locId, day);
        const qty = Math.max(short, 0);
        recommendations.push({
          voyageId: '', vesselClass: cls, fromLoc: src, toLoc: urgent.need.locId, productId: urgent.need.productId, qty, byDay: day,
          reason: `Fleet availability is the binding constraint for ${locById.get(urgent.need.locId)?.name ?? urgent.need.locId} by day ${day} (${qty.toLocaleString()} MT short); charter a spot ${cls}.`,
          estCost: Math.round(qty * (spot[0].voyageRate || 12) * 83),
        });
      }
      unservable.add(`${urgent.need.locId}|${urgent.need.productId}`);
    }
  }

  return { voyages, recommendations, unserved };

  // -------------------------------------------------------------------------
  // Build the cheapest feasible voyage that resolves `trigger`; charter spot if needed.
  // -------------------------------------------------------------------------
  function buildBestVoyage(trigger: Need, deadline: number): Voyage | null {
    let best: { voyage: Voyage; apply: () => void } | null = null;

    const candidates: Vessel[] = [...owned];
    let usedSpot = false;

    const evaluate = (pool: Vessel[]) => {
      for (const v of pool) {
        const vs = vstates.get(v.id)!;
        const plan = assembleVoyage(vs, trigger, deadline);
        if (!plan) continue;
        if (!best || plan.voyage.cost < best.voyage.cost) best = plan;
      }
    };
    evaluate(candidates);

    if (!best) { evaluate(spot); usedSpot = true; }
    if (!best) return null;

    best.apply();
    voyages.push(best.voyage);
    if (usedSpot && best.voyage.pool === 'SPOT') {
      const v = best.voyage;
      const fromLoc = v.stops.find(s => s.kind === 'LOAD')?.locationId ?? null;
      const triggerQty = v.stops.flatMap(s => s.ops).filter(o => o.op === 'DISCHARGE' && o.productId === trigger.productId).reduce((a, o) => a + o.qty, 0);
      const fromName = fromLoc ? (locById.get(fromLoc)?.name ?? fromLoc) : 'source';
      recommendations.push({
        voyageId: v.id, vesselClass: v.vesselClass, fromLoc, toLoc: trigger.locId, productId: trigger.productId, qty: Math.round(triggerQty), byDay: deadline,
        reason: `Owned/TC fleet cannot cover ${fromName} → ${locById.get(trigger.locId)?.name ?? trigger.locId} by day ${deadline}; charter a spot ${v.vesselClass}.`,
        estCost: Math.round(v.cost),
      });
    }
    return best.voyage;
  }

  // Assemble a (multi-pickup / multi-drop) voyage for one vessel. A product parcel may
  // span several compartments, and a loaded compartment may be part-discharged across
  // several destinations — so bulk cargoes fill many tanks and coastal drops can share one.
  function assembleVoyage(vs: VesselState, trigger: Need, deadline: number): { voyage: Voyage; apply: () => void } | null {
    const service = vs.v.service ?? 'CLEAN';
    if ((classOf.get(trigger.productId) ?? 'CLEAN') !== service) return null;
    const MAX_DROPS = 3; // destinations served per product on one voyage

    const stows: Stow[] = [];
    const deliveries: Delivery[] = [];
    const usedComps = new Set<string>();
    const servedProducts = new Set<string>();

    // Same-service needs, trigger first then by dry-out urgency.
    const queue: { need: Need; deadline: number }[] = [{ need: trigger, deadline }];
    for (const o of demandNodes
      .filter(nd => !(nd.locId === trigger.locId && nd.productId === trigger.productId) && !unservable.has(`${nd.locId}|${nd.productId}`))
      .filter(nd => (classOf.get(nd.productId) ?? 'CLEAN') === service)
      .map(nd => ({ nd, day: inv.firstDryOut(nd.locId, nd.productId) }))
      .filter(x => x.day !== null)
      .sort((a, b) => a.day! - b.day!)) queue.push({ need: o.nd, deadline: o.day! });

    // Serve one product to its most urgent destinations from a single source: pool free
    // compartments to hold the total (a parcel across many tanks), split across destinations.
    const serveProduct = (productId: string): boolean => {
      if (servedProducts.has(productId)) return false;
      const dests = queue.filter(q => q.need.productId === productId).slice(0, MAX_DROPS);
      if (!dests.length) return false;
      const src = nearestSource(productId, vs.locId, Math.min(...dests.map(d => d.deadline)));
      if (!src) return false;
      const loadDayEst = Math.min(inv.horizon, vs.freeDay + sailDays(dist(vs.locId, src), vs.v.speed));
      const freeComps = vs.v.compartments.filter(c => !usedComps.has(c.id) && canLoad(vs.compHist[c.id], productId).allowed);
      if (!freeComps.length) return false;
      const freeCap = freeComps.reduce((s, c) => s + c.cap, 0);
      const avail = inv.minAvailableFrom(src, productId, loadDayEst);
      const want = dests.map(d => {
        const arr = Math.min(inv.horizon, loadDayEst + 1 + sailDays(dist(src, d.need.locId), vs.v.speed));
        return { loc: d.need.locId, deadline: d.deadline, q: Math.max(0, inv.minUllageFrom(d.need.locId, productId, arr)) };
      }).filter(x => x.q >= 1);
      const totalWant = want.reduce((s, x) => s + x.q, 0);
      const allowed = Math.min(totalWant, avail, freeCap);
      if (allowed < MIN_PARCEL) return false;
      const scale = allowed / totalWant;
      const scaled = want.map(x => ({ loc: x.loc, deadline: x.deadline, q: Math.floor(x.q * scale) })).filter(x => x.q >= MIN_PARCEL);
      if (!scaled.length) return false;
      const deliverTotal = scaled.reduce((s, x) => s + x.q, 0);
      // Allocate compartments (a parcel may span several) to hold exactly the delivered total.
      let remaining = deliverTotal;
      for (const c of freeComps) {
        if (remaining <= 0) break;
        const take = Math.min(c.cap, remaining);
        if (take < 1) continue;
        stows.push({ compartmentId: c.id, productId, sourceLoc: src, qty: Math.round(take) });
        usedComps.add(c.id);
        remaining -= take;
      }
      for (const x of scaled) deliveries.push({ destLoc: x.loc, productId, qty: x.q, deadline: x.deadline });
      servedProducts.add(productId);
      return true;
    };

    // Serve the trigger's product first, then other urgent products while compartments remain;
    // revert any product group that breaks feasibility.
    for (const pid of [trigger.productId, ...queue.map(q => q.need.productId)]) {
      if (usedComps.size >= vs.v.compartments.length) break;
      if (servedProducts.has(pid)) continue;
      const snap = { s: stows.length, d: deliveries.length, comps: [...usedComps], served: [...servedProducts] };
      if (!serveProduct(pid)) continue;
      const tl = timeline(vs, stows, deliveries);
      if (!tl || !tl.deadlinesOk || !tl.invOk) {
        stows.length = snap.s; deliveries.length = snap.d;
        usedComps.clear(); for (const c of snap.comps) usedComps.add(c);
        servedProducts.clear(); for (const p of snap.served) servedProducts.add(p);
      }
    }

    if (!deliveries.some(d => d.destLoc === trigger.locId && d.productId === trigger.productId)) return null;
    const tl = timeline(vs, stows, deliveries);
    if (!tl || !tl.deadlinesOk || !tl.invOk) return null;

    const voyage: Voyage = {
      id: `voy_${input.stream}_${vs.v.id}_${++voyageSeq}`,
      stream: input.stream, vesselId: vs.v.pool === 'SPOT' ? null : vs.v.id,
      vesselName: vs.v.name, vesselClass: vs.v.class, pool: vs.v.pool,
      startDay: tl.startDay, endDay: tl.endDay, stops: tl.stops, legs: tl.legs,
      cost: Math.round(tl.cost), costBreakdown: tl.breakdown,
    };

    const apply = () => {
      for (const s of stows) inv.addOp(s.sourceLoc, s.productId, tl.loadDepartDay.get(s.sourceLoc) ?? tl.startDay, -s.qty);
      for (const d of deliveries) inv.addOp(d.destLoc, d.productId, tl.dischargeArriveDay.get(d.destLoc) ?? tl.endDay, d.qty);
      for (const s of stows) vs.compHist[s.compartmentId] = [...(vs.compHist[s.compartmentId] ?? []), s.productId].slice(-4);
      for (const [k, add] of tl.berthAdds) berthUsage.set(k, (berthUsage.get(k) ?? 0) + add);
      vs.locId = tl.endLoc;
      vs.freeDay = tl.endDay;
    };

    return { voyage, apply };
  }

  // Attribute each destination's delivery to loaded compartments: a compartment may feed
  // several destinations (partial discharge), and a delivery may draw from several tanks.
  function distribute(stows: Stow[], deliveries: Delivery[]): Map<string, Op[]> {
    const byDest = new Map<string, Op[]>();
    for (const pid of new Set(stows.map(s => s.productId))) {
      const S = stows.filter(s => s.productId === pid).map(s => ({ id: s.compartmentId, rem: s.qty }));
      let si = 0;
      for (const d of deliveries.filter(x => x.productId === pid)) {
        let need = d.qty;
        while (need > 1e-6 && si < S.length) {
          const take = Math.min(S[si].rem, need);
          if (take > 0) {
            const arr = byDest.get(d.destLoc) ?? [];
            arr.push({ op: 'DISCHARGE', productId: pid, qty: Math.round(take), compartmentId: S[si].id });
            byDest.set(d.destLoc, arr);
            S[si].rem -= take; need -= take;
          }
          if (S[si].rem <= 1e-6) si++;
        }
      }
    }
    return byDest;
  }

  // Route timeline: ballast → load stops (by source) → discharge stops (by destination) → empty.
  function timeline(vs: VesselState, stows: Stow[], deliveries: Delivery[]) {
    const loadLocs = uniqueOrderNearest(vs.locId, [...new Set(stows.map(s => s.sourceLoc))]);
    const dischLocs = uniqueOrderNearest(loadLocs[loadLocs.length - 1] ?? vs.locId, [...new Set(deliveries.map(d => d.destLoc))]);

    // Draft feasibility: every visited port must admit the laden vessel.
    for (const loc of [...loadLocs, ...dischLocs]) {
      const bs = berthsByLoc.get(loc);
      if (bs && bs.length && !bs.some(b => b.maxDraft >= vs.v.draftLaden)) return null;
    }
    const dischByDest = distribute(stows, deliveries);

    const stops: Stop[] = [];
    const legs: Leg[] = [];
    const breakdown: CostBreakdown = { bunker: 0, freight: 0, portDA: 0, demurrage: 0, changeover: 0 };
    const berthAdds = new Map<string, number>();
    const loadDepartDay = new Map<string, number>();
    const dischargeArriveDay = new Map<string, number>();

    let cur = vs.locId; let day = vs.freeDay; let seq = 0; let invOk = true;
    const rate = (loc: string) => (berthsByLoc.get(loc)?.[0]?.rateMtPerHr ?? 2000);
    const berthingH = (loc: string) => (berthsByLoc.get(loc)?.[0]?.berthingHours ?? 12);
    const nsim = (loc: string) => (berthsByLoc.get(loc)?.[0]?.nsim ?? 99);

    const hop = (to: string, ballast: boolean) => {
      if (to === cur) return;
      const d = dist(cur, to); const sd = sailDays(d, vs.v.speed);
      legs.push({ fromLoc: cur, toLoc: to, departDay: day, arriveDay: day + sd, ballast, distanceNm: Math.round(d) });
      breakdown.bunker += dailyBunkerMt(vs.v.speed) * sd * BUNKER_USD_PER_MT * INR;
      day += sd; cur = to;
    };

    // A load or discharge call: sail there, check inventory feasibility at the op day, cost it.
    const portStop = (loc: string, kind: 'LOAD' | 'DISCHARGE', ballastLeg: boolean, ops: Op[]) => {
      hop(loc, ballastLeg);
      const qtyTot = ops.reduce((s, o) => s + o.qty, 0);
      const opDays = Math.max(1, Math.ceil((berthingH(loc) + qtyTot / rate(loc)) / 24));
      const arriveDay = day;
      const byProd = new Map<string, number>();
      for (const o of ops) byProd.set(o.productId, (byProd.get(o.productId) ?? 0) + o.qty);
      for (const [pid, q] of byProd) {
        if (kind === 'LOAD' && inv.minAvailableFrom(loc, pid, arriveDay) + 1e-6 < q) invOk = false;
        if (kind === 'DISCHARGE' && (inv.minUllageFrom(loc, pid, arriveDay) + 1e-6 < q || inv.outageOn(loc, pid, arriveDay))) invOk = false;
      }
      const key = `${loc}|${arriveDay}`;
      const busy = (berthUsage.get(key) ?? 0) + (berthAdds.get(key) ?? 0);
      if (busy >= nsim(loc)) breakdown.demurrage += DEM_USD_PER_DAY * INR;
      breakdown.portDA += PORT_CALL_USD * INR;
      for (let k = 0; k < opDays; k++) { const kk = `${loc}|${arriveDay + k}`; berthAdds.set(kk, (berthAdds.get(kk) ?? 0) + 1); }
      day += opDays;
      stops.push({ seq: seq++, locationId: loc, arriveDay, departDay: day, kind, ops });
      if (kind === 'LOAD') loadDepartDay.set(loc, arriveDay); else dischargeArriveDay.set(loc, arriveDay);
    };

    const startDay = day;
    loadLocs.forEach((loc, i) => {
      const here = stows.filter(s => s.sourceLoc === loc);
      const ops: Op[] = here.map(s => {
        breakdown.changeover += transition(lastOf(vs.compHist[s.compartmentId]), s.productId).cost;
        return { op: 'LOAD' as const, productId: s.productId, qty: s.qty, compartmentId: s.compartmentId };
      });
      portStop(loc, 'LOAD', i === 0, ops);            // first leg is ballast to first source
    });
    dischLocs.forEach(loc => portStop(loc, 'DISCHARGE', false, dischByDest.get(loc) ?? []));

    // Freight: SPOT = voyageRate·qty; OWNED/TC/COA = daily hire × voyage days.
    const voyDays = Math.max(1, day - startDay);
    const totQty = deliveries.reduce((s, d) => s + d.qty, 0);
    if (vs.v.pool === 'SPOT') breakdown.freight += vs.v.voyageRate * totQty * INR;
    else breakdown.freight += (vs.v.charterCost || 15000) * voyDays * INR;

    const cost = breakdown.bunker + breakdown.freight + breakdown.portDA + breakdown.demurrage + breakdown.changeover;
    const deadlinesOk = deliveries.every(d => (dischargeArriveDay.get(d.destLoc) ?? Infinity) <= d.deadline);

    return { stops, legs, startDay, endDay: day, endLoc: cur, cost, breakdown, deadlinesOk, invOk, berthAdds, loadDepartDay, dischargeArriveDay };
  }

  function nearestSource(p: string, from: string, byDay: number): string | null {
    const srcs = input.tanks
      .filter(t => t.productId === p && inv.node(t.locationId, p) && inv.node(t.locationId, p)!.netDaily >= 0 && inv.firstDryOut(t.locationId, p) === null)
      .map(t => t.locationId)
      .filter(loc => inv.availableAt(loc, p, Math.max(0, byDay)) >= MIN_PARCEL);
    if (srcs.length === 0) return null;
    return srcs.sort((a, b) => dist(from, a) * jf(a) - dist(from, b) * jf(b))[0];
  }

  function uniqueOrderNearest(from: string, locs: string[]): string[] {
    const out: string[] = []; let cur = from; const rem = [...locs];
    while (rem.length) { rem.sort((a, b) => dist(cur, a) * jf(a) - dist(cur, b) * jf(b)); const n = rem.shift()!; out.push(n); cur = n; }
    return out;
  }
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
  return m;
}
