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
  let noImprove = 0;
  for (let k = 0; k < attempts; k++) {
    const inv = new InventoryModel(input);
    const rand = k === 0 ? () => 0.5 : rng(seed + k * 7919);
    const out = runGreedy(input, inv, rand);
    const cost = out.voyages.reduce((s, v) => s + v.cost, 0);
    const unservedMt = out.unserved.reduce((s, u) => s + u.shortfallMt, 0);
    const better = !best || unservedMt < best.unservedMt || (unservedMt === best.unservedMt && cost < best.cost);
    if (better) { best = { out, inv, cost, unservedMt }; noImprove = 0; } else noImprove++;
    // Feasibility first; then keep exploring the multi-start for lower cost until it stops
    // improving for several consecutive passes (deeper than taking the first feasible plan).
    if (best.unservedMt === 0 && noImprove >= 4) break;
  }
  return best!;
}

export interface AttemptProgress {
  attempt: number; elapsedMs: number;
  rawCost: number; rawUnservedMt: number;   // this construction
  bestCost: number; bestUnservedMt: number; // running best
}

/**
 * Same GRASP multi-start as `search`, but async: it reports each attempt through
 * `onAttempt` and yields to the event loop between passes so a streaming HTTP response
 * can flush the running-best trajectory live (the solve is otherwise one synchronous
 * CPU block that would buffer everything to the end).
 */
export async function searchStreaming(input: EngineInput, onAttempt: (p: AttemptProgress) => void): Promise<SearchResult> {
  const attempts = Math.max(1, input.options?.alnsIterations ?? 12);
  const seed = input.options?.seed ?? 20260724;
  const t0 = Date.now();
  let best: SearchResult | null = null;
  let noImprove = 0;
  for (let k = 0; k < attempts; k++) {
    const inv = new InventoryModel(input);
    const rand = k === 0 ? () => 0.5 : rng(seed + k * 7919);
    const out = runGreedy(input, inv, rand);
    const cost = out.voyages.reduce((s, v) => s + v.cost, 0);
    const unservedMt = out.unserved.reduce((s, u) => s + u.shortfallMt, 0);
    const better = !best || unservedMt < best.unservedMt || (unservedMt === best.unservedMt && cost < best.cost);
    if (better) { best = { out, inv, cost, unservedMt }; noImprove = 0; } else noImprove++;
    onAttempt({ attempt: k, elapsedMs: Date.now() - t0, rawCost: Math.round(cost), rawUnservedMt: Math.round(unservedMt), bestCost: Math.round(best.cost), bestUnservedMt: Math.round(best.unservedMt) });
    await new Promise<void>(r => setImmediate(r)); // let the response flush this frame
    if (best.unservedMt === 0 && noImprove >= 4) break;
  }
  return best!;
}
