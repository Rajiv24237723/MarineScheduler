/**
 * Gap report — how far the heuristic's plan is from a provable floor, per stream.
 *
 *   npx tsx src/lib/mirp/milp/report.ts
 *
 * Reads the seeded network straight from the database, solves each stream with the
 * production heuristic for an upper bound, and bounds the same instance from below
 * with the aggregated MILP. The gap it prints is an upper bound on true
 * sub-optimality: the real gap is no worse than this, and probably better, because
 * the floor deliberately under-charges (see bound.ts).
 */

import { db } from '../../../db/index';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { solve } from '../engine';
import { computeGap } from './bound';
import { EngineInput } from '../types';

const M = (n: number | null | undefined) => n == null ? '—' : `₹${(n / 1e6).toFixed(1)}M`;
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);

async function loadStream(stream: string): Promise<EngineInput> {
  const [products, locations, vessels, tanks, nodeFlows, berths, compatibility, planLines, periods] = await Promise.all([
    db.select().from(schema.products).where(eq(schema.products.stream, stream)),
    db.select().from(schema.locations).where(eq(schema.locations.stream, stream)),
    db.select().from(schema.vessels).where(eq(schema.vessels.stream, stream)),
    db.select().from(schema.tanks).where(eq(schema.tanks.stream, stream)),
    db.select().from(schema.nodeFlows).where(eq(schema.nodeFlows.stream, stream)),
    db.select().from(schema.berths).where(eq(schema.berths.stream, stream)),
    db.select().from(schema.productCompatibility).where(eq(schema.productCompatibility.stream, stream)),
    db.select().from(schema.planLines).where(eq(schema.planLines.stream, stream)),
    db.select().from(schema.planPeriods).where(eq(schema.planPeriods.stream, stream)),
  ]);
  const open = periods.find(p => p.status === 'Open') ?? periods.sort((a, b) => b.code.localeCompare(a.code))[0];
  return {
    stream, startDate: open?.startDate ?? '2026-07-01', horizonDays: open?.horizonDays ?? 30,
    products: products as any, locations: locations as any, vessels: vessels as any,
    tanks: tanks as any, nodeFlows: nodeFlows as any, berths: berths as any,
    compatibility: compatibility as any, planLines: planLines as any,
  };
}

async function main() {
  console.log('\nOptimality gap — heuristic plan vs provable floor\n');
  console.log([pad('stream', 8), pad('required', 10), pad('lifted', 10), pad('×req', 6), pad('LP floor', 10), pad('+cuts', 10), pad('heuristic', 11), pad('gap ≤', 9), 'trips (floor/plan)'].join(' '));
  console.log('-'.repeat(104));

  for (const stream of ['POL', 'CRUDE', 'LNG']) {
    const input = await loadStream(stream);
    if (!input.tanks.length) { console.log(pad(stream, 8), 'no data — seed the database first'); continue; }
    const plan = await solve(input);
    const g = await computeGap(input, plan.kpis.totalCost, { timeLimitSec: 30 });
    const lifted = plan.kpis.liftedMt ?? 0;
    console.log([
      pad(stream, 8),
      pad(`${(g.requiredMt / 1000).toFixed(0)}k`, 10),
      pad(`${(lifted / 1000).toFixed(0)}k`, 10),
      pad(g.requiredMt ? `${(lifted / g.requiredMt).toFixed(2)}×` : '—', 6),
      pad(M(g.lpBound), 10),
      pad(M(g.mipBound), 10),
      pad(M(g.incumbent), 11),
      pad(g.gapPct == null ? '—' : `${g.gapPct.toFixed(0)}%`, 9),
      `${g.minTrips ?? '—'} / ${plan.kpis.voyageCount}   ${g.proven ? 'proved' : g.status} ${g.wallMs}ms`,
    ].join(' '));
    if (g.breakdown) {
      const b = g.breakdown;
      console.log(pad('', 8), `floor: laden bunker ${M(b.bunkerLaden)} · ballast ${M(b.bunkerBallast)} · freight ${M(b.freight)} · port DA ${M(b.portDA)}`);
      console.log(pad('', 8), `plan : bunker ${M(plan.kpis.costBreakdown?.bunker)} · freight ${M(plan.kpis.costBreakdown?.freight)} · port DA ${M(plan.kpis.costBreakdown?.portDA)} · demurrage ${M(plan.kpis.costBreakdown?.demurrage)}`);
    }
    if (g.message) console.log(pad('', 8), `note: ${g.message}`);
  }

  console.log('-'.repeat(104));
  console.log('READ THIS BEFORE QUOTING THE GAP. The floor is valid but not tight, so these numbers');
  console.log('bound sub-optimality without measuring it. Stacked individually-valid concessions make it');
  console.log('unreachable: the floor lets every hull begin exactly where it is needed (no positioning');
  console.log('leg, hence ₹0 ballast), serves each destination from its NEAREST source regardless of what');
  console.log('is actually stored there, allows one day alongside per call against the engine\'s 1.25×');
  console.log('padded port time, and charges no demurrage or tank changeover.');
  console.log('');
  console.log('"required" is only the volume needed to hold every node above its floor. Lifting more is a');
  console.log('policy choice — cover, tank-top limits, multi-drop efficiency — that the floor does not price,');
  console.log('so part of each gap is policy rather than inefficiency.');
  console.log('');
  console.log('Certifying optimality needs the arc-flow relaxation, where vessel flow conservation forces a');
  console.log('hull to actually be somewhere and hire accrues over the whole voyage.\n');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
