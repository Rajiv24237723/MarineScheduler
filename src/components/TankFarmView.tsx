import { useMemo, useState, useEffect } from 'react';
import { DashboardData, Tank, Goto, Focus } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { TankGauge } from '@/components/ui/TankGauge';
import { Tip, TipRows } from '@/components/ui/tooltip';
import { TankDetail } from './TankDetail';

export default function TankFarmView({ data, goto, focus }: { data: DashboardData; goto?: Goto; focus?: Focus }) {
  const [openTank, setOpenTank] = useState<Tank | null>(null);
  // Open the focused tank when navigated here from another card.
  useEffect(() => {
    if (focus?.tankId) { const t = data.tanks.find(x => x.id === focus.tankId); if (t) setOpenTank(t); }
    else if (focus?.node) { const t = data.tanks.find(x => x.locationId === focus.node!.loc && x.productId === focus.node!.product); if (t) setOpenTank(t); }
  }, [focus, data.tanks]);
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const prod = (id: string) => data.products.find(p => p.id === id);

  // All incoming discharge parcels per (location, product).
  const incoming = useMemo(() => {
    const m = new Map<string, { qty: number; day: number; vessel: string }[]>();
    for (const v of data.voyages ?? []) for (const s of v.stops) for (const o of s.ops) {
      if (o.op !== 'DISCHARGE') continue;
      const key = `${s.locationId}|${o.productId}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push({ qty: o.qty, day: s.arriveDay, vessel: v.vesselName });
    }
    for (const arr of m.values()) arr.sort((a, b) => a.day - b.day);
    return m;
  }, [data.voyages]);

  const byLoc = useMemo(() => {
    const g = new Map<string, Tank[]>();
    for (const t of data.tanks) { if (!g.has(t.locationId)) g.set(t.locationId, []); g.get(t.locationId)!.push(t); }
    return g;
  }, [data.tanks]);

  const incFor = (t: Tank) => incoming.get(`${t.locationId}|${t.productId}`) ?? [];
  const proj = (t: Tank) => data.projection?.find(p => p.locationId === t.locationId && p.productId === t.productId);

  // Network inventory rollup across every tank in the stream.
  const agg = useMemo(() => {
    let inv = 0, cap = 0, mn = 0;
    for (const t of data.tanks) { inv += t.currentStock; cap += t.capacity; mn += t.minStock; }
    return {
      tanks: data.tanks.length, inv, cap,
      ullage: Math.max(0, cap - inv), avail: Math.max(0, inv - mn),
      fillPct: Math.round((inv / Math.max(1, cap)) * 100),
      dry: (data.projection ?? []).filter(p => p.firstDryOutDay != null).length,
      top: (data.projection ?? []).filter(p => p.firstTankTopDay != null).length,
    };
  }, [data.tanks, data.projection]);
  const kt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-2xl font-medium text-foreground">Tank Farm — live inventory</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-bad" /> dry-out floor</span>
          <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-warn" /> tank-top</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-md bg-cyan-400/30" /> incoming</span>
        </div>
      </div>

      {/* Network inventory rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-px bg-border/40 rounded-md border border-border/70 overflow-hidden">
        {[
          ['Tanks', String(agg.tanks), ''],
          ['Inventory', `${kt(agg.inv)} MT`, ''],
          ['Ullage', `${kt(agg.ullage)} MT`, 'text-cyan-300'],
          ['Available', `${kt(agg.avail)} MT`, 'text-ok'],
          ['Fill', `${agg.fillPct}%`, ''],
          ['Dry-out risk', String(agg.dry), agg.dry > 0 ? 'text-bad' : 'text-ok'],
          ['Tank-top risk', String(agg.top), agg.top > 0 ? 'text-warn' : 'text-ok'],
        ].map(([label, val, tone]) => (
          <div key={label} className="bg-card px-3.5 py-3">
            <div className="font-cond text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
            <div className={`text-2xl font-serif mt-1 tabular-nums ${tone || 'text-foreground'}`}>{val}</div>
          </div>
        ))}
      </div>

      {[...byLoc.entries()].map(([locId, tanks]) => (
        <Card key={locId} className="bg-card/50 border-border/80 rounded-md">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-sm font-semibold text-foreground/80"><button onClick={() => goto?.('inventory', { locationId: locId })} className="hover:text-cyan-300">{loc(locId)}</button></CardTitle></CardHeader>
          <CardContent className="p-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {tanks.map(t => {
              const inc = incFor(t);
              const incTotal = inc.reduce((s, i) => s + i.qty, 0);
              const p = prod(t.productId);
              const pr = proj(t);
              const dryRisk = pr?.firstDryOutDay != null;
              const topRisk = pr?.firstTankTopDay != null;
              const dailyOut = data.nodeFlows?.find(f => f.locationId === t.locationId && f.productId === t.productId)?.dailyOut ?? 0;
              const available = Math.max(0, t.currentStock - t.minStock);
              const daysCover = dailyOut > 0 ? Math.floor(available / dailyOut) : null;
              const status = dryRisk ? `dry-out d${pr!.firstDryOutDay}` : topRisk ? `tank-top d${pr!.firstTankTopDay}` : 'within limits';
              return (
                <Tip key={t.id} content={<TipRows title={`${t.name} · ${p?.name ?? ''}`} rows={[['Inventory', `${Math.round(t.currentStock).toLocaleString()} MT`], ['Ullage', `${Math.round(t.capacity - t.currentStock).toLocaleString()} MT`], ['Available', `${available.toLocaleString()} MT`], ['Days of cover', daysCover == null ? 'net positive' : `${daysCover} d`], ['Incoming', `${Math.round(incTotal).toLocaleString()} MT · ${inc.length}`], ['Status', status]]} />}>
                  <button onClick={() => setOpenTank(t)} className="group flex flex-col items-center rounded-md border border-border/70 bg-background/40 hover:bg-muted/30 hover:border-cyan-500/40 transition-colors p-2">
                    <TankGauge id={t.id} color={p?.color ?? '#64748b'} fillPct={t.currentStock / t.capacity} minPct={t.minStock / t.capacity} incomingPct={incTotal / t.capacity} height={120} />
                    <div className="mt-1 text-center">
                      <div className="text-[11px] font-mono text-foreground/90 group-hover:text-cyan-300">{t.name}</div>
                      <div className="text-[9px] text-muted-foreground">{p?.name} · {Math.round(t.currentStock / 1000)}k / {Math.round(t.capacity / 1000)}k</div>
                      <div className="text-[9px] text-muted-foreground/75"><span className="text-cyan-400/80">ull</span> {Math.round((t.capacity - t.currentStock) / 1000)}k · <span className="text-ok/90">avl</span> {Math.round(Math.max(0, t.currentStock - t.minStock) / 1000)}k</div>
                      {(dryRisk || topRisk) && <div className={`mt-0.5 text-[8px] px-1 py-0.5 rounded-md ${dryRisk ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn'}`}>{dryRisk ? 'DRY-OUT RISK' : 'TANK-TOP RISK'}</div>}
                    </div>
                  </button>
                </Tip>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Modal open={!!openTank} onClose={() => setOpenTank(null)}
        title={openTank ? `${openTank.name} — ${prod(openTank.productId)?.name}` : ''}
        subtitle={openTank ? loc(openTank.locationId) : ''} width="max-w-3xl">
        {openTank && <TankDetail tank={openTank} data={data} onNavigate={(tab, f) => { setOpenTank(null); goto?.(tab, f); }} />}
      </Modal>
    </div>
  );
}
