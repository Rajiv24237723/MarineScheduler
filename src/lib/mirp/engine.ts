import { EngineInput, SolveResult, Kpis } from './types';
import { InventoryModel } from './inventory';
import { search } from './alns';
import { computeDuals } from './duals';
import { validate } from './validate';

/**
 * Operational MIRP solve (Model B). Heuristic-first per spec §6.1/§10.5:
 * seeded multi-start greedy construction (voyages honouring compartment/product
 * compatibility, berth/draft, and hard no-stockout), spot-charter recommendation
 * when the owned/TC fleet is short, LP-dual bottleneck analytics, and an
 * independent post-solve validator. Two-phase feasibility: a feasible plan has
 * zero unserved; otherwise the shortfall + binding cause is reported.
 */
export async function solve(input: EngineInput): Promise<SolveResult> {
  const { out, inv } = search(input);

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

  const kpis: Kpis = {
    totalCost: Math.round(totalCost),
    demurrage: Math.round(demurrage),
    utilizationPct: ownedCount ? Math.round((usedOwned / ownedCount) * 100) : 0,
    dryOutDays: dryOutNodes,
    tankTopDays: tankTopNodes,
    voyageCount: out.voyages.length,
    charterRecommendationCount: out.recommendations.length,
    demandServedPct,
  };

  const message = achievable
    ? `Feasible plan: ${out.voyages.length} voyage(s), all demand served within tank & fleet limits${out.recommendations.length ? `, incl. ${out.recommendations.length} spot-charter recommendation(s)` : ''}.`
    : `Plan NOT fully achievable — ${Math.round(unservedMt).toLocaleString()} MT of demand cannot be served (see unserved). ${out.recommendations.length} charter recommendation(s) issued.`;

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
    validation,
    message,
  };
}
