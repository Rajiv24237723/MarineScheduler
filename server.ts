import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { db } from './src/db/index';
import * as schema from './src/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { execSync } from 'child_process';
import { seed } from './src/db/seed';
import { solve } from './src/lib/mirp/engine';
import { validate } from './src/lib/mirp/validate';
import { InventoryModel } from './src/lib/mirp/inventory';
import { classifyReplan, DEFAULT_THRESHOLDS, ReplanThresholds } from './src/lib/mirp/classify';
import { EngineInput, EngineOptions, SolveResult } from './src/lib/mirp/types';

const app = express();
app.use(express.json());
const PORT = 3000;
const HORIZON_DAYS = 30;          // start-of-month operating plan: 01–31 Jul 2026
const START_DATE = '2026-07-01';

// ---------------------------------------------------------------------------
// Load a stream-scoped EngineInput from the database.
// ---------------------------------------------------------------------------
async function loadEngineInput(stream: string, options?: EngineOptions): Promise<EngineInput> {
  const [products, locations, vessels, tanks, nodeFlows, berths, compatibility, planLines] = await Promise.all([
    db.select().from(schema.products).where(eq(schema.products.stream, stream)),
    db.select().from(schema.locations).where(eq(schema.locations.stream, stream)),
    db.select().from(schema.vessels).where(eq(schema.vessels.stream, stream)),
    db.select().from(schema.tanks).where(eq(schema.tanks.stream, stream)),
    db.select().from(schema.nodeFlows).where(eq(schema.nodeFlows.stream, stream)),
    db.select().from(schema.berths).where(eq(schema.berths.stream, stream)),
    db.select().from(schema.productCompatibility).where(eq(schema.productCompatibility.stream, stream)),
    db.select().from(schema.planLines).where(eq(schema.planLines.stream, stream)),
  ]);
  return {
    stream, startDate: START_DATE, horizonDays: HORIZON_DAYS,
    products: products as any, locations: locations as any, vessels: vessels as any,
    tanks: tanks as any, nodeFlows: nodeFlows as any, berths: berths as any,
    compatibility: compatibility as any, planLines: planLines as any, options,
  };
}

// ---------------------------------------------------------------------------
// Persist a solve result as a new (Active) schedule version, superseding prior.
// ---------------------------------------------------------------------------
async function persistVersion(stream: string, result: SolveResult, trigger: string, parentId: string | null, status: string = 'Active'): Promise<string> {
  const existing = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.stream, stream));
  const nextVersion = existing.reduce((m, v) => Math.max(m, v.version), 0) + 1;
  // Only a published/Active plan supersedes the prior operating plan; drafts don't.
  if (status === 'Active') await db.update(schema.scheduleVersions).set({ status: 'Superseded' })
    .where(and(eq(schema.scheduleVersions.stream, stream), eq(schema.scheduleVersions.status, 'Active')));

  const id = randomUUID();
  await db.insert(schema.scheduleVersions).values({
    id, stream, runId: randomUUID(), version: nextVersion, parentId, trigger,
    status, objectiveCost: result.kpis.totalCost, achievable: result.achievable ? 1 : 0,
    kpi: result.kpis as any, projection: result.projection as any, duals: result.duals as any,
    payload: { voyages: result.voyages, charterRecommendations: result.charterRecommendations, unserved: result.unserved, validation: result.validation, message: result.message } as any,
    createdAt: new Date().toISOString(),
  });

  // Normalized voyage tables (browsable/queryable). Logical voyage ids repeat
  // across re-runs of a stream, so remap to per-version UUIDs on insert.
  const idMap = new Map<string, string>();
  for (const v of result.voyages) {
    const vid = randomUUID(); idMap.set(v.id, vid);
    await db.insert(schema.voyages).values({
      id: vid, stream, versionId: id, vesselId: v.vesselId, vesselName: v.vesselName,
      vesselClass: v.vesselClass, pool: v.pool, startDay: v.startDay, endDay: v.endDay,
      cost: v.cost, costBreakdown: v.costBreakdown as any,
    });
    for (const s of v.stops) {
      const stopId = randomUUID();
      await db.insert(schema.voyageStops).values({
        id: stopId, voyageId: vid, seq: s.seq, locationId: s.locationId,
        arriveDay: s.arriveDay, departDay: s.departDay, kind: s.kind,
      });
      for (const op of s.ops) await db.insert(schema.voyageOps).values({
        id: randomUUID(), voyageId: vid, stopId, op: op.op, productId: op.productId, qty: op.qty, compartmentId: op.compartmentId,
      });
    }
  }
  for (const r of result.charterRecommendations) await db.insert(schema.charterRecommendations).values({
    id: randomUUID(), stream, versionId: id, voyageId: r.voyageId ? (idMap.get(r.voyageId) ?? null) : null, vesselClass: r.vesselClass, reason: r.reason, estCost: r.estCost,
  });
  return id;
}

