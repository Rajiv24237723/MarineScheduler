/**
 * P1 benchmark runner. Prints, per instance: the LP-relaxation lower bound, the
 * P2 tightened bound (trip-rounding valid inequality), the heuristic's feasible
 * cost, and the optimality gap.
 *
 *   npm run bench
 */

import { benchmark } from './core';
import { bundled } from './instances';
import { generateInstance } from './generate';

const M = (n: number) => isFinite(n) ? '₹' + (n / 1e6).toFixed(2) + 'M' : '—';
const pct = (n: number) => isFinite(n) ? n.toFixed(1) + '%' : '—';
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);

async function main() {
  const instances = [...bundled, generateInstance(1000), generateInstance(1001)];

  console.log('\nMIRPLib-style core benchmark — heuristic (UB) vs valid lower bound (LB)\n');
  console.log([pad('instance', 28), pad('LB relax', 11), pad('LB +cut(P2)', 12), pad('UB heur', 11), pad('gap', 8), 'feasible'].join(' '));
  console.log('-'.repeat(84));
  for (const inst of instances) {
    const r = await benchmark(inst);
    console.log([
      pad(r.name, 28), pad(M(r.lbRelax), 11), pad(M(r.lbCut), 12), pad(M(r.ub), 11),
      pad(pct(r.gapCutPct), 8), r.feasible ? 'yes' : `NO (${r.note})`,
    ].join(' '));
  }
  console.log('-'.repeat(84));
  console.log('LB = valid floor on cost (loaded legs only; omits ballast/return, so it under-estimates).');
  console.log('gap = (UB − LB+cut) / LB+cut — an upper bound on the true optimality gap.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
