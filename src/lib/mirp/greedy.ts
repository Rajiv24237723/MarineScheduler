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

  // Port disruptions. A closure can take the whole port, one berth of several, or
  // just degrade throughput — so capacity is resolved per (location, day) rather
  // than treated as open/shut. Zero slots means the vessel waits at anchorage.
  const closures = input.options?.portClosures ?? [];
  const baseSlots = (loc: string) => {
    const bs = berthsByLoc.get(loc);
    return bs?.length ? bs.reduce((s, b) => s + b.nsim, 0) : 99;
  };
  const activeClosures = (loc: string, day: number) =>
    closures.filter(c => c.locationId === loc && day >= c.fromDay && day <= c.toDay);
  /** Simultaneous berthing slots at a location on a day, after closures. */
  const slotsOn = (loc: string, day: number) => {
    if (!closures.length) return baseSlots(loc);
    let slots = baseSlots(loc);
    for (const c of activeClosures(loc, day)) {
      if (c.capacityPct != null) continue;                  // degraded, not shut — see rateFactorOn
      if (!c.berthId) return 0;                             // whole port down
      slots -= berthsByLoc.get(loc)?.find(b => b.id === c.berthId)?.nsim ?? slots;
    }
    return Math.max(0, slots);
  };
  /** Throughput multiplier (<1 slows pumping) at a location on a day. */
  const rateFactorOn = (loc: string, day: number) => {
    if (!closures.length) return 1;
    let f = 1;
    for (const c of activeClosures(loc, day)) if (c.capacityPct != null) f = Math.min(f, Math.max(0.05, c.capacityPct / 100));
    return f;
  };
  const closedUntil = (loc: string, arriveDay: number) => {
    if (!closures.length) return arriveDay;
    let d = arriveDay;
    const limit = inv.horizon + 60;
    while (d <= limit && slotsOn(loc, d) === 0) d++;
    return d;
  };

  // Vessel disruptions. A delay moves the earliest availability; an outage window
  // takes the hull out entirely for those days (drydock, off-hire, survey).
  const vesselDelay = new Map((input.options?.vesselDelays ?? []).map(d => [d.vesselId, d.availFromDay]));
  const outagesByVessel = new Map<string, { from: number; to: number }[]>();
  for (const o of input.options?.vesselOutages ?? []) {
    if (!outagesByVessel.has(o.vesselId)) outagesByVessel.set(o.vesselId, []);
    outagesByVessel.get(o.vesselId)!.push({ from: o.fromDay, to: o.toDay });
  }
  const vesselOutOn = (vid: string, day: number) =>
    (outagesByVessel.get(vid) ?? []).some(o => day >= o.from && day <= o.to);
  /** Advance past any outage window covering `day`. */
  const vesselFreeFrom = (vid: string, day: number) => {
    const ws = outagesByVessel.get(vid); if (!ws?.length) return day;
    let d = day;
    for (let guard = 0; guard < ws.length + 2; guard++) {
      const w = ws.find(o => d >= o.from && d <= o.to);
      if (!w) break; d = w.to + 1;
    }
    return d;
  };
  /** A voyage may not straddle an off-hire window. */
  const spansOutage = (vid: string, from: number, to: number) =>
    (outagesByVessel.get(vid) ?? []).some(o => from <= o.to && to >= o.from);

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

  // Volumetric stowage: a fixed-volume tank holds different MT by grade density, capped by
  // its weight rating. Effective MT ≈ cap · min(1, ρ/refρ) — light grades fill less by weight,
  // heavy grades are weight-limited. Applied within POL (grades share tanks); ~1 for crude/LNG.
  const densityOf = new Map(input.products.map(p => [p.id, p.density ?? null]));
  const refDensity = input.stream === 'CRUDE' ? 860 : input.stream === 'LNG' ? 450 : 850;
  const capOf = (cap: number, pid: string) => { const d = densityOf.get(pid); return d ? Math.max(1, Math.round(cap * Math.min(1, d / refDensity))) : cap; };
  // LNG boils off in transit (~0.12 %/day); load extra to cover the loss to the tank.
  const boilOffRate = (pid: string) => (classOf.get(pid) === 'LNG' ? 0.0012 : 0);
  const SPEED_FLOOR = 0.85; // slow-steaming: min fraction of service speed (gentle, preserves throughput)
  // Operational slack (options-driven; the plan is a 30-day commitment, so it carries cushion
  // rather than relying on costly replanning). Port calls are windows, deliveries land early.
  const portSlack = input.options?.portSlack ?? 1.25;       // pad berth+pump+changeover time
  const safetyDays = Math.max(0, input.options?.safetyDays ?? 2); // deliver this early (laycan cushion)
  const turnaroundDays = Math.max(0, input.options?.turnaroundDays ?? 1);

  const vstates = new Map<string, VesselState>();
  // Day-0 positions: distribute vessels round-robin over all network ports (loading points
  // included) so some start at a source and open with a laden pickup rather than long ballast.
  const homePorts = input.locations.map(l => l.id);
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
  // A delayed vessel is unavailable until its revised readiness day; an off-hire
  // window pushes it past the end of that window.
  for (const vs of vstates.values()) {
    const d = vesselDelay.get(vs.v.id); if (d != null) vs.freeDay = Math.max(vs.freeDay, d);
    vs.freeDay = vesselFreeFrom(vs.v.id, vs.freeDay);
  }

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
    const deadline = urgent.day < asOf ? asOf + 5 : Math.max(asOf + 1, urgent.day - safetyDays);
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
      .sort((a, b) => a.day! - b.day!)) queue.push({ need: o.nd, deadline: Math.max(asOf + 1, o.day! - safetyDays) });

    // Serve one product to its most urgent destinations: pool free compartments (a parcel
    // spans several tanks), picking up from one or more sources, split across destinations.
    const serveProduct = (productId: string): boolean => {
      if (servedProducts.has(productId)) return false;
      const dests = queue.filter(q => q.need.productId === productId).slice(0, MAX_DROPS);
      if (!dests.length) return false;
      const minDeadline = Math.min(...dests.map(d => d.deadline));
      // Sources with surplus, nearest first (multi-pickup fills across more than one if needed).
      const srcs = input.tanks
        .filter(t => t.productId === productId && inv.node(t.locationId, productId) && inv.node(t.locationId, productId)!.netDaily >= 0 && inv.firstDryOut(t.locationId, productId) === null)
        .map(t => t.locationId)
        .filter(loc => inv.availableAt(loc, productId, Math.max(0, minDeadline)) >= MIN_PARCEL)
        .sort((a, b) => dist(vs.locId, a) * jf(a) - dist(vs.locId, b) * jf(b));
      if (!srcs.length) return false;
      const loadDayEst = Math.min(inv.horizon, vs.freeDay + sailDays(dist(vs.locId, srcs[0]), vs.v.speed));
      // Free compatible tanks, ordered to minimise changeover (a tank last holding this grade
      // needs none; otherwise cheapest transition first).
      const freeComps = vs.v.compartments
        .filter(c => !usedComps.has(c.id) && canLoad(vs.compHist[c.id], productId).allowed)
        .sort((a, b) => transition(lastOf(vs.compHist[a.id]), productId).cost - transition(lastOf(vs.compHist[b.id]), productId).cost);
      if (!freeComps.length) return false;
      const effFreeCap = freeComps.reduce((s, c) => s + capOf(c.cap, productId), 0);
      const totalAvail = srcs.reduce((s, loc) => s + inv.minAvailableFrom(loc, productId, loadDayEst), 0);
      const want = dests.map(d => {
        const arr = Math.min(inv.horizon, loadDayEst + 1 + sailDays(dist(srcs[0], d.need.locId), vs.v.speed));
        return { loc: d.need.locId, deadline: d.deadline, q: Math.max(0, inv.minUllageFrom(d.need.locId, productId, arr)) };
      }).filter(x => x.q >= 1);
      const totalWant = want.reduce((s, x) => s + x.q, 0);
      if (totalWant < 1) return false;
      // Boil-off (LNG): load a little extra so the tank still receives its full parcel.
      const loadFactor = 1 + boilOffRate(productId) * Math.max(1, sailDays(dist(srcs[0], want[0].loc), vs.v.speed));
      const deliverBudget = Math.min(totalWant, totalAvail / loadFactor, effFreeCap / loadFactor);
      if (deliverBudget < MIN_PARCEL) return false;
      const scale = deliverBudget / totalWant;
      const scaled = want.map(x => ({ loc: x.loc, deadline: x.deadline, q: Math.floor(x.q * scale) })).filter(x => x.q >= MIN_PARCEL);
      if (!scaled.length) return false;
      const loadTotal = Math.round(scaled.reduce((s, x) => s + x.q, 0) * loadFactor);
      // Allocate compartments across sources (nearest first); a parcel may span several tanks.
      const newStows: Stow[] = [];
      let toLoad = loadTotal, ci = 0;
      for (const src of srcs) {
        if (toLoad <= 0 || ci >= freeComps.length) break;
        let srcAvail = inv.minAvailableFrom(src, productId, loadDayEst);
        while (toLoad > 0 && ci < freeComps.length && srcAvail >= 1) {
          const eff = capOf(freeComps[ci].cap, productId);
          const take = Math.min(eff, toLoad, srcAvail);
          if (take < 1) break;
          newStows.push({ compartmentId: freeComps[ci].id, productId, sourceLoc: src, qty: Math.round(take) });
          toLoad -= take; srcAvail -= take; ci++;
        }
      }
      const loadedTotal = newStows.reduce((s, x) => s + x.qty, 0);
      if (loadedTotal < MIN_PARCEL) return false;
      // Delivered = loaded, discounted by boil-off; trim destinations to fit.
      let deliverable = Math.floor(loadedTotal / loadFactor);
      const finalDeliv: { loc: string; qty: number; deadline: number }[] = [];
      for (const x of scaled) { const q = Math.min(x.q, deliverable); if (q >= MIN_PARCEL) { finalDeliv.push({ loc: x.loc, qty: q, deadline: x.deadline }); deliverable -= q; } }
      if (!finalDeliv.length) return false;
      for (const s of newStows) { stows.push(s); usedComps.add(s.compartmentId); }
      for (const x of finalDeliv) deliveries.push({ destLoc: x.loc, productId, qty: x.qty, deadline: x.deadline });
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
      vs.freeDay = tl.endDay + turnaroundDays;
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

  // Route timeline: an interleaved pickup-and-delivery route (a drop is eligible once every
  // source feeding its cargo is visited), sailed at a slow-steamed speed that just meets the
  // tightest deadline, with load-dependent draft (part-laden calls at shallow ports allowed)
  // and tank-changeover time charged on loading.
  function timeline(vs: VesselState, stows: Stow[], deliveries: Delivery[]) {
    const dischByDest = distribute(stows, deliveries);
    const sources = [...new Set(stows.map(s => s.sourceLoc))];
    const dests = [...new Set(deliveries.map(d => d.destLoc))];

    const rate = (loc: string) => (berthsByLoc.get(loc)?.[0]?.rateMtPerHr ?? 2000);
    const berthingH = (loc: string) => (berthsByLoc.get(loc)?.[0]?.berthingHours ?? 12);
    // Pumping is slower while a port runs degraded, so port time depends on the day.
    const effRate = (loc: string, day: number) => rate(loc) * rateFactorOn(loc, day);

    // Per-stop ops, and load-stop tank-cleaning/changeover hours (pre-voyage tank history).
    const loadOps = new Map<string, Op[]>(); const loadChangeH = new Map<string, number>();
    for (const src of sources) {
      const here = stows.filter(s => s.sourceLoc === src);
      loadOps.set(src, here.map(s => ({ op: 'LOAD' as const, productId: s.productId, qty: s.qty, compartmentId: s.compartmentId })));
      loadChangeH.set(src, here.reduce((h, s) => h + transition(lastOf(vs.compHist[s.compartmentId]), s.productId).hours, 0));
    }
    const opsAt = (loc: string, kind: 'LOAD' | 'DISCHARGE') => (kind === 'LOAD' ? loadOps.get(loc)! : (dischByDest.get(loc) ?? []));
    const qtyAt = (loc: string, kind: 'LOAD' | 'DISCHARGE') => opsAt(loc, kind).reduce((s, o) => s + o.qty, 0);
    const opDaysAt = (loc: string, kind: 'LOAD' | 'DISCHARGE', day = 0) =>
      Math.max(1, Math.ceil((berthingH(loc) + (kind === 'LOAD' ? (loadChangeH.get(loc) ?? 0) : 0) + qtyAt(loc, kind) / effRate(loc, day)) * portSlack / 24));
    const deadlineAt = (dest: string) => Math.min(...deliveries.filter(d => d.destLoc === dest).map(d => d.deadline));

    // Pickup→delivery precedence: a destination depends on every source of the grades it receives.
    const prodSources = new Map<string, Set<string>>();
    for (const s of stows) { if (!prodSources.has(s.productId)) prodSources.set(s.productId, new Set()); prodSources.get(s.productId)!.add(s.sourceLoc); }
    const destDeps = (dest: string) => { const set = new Set<string>(); for (const d of deliveries.filter(x => x.destLoc === dest)) for (const src of (prodSources.get(d.productId) ?? [])) set.add(src); return [...set]; };

    // Interleaved nearest-neighbour route.
    const route: { loc: string; kind: 'LOAD' | 'DISCHARGE' }[] = [];
    const pendingL = new Set(sources), pendingD = new Set(dests), visited = new Set<string>();
    let rcur = vs.locId;
    while (pendingL.size || pendingD.size) {
      const cand: { loc: string; kind: 'LOAD' | 'DISCHARGE' }[] = [];
      for (const s of pendingL) cand.push({ loc: s, kind: 'LOAD' });
      for (const d of pendingD) if (destDeps(d).every(src => visited.has(src))) cand.push({ loc: d, kind: 'DISCHARGE' });
      if (!cand.length) break;
      cand.sort((a, b) => dist(rcur, a.loc) * jf(a.loc) - dist(rcur, b.loc) * jf(b.loc));
      const pick = cand[0]; route.push(pick); rcur = pick.loc;
      if (pick.kind === 'LOAD') { visited.add(pick.loc); pendingL.delete(pick.loc); } else pendingD.delete(pick.loc);
    }

    // Slow-steaming: one voyage speed that just meets the tightest deadline, bounded below.
    const totalCap = Math.max(1, vs.v.compartments.reduce((s, c) => s + c.cap, 0));
    const draftAt = (aboard: number) => vs.v.draftBallast + (vs.v.draftLaden - vs.v.draftBallast) * Math.min(1, Math.max(0, aboard) / totalCap);
    let simDist = 0, simPort = 0, simCur = vs.locId; const reqSpeeds: number[] = [];
    for (const node of route) {
      simDist += dist(simCur, node.loc); simCur = node.loc;
      if (node.kind === 'DISCHARGE') { const availDays = deadlineAt(node.loc) - vs.freeDay - simPort; if (availDays >= 1) reqSpeeds.push(simDist / (availDays * 24)); }
      simPort += opDaysAt(node.loc, node.kind, vs.freeDay + simPort);
    }
    const svc = Math.max(1, vs.v.speed);
    const effSpeed = Math.min(svc, Math.max(svc * SPEED_FLOOR, reqSpeeds.length ? Math.max(...reqSpeeds) : svc * SPEED_FLOOR));

    const stops: Stop[] = []; const legs: Leg[] = [];
    const breakdown: CostBreakdown = { bunker: 0, freight: 0, portDA: 0, demurrage: 0, changeover: 0 };
    const berthAdds = new Map<string, number>();
    const loadDepartDay = new Map<string, number>();
    const dischargeArriveDay = new Map<string, number>();
    let cur = vs.locId; let day = vs.freeDay; let seq = 0; let invOk = true; let aboard = 0;
    let sailEco = 0, sailNom = 0; // eco (actual) vs service-speed sail days
    const startDay = day;

    const hop = (to: string) => {
      if (to === cur) return;
      const d = dist(cur, to); const sd = sailDays(d, effSpeed);
      legs.push({ fromLoc: cur, toLoc: to, departDay: day, arriveDay: day + sd, ballast: aboard <= 0, distanceNm: Math.round(d) });
      breakdown.bunker += dailyBunkerMt(effSpeed) * sd * BUNKER_USD_PER_MT * INR;
      sailEco += sd; sailNom += sailDays(d, svc);
      day += sd; cur = to;
    };

    for (const node of route) {
      const loc = node.loc, kind = node.kind, ops = opsAt(loc, kind), q = qtyAt(loc, kind);
      // Load-dependent draft: the port must admit the vessel at its draft while alongside
      // (after loading for a pickup, on arrival for a drop) — part-laden reaches shallow ports.
      const alongsideAboard = kind === 'LOAD' ? aboard + q : aboard;
      const bs = berthsByLoc.get(loc);
      if (bs && bs.length && !bs.some(b => b.maxDraft >= draftAt(alongsideAboard) - 1e-6)) return null;
      hop(loc);
      // Port closure: if the vessel arrives during a shut window it waits at anchorage until
      // the berth reopens — idle days that accrue demurrage and push the whole call later.
      const arr0 = day; day = closedUntil(loc, day);
      if (day > arr0) breakdown.demurrage += DEM_USD_PER_DAY * INR * (day - arr0);
      if (kind === 'LOAD') for (const o of ops) breakdown.changeover += transition(lastOf(vs.compHist[o.compartmentId]), o.productId).cost;
      const arriveDay = day;
      const byProd = new Map<string, number>();
      for (const o of ops) byProd.set(o.productId, (byProd.get(o.productId) ?? 0) + o.qty);
      for (const [pid, qq] of byProd) {
        // A tank out of service can neither receive nor dispatch.
        if (inv.outageOn(loc, pid, arriveDay)) invOk = false;
        if (kind === 'LOAD' && inv.minAvailableFrom(loc, pid, arriveDay) + 1e-6 < qq) invOk = false;
        if (kind === 'DISCHARGE' && inv.minUllageFrom(loc, pid, arriveDay) + 1e-6 < qq) invOk = false;
      }
      const opDays = opDaysAt(loc, kind, arriveDay);
      if (((berthUsage.get(`${loc}|${arriveDay}`) ?? 0) + (berthAdds.get(`${loc}|${arriveDay}`) ?? 0)) >= slotsOn(loc, arriveDay)) breakdown.demurrage += DEM_USD_PER_DAY * INR;
      breakdown.portDA += PORT_CALL_USD * INR;
      for (let k = 0; k < opDays; k++) { const kk = `${loc}|${arriveDay + k}`; berthAdds.set(kk, (berthAdds.get(kk) ?? 0) + 1); }
      day += opDays;
      stops.push({ seq: seq++, locationId: loc, arriveDay, departDay: day, kind, ops });
      if (kind === 'LOAD') { aboard += q; loadDepartDay.set(loc, arriveDay); } else { aboard -= q; dischargeArriveDay.set(loc, arriveDay); }
    }

    // Freight: SPOT = voyageRate·qty; OWNED/TC/COA = daily hire × voyage days. Hire is a sunk
    // period cost, so it is charged on nominal (service-speed) days — slow-steaming saves
    // bunker without being penalised as extra hire.
    const portDays = Math.max(0, (day - startDay) - sailEco);
    const nominalVoyDays = Math.max(1, sailNom + portDays);
    const totQty = deliveries.reduce((s, d) => s + d.qty, 0);
    if (vs.v.pool === 'SPOT') breakdown.freight += vs.v.voyageRate * totQty * INR;
    else breakdown.freight += (vs.v.charterCost || 15000) * nominalVoyDays * INR;

    const cost = breakdown.bunker + breakdown.freight + breakdown.portDA + breakdown.demurrage + breakdown.changeover;
    const deadlinesOk = deliveries.every(d => (dischargeArriveDay.get(d.destLoc) ?? Infinity) <= d.deadline);
    // The hull cannot be at sea during its own off-hire window.
    if (spansOutage(vs.v.id, startDay, day)) return null;

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
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }
  return m;
}