async function activeVersion(stream: string) {
  const rows = await db.select().from(schema.scheduleVersions)
    .where(and(eq(schema.scheduleVersions.stream, stream), eq(schema.scheduleVersions.status, 'Active')));
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/dashboard', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const input = await loadEngineInput(stream);
    const active = await activeVersion(stream);

    // Baseline (exo-only) projection so views have data before the first optimize.
    const prodName = new Map(input.products.map(p => [p.id, p.name]));
    const locName = new Map(input.locations.map(l => [l.id, l.name]));
    const baseline = new InventoryModel(input).projections(prodName, locName);

    const versions = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.stream, stream));
    const payload: any = active?.payload ?? null;

    res.json({
      stream,
      vessels: input.vessels, tanks: input.tanks, locations: input.locations, products: input.products,
      planLines: input.planLines, berths: input.berths, nodeFlows: input.nodeFlows, compatibility: input.compatibility,
      projection: active?.projection ?? baseline,
      voyages: payload?.voyages ?? [],
      charterRecommendations: payload?.charterRecommendations ?? [],
      unserved: payload?.unserved ?? [],
      duals: active?.duals ?? [],
      kpis: active?.kpi ?? baselineKpis(baseline),
      validation: payload?.validation ?? null,
      activeVersionId: active?.id ?? null,
      versions: versions.map(v => ({ id: v.id, version: v.version, status: v.status, trigger: v.trigger, objectiveCost: v.objectiveCost, achievable: v.achievable, createdAt: v.createdAt })).sort((a, b) => b.version - a.version),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'dashboard failed', message: (e as Error).message }); }
});

function baselineKpis(projection: any[]) {
  return {
    totalCost: 0, demurrage: 0, utilizationPct: 0,
    dryOutDays: projection.filter(p => p.firstDryOutDay !== null).length,
    tankTopDays: projection.filter(p => p.firstTankTopDay !== null).length,
    voyageCount: 0, charterRecommendationCount: 0, demandServedPct: 0,
  };
}

app.post('/api/optimize', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const options: EngineOptions = req.body?.options ?? {};
    const input = await loadEngineInput(stream, options);
    const result = await solve(input);
    const versionId = await persistVersion(stream, result, 'reoptimize', (await activeVersion(stream))?.id ?? null);
    res.json({ ...result, versionId });
  } catch (e) { console.error(e); res.status(500).json({ error: 'optimize failed', message: (e as Error).message }); }
});

// Streaming optimize: emits the solver's live convergence (NDJSON, one event per line) as
// the multi-start search runs, then a final result. The client animates the cost trajectory.
app.post('/api/optimize/stream', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const options: EngineOptions = req.body?.options ?? {};
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const write = (o: any) => { res.write(JSON.stringify(o) + '\n'); (res as any).flush?.(); };
  try {
    const input = await loadEngineInput(stream, options);
    const result = await solve(input, ev => write(ev));
    const versionId = await persistVersion(stream, result, 'reoptimize', (await activeVersion(stream))?.id ?? null);
    write({ type: 'result', versionId, achievable: result.achievable, kpis: result.kpis, unserved: result.unserved, shortfall: result.shortfall, message: result.message });
    res.end();
  } catch (e) { console.error(e); write({ type: 'error', message: (e as Error).message }); res.end(); }
});

const diffVs = (result: SolveResult, parentKpi: any) => parentKpi ? {
  costDelta: result.kpis.totalCost - parentKpi.totalCost,
  voyageDelta: result.kpis.voyageCount - parentKpi.voyageCount,
  charterDelta: result.kpis.charterRecommendationCount - parentKpi.charterRecommendationCount,
  servedDelta: result.kpis.demandServedPct - parentKpi.demandServedPct,
} : null;

