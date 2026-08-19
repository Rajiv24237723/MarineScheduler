import express from 'express';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServer as createViteServer } from 'vite';
import { db, getDb, driver, waitForDb } from './src/db/index';
import * as schema from './src/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { migrate } from './src/db/migrate';
import { sealPeriod, verifyChain, installLedgerGuards } from './src/db/ledger';
import { repo, unscoped } from './src/db/repository';
import { seed } from './src/db/seed';
import { solve } from './src/lib/mirp/engine';
import { validate } from './src/lib/mirp/validate';
import { InventoryModel } from './src/lib/mirp/inventory';
import { classifyReplan, DEFAULT_THRESHOLDS, ReplanThresholds } from './src/lib/mirp/classify';
import { compileEvents } from './src/lib/mirp/scenario';
import { EngineInput, EngineOptions, ScenarioEvent, SolveResult } from './src/lib/mirp/types';
import { z } from 'zod';
import { loadConfig, describeConfig } from './src/config';
import {
  parseBody, MasterSchemas, MasterTable, ActualSchema, ActualPatchSchema, ActualBulkSchema,
  PeriodSchema, PeriodPatchSchema, ScenarioSchema, ScenarioPatchSchema,
} from './src/lib/http/validate';

// Fail fast and legibly on a bad environment rather than an hour into a session.
const cfg = loadConfig();
const app = express();
app.use(express.json({ limit: '8mb' }));
const PORT = cfg.PORT;
const HORIZON_DAYS = 30;          // fallback when no planning period exists
const START_DATE = '2026-07-01';

// ---------------------------------------------------------------------------
// Planning periods. The horizon is driven by the stream's open period, so day
// indices everywhere are relative to that period's start date.
// ---------------------------------------------------------------------------

// Scoping is enforced by the repository, not repeated at each call site.
const currentPeriod = (stream: string) => repo(stream).currentPeriod();
const resolvePeriod = (stream: string, ref?: string | null) => repo(stream).resolvePeriod(ref);
const loadEngineInput = (stream: string, options?: EngineOptions): Promise<EngineInput> =>
  repo(stream).engineInput(options);

// ---------------------------------------------------------------------------
// Cost-category helpers. Every cost comparison in the app is a five-way split,
// so plan and actual are always summed the same way.
// ---------------------------------------------------------------------------
type Cost = { bunker: number; freight: number; portDA: number; demurrage: number; changeover: number };
const COST_KEYS = ['bunker', 'freight', 'portDA', 'demurrage', 'changeover'] as const;
const COST_LABELS: Record<string, string> = {
  bunker: 'Bunker fuel', freight: 'Freight / hire', portDA: 'Port DA', demurrage: 'Demurrage', changeover: 'Tank changeover',
};
const ZERO_COST = (): Cost => ({ bunker: 0, freight: 0, portDA: 0, demurrage: 0, changeover: 0 });
const addCost = (a: Cost, b: Partial<Cost> | null | undefined): Cost => {
  const out = { ...a };
  for (const k of COST_KEYS) out[k] += Number(b?.[k] ?? 0);
  return out;
};
const sumCost = (c: Cost) => COST_KEYS.reduce((s, k) => s + c[k], 0);

// ---------------------------------------------------------------------------
// Persist a solve result as a new (Active) schedule version, superseding prior.
// ---------------------------------------------------------------------------
async function persistVersion(stream: string, result: SolveResult, trigger: string, parentId: string | null, status: string = 'Active'): Promise<string> {
  const r = repo(stream);
  const nextVersion = await r.nextVersionNumber();
  // Only a published/Active plan supersedes the prior operating plan; drafts don't.
  if (status === 'Active') await r.supersedeActive();

  const period = await r.currentPeriod();
  const id = randomUUID();
  const versionRow = {
    id, stream, runId: randomUUID(), version: nextVersion, parentId, trigger,
    periodId: period?.id ?? null, isBaseline: false,
    status, objectiveCost: result.kpis.totalCost, achievable: result.achievable,
    kpi: result.kpis as any, projection: result.projection as any, duals: result.duals as any,
    payload: { voyages: result.voyages, charterRecommendations: result.charterRecommendations, unserved: result.unserved, validation: result.validation, message: result.message } as any,
    createdAt: new Date().toISOString(),
  };
  await r.insertVersion(versionRow as any);

  // The first published plan for a period becomes its baseline automatically —
  // otherwise there is nothing to measure the month against. Re-assignable later.
  if (status === 'Active' && period) {
    const inPeriod = await r.versionsInPeriod(period.id);
    if (!inPeriod.some(v => v.isBaseline)) await r.updateVersion(id, { isBaseline: true });
  }

  // Normalized voyage tables, for SQL-level inspection alongside the JSON payload.
  // Built in memory and written in four batched statements rather than one round-trip
  // per row — see StreamRepo.insertMany for why that matters off-box.
  // Logical voyage ids repeat across re-runs of a stream, so remap to per-version UUIDs.
  const idMap = new Map<string, string>();
  const voyageRows: any[] = [], stopRows: any[] = [], opRows: any[] = [];
  for (const v of result.voyages) {
    const vid = randomUUID(); idMap.set(v.id, vid);
    voyageRows.push({
      id: vid, stream, versionId: id, vesselId: v.vesselId, vesselName: v.vesselName,
      vesselClass: v.vesselClass, pool: v.pool, startDay: v.startDay, endDay: v.endDay,
      cost: v.cost, costBreakdown: v.costBreakdown as any,
    });
    for (const s of v.stops) {
      const stopId = randomUUID();
      stopRows.push({
        id: stopId, voyageId: vid, seq: s.seq, locationId: s.locationId,
        arriveDay: s.arriveDay, departDay: s.departDay, kind: s.kind,
      });
      for (const op of s.ops) opRows.push({
        id: randomUUID(), voyageId: vid, stopId, op: op.op, productId: op.productId, qty: op.qty, compartmentId: op.compartmentId,
      });
    }
  }
  const recRows = result.charterRecommendations.map(rec => ({
    id: randomUUID(), stream, versionId: id,
    voyageId: rec.voyageId ? (idMap.get(rec.voyageId) ?? null) : null,
    vesselClass: rec.vesselClass, reason: rec.reason, estCost: rec.estCost,
  }));
  await r.insertVoyages(voyageRows);
  await r.insertStops(stopRows);
  await r.insertOps(opRows);
  await r.insertCharterRecs(recRows);
  return id;
}

