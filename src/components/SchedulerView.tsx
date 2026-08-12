import { useState } from 'react';
import { DashboardData, Voyage, Goto, horizonStartDate } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Pennant } from '@/components/ui/SignalFlag';
import { Tip, TipRows } from '@/components/ui/tooltip';
import { VoyageDetail } from './VoyageDetail';
import { format, addDays } from 'date-fns';

const START = () => horizonStartDate();
const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

export default function SchedulerView({ data, onOptimize, optimizing, goto }: { data: DashboardData; stream: string; onOptimize: () => void; optimizing: boolean; goto?: Goto }) {
  const [modalVoyage, setModalVoyage] = useState<Voyage | null>(null);
  const prod = (id: string) => data.products.find(p => p.id === id);
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const voyages = [...data.voyages].sort((a, b) => a.vesselName.localeCompare(b.vesselName) || a.startDay - b.startDay);
  const maxDay = Math.max(data.period?.horizonDays ?? 30, ...voyages.map(v => v.endDay));
  const k = data.kpis;
  const achievable = (data.unserved?.length ?? 0) === 0 && voyages.length > 0;
  const hasPlan = voyages.length > 0 || (data.versions?.length ?? 0) > 0;

  const primaryProduct = (v: Voyage) => v.stops.flatMap(s => s.ops).find(o => o.op === 'LOAD')?.productId;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-serif text-2xl font-medium text-foreground">Operational movement plan</h3>
          {hasPlan && (
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-cond font-semibold uppercase tracking-wider ${achievable ? 'bg-ok/10 text-ok border-ok/25' : 'bg-bad/10 text-bad border-bad/25'}`}>
              <Pennant tone={achievable ? 'ok' : 'critical'} size={12} />
              {achievable ? 'Achievable' : 'Shortfall'} · {k.demandServedPct}% served
            </span>)}
        </div>
        <button onClick={onOptimize} disabled={optimizing} className="px-5 py-2 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm">
          {optimizing ? 'Optimising…' : 'Run optimiser'}
        </button>
      </div>

      {!hasPlan && <Card className="bg-card/50 border-border/80 rounded-md"><CardContent className="p-8 text-center text-sm text-muted-foreground">No plan yet — click <span className="text-cyan-400 font-medium">Run optimiser</span> to build the {data.stream} movement schedule.</CardContent></Card>}

      {hasPlan && (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border/40 rounded-md border border-border/70 overflow-hidden">
        {([
          ['Total cost', fmtM(k.totalCost), 'Bunker + freight/hire + port DA + demurrage + tank changeover across every voyage.'],
          ['Voyages', String(k.voyageCount), 'Distinct vessel voyages in the active plan (ballast → load(s) → discharge(s) → empty).'],
          ['Charter recs', String(k.charterRecommendationCount), 'Spot voyages advised where the owned/TC/COA fleet cannot cover a lift in time.'],
          ['Fleet util', `${k.utilizationPct}%`, 'Share of the owned, time-charter and COA fleet put to work this horizon.'],
          ['Demurrage', fmtM(k.demurrage), 'Waiting cost incurred where a berth is congested beyond its simultaneous-vessel limit.'],
        ] as [string, string, string][]).map(([label, val, tip]) => (
          <Tip key={label} side="bottom" content={<div className="max-w-[15rem]"><div className="font-mono text-foreground/90 mb-1">{val}</div><div className="text-muted-foreground">{tip}</div></div>}>
            <div className="bg-card px-3.5 py-3 cursor-help hover:bg-card/70 transition-colors">
              <div className="font-cond text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
              <div className="text-2xl font-serif text-foreground mt-1 tabular-nums">{val}</div>
            </div>
          </Tip>
        ))}
      </div>
      )}

      {data.charterRecommendations?.length > 0 && (
        <Card className="bg-card/50 border-warn/30 rounded-md">
          <CardHeader className="py-2.5 px-4 bg-warn/10 border-b border-warn/20"><CardTitle className="text-xs font-semibold text-warn">Voyage-charter recommendations ({data.charterRecommendations.length})</CardTitle></CardHeader>
          <CardContent className="p-3 space-y-2 max-h-96 overflow-auto">
            {data.charterRecommendations.slice(0, 20).map((r, i) => (
              <div key={i} className="flex justify-between items-center gap-3 bg-background/50 p-2.5 rounded-md border border-border/80 text-xs">
                <div>
                  <div className="text-foreground/90"><span className="text-warn font-medium">Charter {r.vesselClass}</span> · {prod(r.productId)?.name ?? r.productId} {r.qty ? `${Math.round(r.qty / 1000)}k MT` : ''}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{r.fromLoc ? loc(r.fromLoc) : 'source'} → <button onClick={() => goto?.('inventory', { node: { loc: r.toLoc, product: r.productId } })} className="hover:text-cyan-300 underline-offset-2 hover:underline">{loc(r.toLoc)}</button> · by {format(addDays(START(), r.byDay || 0), 'MMM d')}</div>
                </div>
                {r.estCost > 0 && <span className="font-mono text-warn whitespace-nowrap">{fmtM(r.estCost)}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.unserved?.length > 0 && (
        <Card className="bg-card/50 border-bad/30 rounded-md">
          <CardHeader className="py-2.5 px-4 bg-bad/10 border-b border-bad/20"><CardTitle className="text-xs font-semibold text-bad">Unserved demand</CardTitle></CardHeader>
          <CardContent className="p-3 grid grid-cols-2 gap-2">
            {data.unserved.map((u, i) => (
              <div key={i} className="flex justify-between bg-background/50 p-2 rounded-md border border-border/80 text-xs">
                <span className="text-foreground/80">{loc(u.locationId)} · {prod(u.productId)?.name}</span>
                <span className="text-bad">{u.shortfallMt.toLocaleString()} MT short (day {u.day})</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.duals?.length > 0 && (
        <Card className="bg-card/50 border-border/80 rounded-md">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Binding constraints (shadow prices)</CardTitle></CardHeader>
          <CardContent className="p-3 grid grid-cols-2 gap-2">
            {data.duals.map((d, i) => (
              <Tip key={i} content={<div className="max-w-xs"><div className="text-foreground/90 font-medium">{d.constraint}</div><div className="text-muted-foreground mt-0.5">Shadow price — this limit is binding: relaxing it by one MT would cut plan cost by about ₹{d.shadowPrice.toLocaleString()}.</div></div>}>
                <div className="flex justify-between bg-background/50 p-2 rounded-md border border-border/80 text-xs cursor-help">
                  <span className="text-foreground/80">{d.constraint}</span>
                  <span className="font-mono text-warn">+₹{d.shadowPrice.toLocaleString()}/MT</span>
                </div>
              </Tip>
            ))}
          </CardContent>
        </Card>
      )}

      {voyages.length > 0 && (
      <Card className="min-h-[300px] flex flex-col overflow-hidden bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60 bg-card/80"><CardTitle className="text-sm font-semibold text-foreground/80">Vessel voyages — ballast → load(s) → discharge(s) → empty ({voyages.length})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[70vh]">
          {/* Day axis */}
          <div className="flex border-b border-border/60 bg-background/50 sticky top-0 z-10">
            <div className="w-44 p-2 text-[11px] font-medium text-muted-foreground/80 border-r border-border/60 shrink-0">Vessel</div>
            <div className="flex-1 relative h-8">
              {Array.from({ length: Math.ceil(maxDay / 7) + 1 }).map((_, i) => (
                <div key={i} className="absolute top-0 h-full border-l border-border/40 border-dashed text-[9px] text-muted-foreground/70 pl-1" style={{ left: `${(i * 7 / maxDay) * 100}%` }}>{format(addDays(START(), i * 7), 'MMM d')}</div>
              ))}
            </div>
          </div>
          {voyages.map(v => {
            const pcol = prod(primaryProduct(v) ?? '')?.color ?? '#64748b';
            const mt = v.stops.flatMap(s => s.ops).filter(o => o.op === 'LOAD').reduce((a, o) => a + o.qty, 0);
            return (
              <div key={v.id} className="flex border-b border-border/60 hover:bg-muted/20 cursor-pointer" onClick={() => setModalVoyage(v)}>
                <Tip side="right" content={<TipRows title={v.vesselName} rows={[['Class', v.vesselClass], ['Charter', v.pool], ['MT loaded', `${Math.round(mt / 1000)}k`], ['Window', `${format(addDays(START(), v.startDay), 'MMM d')}–${format(addDays(START(), v.endDay), 'MMM d')}`], ['Stops', String(v.stops.length)], ['Cost', fmtM(v.cost)]]} />}>
                  <div className="w-44 p-2 border-r border-border/60 shrink-0">
                    <div className="font-mono text-xs text-foreground/90 font-semibold">{v.vesselName}</div>
                    <div className="text-[10px] text-muted-foreground/80">{v.vesselClass} · <span className={v.pool === 'SPOT' ? 'text-warn' : ''}>{v.pool}</span> · {fmtM(v.cost)}</div>
                  </div>
                </Tip>
                <div className="flex-1 relative min-h-[46px] py-2">
                  <div className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full opacity-40" style={{ left: `${(v.startDay / maxDay) * 100}%`, width: `${Math.max(1, (v.endDay - v.startDay) / maxDay * 100)}%`, backgroundColor: pcol }} />
                  {v.stops.map(s => (
                    <Tip key={s.seq} content={<div className="max-w-xs"><div className="font-medium text-foreground/90">{s.kind} · {loc(s.locationId)}</div><div className="text-muted-foreground">{format(addDays(START(), s.arriveDay), 'MMM d')}</div><div className="mt-1 space-y-0.5">{s.ops.map((o, oi) => <div key={oi} className="flex justify-between gap-3"><span className="text-muted-foreground">{prod(o.productId)?.name} → {o.compartmentId}</span><span className="font-mono text-foreground/90">{(o.qty / 1000).toFixed(1)}k</span></div>)}</div></div>}>
                      <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-background hover:scale-150 transition-transform"
                        style={{ left: `calc(${(s.arriveDay / maxDay) * 100}% - 5px)`, backgroundColor: s.kind === 'LOAD' ? 'var(--sea-sand)' : 'var(--sea-green)' }} />
                    </Tip>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
      )}

      <Modal open={!!modalVoyage} onClose={() => setModalVoyage(null)}
        title={modalVoyage ? `${modalVoyage.vesselName} · ${modalVoyage.vesselClass}` : ''}
        subtitle={modalVoyage ? `${modalVoyage.pool} · days ${modalVoyage.startDay}–${modalVoyage.endDay} · ${fmtM(modalVoyage.cost)}` : ''} width="max-w-3xl">
        {modalVoyage && <VoyageDetail voyage={modalVoyage} locations={data.locations} products={data.products} vessels={data.vessels} onNavigate={(tab, f) => { setModalVoyage(null); goto?.(tab, f); }} />}
      </Modal>
    </div>
  );
}
