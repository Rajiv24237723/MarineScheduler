/**
 * P3 regression suite. Generates a deterministic set of MIRPLib-style core
 * instances and HARD-asserts the correctness invariants for each: the heuristic
 * finds a FEASIBLE plan (no stock-out / tank-top), the bound is valid (LB ≤ UB),
 * and the result is DETERMINISTIC (same seed → same cost). Exits non-zero on any
 * invariant failure so it can gate CI.
 *
 * The optimality gap is REPORTED, not gated: the lower bound is deliberately
 * loose (it omits ballast/return legs), so a wide gap is not a regression — it's
 * a quality signal to track over time. Instances above GAP_WARN_PCT are flagged.
 *
 *   npm run bench:test
 */

import { benchmark, construct } from './core';
import { generateSuite } from './generate';

const GAP_WARN_PCT = 250; // informational only — not a failure

async function main() {
  const suite = generateSuite(14);
  let fails = 0, wide = 0;
  const gaps: number[] = [];
  console.log(`\nRegression: ${suite.length} generated instances\n`);
  console.log(['instance', 'feasible', 'LB≤UB', 'deterministic', 'gap', 'verdict'].join('\t'));

  for (const inst of suite) {
    const r = await benchmark(inst);
    const a = construct(inst, { seed: 7 });
    const b = construct(inst, { seed: 7 });
    const deterministic = a.feasible === b.feasible && a.cost === b.cost;
    const lbValid = !isFinite(r.ub) || r.lbCut <= r.ub + 1e-6;
    const pass = r.feasible && lbValid && deterministic;      // correctness invariants only
    if (!pass) fails++;
    if (isFinite(r.gapCutPct)) gaps.push(r.gapCutPct);
    const isWide = isFinite(r.gapCutPct) && r.gapCutPct > GAP_WARN_PCT;
    if (isWide) wide++;
    console.log([
      inst.name, r.feasible ? 'yes' : 'NO', lbValid ? 'ok' : 'VIOLATED',
      deterministic ? 'ok' : 'NON-DET', isFinite(r.gapCutPct) ? r.gapCutPct.toFixed(1) + '%' : '—',
      !pass ? 'FAIL' : isWide ? 'pass (wide gap)' : 'PASS',
    ].join('\t'));
  }

  const median = gaps.length ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1] : NaN;
  console.log(`\n${suite.length - fails}/${suite.length} passed correctness invariants.` +
    (fails ? ` ${fails} FAILED.` : '') +
    ` median gap ${isFinite(median) ? median.toFixed(0) + '%' : '—'}, ${wide} above ${GAP_WARN_PCT}% (informational).\n`);
  process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