// Does the CURRENT active plan still hold under a scenario's input changes?
// Re-projects the active plan's committed voyages against the modified inputs — no re-solve.
app.post('/api/scenario/check', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const options: EngineOptions = req.body?.options ?? {};
    const thresholds: ReplanThresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
    const active = await activeVersion(stream);
    const input = await loadEngineInput(stream, options);
    if (!active?.payload) return res.json({ hasPlan: false, holds: false, breaches: [] });
    const voyages = (active.payload as any).voyages ?? [];
    const v = validate(input, voyages);
    const decision = classifyReplan(input, voyages, v.breaches, thresholds);
    res.json({ hasPlan: true, activeVersion: active.version, holds: v.ok, breaches: v.breaches, decision });
  } catch (e) { console.error(e); res.status(500).json({ error: 'scenario check failed', message: (e as Error).message }); }
});

// Solve one recovery for a scenario as a DRAFT (rolling-horizon, freezing committed voyages),
// and classify the replan decision. Shared by /apply (one mode) and /candidates (three modes).
async function simulateRecovery(stream: string, name: string, rawOptions: EngineOptions, thresholds: ReplanThresholds) {
  const options: EngineOptions = { ...rawOptions };
  const parent = await activeVersion(stream);
  const baseVoy: any[] = (parent?.payload as any)?.voyages ?? [];
  const asOf = Math.max(0, options.asOfDay ?? 0);

  // A baseline voyage is invalidated by the disruption if it rides an off-hire / delayed vessel
  // or calls a closed berth / outaged tank during the affected window.
  const off = new Set(options.excludeVessels ?? []);
  const vDelay = new Map((options.vesselDelays ?? []).map(d => [d.vesselId, d.availFromDay]));
  const isInvalidated = (v: any) => {
    if (v.vesselId && off.has(v.vesselId)) return true;
    const dd = v.vesselId ? vDelay.get(v.vesselId) : undefined;
    if (dd != null && v.startDay < dd) return true;
    for (const o of options.tankOutages ?? []) if (v.stops?.some((s: any) => s.locationId === o.locationId && s.arriveDay >= o.fromDay && s.arriveDay <= o.toDay)) return true;
    for (const c of options.portClosures ?? []) if (v.stops?.some((s: any) => s.locationId === c.locationId && s.arriveDay >= c.fromDay && s.arriveDay <= c.toDay)) return true;
    return false;
  };

  let frozen: any[];
  if (options.mode === 'minimal-edit') frozen = baseVoy.filter(v => v.startDay < asOf || !isInvalidated(v));
  else { const freezeUntil = options.mode === 'minimal-change' ? asOf + 14 : asOf; frozen = baseVoy.filter(v => v.startDay < freezeUntil); }
  options.frozenVoyages = frozen as any;
  options.asOfDay = asOf;

  // Feasibility + replan-decision for the pre-existing plan under the change (no re-solve).
  const chkInput = await loadEngineInput(stream, { ...options, frozenVoyages: undefined });
  let currentPlanHolds = true; let breaches: string[] = [];
  if (parent?.payload) { const chk = validate(chkInput, baseVoy); currentPlanHolds = chk.ok; breaches = chk.breaches; }

  const result = await solve(await loadEngineInput(stream, options));
  const versionId = await persistVersion(stream, result, `scenario:${name}`, parent?.id ?? null, 'Draft');

  const frozenIds = new Set(frozen.map(v => v.id));
  const added = result.voyages.filter(v => !frozenIds.has(v.id));
  const removedBaseline = baseVoy.filter(v => !frozenIds.has(v.id));
  const brief = (v: any) => ({
    vesselName: v.vesselName, vesselClass: v.vesselClass, pool: v.pool,
    from: v.stops.find((s: any) => s.kind === 'LOAD')?.locationId ?? null,
    to: v.stops.filter((s: any) => s.kind === 'DISCHARGE').slice(-1)[0]?.locationId ?? null,
    cost: v.cost,
  });
  const changeSet = {
    asOfDay: asOf, mode: options.mode ?? 'cost-optimal',
    frozen: frozen.length, added: added.length, removed: removedBaseline.length,
    replanned: Math.max(0, baseVoy.length - frozen.length),
    spotAdded: added.filter(v => v.pool === 'SPOT').length,
    addedVoyages: added.slice(0, 10).map(brief),
    removedVoyages: removedBaseline.slice(0, 10).map(brief),
  };
  const decision = classifyReplan(chkInput, baseVoy, breaches, thresholds, { kpis: result.kpis, unservedNodes: result.unserved.length }, (parent?.kpi as any) ?? null);
  return { ...result, versionId, currentPlanHolds, breaches, diff: diffVs(result, parent?.kpi ?? null), changeSet, decision };
}

