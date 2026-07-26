import { useState, ReactNode } from 'react';
import { DashboardData } from '../types';
import { Modal } from '@/components/ui/modal';
import { StreamFlag, Pennant, CodeBlock } from '@/components/ui/SignalFlag';
import { Tip, TipRows } from '@/components/ui/tooltip';

const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;
const SIG = { blue: 'var(--sea-cyan)', yellow: 'var(--sea-amber)', green: 'var(--sea-green)', red: 'var(--sea-red)' };

export default function DashboardView({ data, onGoto }: { data: DashboardData; onGoto?: (tab: string) => void }) {
  const [detail, setDetail] = useState<{ sev: string; text: string; action: string } | null>(null);
  const k = data.kpis;
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const prod = (id: string) => data.products.find(p => p.id === id)?.name ?? id;
  const active = data.versions?.find(v => v.status === 'Active');
  const hasPlan = !!active;
  const achievable = (data.unserved?.length ?? 0) === 0 && hasPlan;

  const unserved = data.unserved?.length ?? 0;
  const plates: Array<{ label: string; value: string; code?: string; tip: ReactNode }> = [
    { label: 'Served', value: `${k.demandServedPct}%`, code: k.demandServedPct >= 100 ? SIG.green : SIG.yellow, tip: <TipRows title="Demand served" rows={[['Served', `${k.demandServedPct}%`], ['Nodes short', String(unserved)], ['Status', achievable ? 'achievable' : 'shortfall']]} /> },
    { label: 'Plan cost', value: fmtM(k.totalCost), tip: <TipRows title="Plan cost" rows={[['Total', fmtM(k.totalCost)], ['Demurrage', fmtM(k.demurrage)]]} /> },
    { label: 'Voyages', value: String(k.voyageCount), tip: <TipRows title="Voyages" rows={[['Scheduled', String(k.voyageCount)], ['Spot charters', String(k.charterRecommendationCount)]]} /> },
    { label: 'Fleet util', value: `${k.utilizationPct}%`, tip: <div className="max-w-[13rem]"><TipRows title="Fleet utilisation" rows={[['Owned / TC used', `${k.utilizationPct}%`]]} /><div className="mt-1 text-muted-foreground">Share of the owned and time-chartered fleet put to work this horizon.</div></div> },
    { label: 'Charters', value: String(k.charterRecommendationCount), code: k.charterRecommendationCount > 0 ? SIG.yellow : undefined, tip: <div className="max-w-[13rem]"><TipRows title="Charter recommendations" rows={[['Count', String(k.charterRecommendationCount)]]} /><div className="mt-1 text-muted-foreground">Spot voyages advised where the owned fleet can't cover a lift in time.</div></div> },
    { label: 'Dry / top', value: `${k.dryOutDays}/${k.tankTopDays}`, code: (k.dryOutDays + k.tankTopDays) > 0 ? SIG.red : SIG.green, tip: <TipRows title="Inventory risk (nodes)" rows={[['Dry-out risk', String(k.dryOutDays)], ['Tank-top risk', String(k.tankTopDays)]]} /> },
  ];

  const exceptions: Array<{ sev: string; text: string; action: string }> = [];
  for (const u of data.unserved ?? []) exceptions.push({ sev: 'HIGH', text: `${loc(u.locationId)} · ${prod(u.productId)} short ${u.shortfallMt.toLocaleString()} MT`, action: `${u.reason} — due day ${u.day}` });
  for (const p of (data.projection ?? []).filter(p => p.firstDryOutDay !== null)) exceptions.push({ sev: 'HIGH', text: `Dry-out risk — ${p.locationName} · ${p.productName}`, action: `Below floor day ${p.firstDryOutDay} without a lift` });
  for (const p of (data.projection ?? []).filter(p => p.firstTankTopDay !== null)) exceptions.push({ sev: 'MED', text: `Tank-top risk — ${p.locationName} · ${p.productName}`, action: `Over ceiling day ${p.firstTankTopDay}` });
  for (const d of data.duals ?? []) exceptions.push({ sev: 'MED', text: `Bottleneck — ${d.constraint}`, action: `Marginal value ₹${d.shadowPrice.toLocaleString()}/MT` });

  return (
    <div className="space-y-4">
      {/* Plan-signal hoist — the operating plan read at a glance */}
      <div className="animate-hoist rounded-md border border-border/70 bg-card/60 overflow-hidden">
        <div className="flex flex-col lg:flex-row">
          <div className="flex items-center gap-3.5 p-4 lg:border-r border-b lg:border-b-0 border-border/60 lg:w-72 shrink-0">
            <StreamFlag stream={data.stream} size={38} />
            <div>
              <div className="font-cond text-[10px] uppercase tracking-[0.16em] text-muted-foreground leading-none">{data.stream} operating plan</div>
              <div className="font-serif text-2xl font-medium text-foreground leading-tight mt-0.5">{hasPlan ? `Version ${active!.version}` : 'No plan yet'}</div>
              <div className={`text-[11px] mt-0.5 ${achievable ? 'text-ok' : hasPlan ? 'text-warn' : 'text-muted-foreground'}`}>
                {!hasPlan ? 'Run the optimiser to build a plan' : achievable ? 'All demand served within limits' : `${data.unserved.length} node(s) short of demand`}
              </div>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-3 lg:grid-cols-6 gap-px bg-border/40">
            {plates.map(p => (
              <Tip key={p.label} content={p.tip} side="bottom">
                <div className="bg-card px-3.5 py-3 cursor-help hover:bg-card/70 transition-colors">
                  <div className="font-cond text-[9px] uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1.5">
                    {p.code && <CodeBlock color={p.code} size={9} />}{p.label}
                  </div>
                  <div className="text-2xl font-serif text-foreground mt-1 tabular-nums">{p.value}</div>
                </div>
              </Tip>
            ))}
          </div>
        </div>
      </div>

      {!hasPlan && (
        <div className="rounded-md border border-border/70 bg-card/50 p-6 text-center text-sm text-muted-foreground">
          No active plan for {data.stream}. Open the <button className="text-cyan-400 font-medium" onClick={() => onGoto?.('scheduler')}>Operational Plan</button> and run the optimiser.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        {/* Exception queue — ranked, flagged by pennant */}
        <div className="xl:col-span-3 rounded-md border border-border/70 bg-card/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-card/70">
            <h3 className="font-serif text-base font-medium text-foreground/90">Exception queue</h3>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{exceptions.length}</span>
          </div>
          {exceptions.length === 0 ? (
            <div className="p-4 text-xs text-ok flex items-center gap-2"><Pennant tone="ok" size={14} /> All clear — plan meets demand within limits.</div>
          ) : (
            <div className="divide-y divide-border/50 max-h-[52vh] overflow-auto">
              {exceptions.slice(0, 14).map((e, i) => (
                <Tip key={i} side="left" content={<div className="max-w-xs"><div className="text-foreground/90 font-medium">{e.text}</div><div className="text-muted-foreground mt-0.5">{e.action}</div></div>}>
                  <button onClick={() => setDetail(e)} className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-muted/25">
                    <Pennant tone={e.sev === 'HIGH' ? 'critical' : 'warn'} size={15} />
                    <span className="text-foreground/90 flex-1 truncate">{e.text}</span>
                    <span className="text-muted-foreground truncate hidden md:block">{e.action}</span>
                    <span className="text-muted-foreground/60">›</span>
                  </button>
                </Tip>
              ))}
            </div>
          )}
        </div>

        {/* Recommended actions */}
        <div className="xl:col-span-2 rounded-md border border-border/70 bg-card/50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/60 bg-card/70">
            <h3 className="font-serif text-base font-medium text-foreground/90">Recommended actions</h3>
          </div>
          <div className="p-3 space-y-2 max-h-[52vh] overflow-auto">
            {(data.charterRecommendations ?? []).length === 0 ? (
              <div className="text-xs text-muted-foreground p-2">No charter actions — the owned fleet covers the plan.</div>
            ) : data.charterRecommendations.slice(0, 8).map((r, i) => (
              <Tip key={i} side="left" content={<div className="max-w-xs space-y-1"><div className="text-foreground/90">{r.reason}</div>{r.estCost > 0 && <div className="text-muted-foreground">Est. cost {fmtM(r.estCost)}</div>}</div>}>
                <div className="flex items-center gap-3 bg-background/40 px-3 py-2 rounded-md border border-border/70 text-xs">
                  <StreamFlag stream={data.stream} size={16} />
                  <div className="flex-1 min-w-0">
                    <div className="text-foreground/90 truncate"><span className="font-semibold text-warn">Charter {r.vesselClass}</span> · {prod(r.productId)} {r.qty ? `${Math.round(r.qty / 1000)}k` : ''}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{r.fromLoc ? loc(r.fromLoc) : 'source'} → {loc(r.toLoc)} · by d{r.byDay}</div>
                  </div>
                  <button onClick={() => onGoto?.('scheduler')} className="px-2.5 py-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-[11px] font-medium whitespace-nowrap">Review</button>
                </div>
              </Tip>
            ))}
          </div>
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Exception detail" width="max-w-lg">
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Pennant tone={detail.sev === 'HIGH' ? 'critical' : 'warn'} size={16} />
              <span className="text-sm text-foreground/90">{detail.text}</span>
            </div>
            <div className="bg-background/50 rounded-md border border-border/70 p-3 text-xs text-muted-foreground">{detail.action}</div>
            <div className="flex gap-2">
              <button onClick={() => { setDetail(null); onGoto?.('inventory'); }} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs font-medium">Inventory forecast</button>
              <button onClick={() => { setDetail(null); onGoto?.('scheduler'); }} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-medium">Operational plan</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
