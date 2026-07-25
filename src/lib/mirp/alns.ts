import { EngineInput } from './types';
import { InventoryModel } from './inventory';
import { runGreedy, GreedyOutput } from './greedy';
import { rng } from './distance';

export interface SearchResult { out: GreedyOutput; inv: InventoryModel; cost: number; unservedMt: number; }

/**
 * Seeded multi-start improvement over the greedy constructor (GRASP-style).
 * Attempt 0 is the deterministic baseline; further attempts perturb the
 * source/route/urgency ranking to explore alternative constructions. Keeps the
 * best feasible plan (fewest unserved MT, then lowest cost). Deterministic for
 * a given seed so demos reproduce exactly.
 */
export function search(input: EngineInput): SearchResult {
  const attempts = Math.max(1, input.options?.alnsIterations ?? 12);
  const seed = input.options?.seed ?? 20260724;

  let best: SearchResult | null = null;
  for (let k = 0; k < attempts; k++) {
    const inv = new InventoryModel(input);
    const rand = k === 0 ? () => 0.5 : rng(seed + k * 7919);
    const out = runGreedy(input, inv, rand);
    const cost = out.voyages.reduce((s, v) => s + v.cost, 0);
    const unservedMt = out.unserved.reduce((s, u) => s + u.shortfallMt, 0);
    const better = !best || unservedMt < best.unservedMt || (unservedMt === best.unservedMt && cost < best.cost);
    if (better) best = { out, inv, cost, unservedMt };
    // Feasibility is the priority — once a plan serves all demand, take it and stop
    // (do a couple of extra passes first for a little cost improvement).
    if (best.unservedMt === 0 && k >= 2) break;
  }
  return best!;
}
