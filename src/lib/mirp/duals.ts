import { EngineInput, Dual } from './types';
import { InventoryModel } from './inventory';
import { LpBuilder, solveLp, rowDuals } from '../highs';

// Value of unserved demand (INR/MT) — scales the dimensionless service duals into rupees.
const UNMET_PENALTY_PER_MT = 200000;

/**
 * Bottleneck shadow prices from a compact LP relaxation of the aggregate
 * allocation: maximise served demand subject to per-node deficit, per-product
 * supply, and total fleet capacity. A binding row's dual (× penalty) is the
 * marginal value (INR/MT) of relaxing that bottleneck. Empty when nothing binds.
 */
export async function computeDuals(input: EngineInput, inv: InventoryModel): Promise<Dual[]> {
  const H = input.horizonDays;
  const prodName = new Map(input.products.map(p => [p.id, p.name]));
  const locName = new Map(input.locations.map(l => [l.id, l.name]));

  // Demand nodes and their horizon deficit (MT to deliver to avoid dry-out).
  const demand: Array<{ loc: string; p: string; deficit: number }> = [];
  const supplyByProd = new Map<string, number>();
  for (const t of input.tanks) {
    const n = inv.node(t.locationId, t.productId)!;
    const endStock = inv.stockAt(t.locationId, t.productId, H); // exo-only projection at this point
    if (n.netDaily < 0) {
      const deficit = Math.max(0, n.smin - endStock);
      if (deficit > 0) demand.push({ loc: t.locationId, p: t.productId, deficit: Math.round(deficit) });
    } else {
      supplyByProd.set(t.productId, (supplyByProd.get(t.productId) ?? 0) + Math.max(0, endStock - n.smin));
    }
  }
  if (demand.length === 0) return [];

  // Fleet capacity proxy: Σ owned compartment capacity × feasible trips in horizon.
  const owned = input.vessels.filter(v => v.pool !== 'SPOT' && !(input.options?.excludeVessels ?? []).includes(v.id));
  const tripsPerVessel = Math.max(1, Math.floor(H / 8));
  const fleetCap = Math.round(owned.reduce((s, v) => s + v.compartments.reduce((a, c) => a + c.cap, 0) * tripsPerVessel, 0));

  const lp = new LpBuilder();
  const vn = (i: number) => `srv_${i}`;
  lp.setObjective('Maximize', demand.map((_, i) => [1, vn(i)] as [number, string]));
  demand.forEach((d, i) => {
    lp.addRow(`dem_${i}`, [[1, vn(i)]], '<=', d.deficit);
    lp.setBound(vn(i), 0, d.deficit);
  });
  // Per-product supply rows.
  const rowNames: Array<{ row: string; label: string }> = [];
  const byProd = new Map<string, number[]>();
  demand.forEach((d, i) => { if (!byProd.has(d.p)) byProd.set(d.p, []); byProd.get(d.p)!.push(i); });
  for (const [p, idxs] of byProd) {
    const cap = Math.round(supplyByProd.get(p) ?? 0);
    lp.addRow(`sup_${p}`, idxs.map(i => [1, vn(i)] as [number, string]), '<=', cap);
    rowNames.push({ row: `sup_${p}`, label: `${prodName.get(p) ?? p} source supply` });
  }
  lp.addRow('fleet', demand.map((_, i) => [1, vn(i)] as [number, string]), '<=', fleetCap);
  rowNames.push({ row: 'fleet', label: 'Owned/TC fleet capacity' });

  let sol;
  try { sol = await solveLp(lp.build()); } catch { return []; }
  if (sol.Status !== 'Optimal') return [];

  const duals = rowDuals(sol, rowNames.map(r => r.row));
  const out: Dual[] = [];
  for (const { row, label } of rowNames) {
    const d = duals[row] ?? 0;
    if (d > 1e-6) out.push({ constraint: label, shadowPrice: Math.round(d * UNMET_PENALTY_PER_MT) });
  }
  return out.sort((a, b) => b.shadowPrice - a.shadowPrice);
}
