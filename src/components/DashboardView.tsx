import { useState } from 'react';
import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { IndianRupee, Ship, CheckCircle2, AlertTriangle, Anchor, Droplet } from 'lucide-react';

const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

export default function DashboardView({ data, onGoto }: { data: DashboardData; onGoto?: (tab: string) => void }) {
  const [detail, setDetail] = useState<{ sev: string; text: string; action: string } | null>(null);
  const k = data.kpis;
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const prod = (id: string) => data.products.find(p => p.id === id)?.name ?? id;
  const hasPlan = (data.versions?.length ?? 0) > 0;

  const cards = [
    { label: 'Plan cost', value: fmtM(k.totalCost), icon: IndianRupee, tint: 'text-sky-400' },
    { label: 'Demand served', value: `${k.demandServedPct}%`, icon: CheckCircle2, tint: k.demandServedPct >= 100 ? 'text-emerald-400' : 'text-amber-400' },
    { label: 'Voyages planned', value: String(k.voyageCount), icon: Ship, tint: 'text-sky-400' },
    { label: 'Charter recs', value: String(k.charterRecommendationCount), icon: Anchor, tint: k.charterRecommendationCount > 0 ? 'text-amber-400' : 'text-muted-foreground' },
    { label: 'Fleet utilisation', value: `${k.utilizationPct}%`, icon: Ship, tint: 'text-sky-400' },
    { label: 'Dry-out / tank-top', value: `${k.dryOutDays} / ${k.tankTopDays}`, icon: Droplet, tint: (k.dryOutDays + k.tankTopDays) > 0 ? 'text-red-400' : 'text-emerald-400' },
  ];

  // Exceptions from real diagnostics.
  const exceptions: Array<{ sev: string; text: string; action: string }> = [];
  for (const u of data.unserved ?? []) exceptions.push({ sev: 'HIGH', text: `${loc(u.locationId)} · ${prod(u.productId)} short ${u.shortfallMt.toLocaleString()} MT (day ${u.day})`, action: u.reason });
  for (const p of (data.projection ?? []).filter(p => p.firstDryOutDay !== null)) exceptions.push({ sev: 'HIGH', text: `Dry-out risk: ${p.locationName} · ${p.productName}`, action: `Below floor day ${p.firstDryOutDay} without a lift` });
  for (const p of (data.projection ?? []).filter(p => p.firstTankTopDay !== null)) exceptions.push({ sev: 'MED', text: `Tank-top risk: ${p.locationName} · ${p.productName}`, action: `Over ceiling day ${p.firstTankTopDay}` });
  for (const d of data.duals ?? []) exceptions.push({ sev: 'MED', text: `Bottleneck: ${d.constraint}`, action: `Marginal value ₹${d.shadowPrice.toLocaleString()}/MT` });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {cards.map(c => (
          <Card key={c.label} className="bg-card/50 border-border/80 rounded-lg"><CardContent className="p-4 flex items-center justify-between">
            <div><div className="text-[11px] text-muted-foreground/80">{c.label}</div><div className="text-xl font-semibold text-foreground mt-0.5">{c.value}</div></div>
            <c.icon className={`w-5 h-5 ${c.tint}`} />
          </CardContent></Card>
        ))}
      </div>

      {!hasPlan && (
        <Card className="bg-card/50 border-border/80 rounded-lg"><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No active plan for {data.stream}. Open <button className="text-sky-400 font-medium" onClick={() => onGoto?.('scheduler')}>Operational Plan</button> and run the optimizer.
        </CardContent></Card>
      )}

      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-3 px-4 border-b border-border/60"><CardTitle className="text-sm font-semibold text-foreground/80">Exception Queue ({exceptions.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {exceptions.length === 0 ? <div className="p-4 text-xs text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> No open exceptions — plan meets all demand within limits.</div> :
            <div className="divide-y divide-border/50">
              {exceptions.slice(0, 12).map((e, i) => (
                <button key={i} onClick={() => setDetail(e)} className="w-full text-left flex items-center justify-between px-4 py-2.5 text-xs hover:bg-muted/20">
                  <div className="flex items-center gap-3">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${e.sev === 'HIGH' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{e.sev}</span>
                    <span className="text-foreground/85">{e.text}</span>
                  </div>
                  <span className="text-muted-foreground">{e.action} ›</span>
                </button>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-3 px-4 border-b border-border/60"><CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400" /> Recommended Decisions</CardTitle></CardHeader>
        <CardContent className="p-3 space-y-2">
          {(data.charterRecommendations ?? []).length === 0 ? <div className="text-xs text-muted-foreground p-2">No charter actions recommended — the owned/TC fleet covers the plan.</div> :
            data.charterRecommendations.slice(0, 8).map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-background/50 p-2.5 rounded-lg border border-border/80 text-xs">
                <div>
                  <div className="text-foreground/90"><span className="text-amber-400 font-medium">Charter {r.vesselClass}</span> · {prod(r.productId)} {r.qty ? `${Math.round(r.qty / 1000)}k MT` : ''}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{r.fromLoc ? loc(r.fromLoc) : 'source'} → {loc(r.toLoc)} · by day {r.byDay}</div>
                </div>
                <button onClick={() => onGoto?.('scheduler')} className="ml-3 px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-medium whitespace-nowrap">Review</button>
              </div>
            ))}
        </CardContent>
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Exception detail" width="max-w-lg">
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${detail.sev === 'HIGH' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{detail.sev}</span>
              <span className="text-sm text-foreground/90">{detail.text}</span>
            </div>
            <div className="bg-background/50 rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">{detail.action}</div>
            <div className="flex gap-2">
              <button onClick={() => { setDetail(null); onGoto?.('inventory'); }} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs">Open Inventory Forecast</button>
              <button onClick={() => { setDetail(null); onGoto?.('scheduler'); }} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs">Open Operational Plan</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