// Simulate one recovery draft. The operating plan is left untouched until published.
app.post('/api/scenario/apply', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const name = (req.body?.name as string) || 'scenario';
    const thresholds: ReplanThresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
    res.json(await simulateRecovery(stream, name, req.body?.options ?? {}, thresholds));
  } catch (e) { console.error(e); res.status(500).json({ error: 'scenario apply failed', message: (e as Error).message }); }
});

// Three recovery candidates from one event — minimal-change, service-protection, lowest-cost —
// each a persisted draft, plus a single no-solve replan-decision for the disruption itself.
app.post('/api/scenario/candidates', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const thresholds: ReplanThresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
    const base: EngineOptions = req.body?.options ?? {};
    const active = await activeVersion(stream);
    const baseVoy: any[] = (active?.payload as any)?.voyages ?? [];
    const chkInput = await loadEngineInput(stream, base);
    const chk = active?.payload ? validate(chkInput, baseVoy) : { ok: true, breaches: [] as string[] };
    const decision = classifyReplan(chkInput, baseVoy, chk.breaches, thresholds);

    const specs = [['minimal-edit', 'Minimal change'], ['minimal-change', 'Service protection'], ['cost-optimal', 'Lowest cost']];
    const candidates = [];
    for (const [mode, label] of specs) {
      const r = await simulateRecovery(stream, label, { ...base, mode }, thresholds);
      candidates.push({ mode, label, versionId: r.versionId, kpis: r.kpis, unserved: r.unserved, shortfall: r.shortfall, diff: r.diff, changeSet: r.changeSet, decision: r.decision });
    }
    res.json({ candidates, holds: chk.ok, breaches: chk.breaches, decision });
  } catch (e) { console.error(e); res.status(500).json({ error: 'scenario candidates failed', message: (e as Error).message }); }
});

// Publish a version (draft or superseded) as the operating plan.
async function makeActive(id: string, res: any) {
  const rows = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, id));
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await db.update(schema.scheduleVersions).set({ status: 'Superseded' }).where(and(eq(schema.scheduleVersions.stream, rows[0].stream), eq(schema.scheduleVersions.status, 'Active')));
  await db.update(schema.scheduleVersions).set({ status: 'Active' }).where(eq(schema.scheduleVersions.id, id));
  res.json({ ok: true });
}
app.post('/api/versions/:id/publish', (req, res) => makeActive(req.params.id, res));
app.post('/api/versions/:id/rollback', (req, res) => makeActive(req.params.id, res));

// Discard a non-active version and its voyages.
app.delete('/api/versions/:id', async (req, res) => {
  try {
    const rows = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, req.params.id));
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    if (rows[0].status === 'Active') return res.status(400).json({ error: 'cannot discard the active plan' });
    const voys = await db.select().from(schema.voyages).where(eq(schema.voyages.versionId, req.params.id));
    for (const v of voys) { await db.delete(schema.voyageOps).where(eq(schema.voyageOps.voyageId, v.id)); await db.delete(schema.voyageStops).where(eq(schema.voyageStops.voyageId, v.id)); }
    await db.delete(schema.voyages).where(eq(schema.voyages.versionId, req.params.id));
    await db.delete(schema.charterRecommendations).where(eq(schema.charterRecommendations.versionId, req.params.id));
    await db.delete(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, req.params.id));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'discard failed', message: (e as Error).message }); }
});

// Legacy quick-disruption endpoint (maps singular fields to array options).
app.post('/api/replan', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const { trigger, emergencyDemand, tankOutage, excludeVessels } = req.body ?? {};
    const parent = await activeVersion(stream);
    const options: EngineOptions = {
      emergencyDemands: emergencyDemand ? [emergencyDemand] : undefined,
      tankOutages: tankOutage ? [tankOutage] : undefined,
      excludeVessels,
    };
    const result = await solve(await loadEngineInput(stream, options));
    const versionId = await persistVersion(stream, result, `disruption:${trigger ?? 'manual'}`, parent?.id ?? null);
    res.json({ ...result, versionId, diff: diffVs(result, parent?.kpi ?? null) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'replan failed', message: (e as Error).message }); }
});

