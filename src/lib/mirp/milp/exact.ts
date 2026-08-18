/**
 * Exact arc-flow solve per stream, reported against the heuristic.
 *
 *   npm run exact            all three streams
 *   npm run exact -- LNG     one stream
 *
 * Prints, per stream: model size, whether the exact model is attempted at all, its
 * LP relaxation (a real bound, unlike the aggregated one), the MIP result if it
 * closes, and the heuristic's plan for comparison.
 *
 * Run with the server stopped — PGlite is single-connection.
 */

import { db, getDb } from '../../../db/index';
import * as schema from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { solve } from '../engine';
import { validate } from '../validate';
import { formulate, solveArcFlow, ARCFLOW_BINARY_GUARD } from './arcflow';
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
  await getDb();
  const only = process.argv.slice(2).filter(a => /^(POL|CRUDE|LNG)$/i.test(a)).map(a => a.toUpperCase());
  const streams = only.length ? only : ['LNG', 'CRUDE', 'POL'];
  const limit = Number(process.env.SOLVE_TIME_LIMIT_SEC ?? 120);

  console.log(`\nExact arc-flow MIRP vs heuristic  (time limit ${limit}s per solve, guard ${ARCFLOW_BINARY_GUARD.toLocaleString()} binaries)\n`);

  for (const stream of streams) {
    const input = await loadStream(stream);
    if (!input.tanks.length) { console.log(pad(stream, 7), 'no data — seed first'); continue; }

    const shape = formulate(input).meta;
    console.log(`${pad(stream, 7)} model: ${shape.size.vars.toLocaleString()} vars (${shape.size.binaries.toLocaleString()} binary) · ${shape.size.rows.toLocaleString()} rows · ${shape.size.nonZeros.toLocaleString()} nonzeros · ${shape.arcs.toLocaleString()} arcs`);

    const heur = await solve(input);
    console.log(`${pad('', 7)} heuristic: ${M(heur.kpis.totalCost)} · ${heur.kpis.voyageCount} voyages · ${heur.kpis.demandServedPct}% served`);

    if (shape.size.binaries > ARCFLOW_BINARY_GUARD) {
      console.log(`${pad('', 7)} exact: SKIPPED — ${shape.size.binaries.toLocaleString()} binaries over the guard. Use npm run gap for a bound.\n`);
      continue;
    }

    const relax = await solveArcFlow(input, { relaxIntegrality: true, timeLimitSec: limit });
    console.log(`${pad('', 7)} LP relaxation: ${M(relax.objective)} (${relax.status}, ${relax.wallMs}ms) — a real floor: hulls must be somewhere`);

    const exact = await solveArcFlow(input, { timeLimitSec: limit, mipGap: 0.01 });
    const gapVsHeur = relax.objective && relax.objective > 0
      ? Math.round(((heur.kpis.totalCost - relax.objective) / relax.objective) * 1000) / 10 : null;
    console.log(`${pad('', 7)} exact MIP    : objective ${M(exact.objective)} (${exact.status}${exact.proven ? ', PROVED OPTIMAL' : ''}, ${exact.wallMs}ms) · ${exact.voyages.length} voyages · unserved ${exact.unservedMt.toLocaleString()} MT`);
    if (gapVsHeur != null) console.log(`${pad('', 7)} heuristic is at most ${gapVsHeur.toFixed(1)}% above the LP floor`);

    if (exact.voyages.length) {
      // The objective and the engine's cost model are not the same function; compare
      // the plans, not the objectives.
      const repriced = exact.voyages.reduce((s, v) => s + v.cost, 0);
      const liftedMip = exact.voyages.reduce((s, v) => s + v.stops.reduce((a, st) => a + st.ops.reduce((x, o) => x + (o.op === 'DISCHARGE' ? o.qty : 0), 0), 0), 0);
      const v = validate(input, exact.voyages);
      console.log(`${pad('', 7)} MIP plan re-priced on the engine's cost model: ${M(repriced)} vs heuristic ${M(heur.kpis.totalCost)} (lifted ${Math.round(liftedMip / 1000)}k vs ${Math.round((heur.kpis.liftedMt ?? 0) / 1000)}k MT)`);
      console.log(`${pad('', 7)} independent validator on the MIP plan: ${v.ok ? 'PASS' : `${v.breaches.length} breach(es)`}`);
      if (!v.ok) for (const b of v.breaches.slice(0, 4)) console.log(`${pad('', 9)} ${b}`);
    }
    if (exact.message) console.log(`${pad('', 7)} note: ${exact.message}`);
    console.log('');
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