const activeVersion = (stream: string) => repo(stream).activeVersion();

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

    const r = repo(stream);
    const versions = await r.versions();
    const payload: any = active?.payload ?? null;
    const periods = await r.periodsDesc();
    const period = await r.currentPeriod();

    res.json({
      stream, period, periods,
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
      versions: versions.map(v => ({ id: v.id, version: v.version, status: v.status, trigger: v.trigger, objectiveCost: v.objectiveCost, achievable: v.achievable, createdAt: v.createdAt, periodId: v.periodId, isBaseline: v.isBaseline, kpi: v.kpi })).sort((a, b) => b.version - a.version),
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'dashboard failed', message: (e as Error).message }); }
});

function baselineKpis(projection: any[]) {
  return {
    totalCost: 0, demurrage: 0, utilizationPct: 0,
    dryOutDays: projection.filter(p => p.firstDryOutDay !== null).length,
    tankTopDays: projection.filter(p => p.firstTankTopDay !== null).length,
    voyageCount: 0, charterRecommendationCount: 0, demandServedPct: 0,
    costBreakdown: ZERO_COST(), liftedMt: 0,
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
  } catch (e) { sendDbError(res, e, 'optimize failed'); }
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

// ---------------------------------------------------------------------------
// Scenario events → EngineOptions. The composer posts `events` (an authored list,
// any number of any type); older callers may still post a raw `options` object.
// Both paths end up here so check / apply / candidates always agree.
// ---------------------------------------------------------------------------
async function resolveOptions(stream: string, body: any): Promise<{ options: EngineOptions; events: ScenarioEvent[]; warnings: string[]; summary: string[] }> {
  const raw: EngineOptions = body?.options ?? {};
  const events: ScenarioEvent[] = Array.isArray(body?.events) ? body.events : [];
  if (!events.length) return { options: raw, events: [], warnings: [], summary: [] };

  const r = repo(stream);
  const period = await r.currentPeriod();
  const [nodeFlows, vessels] = await Promise.all([r.nodeFlows(), r.vessels()]);
  const active = await r.activeVersion();
  const compiled = compileEvents(events, {
    horizonDays: period?.horizonDays ?? HORIZON_DAYS,
    nodeFlows: nodeFlows as any,
    vessels: vessels as any,
    baseVoyages: ((active?.payload as any)?.voyages ?? []) as any,
    asOfDay: Number(raw.asOfDay ?? 0),
  });
  // Posture (as-of day, recovery mode) and solver knobs stay on `options`.
  return { options: { ...raw, ...compiled.options }, events, warnings: compiled.warnings, summary: compiled.summary };
}

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
    const { options, warnings, summary } = await resolveOptions(stream, req.body);
    const thresholds: ReplanThresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
    const active = await activeVersion(stream);
    const input = await loadEngineInput(stream, options);
    if (!active?.payload) return res.json({ hasPlan: false, holds: false, breaches: [], warnings, summary });
    const voyages = (active.payload as any).voyages ?? [];
    const v = validate(input, voyages);
    const decision = classifyReplan(input, voyages, v.breaches, thresholds);
    res.json({ hasPlan: true, activeVersion: active.version, holds: v.ok, breaches: v.breaches, decision, warnings, summary });
  } catch (e) { console.error(e); res.status(500).json({ error: 'scenario check failed', message: (e as Error).message }); }
});

/** Compile a scenario without solving — lets the composer preview and warn as you type. */
app.post('/api/scenario/compile', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const { options, warnings, summary } = await resolveOptions(stream, req.body);
    res.json({ options, warnings, summary });
  } catch (e) { console.error(e); res.status(500).json({ error: 'compile failed', message: (e as Error).message }); }
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
    // An off-hire window the voyage would sail through.
    if (v.vesselId) for (const o of options.vesselOutages ?? [])
      if (o.vesselId === v.vesselId && v.startDay <= o.toDay && v.endDay >= o.fromDay) return true;
    for (const o of options.tankOutages ?? []) if (v.stops?.some((s: any) => s.locationId === o.locationId && s.arriveDay >= o.fromDay && s.arriveDay <= o.toDay)) return true;
    // Only a full shutdown invalidates a committed call. Degraded throughput or one
    // berth of several down makes the call slower and dearer, not impossible.
    for (const c of options.portClosures ?? []) {
      if (c.capacityPct != null || c.berthId) continue;
      if (v.stops?.some((s: any) => s.locationId === c.locationId && s.arriveDay >= c.fromDay && s.arriveDay <= c.toDay)) return true;
    }
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
    const { options, warnings, summary } = await resolveOptions(stream, req.body);
    const out = await simulateRecovery(stream, name, options, thresholds);
    res.json({ ...out, warnings, summary });
  } catch (e) { sendDbError(res, e, 'scenario apply failed'); }
});

// Three recovery candidates from one event — minimal-change, service-protection, lowest-cost —
// each a persisted draft, plus a single no-solve replan-decision for the disruption itself.
app.post('/api/scenario/candidates', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const thresholds: ReplanThresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds ?? {}) };
    const { options: base, warnings, summary } = await resolveOptions(stream, req.body);
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
    res.json({ candidates, holds: chk.ok, breaches: chk.breaches, decision, warnings, summary });
  } catch (e) { sendDbError(res, e, 'scenario candidates failed'); }
});

// Publish a version (draft or superseded) as the operating plan.
/**
 * Publish a version as the operating plan. Rollback is the same operation seen from
 * the other direction — making a superseded version current — so both routes share it
 * rather than pretending to differ.
 */
