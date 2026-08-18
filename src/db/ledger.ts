import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from './index';

/**
 * Ledger integrity for the two tables a cost figure can be argued over: `actuals`
 * (what execution cost) and `schedule_versions` (what was planned, and when).
 *
 * Two independent controls, both keyed on the same event — a month closing:
 *
 * 1. Database-enforced immutability. A trigger — the same DDL in PGlite and in
 *    production Postgres, which is the payoff of running one dialect — rejects
 *    UPDATE and DELETE on any row belonging to a Closed period.
 *
 * 2. A hash chain, written when the period is sealed at close. Each row carries a
 *    digest of its material fields plus the previous row's digest, so the settled
 *    record is verifiable without trusting the storage layer. Editing a row breaks
 *    its digest; removing one breaks the walk. Verification follows `prev_hash`
 *    links rather than assuming a sort order, so it catches deletion and
 *    reordering as well as mutation.
 *
 * Sealing at close rather than at insert is deliberate, and the first design here
 * got it wrong. During an open month actuals are working data: imported,
 * corrected, re-simulated. Chaining on insert meant a legitimate correction left a
 * stale digest, so verification reported tampering on honest work — a false
 * positive that would train people to ignore the control. A chain and in-place
 * editing cannot both be right. The record becomes tamper-evident at the moment it
 * becomes final, which is also the moment anyone would want to rely on it.
 */

export const LEDGER_SCHEMA_VERSION = 1;

/** Fields that define an actuals row. Anything not listed here is presentation. */
function actualMaterial(r: Record<string, any>): string {
  return JSON.stringify([
    r.id, r.stream, r.periodId, r.versionId ?? null, r.planVoyageId ?? null,
    r.vesselName, r.vesselClass, r.pool,
    r.fromLocationId ?? null, r.toLocationId ?? null, r.productId ?? null,
    round(r.qtyMt), r.startDay, r.endDay, round(r.cost),
    r.costBreakdown ? [round(r.costBreakdown.bunker), round(r.costBreakdown.freight), round(r.costBreakdown.portDA), round(r.costBreakdown.demurrage), round(r.costBreakdown.changeover)] : null,
    r.status, r.source, r.createdAt, r.schemaVersion ?? LEDGER_SCHEMA_VERSION,
  ]);
}

/** Fields that define a version row. Mutable lifecycle fields are excluded by design. */
function versionMaterial(r: Record<string, any>): string {
  return JSON.stringify([
    r.id, r.stream, r.version, r.periodId ?? null, r.parentId ?? null,
    r.trigger, round(r.objectiveCost), r.achievable === true || r.achievable === 1,
    r.createdAt, r.schemaVersion ?? LEDGER_SCHEMA_VERSION,
  ]);
}

const round = (n: any) => n == null ? null : Math.round(Number(n) * 1e4) / 1e4;

export function digest(material: string, prevHash: string | null): string {
  return createHash('sha256').update(`${prevHash ?? 'genesis'}\n${material}`).digest('hex');
}

type Kind = 'actuals' | 'schedule_versions';
const materialOf: Record<Kind, (r: Record<string, any>) => string> = {
  actuals: actualMaterial,
  schedule_versions: versionMaterial,
};

const rowsOf = (res: any): any[] => Array.isArray(res) ? res : res?.rows ?? [];

/**
 * Seal a period: write the hash chain over its actuals and its versions. Called
 * when the month closes, at which point the trigger also makes the rows immutable,
 * so the digests can never go stale.
 *
 * Rows are chained in (created_at, id) order. Verification does not rely on that
 * order — it follows the prev_hash links — but a deterministic order at seal time
 * makes the result reproducible.
 */
export async function sealPeriod(stream: string, periodId: string): Promise<{ actuals: number; versions: number }> {
  const db = await getDb();
  const counts = { actuals: 0, versions: 0 };
  for (const kind of ['actuals', 'schedule_versions'] as Kind[]) {
    const res = await db.execute(sql`
      select * from ${sql.raw(kind)}
      where stream = ${stream} and period_id = ${periodId}
      order by created_at asc, id asc
    `);
    const rows = rowsOf(res).map(camel);
    let prev: string | null = null;
    for (const r of rows) {
      const withMeta = { ...r, schemaVersion: r.schemaVersion ?? LEDGER_SCHEMA_VERSION, prevHash: prev };
      const h = digest(materialOf[kind](withMeta), prev);
      await db.execute(sql`
        update ${sql.raw(kind)}
        set prev_hash = ${prev}, hash = ${h}, schema_version = ${withMeta.schemaVersion}
        where id = ${r.id}
      `);
      prev = h;
    }
    counts[kind === 'actuals' ? 'actuals' : 'versions'] = rows.length;
  }
  return counts;
}

