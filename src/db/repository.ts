import { and, eq, inArray } from 'drizzle-orm';
import { db } from './index';
import * as schema from './schema';
import { EngineInput, EngineOptions } from '../lib/mirp/types';

/**
 * Stream-scoped repository.
 *
 * Scoping used to be remembered rather than enforced: `eq(table.stream, stream)` was
 * repeated across 35 call sites, and a dozen more fetched by id with no scope at
 * all. One forgotten clause leaks another stream's data into a view — and that is
 * not hypothetical. `/api/versions/compare` needed a hand-written cross-stream guard
 * because nothing structurally stopped a caller pairing a CRUDE version with an LNG
 * one.
 *
 * A `StreamRepo` binds the stream once. Reads are filtered, and a by-id read returns
 * null when the row belongs to a different stream, so crossing streams now requires
 * a deliberate call to `unscoped` rather than a lapse of attention. It happens to be
 * the seam a multi-tenant deployment would need, but that is not why it is here.
 */

const HORIZON_FALLBACK = 30;
const START_FALLBACK = '2026-07-01';

export type Period = typeof schema.planPeriods.$inferSelect;
export type Version = typeof schema.scheduleVersions.$inferSelect;
export type Actual = typeof schema.actuals.$inferSelect;
export type Scenario = typeof schema.scenarios.$inferSelect;

export class StreamRepo {
  constructor(readonly stream: string) {}

  private ofStream<T extends { stream: any }>(t: T) { return eq(t.stream, this.stream); }

  // --- master data --------------------------------------------------------
  products() { return db.select().from(schema.products).where(this.ofStream(schema.products)); }
  locations() { return db.select().from(schema.locations).where(this.ofStream(schema.locations)); }
  vessels() { return db.select().from(schema.vessels).where(this.ofStream(schema.vessels)); }
  tanks() { return db.select().from(schema.tanks).where(this.ofStream(schema.tanks)); }
  nodeFlows() { return db.select().from(schema.nodeFlows).where(this.ofStream(schema.nodeFlows)); }
  berths() { return db.select().from(schema.berths).where(this.ofStream(schema.berths)); }
  compatibility() { return db.select().from(schema.productCompatibility).where(this.ofStream(schema.productCompatibility)); }
  planLines() { return db.select().from(schema.planLines).where(this.ofStream(schema.planLines)); }

  // --- planning periods ---------------------------------------------------
  periods() { return db.select().from(schema.planPeriods).where(this.ofStream(schema.planPeriods)); }

  /** Newest-first by code, which sorts correctly because codes are YYYY-MM. */
  async periodsDesc(): Promise<Period[]> {
    return (await this.periods()).sort((a, b) => b.code.localeCompare(a.code));
  }

  /** The stream's live planning month: the Open one, else the latest. */
  async currentPeriod(): Promise<Period | null> {
    const rows = await this.periods();
    if (!rows.length) return null;
    const open = rows.filter(p => p.status === 'Open').sort((a, b) => b.code.localeCompare(a.code));
    return open[0] ?? rows.sort((a, b) => b.code.localeCompare(a.code))[0];
  }

  /** Null when the id exists but belongs to another stream — the point of the class. */
  async periodById(id: string): Promise<Period | null> {
    const rows = await db.select().from(schema.planPeriods)
      .where(and(eq(schema.planPeriods.id, id), this.ofStream(schema.planPeriods)));
    return rows[0] ?? null;
  }

  /** Resolve an id or a YYYY-MM code, falling back to the current period. */
  async resolvePeriod(ref?: string | null): Promise<Period | null> {
    if (ref) {
      const byId = await this.periodById(ref);
      if (byId) return byId;
      const byCode = await db.select().from(schema.planPeriods)
        .where(and(this.ofStream(schema.planPeriods), eq(schema.planPeriods.code, ref)));
      if (byCode[0]) return byCode[0];
    }
    return this.currentPeriod();
  }

