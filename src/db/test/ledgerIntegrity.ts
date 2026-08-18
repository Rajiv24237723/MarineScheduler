/**
 * Does the hash chain catch tampering that bypasses the application?
 *
 *   npm run ledger:test        (exits non-zero on failure)
 *
 * Simulates the threat the chain exists for: someone with direct database access
 * editing or removing a settled row. The trigger is disabled first, because an
 * attacker with DDL rights would do exactly that — the question is whether the
 * chain still notices. Restores the database from seed afterwards, so it is safe
 * to run against a working copy.
 *
 * Run with the server stopped: PGlite is single-connection.
 */
import { getDb } from '../index';
import { verifyChain, installLedgerGuards } from '../ledger';
import { seed } from '../seed';
import { sql } from 'drizzle-orm';

const TABLES = sql`
  charter_recommendations, voyage_ops, voyage_stops, voyages, actuals,
  schedule_versions, scenarios, plan_periods, plan_lines, node_flows,
  berths, product_compatibility, tanks, vessels, locations, products`;

(async () => {
  const db = await getDb();
  const PID = 'pp_pol_2026-06';

  /** Establish the baseline rather than assuming it — a test that inherits state
   *  from the last run reports on the wrong thing. */
  async function reseed() {
    await db.execute(sql`truncate table ${TABLES}`);
    await installLedgerGuards();
    await seed(db);
  }

  await reseed();
  const before = await verifyChain('actuals', 'POL', PID);
  console.log(`baseline : sealed=${before.sealed} intact=${before.intact} — ${before.message}`);

  const row: any = await db.execute(sql`select id, cost from actuals where period_id = ${PID} order by id limit 1`);
  const target = (Array.isArray(row) ? row : row.rows)[0];
  console.log(`\ntampering with ${target.id}: cost ${target.cost} -> ${Number(target.cost) + 1_000_000}`);

  await db.execute(sql`alter table actuals disable trigger actuals_settled_guard`);
  await db.execute(sql`update actuals set cost = ${Number(target.cost) + 1_000_000} where id = ${target.id}`);
  await db.execute(sql`alter table actuals enable trigger actuals_settled_guard`);

  const afterEdit = await verifyChain('actuals', 'POL', PID);
  console.log(`\nafter edit  : intact=${afterEdit.intact} tampered=[${afterEdit.tampered.join(',')}]`);
  console.log(`              ${afterEdit.message}`);

  // Now remove a row entirely — the walk should break.
  await db.execute(sql`alter table actuals disable trigger actuals_settled_guard`);
  await db.execute(sql`update actuals set cost = ${Number(target.cost)} where id = ${target.id}`); // undo the edit
  const mid: any = await db.execute(sql`select id from actuals where period_id = ${PID} order by id offset 5 limit 1`);
  const victim = (Array.isArray(mid) ? mid : mid.rows)[0];
  await db.execute(sql`delete from actuals where id = ${victim.id}`);
  await db.execute(sql`alter table actuals enable trigger actuals_settled_guard`);

  const afterDelete = await verifyChain('actuals', 'POL', PID);
  console.log(`\nafter deleting ${victim.id}: intact=${afterDelete.intact} orphaned=${afterDelete.orphaned.length} chained=${afterDelete.chained}/${afterDelete.rows}`);
  console.log(`              ${afterDelete.message}`);

  const detected = before.intact
    && !afterEdit.intact && afterEdit.tampered.includes(target.id)
    && !afterDelete.intact && afterDelete.orphaned.length > 0;

  // Leave the database clean for whoever runs next.
  await reseed();
  const restored = await verifyChain('actuals', 'POL', PID);
  console.log(`\nrestored : sealed=${restored.sealed} intact=${restored.intact} rows=${restored.rows}`);

  const pass = detected && restored.intact;
  console.log(pass
    ? '\nRESULT: PASS — mutation and deletion both detected; database restored clean.'
    : `\nRESULT: FAIL — ${!detected ? 'tampering went unnoticed' : 'restore did not verify'}.`);
  process.exit(pass ? 0 : 1);
})();