export interface LedgerVerdict {
  kind: Kind;
  stream: string;
  periodId: string;
  sealed: boolean;
  rows: number;
  chained: number;      // rows reachable by following prev_hash from genesis
  intact: boolean;
  tampered: string[];   // ids whose recomputed digest does not match the stored one
  orphaned: string[];   // ids not reachable from genesis — implies a row was removed
  unsealed: number;     // rows in the period carrying no digest
  message: string;
}

/** Recompute and walk one period's chain. Detects mutation, deletion and reordering. */
export async function verifyChain(kind: Kind, stream: string, periodId: string): Promise<LedgerVerdict> {
  const db = await getDb();
  const res: any = await db.execute(sql`
    select * from ${sql.raw(kind)} where stream = ${stream} and period_id = ${periodId}
  `);
  const rows: any[] = rowsOf(res);

  // Postgres returns snake_case; map to the camelCase the material functions expect.
  type ChainRow = Record<string, any> & { id: string; hash: string | null; prevHash: string | null };
  const norm: ChainRow[] = rows.map(r => ({
    ...camel(r),
    // keep raw hash columns under both spellings for convenience
    hash: r.hash ?? null, prevHash: r.prev_hash ?? r.prevHash ?? null,
  })) as ChainRow[];

  const unsealed = norm.filter(r => !r.hash).length;
  const chainable = norm.filter(r => r.hash);
  const sealed = chainable.length > 0 && unsealed === 0;
  const tampered: string[] = [];
  for (const r of chainable) {
    if (digest(materialOf[kind](r), r.prevHash ?? null) !== r.hash) tampered.push(r.id);
  }

  // Walk from genesis (prevHash null) following hash links.
  const byPrev = new Map<string, any>();
  for (const r of chainable) byPrev.set(r.prevHash ?? '__genesis__', r);
  let cursor = byPrev.get('__genesis__');
  const seen = new Set<string>();
  let chained = 0;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id); chained++;
    cursor = byPrev.get(cursor.hash);
  }
  const orphaned = chainable.filter(r => !seen.has(r.id)).map(r => r.id);
  // An unsealed period is not a failure — it is an open month still being worked.
  const intact = tampered.length === 0 && orphaned.length === 0;

  return {
    kind, stream, periodId, sealed, rows: norm.length, chained, intact, tampered, orphaned, unsealed,
    message: norm.length === 0 ? 'No rows in this period.'
      : !sealed ? `Not sealed — ${unsealed} of ${norm.length} row(s) carry no digest (period still open).`
        : intact ? `Sealed and verified: ${chained} of ${chainable.length} row(s) chained.`
          : `INTEGRITY FAILURE — ${tampered.length} row(s) do not match their digest; ${orphaned.length} unreachable (removed or reordered).`,
  };
}

function camel(r: Record<string, any>): Record<string, any> {
  const o: Record<string, any> = {};
  for (const k of Object.keys(r)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = r[k];
  return o;
}

/**
 * Install the immutability triggers. Idempotent, so it runs on every boot after
 * migrations. TRUNCATE deliberately does not fire row triggers, which is how a
 * full reseed stays possible without an escape hatch that could be misused.
 */
export async function installLedgerGuards(): Promise<void> {
  const db = await getDb();
  await db.execute(sql`
    create or replace function marine_block_settled() returns trigger as $$
    declare st text; pid text;
    begin
      pid := coalesce(old.period_id, new.period_id);
      if pid is null then
        return case tg_op when 'DELETE' then old else new end;
      end if;
      select status into st from plan_periods where id = pid;
      if st = 'Closed' then
        raise exception 'ledger: % on %.% rejected — planning period % is closed and its record is final',
          tg_op, tg_table_schema, tg_table_name, pid;
      end if;
      return case tg_op when 'DELETE' then old else new end;
    end;
    $$ language plpgsql;
  `);
  for (const t of ['actuals', 'schedule_versions']) {
    await db.execute(sql.raw(`drop trigger if exists ${t}_settled_guard on ${t};`));
    await db.execute(sql.raw(`
      create trigger ${t}_settled_guard
      before update or delete on ${t}
      for each row execute function marine_block_settled();
    `));
  }
}