app.get('/api/versions', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const rows = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.stream, stream));
  res.json(rows.map(v => ({ id: v.id, version: v.version, status: v.status, trigger: v.trigger, objectiveCost: v.objectiveCost, achievable: v.achievable, createdAt: v.createdAt, kpi: v.kpi })).sort((a, b) => b.version - a.version));
});

app.get('/api/versions/compare', async (req, res) => {
  const a = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, req.query.a as string));
  const b = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, req.query.b as string));
  if (!a[0] || !b[0]) return res.status(404).json({ error: 'version not found' });
  const ka: any = a[0].kpi, kb: any = b[0].kpi;
  res.json({
    a: { version: a[0].version, kpi: ka }, b: { version: b[0].version, kpi: kb },
    delta: { costDelta: kb.totalCost - ka.totalCost, voyageDelta: kb.voyageCount - ka.voyageCount, servedDelta: kb.demandServedPct - ka.demandServedPct, charterDelta: kb.charterRecommendationCount - ka.charterRecommendationCount },
  });
});

app.get('/api/versions/:id', async (req, res) => {
  const rows = await db.select().from(schema.scheduleVersions).where(eq(schema.scheduleVersions.id, req.params.id));
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// Generic master-data CRUD for the editable tables.
const MASTER: Record<string, any> = {
  products: schema.products, locations: schema.locations, vessels: schema.vessels,
  tanks: schema.tanks, nodeFlows: schema.nodeFlows, planLines: schema.planLines,
  berths: schema.berths, productCompatibility: schema.productCompatibility,
};
app.post('/api/master/:table', async (req, res) => {
  const t = MASTER[req.params.table]; if (!t) return res.status(404).json({ error: 'unknown table' });
  const row = { id: req.body.id ?? randomUUID(), ...req.body };
  await db.insert(t).values(row); res.json(row);
});
app.put('/api/master/:table/:id', async (req, res) => {
  const t = MASTER[req.params.table]; if (!t) return res.status(404).json({ error: 'unknown table' });
  await db.update(t).set(req.body).where(eq(t.id, req.params.id)); res.json({ ok: true });
});
app.delete('/api/master/:table/:id', async (req, res) => {
  const t = MASTER[req.params.table]; if (!t) return res.status(404).json({ error: 'unknown table' });
  await db.delete(t).where(eq(t.id, req.params.id)); res.json({ ok: true });
});
// Bulk import (CSV/plan upload). Optionally replace all rows for a stream first.
app.post('/api/master/:table/bulk', async (req, res) => {
  const t = MASTER[req.params.table]; if (!t) return res.status(404).json({ error: 'unknown table' });
  try {
    const rows: any[] = req.body?.rows ?? [];
    const replaceStream: string | undefined = req.body?.replaceStream;
    if (replaceStream) await db.delete(t).where(eq(t.stream, replaceStream));
    const withIds = rows.map(r => ({ id: r.id ?? randomUUID(), ...r }));
    if (withIds.length) await db.insert(t).values(withIds);
    res.json({ ok: true, inserted: withIds.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'bulk import failed', message: (e as Error).message }); }
});
// Reset all data back to the seeded demo network.
app.post('/api/admin/reseed', async (_req, res) => {
  try {
    const tables = [schema.charterRecommendations, schema.voyageOps, schema.voyageStops, schema.voyages, schema.scheduleVersions, schema.planLines, schema.nodeFlows, schema.berths, schema.productCompatibility, schema.tanks, schema.vessels, schema.locations, schema.products];
    for (const t of tables) await db.delete(t);
    await seed(db);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'reseed failed', message: (e as Error).message }); }
});

// Free Open-Meteo marine weather (no key).
app.get('/api/weather', async (req, res) => {
  try {
    const lat = req.query.lat || '15.0', lng = req.query.lng || '72.0';
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&windspeed_unit=kn`);
    const d = await r.json(); res.json(d.current_weather);
  } catch { res.status(500).json({ error: 'weather fetch failed' }); }
});

// ---------------------------------------------------------------------------
async function startServer() {
  try {
    console.log('Pushing database schema...');
    execSync('npx drizzle-kit push --force', { stdio: 'inherit' });
    const locCount = await db.select({ count: sql`count(*)` }).from(schema.locations);
    if ((locCount[0] as any).count === 0) {
      console.log('Seeding July 2026 start-of-month plan...');
      await seed(db);
      console.log('Seed complete.');
    }
  } catch (e) { console.error('Migration/Seed error:', e); }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

startServer();