async function makeActive(stream: string, id: string, res: any) {
  const r = repo(stream);
  const row = await r.versionById(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  await r.supersedeActive();
  await r.updateVersion(id, { status: 'Active' });
  res.json({ ok: true });
}
const streamOf = (req: any) => (req.query.stream as string) || 'POL';
app.post('/api/versions/:id/publish', (req, res) => makeActive(streamOf(req), req.params.id, res));
app.post('/api/versions/:id/rollback', (req, res) => makeActive(streamOf(req), req.params.id, res));

/**
 * Discard every draft for a stream.
 *
 * A scenario candidate run persists three drafts so they can be compared before one
 * is published — the other two are then dead, and nothing collects them. Over an
 * evaluation session the version list fills with `scenario:*` drafts that obscure
 * the real plan history. This is housekeeping rather than a storage measure: a draft
 * is only ~35 KB, so the 500 MB free tier would take roughly 4,700 candidate runs to
 * fill. The clutter arrives long before the bytes matter.
 */
app.delete('/api/versions/drafts', async (req, res) => {
  try {
    const r = repo(streamOf(req));
    const drafts = await r.drafts();
    for (const d of drafts) {
      await r.deleteVoyageTree(d.id);
      await r.deleteVersion(d.id);
    }
    res.json({ ok: true, discarded: drafts.length, versions: drafts.map(d => d.version) });
  } catch (e) { sendDbError(res, e, 'discard drafts failed'); }
});

// Discard a non-active version and its voyages.
app.delete('/api/versions/:id', async (req, res) => {
  try {
    const r = repo(streamOf(req));
    const row = await r.versionById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status === 'Active') return res.status(400).json({ error: 'cannot discard the active plan' });
    await r.deleteVoyageTree(req.params.id);
    await r.deleteVersion(req.params.id);
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
  const periodId = req.query.periodId as string | undefined;
  let rows = await repo(stream).versions();
  if (periodId) rows = rows.filter(v => v.periodId === periodId);
  res.json(rows.map(v => ({ id: v.id, version: v.version, status: v.status, trigger: v.trigger, objectiveCost: v.objectiveCost, achievable: v.achievable, createdAt: v.createdAt, periodId: v.periodId, isBaseline: v.isBaseline, kpi: v.kpi })).sort((a, b) => b.version - a.version));
});

app.get('/api/versions/compare', async (req, res) => {
  // Both ids must resolve before the pair can be judged, so this is one of the two
  // places that reads across streams on purpose.
  const va = await unscoped.versionByIdAnyStream(req.query.a as string);
  const vb = await unscoped.versionByIdAnyStream(req.query.b as string);
  if (!va || !vb) return res.status(404).json({ error: 'version not found' });
  if (va.stream !== vb.stream) return res.status(400).json({ error: 'cannot compare versions from different streams' });
  const a = [va], b = [vb];
  const ka: any = a[0].kpi ?? {}, kb: any = b[0].kpi ?? {};
  const n = (x: any) => Number(x ?? 0);
  const ca = addCost(ZERO_COST(), ka.costBreakdown), cb = addCost(ZERO_COST(), kb.costBreakdown);
  res.json({
    a: { version: a[0].version, kpi: ka, isBaseline: a[0].isBaseline }, b: { version: b[0].version, kpi: kb, isBaseline: b[0].isBaseline },
    delta: {
      costDelta: n(kb.totalCost) - n(ka.totalCost),
      voyageDelta: n(kb.voyageCount) - n(ka.voyageCount),
      servedDelta: n(kb.demandServedPct) - n(ka.demandServedPct),
      charterDelta: n(kb.charterRecommendationCount) - n(ka.charterRecommendationCount),
      byCategory: COST_KEYS.map(k => ({ key: k, label: COST_LABELS[k], a: ca[k], b: cb[k], delta: cb[k] - ca[k] })),
    },
  });
});

// Designate a version as its period's baseline — the frozen plan the month is measured against.
app.post('/api/versions/:id/baseline', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const r = repo(stream);
    const v = await r.versionById(req.params.id);
    if (!v) return res.status(404).json({ error: 'not found' });
    if (!v.periodId) return res.status(400).json({ error: 'version is not assigned to a planning period' });
    await r.clearBaseline(v.periodId);
    await r.updateVersion(v.id, { isBaseline: true });
    res.json({ ok: true, periodId: v.periodId, version: v.version });
  } catch (e) { console.error(e); res.status(500).json({ error: 'set baseline failed', message: (e as Error).message }); }
});

app.get('/api/versions/:id', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const row = await repo(stream).versionById(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// ---------------------------------------------------------------------------
// Saved scenarios — a named event list, reopenable and re-runnable
// ---------------------------------------------------------------------------

app.get('/api/scenarios', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  res.json(await repo(stream).scenariosDesc());
});

app.post('/api/scenarios', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || req.body?.stream || 'POL';
    const body = parseBody(ScenarioSchema, req, res); if (!body) return;
    const now = new Date().toISOString();
    const row = {
      id: body.id ?? randomUUID(), stream, name: body.name.trim(),
      description: body.description ?? null,
      events: body.events as any,
      asOfDay: body.asOfDay,
      mode: body.mode,
      createdAt: now, updatedAt: now,
    };
    await repo(stream).insertScenario(row);
    res.json(row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'save scenario failed', message: (e as Error).message }); }
});

app.put('/api/scenarios/:id', async (req, res) => {
  const body = parseBody(ScenarioPatchSchema, req, res); if (!body) return;
  try {
    const patch: any = { ...body, updatedAt: new Date().toISOString() };
    await repo(streamOf(req)).updateScenario(req.params.id, patch);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'update scenario failed', message: (e as Error).message }); }
});