  insertPeriod(row: typeof schema.planPeriods.$inferInsert) { return db.insert(schema.planPeriods).values(row); }
  updatePeriod(id: string, patch: Partial<typeof schema.planPeriods.$inferInsert>) {
    return db.update(schema.planPeriods).set(patch).where(and(eq(schema.planPeriods.id, id), this.ofStream(schema.planPeriods)));
  }
  closeAllPeriods() {
    return db.update(schema.planPeriods).set({ status: 'Closed' }).where(this.ofStream(schema.planPeriods));
  }
  deletePeriod(id: string) {
    return db.delete(schema.planPeriods).where(and(eq(schema.planPeriods.id, id), this.ofStream(schema.planPeriods)));
  }

  // --- plan versions ------------------------------------------------------
  versions() { return db.select().from(schema.scheduleVersions).where(this.ofStream(schema.scheduleVersions)); }

  async versionsDesc(): Promise<Version[]> {
    return (await this.versions()).sort((a, b) => b.version - a.version);
  }

  async versionById(id: string): Promise<Version | null> {
    const rows = await db.select().from(schema.scheduleVersions)
      .where(and(eq(schema.scheduleVersions.id, id), this.ofStream(schema.scheduleVersions)));
    return rows[0] ?? null;
  }

  async activeVersion(): Promise<Version | null> {
    const rows = await db.select().from(schema.scheduleVersions)
      .where(and(this.ofStream(schema.scheduleVersions), eq(schema.scheduleVersions.status, 'Active')));
    return rows[0] ?? null;
  }

  async versionsInPeriod(periodId: string): Promise<Version[]> {
    return db.select().from(schema.scheduleVersions)
      .where(and(this.ofStream(schema.scheduleVersions), eq(schema.scheduleVersions.periodId, periodId)));
  }

  async nextVersionNumber(): Promise<number> {
    return (await this.versions()).reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }

  insertVersion(row: typeof schema.scheduleVersions.$inferInsert) { return db.insert(schema.scheduleVersions).values(row); }
  updateVersion(id: string, patch: Partial<typeof schema.scheduleVersions.$inferInsert>) {
    return db.update(schema.scheduleVersions).set(patch).where(and(eq(schema.scheduleVersions.id, id), this.ofStream(schema.scheduleVersions)));
  }
  supersedeActive() {
    return db.update(schema.scheduleVersions).set({ status: 'Superseded' })
      .where(and(this.ofStream(schema.scheduleVersions), eq(schema.scheduleVersions.status, 'Active')));
  }
  clearBaseline(periodId: string) {
    return db.update(schema.scheduleVersions).set({ isBaseline: false })
      .where(and(this.ofStream(schema.scheduleVersions), eq(schema.scheduleVersions.periodId, periodId)));
  }
  deleteVersion(id: string) {
    return db.delete(schema.scheduleVersions).where(and(eq(schema.scheduleVersions.id, id), this.ofStream(schema.scheduleVersions)));
  }

  // --- voyages ------------------------------------------------------------
  voyagesForVersion(versionId: string) {
    return db.select().from(schema.voyages)
      .where(and(eq(schema.voyages.versionId, versionId), this.ofStream(schema.voyages)));
  }
  insertVoyage(row: typeof schema.voyages.$inferInsert) { return db.insert(schema.voyages).values(row); }
  insertStop(row: typeof schema.voyageStops.$inferInsert) { return db.insert(schema.voyageStops).values(row); }
  insertOp(row: typeof schema.voyageOps.$inferInsert) { return db.insert(schema.voyageOps).values(row); }
  insertCharterRec(row: typeof schema.charterRecommendations.$inferInsert) { return db.insert(schema.charterRecommendations).values(row); }

  /** Remove a version's voyage tree. Ops and stops are keyed by voyage, not stream. */
  async deleteVoyageTree(versionId: string): Promise<number> {
    const voys = await this.voyagesForVersion(versionId);
    const ids = voys.map(v => v.id);
    if (ids.length) {
      await db.delete(schema.voyageOps).where(inArray(schema.voyageOps.voyageId, ids));
      await db.delete(schema.voyageStops).where(inArray(schema.voyageStops.voyageId, ids));
    }
    await db.delete(schema.voyages).where(and(eq(schema.voyages.versionId, versionId), this.ofStream(schema.voyages)));
    await db.delete(schema.charterRecommendations)
      .where(and(eq(schema.charterRecommendations.versionId, versionId), this.ofStream(schema.charterRecommendations)));
    return ids.length;
  }

