import { EngineInput, Voyage } from './types';
import { InventoryModel } from './inventory';

/**
 * Independent hard-constraint re-check (spec §8) — rebuilds inventory from the
 * returned voyages and verifies no dry-out / tank-top, compartment capacity, and
 * draft admissibility (load-dependent: a part-laden vessel may call a shallower port).
 * Runs separately from the solver's own bookkeeping.
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
    const totalCap = Math.max(1, (v?.compartments ?? []).reduce((s, c) => s + c.cap, 0));
    // Draft alongside scales with cargo aboard: ballast → laden across the compartment fill.
    const draftAt = (aboard: number) => v ? v.draftBallast + (v.draftLaden - v.draftBallast) * Math.min(1, Math.max(0, aboard) / totalCap) : 0;
    let aboard = 0;
    for (const stop of voy.stops) {
      const loadHere = stop.ops.filter(o => o.op === 'LOAD').reduce((s, o) => s + o.qty, 0);
      const dischHere = stop.ops.filter(o => o.op === 'DISCHARGE').reduce((s, o) => s + o.qty, 0);
      // Draft — check the deepest condition while alongside (after loading here / on arrival to discharge).
      const bs = berthsByLoc.get(stop.locationId);
      const dHere = draftAt(aboard + loadHere);
      if (v && bs && bs.length && !bs.some(b => b.maxDraft >= dHere - 1e-6))
        breaches.push(`Draft: ${voy.vesselName} (${dHere.toFixed(1)}m laden here) cannot berth at ${locName.get(stop.locationId) ?? stop.locationId}`);
      for (const op of stop.ops) {
        // Compartment capacity
        const cap = capById.get(op.compartmentId);
        if (cap !== undefined && op.qty > cap + 1e-6)
          breaches.push(`Capacity: ${op.qty} MT into ${voy.vesselName}/${op.compartmentId} (cap ${cap})`);
        // Apply to inventory on the arrival day (matches the engine's bookkeeping).
        inv.addOp(stop.locationId, op.productId, stop.arriveDay, op.op === 'LOAD' ? -op.qty : op.qty);
      }
      aboard += loadHere - dischHere;
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