app.delete('/api/scenarios/:id', async (req, res) => {
  await repo(streamOf(req)).deleteScenario(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Planning periods
// ---------------------------------------------------------------------------

app.get('/api/periods', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const r = repo(stream);
  const rows = await r.periodsDesc();
  const versions = await r.versions();
  const acts = await r.actuals();
  res.json(rows.map(p => ({
    ...p,
    versionCount: versions.filter(v => v.periodId === p.id).length,
    baselineVersion: versions.find(v => v.periodId === p.id && v.isBaseline)?.version ?? null,
    actualCount: acts.filter(a => a.periodId === p.id).length,
  })));
});

app.post('/api/periods', async (req, res) => {
  try {
    const body = parseBody(PeriodSchema, req, res); if (!body) return;
    const { stream, code, label, startDate, endDate, horizonDays, status, copyPlanLinesFrom } = body;
    const r = repo(stream);
    if ((await r.periods()).some(p => p.code === code)) return res.status(400).json({ error: `period ${code} already exists for ${stream}` });
    const days = Number(horizonDays) || Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1);
    const row = {
      id: randomUUID(), stream, code, label: label || code, startDate, endDate,
      horizonDays: days, status: status || 'Open', createdAt: new Date().toISOString(),
    };
    await r.insertPeriod(row);
    // Rolling a month forward: carry the previous month's plan lines over as a starting point.
    let copied = 0;
    if (copyPlanLinesFrom) {
      const src = await r.planLines();
      const rows = src.filter(l => l.periodId === copyPlanLinesFrom)
        .map(l => ({ ...l, id: randomUUID(), periodId: row.id, windowStart: startDate, windowEnd: endDate }));
      await r.insertPlanLines(rows);
      copied = rows.length;
    }
    res.json({ ...row, planLinesCopied: copied });
  } catch (e) { console.error(e); res.status(500).json({ error: 'create period failed', message: (e as Error).message }); }
});

app.put('/api/periods/:id', async (req, res) => {
  const body = parseBody(PeriodPatchSchema, req, res); if (!body) return;
  try { await repo(streamOf(req)).updatePeriod(req.params.id, body); res.json({ ok: true }); }
  catch (e) { sendDbError(res, e, 'update period failed'); }
});

/** Settle a month: no further planning against it, but its versions and actuals remain. */
app.post('/api/periods/:id/close', async (req, res) => {
  try {
    const r = repo(streamOf(req));
    const p = await r.periodById(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    // Seal BEFORE flipping status: once Closed, the guard rejects the writes the
    // chain needs to make.
    const sealed = await sealPeriod(p.stream, p.id);
    await r.updatePeriod(p.id, { status: 'Closed' });
    res.json({ ok: true, sealed });
  } catch (e) { console.error(e); res.status(500).json({ error: 'close period failed', message: (e as Error).message }); }
});

/** Make this the live planning month; every other period for the stream is closed. */
app.post('/api/periods/:id/open', async (req, res) => {
  try {
    const r = repo(streamOf(req));
    const p = await r.periodById(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    // Any month this displaces gets sealed on the way out, so "Closed" always
    // implies "sealed". Seal first — once Closed, the guard rejects the writes the
    // chain needs. Re-closing a reopened month recomputes its chain from scratch,
    // so digests left stale by edits during the reopen self-heal.
    const displaced = (await r.periods()).filter(x => x.id !== p.id && x.status === 'Open');
    for (const x of displaced) await sealPeriod(x.stream, x.id);
    await r.closeAllPeriods();
    await r.updatePeriod(p.id, { status: 'Open' });
    res.json({ ok: true, opened: p.label, sealed: displaced.map(x => x.label) });
  } catch (e) { sendDbError(res, e, 'open period failed'); }
});

app.delete('/api/periods/:id', async (req, res) => {
  const r = repo(streamOf(req));
  const p = await r.periodById(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const vs = await r.versionsInPeriod(p.id);
  if (vs.length) return res.status(400).json({ error: `period has ${vs.length} plan version(s) — delete those first` });
  await r.deleteActualsInPeriod(p.id);
  await r.deletePlanLinesInPeriod(p.id);
  await r.deletePeriod(p.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Actuals — what really happened, and what it really cost
// ---------------------------------------------------------------------------

app.get('/api/actuals', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const period = await resolvePeriod(stream, req.query.periodId as string | undefined);
  const rows = period ? await repo(stream).actualsInPeriod(period.id) : await repo(stream).actuals();
  res.json(rows.sort((a, b) => a.startDay - b.startDay));
});

const normaliseActual = (stream: string, periodId: string, r: any) => {
  const cb = r.costBreakdown ? addCost(ZERO_COST(), r.costBreakdown) : null;
  return {
    id: r.id ?? randomUUID(), stream, periodId,
    versionId: r.versionId ?? null, planVoyageId: r.planVoyageId ?? null,
    vesselName: String(r.vesselName ?? 'Unknown'), vesselClass: String(r.vesselClass ?? ''), pool: String(r.pool ?? 'OWNED'),
    fromLocationId: r.fromLocationId ?? null, toLocationId: r.toLocationId ?? null, productId: r.productId ?? null,
    qtyMt: Number(r.qtyMt ?? 0), startDay: Number(r.startDay ?? 0), endDay: Number(r.endDay ?? 0),
    // If a breakdown is given, it is authoritative and cost is its sum.
    cost: cb ? Math.round(sumCost(cb)) : Number(r.cost ?? 0),
    costBreakdown: cb as any,
    status: String(r.status ?? 'COMPLETED'), source: String(r.source ?? 'MANUAL'),
    note: r.note ?? null, createdAt: new Date().toISOString(),
  };
};

app.post('/api/actuals', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || req.body?.stream || 'POL';
    const body = parseBody(ActualSchema, req, res); if (!body) return;
    const period = await resolvePeriod(stream, body.periodId);
    if (!period) return res.status(400).json({ error: 'no planning period for this stream' });
    const row = normaliseActual(stream, period.id, body);
    await repo(stream).insertActuals([row as any]);
    res.json(row);
  } catch (e) { console.error(e); res.status(500).json({ error: 'create actual failed', message: (e as Error).message }); }
});

/** A rejection from the settled-period trigger is a business rule, not a bug. */
const guardReject = (e: unknown) => /period .* is closed|record is final/i.test(String((e as any)?.cause?.message ?? (e as Error)?.message ?? ''));
const sendDbError = (res: any, e: unknown, what: string) => {
  if (guardReject(e)) return res.status(409).json({ error: 'period closed', message: 'This planning period is closed; its record is final and cannot be changed.' });
  console.error(e);
  return res.status(500).json({ error: what, message: (e as Error).message });
};

app.put('/api/actuals/:id', async (req, res) => {
  try {
    const body = parseBody(ActualPatchSchema, req, res); if (!body) return;
    const patch: any = { ...body };
    if (patch.costBreakdown) { const cb = addCost(ZERO_COST(), patch.costBreakdown); patch.costBreakdown = cb; patch.cost = Math.round(sumCost(cb)); }
    await repo(streamOf(req)).updateActual(req.params.id, patch);
    res.json({ ok: true });
  } catch (e) { sendDbError(res, e, 'update actual failed'); }
});

app.delete('/api/actuals/:id', async (req, res) => {
  try {
    await repo(streamOf(req)).deleteActual(req.params.id);
    res.json({ ok: true });
  } catch (e) { sendDbError(res, e, 'delete actual failed'); }
});

/** Bulk ingest (CSV/ERP extract). `replace` clears the period's existing rows first. */
app.post('/api/actuals/bulk', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || req.body?.stream || 'POL';
    const body = parseBody(ActualBulkSchema, req, res); if (!body) return;
    const period = await resolvePeriod(stream, body.periodId);
    if (!period) return res.status(400).json({ error: 'no planning period for this stream' });
    if (body.replace) await repo(stream).deleteActualsInPeriod(period.id);
    const rows = body.rows.map((r: any) => normaliseActual(stream, period.id, { source: 'UPLOAD', ...r }));
    await repo(stream).insertActuals(rows as any);
    res.json({ ok: true, inserted: rows.length, periodId: period.id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'bulk actuals import failed', message: (e as Error).message }); }
});

app.delete('/api/actuals', async (req, res) => {
  const stream = (req.query.stream as string) || 'POL';
  const period = await resolvePeriod(stream, req.query.periodId as string | undefined);
  if (!period) return res.status(400).json({ error: 'no planning period' });
  await repo(stream).deleteActualsInPeriod(period.id);
  res.json({ ok: true });
});

/** Deterministic PRNG so a simulated month is reproducible from its seed. */
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Stand in for an ops feed: execute a plan version on paper with realistic
 * slippage — bunker moves with fuel price, port days run long, a few voyages
 * are cancelled, occasionally an unplanned spot lift covers the gap.
 */
app.post('/api/actuals/simulate', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const period = await resolvePeriod(stream, req.body?.periodId);
    if (!period) return res.status(400).json({ error: 'no planning period for this stream' });

    const versions = await repo(stream).versions();
    const inPeriod = versions.filter(v => v.periodId === period.id && v.status !== 'Draft');
    const src = req.body?.versionId ? versions.find(v => v.id === req.body.versionId)
      : (inPeriod.find(v => v.status === 'Active') ?? inPeriod.find(v => v.isBaseline) ?? inPeriod.sort((a, b) => b.version - a.version)[0]);
    if (!src) return res.status(400).json({ error: 'no plan version to execute for this period — run the optimiser first' });

    const voyages: any[] = (src.payload as any)?.voyages ?? [];
    if (!voyages.length) return res.status(400).json({ error: 'that plan version has no voyages' });

    const rnd = mulberry32(Number(req.body?.seed ?? 20260701));
    const bias = Number(req.body?.costBias ?? 0.04);   // systemic overrun, e.g. bunker up 4%
    const spread = Number(req.body?.spread ?? 0.12);   // per-voyage noise
    const cancelRate = Number(req.body?.cancelRate ?? 0.05);
    const jitter = () => 1 + bias + (rnd() * 2 - 1) * spread;

    await repo(stream).deleteActualsInPeriod(period.id);

    const rows: any[] = [];
    for (const v of voyages) {
      const cancelled = rnd() < cancelRate;
      const disch = v.stops.flatMap((s: any) => s.ops.filter((o: any) => o.op === 'DISCHARGE'));
      const qty = disch.reduce((a: number, o: any) => a + o.qty, 0);
      const partial = !cancelled && rnd() < 0.10;
      const qtyFactor = cancelled ? 0 : partial ? 0.6 + rnd() * 0.3 : 1;
      const base = addCost(ZERO_COST(), v.costBreakdown);
      const cb = cancelled
        // A cancelled voyage still burns positioning fuel and port charges.
        ? { bunker: Math.round(base.bunker * 0.25), freight: 0, portDA: Math.round(base.portDA * 0.5), demurrage: 0, changeover: 0 }
        : {
            bunker: Math.round(base.bunker * jitter()),
            freight: Math.round(base.freight * (v.pool === 'SPOT' ? jitter() * 1.06 : jitter())),
            portDA: Math.round(base.portDA * (1 + rnd() * 0.08)),
            // Demurrage is the tail risk: usually near plan, occasionally far above it.
            demurrage: Math.round(base.demurrage * (rnd() < 0.18 ? 1.8 + rnd() * 2.2 : 0.6 + rnd() * 0.7)),
            changeover: Math.round(base.changeover * (1 + rnd() * 0.15)),
          };
      const slip = Math.round((rnd() * 2 - 0.6) * 2);
      rows.push(normaliseActual(stream, period.id, {
        versionId: src.id, planVoyageId: v.id, vesselName: v.vesselName, vesselClass: v.vesselClass, pool: v.pool,
        fromLocationId: v.stops.find((s: any) => s.kind !== 'DISCHARGE')?.locationId ?? v.stops[0]?.locationId ?? null,
        toLocationId: [...v.stops].reverse().find((s: any) => s.kind !== 'LOAD')?.locationId ?? null,
        productId: disch[0]?.productId ?? null,
        qtyMt: Math.round(qty * qtyFactor), startDay: v.startDay, endDay: Math.max(v.startDay, v.endDay + slip),
        costBreakdown: cb, status: cancelled ? 'CANCELLED' : partial ? 'PARTIAL' : 'COMPLETED',
        source: 'SIMULATED', note: cancelled ? 'Voyage cancelled in execution' : partial ? 'Part cargo lifted' : null,
      }));
    }

    // Cover cancellations with an unplanned spot lift — the classic in-month cost surprise.
    const cancelledRows = rows.filter(r => r.status === 'CANCELLED');
    for (const c of cancelledRows) {
      if (rnd() > 0.65) continue;
      const plan = voyages.find((v: any) => v.id === c.planVoyageId);
      const planCost = plan ? sumCost(addCost(ZERO_COST(), plan.costBreakdown)) : c.cost * 4;
      const freight = Math.round(planCost * (1.15 + rnd() * 0.35));
      rows.push(normaliseActual(stream, period.id, {
        versionId: src.id, planVoyageId: null, vesselName: `Spot charter ${String(rows.length + 1).padStart(2, '0')}`,
        vesselClass: c.vesselClass, pool: 'SPOT', fromLocationId: c.fromLocationId, toLocationId: c.toLocationId,
        productId: c.productId, qtyMt: Math.round((plan?.stops ?? []).flatMap((s: any) => s.ops.filter((o: any) => o.op === 'DISCHARGE')).reduce((a: number, o: any) => a + o.qty, 0)),
        startDay: c.startDay + 2, endDay: c.endDay + 3,
        costBreakdown: { bunker: 0, freight, portDA: Math.round(freight * 0.05), demurrage: Math.round(freight * 0.03 * rnd()), changeover: 0 },
        status: 'COMPLETED', source: 'SIMULATED', note: 'Unplanned spot fixture covering a cancelled voyage',
      }));
    }

    await repo(stream).insertActuals(rows as any);
    res.json({ ok: true, inserted: rows.length, periodId: period.id, versionId: src.id, version: src.version });
  } catch (e) { console.error(e); res.status(500).json({ error: 'simulate actuals failed', message: (e as Error).message }); }
});

