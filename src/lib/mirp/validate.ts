import { EngineInput, Voyage } from './types';
import { InventoryModel } from './inventory';

/**
 * Independent hard-constraint re-check (spec §8) — rebuilds inventory from the
 * returned voyages and verifies no dry-out / tank-top, compartment capacity, and
 * laden-draft admissibility. Runs separately from the solver's own bookkeeping.
 */
export function validate(input: EngineInput, voyages: Voyage[]): { ok: boolean; breaches: string[] } {
  const breaches: string[] = [];
  const inv = new InventoryModel(input);
  const locName = new Map(input.locations.map(l => [l.id, l.name]));
  const prodName = new Map(input.products.map(p => [p.id, p.name]));
  const vesselByName = new Map(input.vessels.map(v => [v.name, v]));
  const berthsByLoc = new Map<string, typeof input.berths>();
  for (const b of input.berths) { if (!berthsByLoc.has(b.locationId)) berthsByLoc.set(b.locationId, [] as any); berthsByLoc.get(b.locationId)!.push(b); }

  for (const voy of voyages) {
    const v = vesselByName.get(voy.vesselName);
    const capById = new Map((v?.compartments ?? []).map(c => [c.id, c.cap]));
    for (const stop of voy.stops) {
      // Draft
      const bs = berthsByLoc.get(stop.locationId);
      if (v && bs && bs.length && !bs.some(b => b.maxDraft >= v.draftLaden))
        breaches.push(`Draft: ${voy.vesselName} (${v.draftLaden}m) cannot berth at ${locName.get(stop.locationId) ?? stop.locationId}`);
      for (const op of stop.ops) {
        // Compartment capacity
        const cap = capById.get(op.compartmentId);
        if (cap !== undefined && op.qty > cap + 1e-6)
          breaches.push(`Capacity: ${op.qty} MT into ${voy.vesselName}/${op.compartmentId} (cap ${cap})`);
        // Apply to inventory on the arrival day (matches the engine's bookkeeping).
        inv.addOp(stop.locationId, op.productId, stop.arriveDay, op.op === 'LOAD' ? -op.qty : op.qty);
      }
    }
  }

  // No dry-out / tank-top anywhere.
  for (const t of input.tanks) {
    const dry = inv.firstDryOut(t.locationId, t.productId);
    if (dry !== null) breaches.push(`Dry-out: ${locName.get(t.locationId)}/${prodName.get(t.productId)} below floor on day ${dry}`);
    const top = inv.firstTankTop(t.locationId, t.productId);
    if (top !== null) breaches.push(`Tank-top: ${locName.get(t.locationId)}/${prodName.get(t.productId)} over ceiling on day ${top}`);
  }

  return { ok: breaches.length === 0, breaches: breaches.slice(0, 20) };
}
