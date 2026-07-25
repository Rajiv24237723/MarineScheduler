import { useState } from 'react';
import { DashboardData, Voyage } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { VoyageDetail } from './VoyageDetail';
import { format, addDays } from 'date-fns';

const START = new Date('2026-07-01T00:00:00Z');
const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

export default function SchedulerView({ data, onOptimize, optimizing }: { data: DashboardData; stream: string; onOptimize: () => void; optimizing: boolean }) {
  const [modalVoyage, setModalVoyage] = useState<Voyage | null>(null);
  const prod = (id: string) => data.products.find(p => p.id === id);
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const voyages = [...data.voyages].sort((a, b) => a.vesselName.localeCompare(b.vesselName) || a.startDay - b.startDay);
  const maxDay = Math.max(31, ...voyages.map(v => v.endDay));
  const k = data.kpis;
  const achievable = (data.unserved?.length ?? 0) === 0 && voyages.length > 0;
  const hasPlan = voyages.length > 0 || (data.versions?.length ?? 0) > 0;

  const primaryProduct = (v: Voyage) => v.stops.flatMap(s => s.ops).find(o => o.op === 'LOAD')?.productId;

  return (
    <div className="space-y-5 flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-foreground">Operational Movement Plan</h3>
          {hasPlan && (achievable
            ? <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-medium tracking-wider">ACHIEVABLE · {k.demandServedPct}% SERVED</span>
            : <span className="px-3 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-[10px] font-medium tracking-wider">SHORTFALL · {k.demandServedPct}% SERVED</span>)}
        </div>
        <button onClick={onOptimize} disabled={optimizing} className="px-6 py-2 bg-sky-600 text-white rounded-lg text-xs font-medium hover:bg-sky-500 transition-colors disabled:opacity-50 shadow-sm">
          {optimizing ? 'Optimizing…' : 'Run Optimizer'}
        </button>
      </div>

      {!hasPlan && <Card className="bg-card/50 border-border/80 rounded-lg"><CardContent className="p-8 text-center text-sm text-muted-foreground">No plan yet — click <span className="text-sky-400 font-medium">Run Optimizer</span> to build the {data.stream} movement schedule.</CardContent></Card>}

      {hasPlan && (
      <div className="grid grid-cols-5 gap-3">
        {[
          ['Total cost', fmtM(k.totalCost)],
          ['Voyages', String(k.voyageCount)],
          ['Charter recs', String(k.charterRecommendationCount)],
          ['Fleet utilisation', `${k.utilizationPct}%`],
          ['Demurrage', fmtM(k.demurrage)],
        ].map(([label, val]) => (
          <Card key={label} className="bg-card/50 border-border/80 rounded-lg"><CardContent className="p-3">
            <div className="text-[11px] text-muted-foreground/80">{label}</div>
            <div className="text-lg font-semibold text-foreground mt-0.5">{val}</div>
          </CardContent></Card>
        ))}
      </div>
      )}

      {data.charterRecommendations?.length > 0 && (
        <Card className="bg-card/50 border-amber-500/30 rounded-lg">
          <CardHeader className="py-2.5 px-4 bg-amber-500/10 border-b border-amber-500/20 rounded-t-xl"><CardTitle className="text-xs font-semibold text-amber-500">Voyage-Charter Recommendations ({data.charterRecommendations.length})</CardTitle></CardHeader>
          <CardContent className="p-3 space-y-2 max-h-52 overflow-auto">
            {data.charterRecommendations.slice(0, 20).map((r, i) => (
              <div key={i} className="flex justify-between items-center gap-3 bg-background/50 p-2.5 rounded-lg border border-border/80 text-xs">
                <div>
                  <div className="text-foreground/90"><span className="text-amber-400 font-medium">Charter {r.vesselClass}</span> · {prod(r.productId)?.name ?? r.productId} {r.qty ? `${Math.round(r.qty / 1000)}k MT` : ''}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{r.fromLoc ? loc(r.fromLoc) : 'source'} → {loc(r.toLoc)} · by {format(addDays(START, r.byDay || 0), 'MMM d')}</div>
                </div>
                {r.estCost > 0 && <span className="font-mono text-amber-400 whitespace-nowrap">{fmtM(r.estCost)}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.unserved?.length > 0 && (
        <Card className="bg-card/50 border-red-500/30 rounded-lg">
          <CardHeader className="py-2.5 px-4 bg-red-500/10 border-b border-red-500/20 rounded-t-xl"><CardTitle className="text-xs font-semibold text-red-400">Unserved Demand</CardTitle></CardHeader>
          <CardContent className="p-3 grid grid-cols-2 gap-2">
            {data.unserved.map((u, i) => (
              <div key={i} className="flex justify-between bg-background/50 p-2 rounded-lg border border-border/80 text-xs">
                <span className="text-foreground/80">{loc(u.locationId)} · {prod(u.productId)?.name}</span>
                <span className="text-red-400">{u.shortfallMt.toLocaleString()} MT short (day {u.day})</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.duals?.length > 0 && (
        <Card className="bg-card/50 border-border/80 rounded-lg">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Binding Constraints (shadow prices)</CardTitle></CardHeader>
          <CardContent className="p-3 grid grid-cols-2 gap-2">
            {data.duals.map((d, i) => (
              <div key={i} className="flex justify-between bg-background/50 p-2 rounded-lg border border-border/80 text-xs">
                <span className="text-foreground/80">{d.constraint}</span>
                <span className="font-mono text-amber-400">+₹{d.shadowPrice.toLocaleString()}/MT</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {voyages.length > 0 && (
      <Card className="flex-1 min-h-[300px] flex flex-col overflow-hidden bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-2.5 px-4 border-b border-border/60 bg-card/80"><CardTitle className="text-sm font-semibold text-foreground/80">Vessel Voyages — ballast → load(s) → discharge(s) → empty ({voyages.length})</CardTitle></CardHeader>
        <CardContent className="flex-1 p-0 overflow-auto">
          {/* Day axis */}
          <div className="flex border-b border-border/60 bg-background/50 sticky top-0 z-10">
            <div className="w-44 p-2 text-[11px] font-medium text-muted-foreground/80 border-r border-border/60 shrink-0">Vessel</div>
            <div className="flex-1 relative h-8">
              {Array.from({ length: Math.ceil(maxDay / 7) + 1 }).map((_, i) => (
                <div key={i} className="absolute top-0 h-full border-l border-border/40 border-dashed text-[9px] text-muted-foreground/70 pl-1" style={{ left: `${(i * 7 / maxDay) * 100}%` }}>{format(addDays(START, i * 7), 'MMM d')}</div>
              ))}
            </div>
          </div>
          {voyages.map(v => {
            const pcol = prod(primaryProduct(v) ?? '')?.color ?? '#64748b';
            return (
              <div key={v.id} className="flex border-b border-border/60 hover:bg-muted/20 cursor-pointer" onClick={() => setModalVoyage(v)}>
                <div className="w-44 p-2 border-r border-border/60 shrink-0">
                  <div className="font-mono text-xs text-foreground/90 font-semibold">{v.vesselName}</div>
                  <div className="text-[10px] text-muted-foreground/80">{v.vesselClass} · <span className={v.pool === 'SPOT' ? 'text-amber-400' : ''}>{v.pool}</span> · {fmtM(v.cost)}</div>
                </div>
                <div className="flex-1 relative min-h-[46px] py-2">
                  <div className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full opacity-40" style={{ left: `${(v.startDay / maxDay) * 100}%`, width: `${Math.max(1, (v.endDay - v.startDay) / maxDay * 100)}%`, backgroundColor: pcol }} />
                  {v.stops.map(s => (
                    <div key={s.seq} title={`${s.kind} @ ${loc(s.locationId)} (day ${s.arriveDay})`}
                      className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-background"
                      style={{ left: `calc(${(s.arriveDay / maxDay) * 100}% - 5px)`, backgroundColor: s.kind === 'LOAD' ? '#6366f1' : '#10b981' }} />
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
        {modalVoyage && <VoyageDetail voyage={modalVoyage} locations={data.locations} products={data.products} vessels={data.vessels} />}
      </Modal>
    </div>
  );
}
