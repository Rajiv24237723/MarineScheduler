/**
 * Seeded generator of MIRPLib-style single-product core instances, for the P3
 * regression suite. Instances are sized to be comfortably feasible (ample
 * supply, fleet and ullage) so the suite guards solver quality and determinism,
 * not corner-case feasibility. Same seed → identical instance.
 */

import { CoreInstance, CorePort, demandDeficit, supplyAvail } from './core';
import { rng } from '../distance';

export interface GenOpts { ports?: number; vessels?: number; horizon?: number; }

export function generateInstance(seed: number, opts: GenOpts = {}): CoreInstance {
  const rand = rng(seed >>> 0);
  const ri = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo + 1));
  const nPorts = opts.ports ?? ri(4, 6);
  const nVessels = opts.vessels ?? ri(2, 4);
  const horizon = opts.horizon ?? 30;
  const nSupply = Math.max(1, Math.round(nPorts * 0.4));

  const ports: CorePort[] = [];
  for (let i = 0; i < nPorts; i++) {
    if (i < nSupply) {
      ports.push({ id: `S${i}`, kind: 'S', rate: ri(3000, 6000), init: ri(60000, 110000), smin: 5000, smax: 400000 });
    } else {
      ports.push({ id: `D${i - nSupply}`, kind: 'D', rate: ri(900, 2000), init: ri(16000, 30000), smin: 3000, smax: 80000 });
    }
  }

  // symmetric integer travel-day matrix (2..8), zero diagonal
  const travel: number[][] = Array.from({ length: nPorts }, () => Array(nPorts).fill(0));
  for (let i = 0; i < nPorts; i++)
    for (let j = i + 1; j < nPorts; j++) { const d = ri(2, 8); travel[i][j] = d; travel[j][i] = d; }

  // capacities sized so the fleet can comfortably cover total deficit
  const totalDeficit = ports.filter(p => p.kind === 'D').reduce((s, p) => s + demandDeficit(p, horizon), 0);
  const totalSupply = ports.filter(p => p.kind === 'S').reduce((s, p) => s + supplyAvail(p, horizon), 0);
  const cap = Math.max(20000, Math.ceil(totalDeficit / Math.max(1, nVessels) / 2 / 1000) * 1000);
  const vessels = Array.from({ length: nVessels }, (_, k) => ({ id: `v${k + 1}`, cap: cap + ri(-2000, 2000) }));

  // guard: if supply can't cover demand, scale a supply port up (keeps instances feasible)
  if (totalSupply < totalDeficit * 1.3) ports[0].init += Math.ceil((totalDeficit * 1.3 - totalSupply));

  return { name: `gen-${seed}`, horizon, charterPerDay: 100_000, ports, vessels, travel };
}

/** A deterministic suite of K instances. */
export function generateSuite(count: number, baseSeed = 1000): CoreInstance[] {
  return Array.from({ length: count }, (_, k) => generateInstance(baseSeed + k));
}
