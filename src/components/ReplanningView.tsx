import { useCallback, useEffect, useState } from 'react';
import { DashboardData, Voyage, ReplanThresholds, ScenarioEvent, SavedScenario, horizonStartDate } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { toast } from './ui/toast';
import { VoyageDetail } from './VoyageDetail';
import ScenarioComposer from './ScenarioComposer';
import { GitCompare, AlertTriangle, CheckCircle2, Ship, Anchor, Snowflake, Plus, Layers, Flag, Trash2 } from 'lucide-react';
import { format, addDays } from 'date-fns';

const START = () => horizonStartDate();
const fmtM = (n: number) => `${n >= 0 ? '+' : ''}₹${(n / 1e6).toFixed(1)}M`;
const money = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;
// Replan-decision level → tone + one-word gloss.
const LVL: Record<string, { tone: string; bg: string; border: string }> = {
  L0: { tone: 'text-ok', bg: 'bg-ok/10', border: 'border-ok/25' },
  L1: { tone: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/25' },
  L2: { tone: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/25' },
  L3: { tone: 'text-warn', bg: 'bg-warn/10', border: 'border-warn/30' },
  L4: { tone: 'text-bad', bg: 'bg-bad/10', border: 'border-bad/30' },
};

export default function ReplanningView({ data, stream, refresh, thresholds }: { data: DashboardData; stream: string; refresh: () => Promise<void>; thresholds: ReplanThresholds }) {
  const versions = data.versions ?? [];
  const active = versions.find(v => v.status === 'Active');
  const loc = (id: string | null) => id ? (data.locations.find(l => l.id === id)?.name ?? id) : 'source';
  const periodLabel = (id: string | null | undefined) => (data.periods ?? []).find(p => p.id === id)?.label ?? '—';

  // Planning posture. Day bounds follow the period's horizon, not a fixed month length.
  const horizon = data.period?.horizonDays ?? 30;
  const [asOf, setAsOf] = useState(Math.round(horizon * 0.4));
  const [mode, setMode] = useState('minimal-edit');

  // Disruption events — an ordered list, any number of any type.
  const [events, setEvents] = useState<ScenarioEvent[]>([]);
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [candidates, setCandidates] = useState<any>(null);

  // Default the compare pair to the two newest versions, and re-point it whenever
  // a solve/publish/discard changes the list — otherwise the selects show options
  // the state no longer holds and Compare silently does nothing.
  const [a, setA] = useState(''); const [b, setB] = useState('');
  useEffect(() => {
    const ids = new Set(versions.map(v => v.id));
    if (!ids.has(a)) setA(versions[1]?.id ?? versions[0]?.id ?? '');
    if (!ids.has(b)) setB(versions[0]?.id ?? '');
  }, [versions, a, b]);
  const [cmp, setCmp] = useState<any>(null);
  const [versionVoyages, setVersionVoyages] = useState<{ v: number; voyages: Voyage[] } | null>(null);
  const [voyageModal, setVoyageModal] = useState<Voyage | null>(null);

  // Saved scenarios for this stream.
  const loadScenarios = useCallback(async () => {
    try { const r = await fetch(`/api/scenarios?stream=${stream}`); setScenarios(await r.json()); } catch (e) { console.error(e); }
  }, [stream]);
  useEffect(() => { loadScenarios(); }, [loadScenarios]);
  useEffect(() => { setEvents([]); setWarnings([]); setDraft(null); setCandidates(null); setCheck(null); }, [stream]);

  const saveScenario = async (name: string) => {
    await fetch(`/api/scenarios?stream=${stream}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, events, asOfDay: asOf, mode }),
    });
    await loadScenarios();
    toast(`Scenario “${name}” saved.`, 'success');
  };
  const loadScenario = (s: SavedScenario) => {
    setEvents(s.events ?? []); setAsOf(s.asOfDay ?? 0); setMode(s.mode ?? 'minimal-edit');
    setDraft(null); setCandidates(null); setCheck(null); setWarnings([]);
    toast(`Loaded “${s.name}” — ${(s.events ?? []).length} event(s).`, 'info');
  };
  const deleteScenario = async (id: string) => { await fetch(`/api/scenarios/${id}?stream=${stream}`, { method: 'DELETE' }); await loadScenarios(); };

  // The server compiles events → engine options, so posture is all the client sends.
  const body = (extra: any = {}) => JSON.stringify({ events, options: { asOfDay: asOf, mode }, thresholds, ...extra });
  const hasEvents = events.length > 0;

  const POST = (path: string, extra: any = {}) => fetch(`/api/scenario/${path}?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(extra) }).then(r => r.json());
  const doCheck = async () => { setBusy(true); setDraft(null); setCandidates(null); try { const res = await POST('check'); setCheck(res); setWarnings(res.warnings ?? []); } catch (e) { console.error(e); } setBusy(false); };
  const doSimulate = async () => { setBusy(true); setCandidates(null); try { const res = await POST('apply', { name: mode }); setDraft(res); setWarnings(res.warnings ?? []); setCheck({ hasPlan: true, holds: res.currentPlanHolds, breaches: res.breaches, decision: res.decision, activeVersion: active?.version }); await refresh(); toast(`Recovery draft created — ${res.changeSet?.removed ?? 0} removed / ${res.changeSet?.added ?? 0} added.`, 'success'); } catch (e) { console.error(e); toast('Simulation failed.', 'error'); } setBusy(false); };
  const doCandidates = async () => { setBusy(true); setDraft(null); try { const res = await POST('candidates'); setCandidates(res); setWarnings(res.warnings ?? []); setCheck({ hasPlan: true, holds: res.holds, breaches: res.breaches, decision: res.decision, activeVersion: active?.version }); await refresh(); toast(`Generated ${res.candidates?.length ?? 0} recovery candidates.`, 'success'); } catch (e) { console.error(e); toast('Candidate generation failed.', 'error'); } setBusy(false); };
  const publish = async (id: string) => { await fetch(`/api/versions/${id}/publish?stream=${stream}`, { method: 'POST' }); setDraft(null); setCheck(null); await refresh(); toast('Draft published as the operating plan.', 'success'); };
  const rollback = async (id: string) => { await fetch(`/api/versions/${id}/rollback?stream=${stream}`, { method: 'POST' }); await refresh(); toast('Rolled back — this version is now active.', 'success'); };
  const discard = async (id: string) => { await fetch(`/api/versions/${id}?stream=${stream}`, { method: 'DELETE' }); if (draft?.versionId === id) setDraft(null); await refresh(); toast('Draft discarded.', 'info'); };
  const publishCandidate = async (chosen: any) => { await fetch(`/api/versions/${chosen.versionId}/publish?stream=${stream}`, { method: 'POST' }); for (const c of candidates.candidates) if (c.versionId !== chosen.versionId) await fetch(`/api/versions/${c.versionId}?stream=${stream}`, { method: 'DELETE' }); setCandidates(null); setCheck(null); await refresh(); toast(`Published “${chosen.label}” recovery as the operating plan.`, 'success'); };
  const discardCandidates = async () => { for (const c of candidates.candidates) await fetch(`/api/versions/${c.versionId}?stream=${stream}`, { method: 'DELETE' }); setCandidates(null); await refresh(); toast('Candidates discarded.', 'info'); };
  // A candidate run leaves three drafts behind; only one gets published. Without a
  // sweep the version list fills with scenario drafts and hides the real history.
  const draftCount = versions.filter(v => v.status === 'Draft').length;
  const discardAllDrafts = async () => {
    const r = await fetch(`/api/versions/drafts?stream=${stream}`, { method: 'DELETE' });
    const res = await r.json();
    setDraft(null); setCandidates(null);
    await refresh();
    toast(res.error ? res.error : `Discarded ${res.discarded} draft${res.discarded === 1 ? '' : 's'}.`, res.error ? 'error' : 'info');
  };
  const compare = async () => { if (!a || !b) return; const r = await fetch(`/api/versions/compare?a=${a}&b=${b}`); setCmp(await r.json()); };
  const openVersion = async (id: string, v: number) => { const r = await fetch(`/api/versions/${id}?stream=${stream}`); const row = await r.json(); setVersionVoyages({ v, voyages: row.payload?.voyages ?? [] }); };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Replanning Workbench</h3>
        <div className="text-xs text-muted-foreground">Operating plan: {active ? <span className="text-foreground/90">v{active.version} · {data.kpis?.demandServedPct ?? 0}% served</span> : 'none — run the optimizer first'}</div>
      </div>

      {/* Posture: as-of + mode */}
      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardContent className="p-4 grid grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-xs mb-1"><label className="text-muted-foreground flex items-center gap-1.5"><Snowflake className="w-3.5 h-3.5 text-cyan-400" /> Planning as of (freeze committed voyages before)</label><span className="font-mono text-foreground/90">{format(addDays(START(), asOf), 'MMM d')} (day {asOf})</span></div>
            <input type="range" min={0} max={horizon} value={asOf} onChange={e => setAsOf(Number(e.target.value))} className="w-full accent-cyan-500" />
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">Voyages already underway before this date are locked; only the future is re-planned.</div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Recovery mode</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {[['minimal-edit', 'Minimal-edit', 'Change only the voyages the disruption forces (destroy/repair)'], ['minimal-change', 'Minimal-change', 'Freeze the next ~2 weeks too'], ['cost-optimal', 'Cost-optimal', 'Re-plan the whole future for lowest cost']].map(([id, label, desc]) => (
                <button key={id} onClick={() => setMode(id)} className={`text-left px-2.5 py-2 rounded-md border text-xs ${mode === id ? 'bg-cyan-500/10 border-cyan-500/40 text-foreground' : 'bg-background/50 border-border/70 text-muted-foreground hover:text-foreground/80'}`}>
                  <div className="font-medium">{label}</div><div className="text-[10px] mt-0.5 text-muted-foreground leading-tight">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Replan-decision banner: should we replan, and how big a repair? */}
      {check?.hasPlan && (() => {
        const d = check.decision;
        const t = d ? LVL[d.level] : (check.holds ? LVL.L0 : LVL.L4);
        return (
          <div className={`rounded-md border px-4 py-3 ${t.bg} ${t.border}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {check.holds ? <CheckCircle2 className={`w-4 h-4 ${t.tone}`} /> : <AlertTriangle className={`w-4 h-4 ${t.tone}`} />}
              {d && <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${t.tone} ${t.border}`}>{d.level}</span>}
              <span className={`text-sm font-medium ${t.tone}`}>{d ? d.label : (check.holds ? 'Operating plan holds' : 'Operating plan infeasible')}</span>
              {check.activeVersion && <span className="text-[11px] text-muted-foreground">v{check.activeVersion}</span>}
              {!check.holds && <span className="text-[11px] text-muted-foreground">· {check.breaches.length} breach{check.breaches.length === 1 ? '' : 'es'}</span>}
            </div>
            {d && <div className="mt-1.5 text-xs text-foreground/80">{d.recommend}</div>}
            {d?.reasons?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{d.reasons.map((r: string, i: number) => <span key={i} className={`px-2 py-0.5 rounded-full text-[10px] border bg-background/30 ${t.border} ${t.tone}`}>{r}</span>)}</div>}
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {d && <span>Blast radius: <span className="text-foreground/80">{d.blast.voyages}</span> voyage(s) · <span className="text-foreground/80">{d.blast.nodes}</span> node(s){d.blast.fromDay != null ? ` · days ${d.blast.fromDay}–${d.blast.toDay}` : ''}</span>}
              {!check.holds && check.breaches?.length > 0 && <span className="truncate">{check.breaches.slice(0, 2).join(' · ')}</span>}
            </div>
          </div>
        );
      })()}

      {/* How the compiler read the events — inverted ranges, colliding delays, floored rates. */}
      {warnings.length > 0 && (
        <div className="rounded-md border border-warn/25 bg-warn/5 px-4 py-2.5">
          <div className="text-[11px] font-medium text-warn mb-1">How the scenario was read</div>
          <ul className="space-y-0.5">
            {warnings.map((w, i) => <li key={i} className="text-[11px] text-foreground/75">· {w}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="space-y-3">
          <ScenarioComposer
            data={data} events={events} setEvents={setEvents} horizon={horizon}
            scenarios={scenarios} onSave={saveScenario} onLoad={loadScenario} onDelete={deleteScenario}
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <button disabled={busy || !hasEvents} onClick={doCheck} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md disabled:opacity-50">Check impact</button>
            <button disabled={busy || !hasEvents} onClick={doSimulate} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md disabled:opacity-50">{busy ? 'Solving…' : 'Simulate recovery (draft)'}</button>
            <button disabled={busy || !hasEvents} onClick={doCandidates} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md disabled:opacity-50 flex items-center gap-1"><Layers className="w-3.5 h-3.5 text-cyan-400" /> 3 candidates</button>
            {!hasEvents && <span className="self-center text-[11px] text-muted-foreground">Add at least one event to simulate.</span>}
          </div>
        </div>

        {/* Draft recovery result */}
        <Card className={`bg-card/50 rounded-md ${draft ? 'border-cyan-500/30' : 'border-border/80'}`}>
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Recovery draft</CardTitle></CardHeader>
          <CardContent className="p-3 text-xs">
            {!draft ? <div className="text-muted-foreground p-2">Compose events and simulate — the recovery is saved as a <span className="text-cyan-300">draft</span>; your operating plan is untouched until you publish.</div> : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[['Served', `${draft.kpis.demandServedPct}%`], ['Total cost', money(draft.kpis.totalCost)], ['Voyages', String(draft.kpis.voyageCount)], ['Charter recs', String(draft.kpis.charterRecommendationCount)]].map(([l, v]) => (
                    <div key={l} className="bg-background/50 p-2 rounded-md border border-border/70 text-center"><div className="text-[10px] text-muted-foreground">{l}</div><div className="text-sm font-semibold text-foreground mt-0.5">{v}</div></div>
                  ))}
                </div>
                {draft.shortfall && (
                  <div className="rounded-md border border-bad/25 bg-bad/5 p-2.5 text-[11px]">
                    <div className="text-bad font-medium mb-1">Shortfall — {draft.shortfall.totalMt.toLocaleString()} MT unserved across {draft.shortfall.nodes} node(s)</div>
                    <div className="text-muted-foreground">To close the gap: ~<span className="text-foreground/80">{draft.shortfall.addlVesselVoyages}</span> more voyage(s), ~<span className="text-foreground/80">{Math.round(draft.shortfall.addlBerthHours)}</span> berth-hours{draft.shortfall.earliestFeasibleDay != null ? `; earliest a lift can arrive ≈ day ${draft.shortfall.earliestFeasibleDay}` : ''}.</div>
                  </div>
                )}
                {draft.changeSet && (
                  <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                    <div className="text-[11px] font-medium text-foreground/80 mb-1">Change vs operating plan {draft.diff && <span className="text-muted-foreground">(cost {fmtM(draft.diff.costDelta)})</span>}</div>
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1"><Snowflake className="w-3 h-3" />{draft.changeSet.frozen} kept</span>
                      <span className="px-2 py-0.5 rounded-full bg-bad/10 text-bad border border-bad/20">−{draft.changeSet.removed} removed</span>
                      <span className="px-2 py-0.5 rounded-full bg-ok/10 text-ok border border-ok/20 flex items-center gap-1"><Plus className="w-3 h-3" />{draft.changeSet.added} added</span>
                      <span className="px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20 flex items-center gap-1"><Anchor className="w-3 h-3" />{draft.changeSet.spotAdded} spot</span>
                    </div>
                    <div className="mt-2 max-h-36 overflow-auto space-y-1">
                      {(draft.changeSet.removedVoyages ?? []).map((v: any, i: number) => (
                        <div key={`r${i}`} className="flex justify-between bg-bad/5 rounded-md px-2 py-1 border border-bad/15">
                          <span className="text-foreground/70"><span className="text-bad mr-1">−</span>{v.vesselName} <span className={v.pool === 'SPOT' ? 'text-warn' : 'text-muted-foreground'}>{v.pool}</span></span>
                          <span className="text-muted-foreground">{loc(v.from)} → {loc(v.to)}</span>
                        </div>
                      ))}
                      {draft.changeSet.addedVoyages.map((v: any, i: number) => (
                        <div key={`a${i}`} className="flex justify-between bg-ok/5 rounded-md px-2 py-1 border border-ok/15">
                          <span className="text-foreground/80"><span className="text-ok mr-1">+</span>{v.vesselName} <span className={v.pool === 'SPOT' ? 'text-warn' : 'text-muted-foreground'}>{v.pool}</span></span>
                          <span className="text-muted-foreground">{loc(v.from)} → {loc(v.to)} · {money(v.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => publish(draft.versionId)} className="px-3 py-1.5 bg-ok hover:bg-ok/90 text-background rounded-md text-xs">Publish as operating plan</button>
                  <button onClick={() => discard(draft.versionId)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Discard draft</button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recovery candidates — minimal-change / service-protection / lowest-cost, side by side */}
      {candidates?.candidates && (
        <Card className="bg-card/50 border-cyan-500/30 rounded-md">
          <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-cyan-400" /> Recovery candidates — pick one to publish</CardTitle>
            <button onClick={discardCandidates} className="text-[10px] text-muted-foreground hover:text-foreground/80">Discard all</button>
          </CardHeader>
          <CardContent className="p-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {candidates.candidates.map((c: any) => {
              const t = c.decision ? LVL[c.decision.level] : LVL.L2;
              return (
                <div key={c.versionId} className="rounded-md border border-border/70 bg-background/40 p-3 flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground/90">{c.label}</span>
                    {c.decision && <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono border ${t.tone} ${t.border}`}>{c.decision.level}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mt-2 text-center text-[10px]">
                    <div className="bg-card/60 rounded-md py-1 border border-border/60"><div className="text-muted-foreground">Served</div><div className={`text-sm font-semibold ${c.kpis.demandServedPct >= 100 ? 'text-ok' : 'text-warn'}`}>{c.kpis.demandServedPct}%</div></div>
                    <div className="bg-card/60 rounded-md py-1 border border-border/60"><div className="text-muted-foreground">Cost</div><div className="text-sm font-semibold text-foreground">{money(c.kpis.totalCost)}</div></div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2 text-[9px]">
                    <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">{c.changeSet.frozen} kept</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-bad/10 text-bad border border-bad/20">−{c.changeSet.removed}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-ok/10 text-ok border border-ok/20">+{c.changeSet.added}</span>
                    {c.changeSet.spotAdded > 0 && <span className="px-1.5 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20">{c.changeSet.spotAdded} spot</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5">Δ cost {c.diff ? fmtM(c.diff.costDelta) : '—'} · {c.kpis.voyageCount} voyages</div>
                  {c.shortfall && <div className="text-[10px] text-bad mt-1">{c.shortfall.totalMt.toLocaleString()} MT short · +{c.shortfall.addlVesselVoyages} voy to close</div>}
                  <button onClick={() => publishCandidate(c)} className="mt-3 px-2.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-[11px] font-medium">Publish this</button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Version history */}
      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-3 px-4 border-b border-border/60 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground/80">
            Plan versions ({versions.length})
            {draftCount > 0 && <span className="ml-2 text-[11px] font-normal text-cyan-300">{draftCount} draft{draftCount === 1 ? '' : 's'}</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            {draftCount > 0 && (
              <button onClick={discardAllDrafts} className="px-2.5 py-1 bg-muted hover:bg-accent border border-border/80 rounded-md text-[11px] flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Discard {draftCount} draft{draftCount === 1 ? '' : 's'}
              </button>
            )}
            <select value={a} onChange={e => setA(e.target.value)} className="bg-background/50 text-[11px] rounded-md px-2 py-1 border border-border/80">{versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
            <span className="text-muted-foreground text-[11px]">vs</span>
            <select value={b} onChange={e => setB(e.target.value)} className="bg-background/50 text-[11px] rounded-md px-2 py-1 border border-border/80">{versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
            <button onClick={compare} className="px-2.5 py-1 bg-muted hover:bg-accent border border-border/80 rounded-md text-[11px] flex items-center gap-1"><GitCompare className="w-3 h-3" /> Compare</button>
          </div>
        </CardHeader>
        {cmp?.delta && <div className="px-4 py-2 border-b border-border/50 grid grid-cols-4 gap-2 text-center bg-background/30">
          {[['Cost', fmtM(cmp.delta.costDelta)], ['Voyages', `${cmp.delta.voyageDelta >= 0 ? '+' : ''}${cmp.delta.voyageDelta}`], ['Charters', `${cmp.delta.charterDelta >= 0 ? '+' : ''}${cmp.delta.charterDelta}`], ['Served', `${cmp.delta.servedDelta >= 0 ? '+' : ''}${cmp.delta.servedDelta}%`]].map(([l, v]) => (<div key={l}><div className="text-[10px] text-muted-foreground">{l} Δ (v{cmp.a.version}→v{cmp.b.version})</div><div className="text-sm font-semibold text-foreground">{v}</div></div>))}
        </div>}
        <CardContent className="p-0">
          <div className="divide-y divide-border/50">
            {versions.map(v => (
              <div key={v.id} className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-muted/20">
                <button onClick={() => openVersion(v.id, v.version)} className="flex items-center gap-3 text-left">
                  <span className="font-mono text-foreground/90">v{v.version}</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[9px] ${v.status === 'Active' ? 'bg-ok/10 text-ok border border-ok/20' : v.status === 'Draft' ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20' : 'bg-muted text-muted-foreground border border-border/60'}`}>{v.status}</span>
                  {v.isBaseline && <span className="px-1.5 py-0.5 rounded-md text-[9px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 flex items-center gap-1"><Flag className="w-2.5 h-2.5" /> baseline</span>}
                  <span className="text-[10px] text-muted-foreground/80">{periodLabel(v.periodId)}</span>
                  <span className="text-muted-foreground">{v.trigger}</span>
                  <span className={v.achievable ? 'text-ok' : 'text-bad'}>{v.achievable ? 'achievable' : 'shortfall'}</span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-foreground/80">₹{(v.objectiveCost / 1e6).toFixed(1)}M</span>
                  {v.status === 'Draft' && <><button onClick={() => publish(v.id)} className="px-2 py-0.5 rounded-md bg-ok hover:bg-ok/90 text-background text-[10px]">Publish</button><button onClick={() => discard(v.id)} className="px-2 py-0.5 rounded-md bg-muted border border-border/70 text-[10px]">Discard</button></>}
                  {v.status === 'Superseded' && <button onClick={() => rollback(v.id)} className="px-2 py-0.5 rounded-md bg-muted hover:bg-accent border border-border/70 text-[10px]">Roll back</button>}
                </div>
              </div>
            ))}
            {versions.length === 0 && <div className="p-4 text-xs text-muted-foreground">No versions yet — run the optimizer.</div>}
          </div>
        </CardContent>
      </Card>

      <Modal open={!!versionVoyages} onClose={() => setVersionVoyages(null)} title={versionVoyages ? `Version v${versionVoyages.v} — ${versionVoyages.voyages.length} voyages` : ''} width="max-w-2xl">
        {versionVoyages && <div className="space-y-1.5">
          {versionVoyages.voyages.length === 0 ? <div className="text-xs text-muted-foreground">No voyages.</div> :
            versionVoyages.voyages.map(v => (
              <button key={v.id} onClick={() => setVoyageModal(v)} className="w-full text-left flex items-center justify-between bg-background/50 rounded-md border border-border/70 px-3 py-2 text-xs hover:border-cyan-500/40">
                <span className="flex items-center gap-2"><Ship className="w-3.5 h-3.5 text-cyan-400" /> <span className="font-mono text-foreground/90">{v.vesselName}</span> <span className={v.pool === 'SPOT' ? 'text-warn' : 'text-muted-foreground'}>{v.pool}</span></span>
                <span className="text-muted-foreground">{v.stops.length} stops · {money(v.cost)} ›</span>
              </button>
            ))}
        </div>}
      </Modal>
      <Modal open={!!voyageModal} onClose={() => setVoyageModal(null)} title={voyageModal ? `${voyageModal.vesselName} · ${voyageModal.vesselClass}` : ''} subtitle={voyageModal ? `${voyageModal.pool} · days ${voyageModal.startDay}–${voyageModal.endDay}` : ''} width="max-w-3xl">
        {voyageModal && <VoyageDetail voyage={voyageModal} locations={data.locations} products={data.products} vessels={data.vessels} />}
      </Modal>
    </div>
  );
}
