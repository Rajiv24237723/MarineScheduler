import { useMemo, useState } from 'react';
import { DashboardData, Tank } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { TankGauge } from '@/components/ui/TankGauge';
import { TankDetail } from './TankDetail';

export default function TankFarmView({ data }: { data: DashboardData }) {
  const [openTank, setOpenTank] = useState<Tank | null>(null);
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Tank Farm — live inventory</h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-red-400" /> dry-out floor</span>
          <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-amber-400" /> tank-top</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-400/30" /> incoming</span>
        </div>
      </div>

      {[...byLoc.entries()].map(([locId, tanks]) => (
        <Card key={locId} className="bg-card/50 border-border/80 rounded-lg">
          <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-sm font-semibold text-foreground/80">{loc(locId)}</CardTitle></CardHeader>
          <CardContent className="p-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {tanks.map(t => {
              const inc = incFor(t);
              const incTotal = inc.reduce((s, i) => s + i.qty, 0);
              const p = prod(t.productId);
              const pr = proj(t);
              const dryRisk = pr?.firstDryOutDay != null;
              const topRisk = pr?.firstTankTopDay != null;
              return (
                <button key={t.id} onClick={() => setOpenTank(t)} className="group flex flex-col items-center rounded-lg border border-border/70 bg-background/40 hover:bg-muted/30 hover:border-indigo-500/40 transition-colors p-2">
                  <TankGauge id={t.id} color={p?.color ?? '#64748b'} fillPct={t.currentStock / t.capacity} minPct={t.minStock / t.capacity} incomingPct={incTotal / t.capacity} height={120} />
                  <div className="mt-1 text-center">
                    <div className="text-[11px] font-mono text-foreground/90 group-hover:text-indigo-300">{t.name}</div>
                    <div className="text-[9px] text-muted-foreground">{p?.name} · {Math.round(t.currentStock / 1000)}k / {Math.round(t.capacity / 1000)}k</div>
                    {(dryRisk || topRisk) && <div className={`mt-0.5 text-[8px] px-1 py-0.5 rounded ${dryRisk ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{dryRisk ? 'DRY-OUT RISK' : 'TANK-TOP RISK'}</div>}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Modal open={!!openTank} onClose={() => setOpenTank(null)}
        title={openTank ? `${openTank.name} — ${prod(openTank.productId)?.name}` : ''}
        subtitle={openTank ? loc(openTank.locationId) : ''} width="max-w-3xl">
        {openTank && <TankDetail tank={openTank} data={data} />}
      </Modal>
    </div>
  );
}