// ---------------------------------------------------------------------------
// Performance — baseline vs plan vs actual
// ---------------------------------------------------------------------------

/** Discharged MT on a planned voyage. */
const voyageMt = (v: any) => (v?.stops ?? []).reduce((a: number, s: any) =>
  a + (s.ops ?? []).reduce((x: number, o: any) => x + (o.op === 'DISCHARGE' ? o.qty : 0), 0), 0);

/** Roll a period's actual rows into the same shape as a plan KPI. */
function rollupActuals(rows: any[]) {
  const live = rows.filter(r => r.status !== 'CANCELLED');
  let cost = ZERO_COST();
  for (const r of rows) cost = addCost(cost, r.costBreakdown ?? { freight: r.cost });
  return {
    totalCost: Math.round(rows.reduce((s, r) => s + r.cost, 0)),
    costBreakdown: cost,
    liftedMt: Math.round(live.reduce((s, r) => s + r.qtyMt, 0)),
    voyageCount: live.length,
    spotVoyageCount: live.filter(r => r.pool === 'SPOT').length,
    cancelledCount: rows.filter(r => r.status === 'CANCELLED').length,
    unplannedCount: rows.filter(r => !r.planVoyageId && r.status !== 'CANCELLED').length,
    recordCount: rows.length,
  };
}

