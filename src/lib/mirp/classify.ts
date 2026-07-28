import { EngineInput, EngineOptions, Voyage, Kpis } from './types';
import { InventoryModel } from './inventory';

/**
 * Replan-decision layer. A change to the operating plan doesn't automatically warrant a
 * rebuild — the tool should say whether it does and how big a repair it needs, so the planner
 * isn't chasing every ETA wobble ("plan nervousness"). This classifies an event into a response
 * level, names the trigger reasons, and measures the blast radius, driven by configurable
 * thresholds. Levels follow the planner taxonomy: L0 actualize-only → L4 full-horizon replan.
 */
export interface ReplanThresholds {
  dryOutDaysCover: number;   // flag service risk if a node's cover falls below this many days
  ullageMarginPct: number;   // required ullage headroom over an incoming parcel
  demurrageInr: number;      // demurrage exposure that itself justifies a replan
  costVariancePct: number;   // recovery cost rise over baseline that flags a cheaper candidate
  qtyChangePct: number;      // movement-quantity change that forces feasibility revalidation
}
export const DEFAULT_THRESHOLDS: ReplanThresholds = {
  dryOutDaysCover: 3, ullageMarginPct: 8, demurrageInr: 30_000_000, costVariancePct: 7, qtyChangePct: 10,
};

export type ReplanLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export interface ReplanDecision {
  level: ReplanLevel;
  label: string;
  reasons: string[];
  blast: { voyages: number; nodes: number; fromDay: number | null; toDay: number | null };
  recommend: string;
}
const LABEL: Record<ReplanLevel, string> = {
  L0: 'Actualize only', L1: 'Local adjustment', L2: 'Local repair',
  L3: 'Partial network replan', L4: 'Full-horizon replan',
};
const RECO: Record<ReplanLevel, string> = {
  L0: 'Update ETA / stock / berth status — the operating plan still holds.',
  L1: 'Nudge one call (speed, berth time, or tank); vessel and cargo assignments stand.',
  L2: 'Repair the affected vessel / cargo / location over a short window.',
  L3: 'Re-optimise the affected stream over the next 1–2 weeks.',
  L4: 'Re-plan the remaining horizon and charter coverage.',
};