  // --- actuals ------------------------------------------------------------
  actuals() { return db.select().from(schema.actuals).where(this.ofStream(schema.actuals)); }

  actualsInPeriod(periodId: string) {
    return db.select().from(schema.actuals)
      .where(and(this.ofStream(schema.actuals), eq(schema.actuals.periodId, periodId)));
  }

  insertActuals(rows: (typeof schema.actuals.$inferInsert)[]) {
    return rows.length ? db.insert(schema.actuals).values(rows) : Promise.resolve();
  }
  updateActual(id: string, patch: Partial<typeof schema.actuals.$inferInsert>) {
    return db.update(schema.actuals).set(patch).where(and(eq(schema.actuals.id, id), this.ofStream(schema.actuals)));
  }
  deleteActual(id: string) {
    return db.delete(schema.actuals).where(and(eq(schema.actuals.id, id), this.ofStream(schema.actuals)));
  }
  deleteActualsInPeriod(periodId: string) {
    return db.delete(schema.actuals).where(and(this.ofStream(schema.actuals), eq(schema.actuals.periodId, periodId)));
  }

  // --- scenarios ----------------------------------------------------------
  async scenariosDesc(): Promise<Scenario[]> {
    const rows = await db.select().from(schema.scenarios).where(this.ofStream(schema.scenarios));
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  insertScenario(row: typeof schema.scenarios.$inferInsert) { return db.insert(schema.scenarios).values(row); }
  updateScenario(id: string, patch: Partial<typeof schema.scenarios.$inferInsert>) {
    return db.update(schema.scenarios).set(patch).where(and(eq(schema.scenarios.id, id), this.ofStream(schema.scenarios)));
  }
  deleteScenario(id: string) {
    return db.delete(schema.scenarios).where(and(eq(schema.scenarios.id, id), this.ofStream(schema.scenarios)));
  }

  // --- planLines (bulk paths used by the movement-plan upload) -------------
  deletePlanLines() { return db.delete(schema.planLines).where(this.ofStream(schema.planLines)); }
  insertPlanLines(rows: (typeof schema.planLines.$inferInsert)[]) {
    return rows.length ? db.insert(schema.planLines).values(rows) : Promise.resolve();
  }
  deletePlanLinesInPeriod(periodId: string) {
    return db.delete(schema.planLines).where(and(this.ofStream(schema.planLines), eq(schema.planLines.periodId, periodId)));
  }

  // --- engine input -------------------------------------------------------
  /**
   * Everything the solver needs, scoped to this stream and to the live period.
   * Plan lines carrying no period are treated as in scope so legacy rows still load.
   */
  async engineInput(options?: EngineOptions): Promise<EngineInput> {
    const period = await this.currentPeriod();
    const [products, locations, vessels, tanks, nodeFlows, berths, compatibility, planLines] = await Promise.all([
      this.products(), this.locations(), this.vessels(), this.tanks(),
      this.nodeFlows(), this.berths(), this.compatibility(), this.planLines(),
    ]);
    const scoped = period ? planLines.filter(l => !l.periodId || l.periodId === period.id) : planLines;
    return {
      stream: this.stream,
      startDate: period?.startDate ?? START_FALLBACK,
      horizonDays: period?.horizonDays ?? HORIZON_FALLBACK,
      products: products as any, locations: locations as any, vessels: vessels as any,
      tanks: tanks as any, nodeFlows: nodeFlows as any, berths: berths as any,
      compatibility: compatibility as any, planLines: scoped as any, options,
    };
  }
}

const cache = new Map<string, StreamRepo>();

/** Repository bound to one stream. Cached — these hold no per-request state. */
export function repo(stream: string): StreamRepo {
  let r = cache.get(stream);
  if (!r) { r = new StreamRepo(stream); cache.set(stream, r); }
  return r;
}

/**
 * Deliberate cross-stream access, for the handful of genuinely global operations:
 * reseeding, and verifying every stream's ledger. Named so that reading it is
 * enough to tell it was a choice.
 */
export const unscoped = {
  allPeriods: () => db.select().from(schema.planPeriods),
  /** Used only by compare, which must resolve two ids before it can reject the pair. */
  versionByIdAnyStream: async (id: string): Promise<Version | null> => {
    const rows = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, id));
    return rows[0] ?? null;
  },
};