/** Pick the two reference plans for a period: its frozen baseline and its live plan. */
function periodRefs(versions: any[], periodId: string) {
  const inPeriod = versions.filter(v => v.periodId === periodId && v.status !== 'Draft');
  const byVersion = [...inPeriod].sort((a, b) => a.version - b.version);
  const baseline = byVersion.find(v => v.isBaseline) ?? byVersion[0] ?? null;
  const current = inPeriod.find(v => v.status === 'Active') ?? byVersion[byVersion.length - 1] ?? null;
  const ref = (v: any) => v ? { versionId: v.id, version: v.version, status: v.status, trigger: v.trigger, kpi: v.kpi ?? null } : null;
  return { baseline: ref(baseline), current: ref(current), baselineRow: baseline, currentRow: current, count: inPeriod.length };
}

app.get('/api/performance', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const period = await resolvePeriod(stream, req.query.periodId as string | undefined);
    if (!period) return res.json({ period: null, baseline: null, current: null, actual: rollupActuals([]), lines: [], voyageMatches: [] });

    const r = repo(stream);
    const versions = await r.versions();
    const { baseline, current, currentRow } = periodRefs(versions, period.id);
    const actRows = await r.actualsInPeriod(period.id);
    const actual = rollupActuals(actRows);

    const bCost = addCost(ZERO_COST(), (baseline?.kpi as any)?.costBreakdown);
    const pCost = addCost(ZERO_COST(), (current?.kpi as any)?.costBreakdown);
    const hasActuals = actRows.length > 0;

    const line = (key: string, label: string, b: number, p: number, a: number) => ({
      key, label, baseline: Math.round(b), plan: Math.round(p), actual: Math.round(a),
      varVsBaseline: Math.round(a - b), varVsPlan: Math.round(a - p),
      varPctVsBaseline: b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null,
    });
    const lines = [
      ...COST_KEYS.map(k => line(k, COST_LABELS[k], bCost[k], pCost[k], actual.costBreakdown[k])),
      line('total', 'Total cost', Number((baseline?.kpi as any)?.totalCost ?? sumCost(bCost)), Number((current?.kpi as any)?.totalCost ?? sumCost(pCost)), actual.totalCost),
    ];

    // Voyage-level reconciliation: matched, unplanned, and planned-but-not-executed.
    const planVoyages: any[] = (currentRow?.payload as any)?.voyages ?? [];
    const planById = new Map(planVoyages.map(v => [v.id, v]));
    const seen = new Set<string>();
    const voyageMatches: any[] = [];
    for (const a of actRows) {
      const pv = a.planVoyageId ? planById.get(a.planVoyageId) : null;
      if (a.planVoyageId) seen.add(a.planVoyageId);
      voyageMatches.push({
        planVoyageId: a.planVoyageId, vesselName: a.vesselName, pool: a.pool,
        planCost: pv ? Math.round(pv.cost) : null, actualCost: Math.round(a.cost),
        variance: pv ? Math.round(a.cost - pv.cost) : null,
        planQtyMt: pv ? Math.round(voyageMt(pv)) : null, actualQtyMt: Math.round(a.qtyMt),
        state: pv ? 'matched' : 'unplanned', status: a.status,
      });
    }
    for (const v of planVoyages) {
      if (seen.has(v.id)) continue;
      voyageMatches.push({
        planVoyageId: v.id, vesselName: v.vesselName, pool: v.pool,
        planCost: Math.round(v.cost), actualCost: hasActuals ? 0 : null,
        variance: hasActuals ? -Math.round(v.cost) : null,
        planQtyMt: Math.round(voyageMt(v)), actualQtyMt: hasActuals ? 0 : null,
        state: 'not-executed', status: null,
      });
    }
    voyageMatches.sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));

    const baselineMt = Number((baseline?.kpi as any)?.liftedMt ?? 0);
    const planMt = Number((current?.kpi as any)?.liftedMt ?? 0);
    const unit = (cost: number, mt: number) => mt > 0 ? Math.round((cost / mt) * 10) / 10 : null;

    res.json({
      period, baseline, current, actual: {
        ...actual,
        // How much of the live plan actually has execution data behind it.
        coveragePct: planVoyages.length ? Math.round((seen.size / planVoyages.length) * 100) : (hasActuals ? 100 : 0),
      },
      lines,
      volume: { baselineMt, planMt, actualMt: actual.liftedMt, varVsPlanMt: actual.liftedMt - planMt },
      unitCost: {
        baseline: unit(Number((baseline?.kpi as any)?.totalCost ?? 0), baselineMt),
        plan: unit(Number((current?.kpi as any)?.totalCost ?? 0), planMt),
        actual: hasActuals ? unit(actual.totalCost, actual.liftedMt) : null,
      },
      service: {
        baselineServedPct: (baseline?.kpi as any)?.demandServedPct ?? null,
        planServedPct: (current?.kpi as any)?.demandServedPct ?? null,
        deliveredPct: planMt > 0 && hasActuals ? Math.round((actual.liftedMt / planMt) * 100) : null,
      },
      voyageMatches,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'performance failed', message: (e as Error).message }); }
});