export function classifyReplan(
  input: EngineInput, baseVoy: Voyage[], breaches: string[], thresholds: ReplanThresholds,
  solved?: { kpis: Kpis; unservedNodes: number }, baselineKpi?: Kpis | null,
): ReplanDecision {
  const o: EngineOptions = input.options ?? {};
  const reasons: string[] = [];
  const affectedDays: number[] = [];
  const riskNodes = new Set<string>();

  // Blast radius — which committed voyages the disruption disturbs.
  const off = new Set(o.excludeVessels ?? []);
  const vDelay = new Map((o.vesselDelays ?? []).map(d => [d.vesselId, d.availFromDay]));
  const closures = o.portClosures ?? [];
  const outages = o.tankOutages ?? [];
  const flowNodes = new Set([...(o.flowOverrides ?? []), ...(o.emergencyDemands ?? [])].map(f => `${f.locationId}|${f.productId}`));
  // Nodes the disruption actually touches — the only ones where "thin cover" is a NEW risk
  // rather than the optimiser's intended just-in-time delivery on a healthy baseline.
  const affectedNodeKeys = new Set<string>(flowNodes);
  for (const c of closures) for (const t of input.tanks) if (t.locationId === c.locationId) affectedNodeKeys.add(`${t.locationId}|${t.productId}`);
  for (const t of outages) affectedNodeKeys.add(`${t.locationId}|${t.productId}`);
  let affectedVoy = 0;
  for (const v of baseVoy) {
    let hit = false;
    if (v.vesselId && off.has(v.vesselId)) hit = true;
    const dd = v.vesselId ? vDelay.get(v.vesselId) : undefined; if (dd != null && v.startDay < dd) hit = true;
    for (const s of v.stops) {
      for (const c of closures) if (s.locationId === c.locationId && s.arriveDay >= c.fromDay && s.arriveDay <= c.toDay) hit = true;
      for (const t of outages) if (s.locationId === t.locationId && s.arriveDay >= t.fromDay && s.arriveDay <= t.toDay) hit = true;
      for (const op of s.ops) if (flowNodes.has(`${s.locationId}|${op.productId}`)) hit = true;
    }
    if (hit) { affectedVoy++; affectedDays.push(v.startDay, v.endDay); for (const s of v.stops) for (const op of s.ops) if (op.op === 'DISCHARGE') affectedNodeKeys.add(`${s.locationId}|${op.productId}`); }
  }

  // Hard breaches (from the independent validator) → reasons.
  const hard = breaches.length > 0;
  if (breaches.some(b => b.startsWith('Dry-out'))) reasons.push('projected stock-out');
  if (breaches.some(b => b.startsWith('Tank-top'))) reasons.push('tank-top');
  if (breaches.some(b => b.startsWith('Closure'))) reasons.push('berth closure blocks a committed call');
  if (breaches.some(b => b.startsWith('Delay'))) reasons.push('vessel not ready for a committed voyage');
  if (breaches.some(b => b.startsWith('Draft') || b.startsWith('Capacity'))) reasons.push('vessel/berth constraint violated');
  const breachNodes = breaches.filter(b => b.startsWith('Dry-out') || b.startsWith('Tank-top')).length;

  // Soft service risk — thin cover that hasn't breached the floor yet but crosses the threshold.
  const inv = new InventoryModel(input);
  for (const voy of baseVoy) for (const s of voy.stops) for (const op of s.ops)
    inv.addOp(s.locationId, op.productId, s.arriveDay, op.op === 'LOAD' ? -op.qty : op.qty);
  let thin = 0;
  for (const t of input.tanks) {
    const n = inv.node(t.locationId, t.productId); if (!n || n.netDaily >= 0) continue;
    if (!affectedNodeKeys.has(`${t.locationId}|${t.productId}`)) continue; // only disruption-touched nodes
    let minStock = Infinity; for (let d = 0; d <= inv.horizon; d++) minStock = Math.min(minStock, inv.stockAt(t.locationId, t.productId, d));
    const cover = (minStock - t.minStock) / Math.max(1, -n.netDaily);
    if (minStock >= t.minStock && cover < thresholds.dryOutDaysCover) { thin++; riskNodes.add(`${t.locationId}|${t.productId}`); affectedDays.push(Math.round(cover)); }
  }
  if (thin) reasons.push(`thin cover (< ${thresholds.dryOutDaysCover} d) at ${thin} node(s)`);

  // Disruption context.
  if (off.size) reasons.push(`${off.size} vessel(s) off-hire/diverted`);
  if ((o.vesselDelays ?? []).length) reasons.push('vessel delayed');
  if (closures.length) reasons.push('berth closure in window');

  // Cost / demurrage — only meaningful once a recovery has been solved.
  const prolongedClosure = closures.some(c => c.toDay - c.fromDay >= 7);
  const vesselLoss = off.size > 0;
  let costVar = 0, multiShort = 0;
  if (solved) {
    multiShort = solved.unservedNodes;
    if (solved.kpis.demurrage > thresholds.demurrageInr) reasons.push(`demurrage ₹${(solved.kpis.demurrage / 1e6).toFixed(1)}M over tolerance`);
    if (baselineKpi && baselineKpi.totalCost > 0) {
      costVar = ((solved.kpis.totalCost - baselineKpi.totalCost) / baselineKpi.totalCost) * 100;
      if (costVar > thresholds.costVariancePct) reasons.push(`recovery cost +${costVar.toFixed(0)}% vs baseline`);
    }
    if (multiShort > 0) reasons.push(`${multiShort} node(s) unserved after replan`);
  }

  const fromDay = affectedDays.length ? Math.min(...affectedDays) : null;
  const toDay = affectedDays.length ? Math.max(...affectedDays) : null;
  const window = fromDay != null && toDay != null ? toDay - fromDay : 0;
  const nodeCount = riskNodes.size + breachNodes;

  const servedLow = solved != null && solved.kpis.demandServedPct < 95;
  let level: ReplanLevel;
  if (!hard && thin === 0 && affectedVoy === 0) level = 'L0';
  else if (!hard && affectedVoy <= 1 && nodeCount <= 1) level = 'L1';
  else {
    level = 'L2';
    if (affectedVoy >= 3 || window >= 7 || nodeCount >= 2) level = 'L3';
    if (affectedVoy > 5 || prolongedClosure || multiShort >= 2 || servedLow || (vesselLoss && affectedVoy >= 3) || costVar > thresholds.costVariancePct * 2) level = 'L4';
  }
  if (!reasons.length) reasons.push('within all buffers');

  return { level, label: LABEL[level], reasons, blast: { voyages: affectedVoy, nodes: nodeCount, fromDay, toDay }, recommend: RECO[level] };
}
