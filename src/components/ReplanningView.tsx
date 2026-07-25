import { useState } from 'react';
import { DashboardData, Voyage } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { VoyageDetail } from './VoyageDetail';
import { GitCompare, AlertTriangle, CheckCircle2, Ship, Anchor, Snowflake, Plus } from 'lucide-react';
import { format, addDays } from 'date-fns';

const START = new Date('2026-07-01T00:00:00Z');
const fmtM = (n: number) => `${n >= 0 ? '+' : ''}₹${(n / 1e6).toFixed(1)}M`;
const money = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

export default function ReplanningView({ data, stream, refresh }: { data: DashboardData; stream: string; refresh: () => Promise<void> }) {
  const versions = data.versions ?? [];
  const active = versions.find(v => v.status === 'Active');
  const loc = (id: string | null) => id ? (data.locations.find(l => l.id === id)?.name ?? id) : 'source';
  const prod = (id: string) => data.products.find(p => p.id === id)?.name ?? id;
  const demandNodes = data.nodeFlows.filter(f => f.dailyOut > 0);

  // Planning posture
  const [asOf, setAsOf] = useState(12);
  const [mode, setMode] = useState('minimal-edit');

  // Disruption events
  const [flowNode, setFlowNode] = useState(''); const [flowVal, setFlowVal] = useState('');
  const [spotNode, setSpotNode] = useState(''); const [spotQty, setSpotQty] = useState('60000'); const [spotDay, setSpotDay] = useState('20');
  const [closureLoc, setClosureLoc] = useState(''); const [closeFrom, setCloseFrom] = useState('14'); const [closeTo, setCloseTo] = useState('24');
  const [vesselOut, setVesselOut] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);

  const [a, setA] = useState(versions[1]?.id ?? ''); const [b, setB] = useState(versions[0]?.id ?? '');
  const [cmp, setCmp] = useState<any>(null);
  const [versionVoyages, setVersionVoyages] = useState<{ v: number; voyages: Voyage[] } | null>(null);
  const [voyageModal, setVoyageModal] = useState<Voyage | null>(null);

  const toggleVessel = (id: string) => setVesselOut(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const events: string[] = [];
  if (flowNode && flowVal) events.push(`Demand revised @ ${loc(flowNode.split('|')[0])} → ${flowVal}/d`);
  if (spotNode && spotQty) events.push(`Spot cargo +${Number(spotQty).toLocaleString()} MT @ ${loc(spotNode.split('|')[0])} day ${spotDay}`);
  if (closureLoc) events.push(`Port closure @ ${loc(closureLoc)} days ${closeFrom}–${closeTo}`);
  if (vesselOut.size) events.push(`${vesselOut.size} vessel(s) off-hire/diverted`);

  const buildOptions = () => {
    const o: any = { asOfDay: asOf, mode };
    if (flowNode && flowVal) { const [l, p] = flowNode.split('|'); o.flowOverrides = [{ locationId: l, productId: p, dailyOut: Number(flowVal) }]; }
    if (spotNode && spotQty) { const [l, p] = spotNode.split('|'); o.emergencyDemands = [{ locationId: l, productId: p, qty: Number(spotQty), day: Number(spotDay) }]; }
    if (closureLoc) o.tankOutages = data.tanks.filter(t => t.locationId === closureLoc).map(t => ({ locationId: t.locationId, productId: t.productId, fromDay: Number(closeFrom), toDay: Number(closeTo) }));
    if (vesselOut.size) o.excludeVessels = [...vesselOut];
    return o;
  };
  const hasEvents = events.length > 0;

  const doCheck = async () => { setBusy(true); setDraft(null); try { const r = await fetch(`/api/scenario/check?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options: buildOptions() }) }); setCheck(await r.json()); } catch (e) { console.error(e); } setBusy(false); };
  const doSimulate = async () => { setBusy(true); try { const r = await fetch(`/api/scenario/apply?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: mode, options: buildOptions() }) }); const res = await r.json(); setDraft(res); setCheck({ hasPlan: true, holds: res.currentPlanHolds, breaches: res.breaches, activeVersion: active?.version }); await refresh(); } catch (e) { console.error(e); } setBusy(false); };
  const publish = async (id: string) => { await fetch(`/api/versions/${id}/publish`, { method: 'POST' }); setDraft(null); setCheck(null); await refresh(); };
  const rollback = async (id: string) => { await fetch(`/api/versions/${id}/rollback`, { method: 'POST' }); await refresh(); };
  const discard = async (id: string) => { await fetch(`/api/versions/${id}`, { method: 'DELETE' }); if (draft?.versionId === id) setDraft(null); await refresh(); };
  const compare = async () => { if (!a || !b) return; const r = await fetch(`/api/versions/compare?a=${a}&b=${b}`); setCmp(await r.json()); };
  const openVersion = async (id: string, v: number) => { const r = await fetch(`/api/versions/${id}`); const row = await r.json(); setVersionVoyages({ v, voyages: row.payload?.voyages ?? [] }); };

  const nodeOpt = (f: any) => <option key={`${f.locationId}|${f.productId}`} value={`${f.locationId}|${f.productId}`}>{loc(f.locationId)} · {prod(f.productId)} ({f.dailyOut}/d)</option>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Replanning Workbench</h3>
        <div className="text-xs text-muted-foreground">Operating plan: {active ? <span className="text-foreground/90">v{active.version} · {data.kpis?.demandServedPct ?? 0}% served</span> : 'none — run the optimizer first'}</div>
      </div>

      {/* Posture: as-of + mode */}
      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardContent className="p-4 grid grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-xs mb-1"><label className="text-muted-foreground flex items-center gap-1.5"><Snowflake className="w-3.5 h-3.5 text-sky-400" /> Planning as of (freeze committed voyages before)</label><span className="font-mono text-foreground/90">{format(addDays(START, asOf), 'MMM d')} (day {asOf})</span></div>
            <input type="range" min={0} max={40} value={asOf} onChange={e => setAsOf(Number(e.target.value))} className="w-full accent-sky-500" />
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">Voyages already underway before this date are locked; only the future is re-planned.</div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Recovery mode</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {[['minimal-edit', 'Minimal-edit', 'Change only the voyages the disruption forces (destroy/repair)'], ['minimal-change', 'Minimal-change', 'Freeze the next ~2 weeks too'], ['cost-optimal', 'Cost-optimal', 'Re-plan the whole future for lowest cost']].map(([id, label, desc]) => (
                <button key={id} onClick={() => setMode(id)} className={`text-left px-2.5 py-2 rounded-lg border text-xs ${mode === id ? 'bg-indigo-500/10 border-indigo-500/40 text-foreground' : 'bg-background/50 border-border/70 text-muted-foreground hover:text-foreground/80'}`}>
                  <div className="font-medium">{label}</div><div className="text-[10px] mt-0.5 text-muted-foreground leading-tight">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System-generated feasibility banner */}
      {check?.hasPlan && (
        check.holds
          ? <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-sm"><CheckCircle2 className="w-4 h-4" /> Operating plan{check.activeVersion ? ` (v${check.activeVersion})` : ''} still holds under these events — no replan required.</div>
          : <div className="px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-sm">
              <div className="flex items-center gap-2 text-red-400 font-medium"><AlertTriangle className="w-4 h-4" /> System alert: operating plan is no longer feasible ({check.breaches.length} breach{check.breaches.length === 1 ? '' : 'es'}).</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{check.breaches.slice(0, 3).join(' · ')}</div>
            </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Event composer */}
        <Card className="bg-card/50 border-border/80 rounded-lg">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Disruption events</CardTitle></CardHeader>
          <CardContent className="p-3 space-y-3 text-xs">
            <div>
              <label className="text-[11px] text-muted-foreground">Demand revision (new daily offtake)</label>
              <div className="flex gap-2 mt-1"><select value={flowNode} onChange={e => setFlowNode(e.target.value)} className="flex-1 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80"><option value="">— none —</option>{demandNodes.map(nodeOpt)}</select><input placeholder="MT/day" value={flowVal} onChange={e => setFlowVal(e.target.value)} type="number" className="w-24 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80" /></div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Spot / emergency cargo</label>
              <div className="flex gap-2 mt-1"><select value={spotNode} onChange={e => setSpotNode(e.target.value)} className="flex-1 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80"><option value="">— none —</option>{demandNodes.map(nodeOpt)}</select><input value={spotQty} onChange={e => setSpotQty(e.target.value)} type="number" className="w-20 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80" title="qty MT" /><input value={spotDay} onChange={e => setSpotDay(e.target.value)} type="number" className="w-14 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80" title="by day" /></div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Port / berth closure</label>
              <div className="flex gap-2 mt-1"><select value={closureLoc} onChange={e => setClosureLoc(e.target.value)} className="flex-1 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80"><option value="">— none —</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select><input value={closeFrom} onChange={e => setCloseFrom(e.target.value)} type="number" className="w-14 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80" title="from day" /><input value={closeTo} onChange={e => setCloseTo(e.target.value)} type="number" className="w-14 bg-background/50 rounded-lg px-2 py-1.5 border border-border/80" title="to day" /></div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Vessel off-hire / diverted</label>
              <div className="flex flex-wrap gap-1 mt-1 max-h-20 overflow-auto">{data.vessels.filter(v => v.pool !== 'SPOT').map(v => (<button key={v.id} onClick={() => toggleVessel(v.id)} className={`px-2 py-1 rounded-md border text-[10px] ${vesselOut.has(v.id) ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-background/50 border-border/70 text-muted-foreground hover:text-foreground/80'}`}>{v.name}</button>))}</div>
            </div>
            {events.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{events.map((e, i) => <span key={i} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">{e}</span>)}</div>}
            <div className="flex gap-2 pt-1">
              <button disabled={busy || !hasEvents} onClick={doCheck} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg disabled:opacity-50">Check impact</button>
              <button disabled={busy || !hasEvents} onClick={doSimulate} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">{busy ? 'Solving…' : 'Simulate recovery (draft)'}</button>
            </div>
          </CardContent>
        </Card>

        {/* Draft recovery result */}
        <Card className={`bg-card/50 rounded-lg ${draft ? 'border-indigo-500/30' : 'border-border/80'}`}>
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Recovery draft</CardTitle></CardHeader>
          <CardContent className="p-3 text-xs">
            {!draft ? <div className="text-muted-foreground p-2">Compose events and simulate — the recovery is saved as a <span className="text-indigo-300">draft</span>; your operating plan is untouched until you publish.</div> : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[['Served', `${draft.kpis.demandServedPct}%`], ['Total cost', money(draft.kpis.totalCost)], ['Voyages', String(draft.kpis.voyageCount)], ['Charter recs', String(draft.kpis.charterRecommendationCount)]].map(([l, v]) => (
                    <div key={l} className="bg-background/50 p-2 rounded-lg border border-border/70 text-center"><div className="text-[10px] text-muted-foreground">{l}</div><div className="text-sm font-semibold text-foreground mt-0.5">{v}</div></div>
                  ))}
                </div>
                {draft.changeSet && (
                  <div className="rounded-lg border border-border/70 bg-background/40 p-2.5">
                    <div className="text-[11px] font-medium text-foreground/80 mb-1">Change vs operating plan {draft.diff && <span className="text-muted-foreground">(cost {fmtM(draft.diff.costDelta)})</span>}</div>
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-1"><Snowflake className="w-3 h-3" />{draft.changeSet.frozen} kept</span>
                      <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">−{draft.changeSet.removed} removed</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1"><Plus className="w-3 h-3" />{draft.changeSet.added} added</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1"><Anchor className="w-3 h-3" />{draft.changeSet.spotAdded} spot</span>
                    </div>
                    <div className="mt-2 max-h-36 overflow-auto space-y-1">
                      {(draft.changeSet.removedVoyages ?? []).map((v: any, i: number) => (
                        <div key={`r${i}`} className="flex justify-between bg-red-500/5 rounded px-2 py-1 border border-red-500/15">
                          <span className="text-foreground/70"><span className="text-red-400 mr-1">−</span>{v.vesselName} <span className={v.pool === 'SPOT' ? 'text-amber-400' : 'text-muted-foreground'}>{v.pool}</span></span>
                          <span className="text-muted-foreground">{loc(v.from)} → {loc(v.to)}</span>
                        </div>
                      ))}
                      {draft.changeSet.addedVoyages.map((v: any, i: number) => (
                        <div key={`a${i}`} className="flex justify-between bg-emerald-500/5 rounded px-2 py-1 border border-emerald-500/15">
                          <span className="text-foreground/80"><span className="text-emerald-400 mr-1">+</span>{v.vesselName} <span className={v.pool === 'SPOT' ? 'text-amber-400' : 'text-muted-foreground'}>{v.pool}</span></span>
                          <span className="text-muted-foreground">{loc(v.from)} → {loc(v.to)} · {money(v.cost)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => publish(draft.versionId)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs">Publish as operating plan</button>
                  <button onClick={() => discard(draft.versionId)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs">Discard draft</button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Version history */}
      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-3 px-4 border-b border-border/60 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground/80">Plan versions ({versions.length})</CardTitle>
          <div className="flex items-center gap-2">
            <select value={a} onChange={e => setA(e.target.value)} className="bg-background/50 text-[11px] rounded-lg px-2 py-1 border border-border/80">{versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
            <span className="text-muted-foreground text-[11px]">vs</span>
            <select value={b} onChange={e => setB(e.target.value)} className="bg-background/50 text-[11px] rounded-lg px-2 py-1 border border-border/80">{versions.map(v => <option key={v.id} value={v.id}>v{v.version}</option>)}</select>
            <button onClick={compare} className="px-2.5 py-1 bg-muted hover:bg-accent border border-border/80 rounded-lg text-[11px] flex items-center gap-1"><GitCompare className="w-3 h-3" /> Compare</button>
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
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${v.status === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : v.status === 'Draft' ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20' : 'bg-muted text-muted-foreground border border-border/60'}`}>{v.status}</span>
                  <span className="text-muted-foreground">{v.trigger}</span>
                  <span className={v.achievable ? 'text-emerald-400' : 'text-red-400'}>{v.achievable ? 'achievable' : 'shortfall'}</span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-foreground/80">₹{(v.objectiveCost / 1e6).toFixed(1)}M</span>
                  {v.status === 'Draft' && <><button onClick={() => publish(v.id)} className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px]">Publish</button><button onClick={() => discard(v.id)} className="px-2 py-0.5 rounded bg-muted border border-border/70 text-[10px]">Discard</button></>}
                  {v.status === 'Superseded' && <button onClick={() => rollback(v.id)} className="px-2 py-0.5 rounded bg-muted hover:bg-accent border border-border/70 text-[10px]">Roll back</button>}
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
              <button key={v.id} onClick={() => setVoyageModal(v)} className="w-full text-left flex items-center justify-between bg-background/50 rounded-lg border border-border/70 px-3 py-2 text-xs hover:border-indigo-500/40">
                <span className="flex items-center gap-2"><Ship className="w-3.5 h-3.5 text-sky-400" /> <span className="font-mono text-foreground/90">{v.vesselName}</span> <span className={v.pool === 'SPOT' ? 'text-amber-400' : 'text-muted-foreground'}>{v.pool}</span></span>
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