/** Cost history across every period for the stream — the plan-vs-actual trend. */
app.get('/api/performance/trend', async (req, res) => {
  try {
    const stream = (req.query.stream as string) || 'POL';
    const r = repo(stream);
    const periods = await r.periods();
    const versions = await r.versions();
    const acts = await r.actuals();

    const points = periods.sort((a, b) => a.code.localeCompare(b.code)).map(p => {
      const { baseline, current, count } = periodRefs(versions, p.id);
      const rows = acts.filter(a => a.periodId === p.id);
      const roll = rollupActuals(rows);
      const bMt = Number((baseline?.kpi as any)?.liftedMt ?? 0) || null;
      const pMt = Number((current?.kpi as any)?.liftedMt ?? 0) || null;
      const unit = (c: number | null, mt: number | null) => c != null && mt ? Math.round((c / mt) * 10) / 10 : null;
      const planCost = current?.kpi ? Number((current.kpi as any).totalCost) : null;
      return {
        periodId: p.id, code: p.code, label: p.label, status: p.status,
        baselineCost: baseline?.kpi ? Number((baseline.kpi as any).totalCost) : null,
        planCost,
        actualCost: rows.length ? roll.totalCost : null,
        baselineMt: bMt, planMt: pMt, actualMt: rows.length ? roll.liftedMt : null,
        actualUnitCost: rows.length ? unit(roll.totalCost, roll.liftedMt || null) : null,
        planUnitCost: unit(planCost, pMt),
        servedPct: (current?.kpi as any)?.demandServedPct ?? null,
        versionCount: count, hasActuals: rows.length > 0,
      };
    });
    res.json({ stream, points });
  } catch (e) { console.error(e); res.status(500).json({ error: 'trend failed', message: (e as Error).message }); }
});

// Generic master-data CRUD for the editable tables.
const MASTER: Record<string, any> = {
  products: schema.products, locations: schema.locations, vessels: schema.vessels,
  tanks: schema.tanks, nodeFlows: schema.nodeFlows, planLines: schema.planLines,
  berths: schema.berths, productCompatibility: schema.productCompatibility,
};
const masterSchema = (name: string) => MasterSchemas[name as MasterTable];

app.post('/api/master/:table', async (req, res) => {
  const t = MASTER[req.params.table]; const schema = masterSchema(req.params.table);
  if (!t || !schema) return res.status(404).json({ error: 'unknown table' });
  const body = parseBody(schema, req, res); if (!body) return;
  try {
    const row = { ...(body as Record<string, unknown>), id: (body as any).id ?? randomUUID() };
    await db.insert(t).values(row); res.json(row);
  } catch (e) { sendDbError(res, e, 'create failed'); }
});
app.put('/api/master/:table/:id', async (req, res) => {
  const t = MASTER[req.params.table]; const schema = masterSchema(req.params.table);
  if (!t || !schema) return res.status(404).json({ error: 'unknown table' });
  // A patch may be partial, but every field present must still be valid.
  const loose = (schema as any).partial ? (schema as any).partial() : schema;
  const body = parseBody(loose, req, res); if (!body) return;
  try {
    const patch = { ...(body as Record<string, unknown>) }; delete patch.id;
    await db.update(t).set(patch).where(eq(t.id, req.params.id)); res.json({ ok: true });
  } catch (e) { sendDbError(res, e, 'update failed'); }
});
app.delete('/api/master/:table/:id', async (req, res) => {
  const t = MASTER[req.params.table]; if (!t) return res.status(404).json({ error: 'unknown table' });
  await db.delete(t).where(eq(t.id, req.params.id)); res.json({ ok: true });
});
// Bulk import (CSV/plan upload). Optionally replace all rows for a stream first.
app.post('/api/master/:table/bulk', async (req, res) => {
  const t = MASTER[req.params.table]; const schema = masterSchema(req.params.table);
  if (!t || !schema) return res.status(404).json({ error: 'unknown table' });
  const parsed = parseBody(z.object({
    rows: z.array(schema as any).max(20000),
    replaceStream: z.enum(['CRUDE', 'LNG', 'POL']).optional(),
  }), req, res);
  if (!parsed) return;
  try {
    const rows: any[] = parsed.rows as any[];
    const replaceStream: string | undefined = parsed.replaceStream;
    if (replaceStream) await db.delete(t).where(eq(t.stream, replaceStream));
    const withIds = rows.map(r => ({ id: r.id ?? randomUUID(), ...r }));
    if (withIds.length) await db.insert(t).values(withIds);
    res.json({ ok: true, inserted: withIds.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'bulk import failed', message: (e as Error).message }); }
});
// Reset all data back to the seeded demo network.
app.post('/api/admin/reseed', async (_req, res) => {
  try {
    // TRUNCATE rather than DELETE: it does not fire row-level triggers, so a full
    // reset stays possible without an escape hatch that could bypass the ledger
    // guards in normal operation.
    await db.execute(sql`truncate table
      charter_recommendations, voyage_ops, voyage_stops, voyages, actuals,
      schedule_versions, scenarios, plan_periods, plan_lines, node_flows,
      berths, product_compatibility, tanks, vessels, locations, products`);
    await seed(db);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'reseed failed', message: (e as Error).message }); }
});

