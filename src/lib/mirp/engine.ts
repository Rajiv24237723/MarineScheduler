import { EngineInput, SolveResult, Kpis, ShortfallSummary } from './types';
import { InventoryModel } from './inventory';
import { search, searchStreaming, AttemptProgress } from './alns';
import { computeDuals } from './duals';
import { validate } from './validate';
import { assessResilience } from './resilience';
import { haversineNm, sailDays } from './distance';

export type ProgressEvent =
  | { type: 'phase'; phase: string }
  | ({ type: 'attempt' } & AttemptProgress);

/**
 * Operational MIRP solve (Model B). Heuristic-first per spec §6.1/§10.5:
 * seeded multi-start greedy construction (voyages honouring compartment/product
 * compatibility, berth/draft, and hard no-stockout), spot-charter recommendation
 * when the owned/TC fleet is short, LP-dual bottleneck analytics, and an
 * independent post-solve validator. Two-phase feasibility: a feasible plan has
 * zero unserved; otherwise the shortfall + binding cause is reported.
 */
export async function solve(input: EngineInput, onProgress?: (e: ProgressEvent) => void): Promise<SolveResult> {
  onProgress?.({ type: 'phase', phase: 'construct' });
  const { out, inv } = onProgress
    ? await searchStreaming(input, a => onProgress({ type: 'attempt', ...a }))
    : search(input);
  onProgress?.({ type: 'phase', phase: 'diagnose' });

  const prodName = new Map(input.products.map(p => [p.id, p.name]));
  const locName = new Map(input.locations.map(l => [l.id, l.name]));
  const projection = inv.projections(prodName, locName);

  // Duals measured against RAW (exo-only) demand/supply, not the post-schedule state.
  const rawInv = new InventoryModel(input);
  const duals = await computeDuals(input, rawInv);

  const validation = validate(input, out.voyages);

  const achievable = out.unserved.length === 0;
  const totalCost = out.voyages.reduce((s, v) => s + v.cost, 0);
  const demurrage = out.voyages.reduce((s, v) => s + v.costBreakdown.demurrage, 0);
  const ownedCount = input.vessels.filter(v => v.pool !== 'SPOT').length;
  const usedOwned = new Set(out.voyages.filter(v => v.pool !== 'SPOT').map(v => v.vesselId)).size;
  const dryOutNodes = projection.filter(p => p.firstDryOutDay !== null).length;
  const tankTopNodes = projection.filter(p => p.firstTankTopDay !== null).length;

  // Demand served %: total horizon deficit vs unserved.
  let totalDeficit = 0;
  for (const t of input.tanks) {
    const n = rawInv.node(t.locationId, t.productId)!;
    if (n.netDaily < 0) totalDeficit += Math.max(0, n.smin - rawInv.stockAt(t.locationId, t.productId, input.horizonDays));
  }
  const unservedMt = out.unserved.reduce((s, u) => s + u.shortfallMt, 0);
  const demandServedPct = totalDeficit > 0 ? Math.round((1 - unservedMt / totalDeficit) * 100) : 100;

  // Shortfall augmentation: quantify the resource gap so the planner sees what would close it.
  let shortfall: ShortfallSummary | undefined;
  if (out.unserved.length) {
    const locById = new Map(input.locations.map(l => [l.id, l]));
    const supplyByProd = new Map<string, typeof input.locations>();
    for (const t of input.tanks) {
      const n = rawInv.node(t.locationId, t.productId);
      if (n && n.netDaily >= 0) { const l = locById.get(t.locationId); if (l) { if (!supplyByProd.has(t.productId)) supplyByProd.set(t.productId, []); supplyByProd.get(t.productId)!.push(l); } }
    }
    const avgSpeed = input.vessels.length ? input.vessels.reduce((s, v) => s + v.speed, 0) / input.vessels.length : 14;
    let earliest = Infinity;
    for (const u of out.unserved) {
      const dest = locById.get(u.locationId);
      if (dest) for (const s of supplyByProd.get(u.productId) ?? []) earliest = Math.min(earliest, sailDays(haversineNm(s, dest), avgSpeed) + 1);
    }
    const avgCap = input.vessels.length ? input.vessels.reduce((s, v) => s + v.compartments.reduce((a, c) => a + c.cap, 0), 0) / input.vessels.length : 100000;
    const avgBerthH = input.berths.length ? input.berths.reduce((s, b) => s + b.berthingHours, 0) / input.berths.length : 18;
    const avgRate = input.berths.length ? input.berths.reduce((s, b) => s + b.rateMtPerHr, 0) / input.berths.length : 2000;
    const voyages = Math.max(1, Math.ceil(unservedMt / Math.max(1, avgCap)));
    shortfall = {
      totalMt: Math.round(unservedMt),
      nodes: new Set(out.unserved.map(u => `${u.locationId}|${u.productId}`)).size,
      earliestFeasibleDay: earliest === Infinity ? null : Math.round(earliest),
      addlVesselVoyages: voyages,
      addlBerthHours: Math.round(voyages * avgBerthH + unservedMt / avgRate),
    };
  }

  const kpis: Kpis = {
    totalCost: Math.round(totalCost),
    demurrage: Math.round(demurrage),
    utilizationPct: ownedCount ? Math.round((usedOwned / ownedCount) * 100) : 0,
    dryOutDays: dryOutNodes,
    tankTopDays: tankTopNodes,
    voyageCount: out.voyages.length,
    charterRecommendationCount: out.recommendations.length,
    demandServedPct,
    resilience: assessResilience(input, out.voyages),
  };

  const message = achievable
    ? `Feasible plan: ${out.voyages.length} voyage(s), all demand served within tank & fleet limits${out.recommendations.length ? `, incl. ${out.recommendations.length} spot-charter recommendation(s)` : ''}.`
    : `Plan NOT fully achievable — ${Math.round(unservedMt).toLocaleString()} MT of demand cannot be served (see unserved). ${out.recommendations.length} charter recommendation(s) issued.`;

  onProgress?.({ type: 'phase', phase: 'done' });
  return {
    stream: input.stream,
    achievable,
    status: achievable ? 'success' : 'infeasible',
    voyages: out.voyages,
    charterRecommendations: out.recommendations,
    projection,
    duals,
    kpis,
    unserved: out.unserved,
    shortfall,
    validation,
    message,
  };
}
