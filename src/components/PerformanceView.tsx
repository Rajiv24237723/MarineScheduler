import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DashboardData, PerformanceReport, PlanPeriod, TrendPoint, Actual, VarianceLine } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { toast } from './ui/toast';
import { Tip } from './ui/tooltip';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Flag, Upload, Wand2, Trash2, Plus, Lock, Anchor, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const M = (n: number | null | undefined) => n == null ? '—' : `₹${(n / 1e6).toFixed(1)}M`;
const signedM = (n: number | null | undefined) => n == null ? '—' : `${n >= 0 ? '+' : '−'}₹${Math.abs(n / 1e6).toFixed(1)}M`;
const pct = (n: number | null | undefined, d = 1) => n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`;
const mt = (n: number | null | undefined) => n == null ? '—' : `${Math.round(n / 1000).toLocaleString()}k MT`;
/** Over budget is bad, under is good — colour every variance the same way. */
const tone = (n: number | null | undefined, eps = 0) =>
  n == null ? 'text-muted-foreground' : n > eps ? 'text-bad' : n < -eps ? 'text-ok' : 'text-muted-foreground';

const EMPTY_ROW = {
  vesselName: '', vesselClass: '', pool: 'OWNED', fromLocationId: '', toLocationId: '', productId: '',
  qtyMt: '', startDay: '0', endDay: '0', bunker: '', freight: '', portDA: '', demurrage: '', changeover: '',
  status: 'COMPLETED', note: '',
};

/** Minimal CSV reader — handles quoted fields and a header row. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  const clean = rows.filter(r => r.some(c => c.trim() !== ''));
  if (clean.length < 2) return [];
  const head = clean[0].map(h => h.trim());
  return clean.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

export default function PerformanceView({ data, stream, refresh }: { data: DashboardData; stream: string; refresh: () => Promise<void> }) {
  const [periods, setPeriods] = useState<(PlanPeriod & { versionCount: number; baselineVersion: number | null; actualCount: number })[]>([]);
  const [periodId, setPeriodId] = useState<string>('');
  const [perf, setPerf] = useState<PerformanceReport | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [actuals, setActuals] = useState<Actual[]>([]);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [baseOpen, setBaseOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_ROW });
  const fileRef = useRef<HTMLInputElement>(null);

  const locName = useCallback((id: string | null) => id ? (data.locations.find(l => l.id === id)?.name ?? id) : '—', [data.locations]);

  const loadPeriods = useCallback(async () => {
    const r = await fetch(`/api/periods?stream=${stream}`);
    const rows = await r.json();
    setPeriods(rows);
    setPeriodId(prev => rows.some((p: PlanPeriod) => p.id === prev) ? prev : (rows.find((p: PlanPeriod) => p.status === 'Open')?.id ?? rows[0]?.id ?? ''));
  }, [stream]);

  const loadPerf = useCallback(async () => {
    if (!periodId) return;
    const [p, t, a] = await Promise.all([
      fetch(`/api/performance?stream=${stream}&periodId=${periodId}`).then(r => r.json()),
      fetch(`/api/performance/trend?stream=${stream}`).then(r => r.json()),
      fetch(`/api/actuals?stream=${stream}&periodId=${periodId}`).then(r => r.json()),
    ]);
    setPerf(p); setTrend(t.points ?? []); setActuals(a);
  }, [stream, periodId]);

  useEffect(() => { loadPeriods().catch(console.error); }, [loadPeriods]);
  useEffect(() => { loadPerf().catch(console.error); }, [loadPerf]);

  const period = periods.find(p => p.id === periodId) ?? null;
  const versionsInPeriod = useMemo(() => (data.versions ?? []).filter(v => v.periodId === periodId && v.status !== 'Draft'), [data.versions, periodId]);
  const hasActuals = actuals.length > 0;

  const totalLine = perf?.lines.find(l => l.key === 'total') ?? null;
  const catLines = perf?.lines.filter(l => l.key !== 'total') ?? [];
  const maxCat = Math.max(1, ...catLines.flatMap(l => [l.baseline, l.plan, l.actual]));

  // --- actions --------------------------------------------------------------
  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { const r = await fn(); if (r?.error) toast(r.error, 'error'); else { await loadPerf(); await loadPeriods(); await refresh(); toast(ok, 'success'); } }
    catch (e) { console.error(e); toast('Request failed.', 'error'); }
    setBusy(false);
  };

  const simulate = () => run(
    () => fetch(`/api/actuals/simulate?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId }) }).then(r => r.json()),
    'Execution simulated from the plan — actuals recorded.');

  const clearActuals = () => run(
    () => fetch(`/api/actuals?stream=${stream}&periodId=${periodId}`, { method: 'DELETE' }).then(r => r.json()),
    'Actuals cleared for this period.');

  const setBaseline = (id: string) => run(
    () => fetch(`/api/versions/${id}/baseline`, { method: 'POST' }).then(r => r.json()),
    'Baseline set — the month is now measured against this plan.');

  const closePeriod = () => run(
    () => fetch(`/api/periods/${periodId}/close`, { method: 'POST' }).then(r => r.json()),
    'Period closed.');

  const addActual = () => {
    const num = (v: string) => v === '' ? 0 : Number(v);
    const cb = { bunker: num(form.bunker), freight: num(form.freight), portDA: num(form.portDA), demurrage: num(form.demurrage), changeover: num(form.changeover) };
    run(() => fetch(`/api/actuals?stream=${stream}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, periodId, qtyMt: num(form.qtyMt), startDay: num(form.startDay), endDay: num(form.endDay), costBreakdown: cb, source: 'MANUAL' }),
    }).then(r => r.json()), 'Actual recorded.').then(() => { setAddOpen(false); setForm({ ...EMPTY_ROW }); });
  };

  const onFile = async (f: File) => {
    const rows = parseCsv(await f.text());
    if (!rows.length) { toast('No rows found in that file.', 'error'); return; }
    const n = (v: string | undefined) => v == null || v === '' ? 0 : Number(v);
    const payload = rows.map(r => ({
      planVoyageId: r.planVoyageId || null, vesselName: r.vesselName || r.vessel || 'Unknown',
      vesselClass: r.vesselClass || '', pool: r.pool || 'OWNED',
      fromLocationId: r.fromLocationId || null, toLocationId: r.toLocationId || null, productId: r.productId || null,
      qtyMt: n(r.qtyMt), startDay: n(r.startDay), endDay: n(r.endDay),
      costBreakdown: { bunker: n(r.bunker), freight: n(r.freight), portDA: n(r.portDA), demurrage: n(r.demurrage), changeover: n(r.changeover) },
      status: r.status || 'COMPLETED', note: r.note || null,
    }));
    run(() => fetch(`/api/actuals/bulk?stream=${stream}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, rows: payload, replace: true }),
    }).then(r => r.json()), `Imported ${payload.length} actual voyage row(s).`);
  };

  const deleteActual = (id: string) => run(() => fetch(`/api/actuals/${id}`, { method: 'DELETE' }).then(r => r.json()), 'Row removed.');

  // --- render ---------------------------------------------------------------
  const tile = (label: string, value: string, sub?: string, subTone?: string, tip?: string) => {
    const el = (
      <div className="bg-background/50 border border-border/70 rounded-md px-4 py-3">
        <div className="font-cond text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold font-mono text-foreground mt-1.5">{value}</div>
        {sub && <div className={`text-[11px] mt-1 ${subTone ?? 'text-muted-foreground'}`}>{sub}</div>}
      </div>
    );
    return tip ? <Tip content={tip} side="bottom">{el}</Tip> : el;
  };

  const bar = (v: number, colour: string) => (
    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
      <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.max(1, (v / maxCat) * 100)}%` }} />
    </div>
  );

  const trendData = trend.map(t => ({
    ...t,
    baseline: t.baselineCost != null ? t.baselineCost / 1e6 : null,
    plan: t.planCost != null ? t.planCost / 1e6 : null,
    actual: t.actualCost != null ? t.actualCost / 1e6 : null,
  }));

  return (
    <div className="space-y-5">
      {/* Period bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">Cost performance</h3>
          <select value={periodId} onChange={e => setPeriodId(e.target.value)} className="bg-background/60 text-xs rounded-md px-2.5 py-1.5 border border-border/80">
            {periods.map(p => <option key={p.id} value={p.id}>{p.label}{p.status === 'Open' ? ' · live' : ''}</option>)}
          </select>
          {period && (
            <span className={`px-2 py-0.5 rounded-md text-[10px] border ${period.status === 'Open' ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25' : 'bg-muted text-muted-foreground border-border/60'}`}>
              {period.status === 'Open' ? 'Open' : 'Closed'}
            </span>
          )}
          {period && <span className="text-[11px] text-muted-foreground">{period.startDate} → {period.endDate} · {period.versionCount} version(s){period.baselineVersion ? ` · baseline v${period.baselineVersion}` : ' · no baseline'}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button disabled={busy} onClick={() => setBaseOpen(true)} className="px-3 py-1.5 text-xs bg-muted hover:bg-accent border border-border/80 rounded-md flex items-center gap-1.5 disabled:opacity-50"><Flag className="w-3.5 h-3.5 text-cyan-400" /> Set baseline</button>
          <button disabled={busy} onClick={simulate} className="px-3 py-1.5 text-xs bg-muted hover:bg-accent border border-border/80 rounded-md flex items-center gap-1.5 disabled:opacity-50"><Wand2 className="w-3.5 h-3.5 text-cyan-400" /> Simulate execution</button>
          <button disabled={busy} onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-xs bg-muted hover:bg-accent border border-border/80 rounded-md flex items-center gap-1.5 disabled:opacity-50"><Upload className="w-3.5 h-3.5 text-cyan-400" /> Import actuals</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          {period?.status === 'Open' && <button disabled={busy} onClick={closePeriod} className="px-3 py-1.5 text-xs bg-muted hover:bg-accent border border-border/80 rounded-md flex items-center gap-1.5 disabled:opacity-50"><Lock className="w-3.5 h-3.5" /> Close month</button>}
        </div>
      </div>

      {/* Headline: baseline vs plan vs actual */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tile('Baseline plan', M(totalLine?.baseline),
          perf?.baseline ? `v${perf.baseline.version} · ${perf.baseline.trigger}` : 'no baseline set',
          undefined, 'The frozen start-of-month plan this period is measured against.')}
        {tile('Current plan', M(totalLine?.plan),
          totalLine ? `${pct(totalLine.baseline > 0 ? ((totalLine.plan - totalLine.baseline) / totalLine.baseline) * 100 : null)} vs baseline` : undefined,
          tone(totalLine ? totalLine.plan - totalLine.baseline : null), 'The live plan after in-month replans.')}
        {tile('Actual', hasActuals ? M(totalLine?.actual) : '—',
          hasActuals && totalLine ? `${signedM(totalLine.varVsPlan)} vs plan` : 'no actuals recorded',
          hasActuals ? tone(totalLine?.varVsPlan) : undefined, 'Executed cost from the actuals ledger.')}
        {tile('Variance vs baseline', hasActuals ? signedM(totalLine?.varVsBaseline) : '—',
          hasActuals ? `${pct(totalLine?.varPctVsBaseline)} · ${perf?.actual.coveragePct ?? 0}% of plan executed` : 'awaiting execution data',
          hasActuals ? tone(totalLine?.varVsBaseline) : undefined, 'Actual minus baseline — the number the month is judged on.')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Variance by cost category */}
        <Card className="bg-card/50 border-border/80 rounded-md lg:col-span-3">
          <CardHeader className="py-2.5 px-4 border-b border-border/60">
            <CardTitle className="text-xs font-semibold text-foreground/80">Where the money went — baseline vs plan vs actual</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 border-b border-border/50 text-[10px] font-cond uppercase tracking-[0.14em] text-muted-foreground">
              <span>Category</span><span className="text-right">Baseline</span><span className="text-right">Plan</span><span className="text-right">Actual</span><span className="text-right">Δ vs baseline</span>
            </div>
            <div className="divide-y divide-border/40">
              {catLines.map((l: VarianceLine) => (
                <div key={l.key} className="px-4 py-2.5 hover:bg-muted/20">
                  <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 items-center text-xs">
                    <span className="text-foreground/85">{l.label}</span>
                    <span className="text-right font-mono text-muted-foreground">{M(l.baseline)}</span>
                    <span className="text-right font-mono text-foreground/80">{M(l.plan)}</span>
                    <span className="text-right font-mono text-foreground">{hasActuals ? M(l.actual) : '—'}</span>
                    <span className={`text-right font-mono ${hasActuals ? tone(l.varVsBaseline) : 'text-muted-foreground'}`}>
                      {hasActuals ? `${signedM(l.varVsBaseline)}${l.varPctVsBaseline != null ? ` (${pct(l.varPctVsBaseline, 0)})` : ''}` : '—'}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 mt-1.5">
                    <span />
                    {bar(l.baseline, 'bg-muted-foreground/40')}
                    {bar(l.plan, 'bg-cyan-500/60')}
                    {bar(hasActuals ? l.actual : 0, hasActuals && l.varVsBaseline > 0 ? 'bg-bad/70' : 'bg-ok/70')}
                    <span />
                  </div>
                </div>
              ))}
              {totalLine && (
                <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2.5 items-center text-xs bg-background/40">
                  <span className="font-semibold text-foreground">Total</span>
                  <span className="text-right font-mono text-muted-foreground">{M(totalLine.baseline)}</span>
                  <span className="text-right font-mono text-foreground/80">{M(totalLine.plan)}</span>
                  <span className="text-right font-mono font-semibold text-foreground">{hasActuals ? M(totalLine.actual) : '—'}</span>
                  <span className={`text-right font-mono font-semibold ${hasActuals ? tone(totalLine.varVsBaseline) : 'text-muted-foreground'}`}>{hasActuals ? signedM(totalLine.varVsBaseline) : '—'}</span>
                </div>
              )}
              {!catLines.length && <div className="p-4 text-xs text-muted-foreground">No plan version for this period yet — run the optimiser.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Volume, unit cost, service */}
        <Card className="bg-card/50 border-border/80 rounded-md lg:col-span-2">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Volume, unit cost & service</CardTitle></CardHeader>
          <CardContent className="p-3 space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Baseline', mt(perf?.volume.baselineMt)], ['Plan', mt(perf?.volume.planMt)], ['Actual', hasActuals ? mt(perf?.volume.actualMt) : '—']].map(([l, v]) => (
                <div key={l} className="bg-background/50 rounded-md border border-border/70 py-2">
                  <div className="text-[10px] text-muted-foreground">{l} lifted</div>
                  <div className="text-sm font-semibold font-mono text-foreground mt-0.5">{v}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Baseline', perf?.unitCost.baseline], ['Plan', perf?.unitCost.plan], ['Actual', perf?.unitCost.actual]].map(([l, v]) => (
                <div key={l as string} className="bg-background/50 rounded-md border border-border/70 py-2">
                  <div className="text-[10px] text-muted-foreground">{l as string} ₹/MT</div>
                  <div className="text-sm font-semibold font-mono text-foreground mt-0.5">{v == null ? '—' : `₹${Number(v).toFixed(0)}`}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border/70 bg-background/40 p-2.5 space-y-1.5">
              {[
                ['Plan demand served', perf?.service.planServedPct == null ? '—' : `${perf.service.planServedPct}%`],
                ['Volume delivered vs plan', perf?.service.deliveredPct == null ? '—' : `${perf.service.deliveredPct}%`],
                ['Voyages executed', hasActuals ? `${perf?.actual.voyageCount ?? 0} of ${perf?.current?.kpi?.voyageCount ?? 0} planned` : '—'],
                ['Unplanned spot fixtures', hasActuals ? String(perf?.actual.unplannedCount ?? 0) : '—'],
                ['Cancelled voyages', hasActuals ? String(perf?.actual.cancelledCount ?? 0) : '—'],
              ].map(([l, v]) => (
                <div key={l as string} className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">{l as string}</span>
                  <span className="font-mono text-foreground/90 text-[11px]">{v as string}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trend across months */}
      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold text-foreground/80">Cost history — baseline, final plan and actual by month</CardTitle>
          <span className="text-[10px] text-muted-foreground">₹ million · {stream}</span>
        </CardHeader>
        <CardContent className="p-4 h-[300px]">
          {trendData.length === 0 ? <div className="text-xs text-muted-foreground">No periods yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `₹${v}M`} />
                <RTooltip contentStyle={{ background: '#0f172a', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, n: any) => [v == null ? '—' : `₹${Number(v).toFixed(1)}M`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="baseline" name="Baseline" fill="#64748b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="plan" name="Final plan" fill="#22d3ee" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="actual" name="Actual" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3.5 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
        <div className="border-t border-border/50 divide-y divide-border/40">
          {trend.map(t => {
            const v = t.actualCost != null && t.baselineCost != null ? t.actualCost - t.baselineCost : null;
            const Icon = v == null ? Minus : v > 0 ? TrendingUp : TrendingDown;
            return (
              <button key={t.periodId} onClick={() => setPeriodId(t.periodId)} className={`w-full grid grid-cols-6 gap-2 px-4 py-2 text-xs text-left hover:bg-muted/20 ${t.periodId === periodId ? 'bg-cyan-500/5' : ''}`}>
                <span className="text-foreground/90 flex items-center gap-1.5">{t.label}{t.status === 'Open' && <span className="text-[9px] text-cyan-300">live</span>}</span>
                <span className="text-right font-mono text-muted-foreground">{M(t.baselineCost)}</span>
                <span className="text-right font-mono text-foreground/80">{M(t.planCost)}</span>
                <span className="text-right font-mono text-foreground">{M(t.actualCost)}</span>
                <span className={`text-right font-mono flex items-center justify-end gap-1 ${tone(v)}`}><Icon className="w-3 h-3" />{signedM(v)}</span>
                <span className="text-right font-mono text-muted-foreground">{t.actualUnitCost != null ? `₹${t.actualUnitCost.toFixed(0)}/MT` : t.planUnitCost != null ? `₹${t.planUnitCost.toFixed(0)}/MT plan` : '—'}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Voyage reconciliation */}
        <Card className="bg-card/50 border-border/80 rounded-md">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Voyage reconciliation — biggest movers</CardTitle></CardHeader>
          <CardContent className="p-0 max-h-[320px] overflow-auto">
            <div className="divide-y divide-border/40">
              {(perf?.voyageMatches ?? []).slice(0, 25).map((v, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-xs">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-foreground/90 truncate">{v.vesselName}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] border ${v.state === 'unplanned' ? 'bg-warn/10 text-warn border-warn/25' : v.state === 'not-executed' ? 'bg-bad/10 text-bad border-bad/25' : 'bg-muted text-muted-foreground border-border/60'}`}>
                      {v.state === 'matched' ? (v.status ?? 'matched').toLowerCase() : v.state === 'unplanned' ? 'unplanned' : 'not executed'}
                    </span>
                    {v.pool === 'SPOT' && <Anchor className="w-3 h-3 text-warn shrink-0" />}
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground font-mono">{M(v.planCost)} → {M(v.actualCost)}</span>
                    <span className={`font-mono w-20 text-right ${tone(v.variance)}`}>{signedM(v.variance)}</span>
                  </span>
                </div>
              ))}
              {!(perf?.voyageMatches ?? []).length && <div className="p-4 text-xs text-muted-foreground">Nothing to reconcile — record actuals for this period.</div>}
            </div>
          </CardContent>
        </Card>

        {/* Actuals ledger */}
        <Card className="bg-card/50 border-border/80 rounded-md">
          <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-foreground/80">Actuals ledger ({actuals.length})</CardTitle>
            <div className="flex items-center gap-2">
              <button onClick={() => setAddOpen(true)} className="px-2 py-1 text-[10px] bg-muted hover:bg-accent border border-border/70 rounded-md flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button>
              {hasActuals && <button onClick={clearActuals} className="px-2 py-1 text-[10px] bg-muted hover:bg-accent border border-border/70 rounded-md">Clear</button>}
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[320px] overflow-auto">
            <div className="divide-y divide-border/40">
              {actuals.map(a => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2 text-xs group">
                  <span className="min-w-0">
                    <span className="font-mono text-foreground/90">{a.vesselName}</span>
                    <span className="text-muted-foreground ml-2 text-[10px]">{locName(a.fromLocationId)} → {locName(a.toLocationId)} · d{a.startDay}–{a.endDay}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-muted-foreground font-mono text-[10px]">{Math.round(a.qtyMt / 1000)}k MT</span>
                    <span className="font-mono text-foreground/90">{M(a.cost)}</span>
                    <button onClick={() => deleteActual(a.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-bad transition-opacity"><Trash2 className="w-3 h-3" /></button>
                  </span>
                </div>
              ))}
              {!hasActuals && (
                <div className="p-4 text-xs text-muted-foreground space-y-2">
                  <p>No execution data for {period?.label ?? 'this period'}.</p>
                  <p className="text-[11px]">Import a CSV with <span className="font-mono text-foreground/70">vesselName, pool, fromLocationId, toLocationId, qtyMt, startDay, endDay, bunker, freight, portDA, demurrage, changeover, status, planVoyageId</span> — or simulate execution from the plan to see the mechanics.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Set baseline */}
      <Modal open={baseOpen} onClose={() => setBaseOpen(false)} title={`Baseline for ${period?.label ?? ''}`} subtitle="The frozen plan this month's cost is measured against.">
        <div className="space-y-1.5">
          {versionsInPeriod.length === 0 && <div className="text-xs text-muted-foreground">No plan versions in this period yet.</div>}
          {versionsInPeriod.map(v => (
            <button key={v.id} onClick={() => { setBaseline(v.id); setBaseOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-xs ${v.isBaseline ? 'bg-cyan-500/10 border-cyan-500/40' : 'bg-background/50 border-border/70 hover:border-cyan-500/40'}`}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-foreground/90">v{v.version}</span>
                <span className="text-muted-foreground">{v.trigger}</span>
                {v.isBaseline && <span className="px-1.5 py-0.5 rounded-md text-[9px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">current baseline</span>}
              </span>
              <span className="font-mono text-foreground/80">{M(v.objectiveCost)}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Manual actual entry */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record an actual voyage" subtitle={period?.label} width="max-w-xl">
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[['vesselName', 'Vessel name'], ['vesselClass', 'Class'], ['qtyMt', 'Qty lifted (MT)'], ['startDay', 'Start day'], ['endDay', 'End day']].map(([k, l]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">{l}</span>
              <input value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80" />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px]">Pool</span>
            <select value={form.pool} onChange={e => setForm(f => ({ ...f, pool: e.target.value }))} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80">
              {['OWNED', 'TC', 'COA', 'SPOT'].map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          {[['fromLocationId', 'Load port'], ['toLocationId', 'Discharge port']].map(([k, l]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-muted-foreground text-[11px]">{l}</span>
              <select value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80">
                <option value="">—</option>
                {data.locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
              </select>
            </label>
          ))}
          <div className="col-span-2 grid grid-cols-5 gap-2">
            {[['bunker', 'Bunker'], ['freight', 'Freight'], ['portDA', 'Port DA'], ['demurrage', 'Demurrage'], ['changeover', 'Changeover']].map(([k, l]) => (
              <label key={k} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-[10px]">{l} ₹</span>
                <input value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80" />
              </label>
            ))}
          </div>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-muted-foreground text-[11px]">Note</span>
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80" />
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button disabled={busy || !form.vesselName} onClick={addActual} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs disabled:opacity-50">Record</button>
          <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Cancel</button>
        </div>
      </Modal>
    </div>
  );
}