/**
 * Ledger integrity. Recomputes every digest and walks the prev_hash chain, so a
 * mutated row fails its digest and a removed row breaks the walk. Independent of
 * whatever the storage layer reports about itself.
 */
app.get('/api/ledger/verify', async (req, res) => {
  try {
    const streams = req.query.stream ? [String(req.query.stream)] : ['CRUDE', 'LNG', 'POL'];
    const checks = [];
    for (const st of streams) {
      const periods = await repo(st).periods();
      for (const p of periods.sort((a, b) => a.code.localeCompare(b.code))) {
        checks.push({ period: p.label, status: p.status, ...(await verifyChain('actuals', st, p.id)) });
        checks.push({ period: p.label, status: p.status, ...(await verifyChain('schedule_versions', st, p.id)) });
      }
    }
    // Only sealed periods can fail; an open month simply has nothing to verify yet.
    res.json({ driver, intact: checks.filter(c => c.sealed).every(c => c.intact), checks });
  } catch (e) { console.error(e); res.status(500).json({ error: 'ledger verify failed', message: (e as Error).message }); }
});

/**
 * Liveness only — deliberately does NOT touch the database.
 *
 * This is the endpoint to point a keep-warm schedule and a liveness probe at. On a
 * serverless Postgres plan whose compute suspends when idle, anything that queries
 * on a timer keeps that compute permanently awake: a 30-second probe is ~2,880
 * queries a day, which on Neon's free plan burns roughly 182 CU-hours a month
 * against a 100-hour budget and locks the database out until the next billing
 * period. Warming the container is nearly free; warming the database is not.
 *
 * Use /api/health when you want to know whether the database is reachable.
 */
app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()), env: cfg.NODE_ENV });
});

/**
 * Readiness — reports whether the database is actually reachable, so it runs a real
 * query rather than returning 200 from Node. Right for a startup probe and for
 * manual checks; wrong for anything on a short timer (see /api/ping).
 */
app.get('/api/health', async (_req, res) => {
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
    res.json({ ok: true, db: driver, latencyMs: Date.now() - t0 });
  } catch (e) {
    res.status(503).json({ ok: false, db: driver, latencyMs: Date.now() - t0, message: (e as Error).message });
  }
});

// Free Open-Meteo marine weather (no key).
app.get('/api/weather', async (req, res) => {
  try {
    const lat = req.query.lat || '15.0', lng = req.query.lng || '72.0';
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&windspeed_unit=kn`);
    const d = await r.json(); res.json(d.current_weather);
  } catch { res.status(500).json({ error: 'weather fetch failed' }); }
});

/**
 * Seed exactly once, even if several container instances cold-boot together.
 *
 * Without a lock, two instances both see an empty database and both seed, which
 * duplicates every row — the kind of fault that only appears under the concurrency
 * a shared demo actually gets. The lock is transaction-scoped rather than
 * session-scoped on purpose: a connection pooler can hand out a different backend
 * per transaction, which makes session-level advisory locks unreliable.
 */
const SEED_LOCK_KEY = 4726_1802;   // arbitrary, stable
async function seedOnce(): Promise<'seeded' | 'already-populated'> {
  // Held on an object so the assignment inside the transaction callback is visible
  // to the type checker's control-flow analysis.
  const state = { seeded: false };
  await db.transaction(async (tx: any) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
    const res: any = await tx.execute(sql`select count(*)::int as n from locations`);
    const n = Number((Array.isArray(res) ? res : res?.rows ?? [])[0]?.n ?? 0);
    if (n > 0) return;
    console.log('Seeding July 2026 start-of-month plan...');
    await seed(tx);
    state.seeded = true;
  });
  console.log(state.seeded ? 'Seed complete.' : 'Database already populated; seed skipped.');
  return state.seeded ? 'seeded' : 'already-populated';
}

// ---------------------------------------------------------------------------
async function startServer() {
  try {
    // Wait for the database before touching it: a suspend-capable compute resumes
    // on connect, and a cold start would otherwise race the resume.
    const ready = await waitForDb();
    if (ready.attempts > 1) console.log(`Database answered after ${ready.attempts} attempts (${ready.ms}ms).`);
    // Committed migrations, replayed in order — not a destructive schema diff.
    const m = await migrate();
    console.log(`Database ready on ${m.driver}; migrations applied.${m.note ? ` (${m.note})` : ''}`);
    // Same DDL in PGlite and in production Postgres, which is why one dialect matters.
    await installLedgerGuards();
    await seedOnce();
  } catch (e) {
    // Exit rather than listen. Previously this only set exitCode and carried on, so a
    // container with an unreachable database still bound the port and answered every
    // request with an error — the deploy looked healthy and failed silently. Exiting
    // makes Cloud Run fail the revision and surface the reason.
    console.error('Startup failed — refusing to serve:', (e as Error).message);
    process.exit(1);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT} - ${describeConfig(cfg)}`));
}

startServer();
