import { useState, useMemo, useEffect } from 'react';
import { DashboardData, Tank, Goto, Focus } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { TankDetail } from './TankDetail';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, addDays } from 'date-fns';

const START = new Date('2026-07-01T00:00:00Z');

export default function InventoryView({ data, goto, focus }: { data: DashboardData; goto?: Goto; focus?: Focus }) {
  const projections = data.projection ?? [];
  const [key, setKey] = useState<string>(projections[0] ? `${projections[0].locationId}|${projections[0].productId}` : '');
  const [openTank, setOpenTank] = useState<Tank | null>(null);
  // Land focused on a node (or the first node at a location) when navigated here.
  useEffect(() => {
    if (focus?.node) setKey(`${focus.node.loc}|${focus.node.product}`);
    else if (focus?.locationId) { const p = projections.find(x => x.locationId === focus.locationId); if (p) setKey(`${p.locationId}|${p.productId}`); }
  }, [focus]);
  const tankFor = (loc: string, pid: string) => data.tanks.find(t => t.locationId === loc && t.productId === pid) ?? null;
  const sel = projections.find(p => `${p.locationId}|${p.productId}` === key) ?? projections[0];

  const chartData = useMemo(() => (sel?.series ?? []).map(s => ({
    date: format(addDays(START, s.day), 'MMM d'), stock: s.stock,
  })), [sel]);

  if (!sel) return <div className="text-sm text-muted-foreground">No inventory nodes for this stream.</div>;

  const atRisk = projections.filter(p => p.firstDryOutDay !== null || p.firstTankTopDay !== null);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Network Inventory Forecast</h3>
        <select value={key} onChange={e => setKey(e.target.value)} className="bg-card/50 text-sm rounded-md px-3 py-1.5 border border-border/80 text-foreground/90">
          {projections.map(p => <option key={`${p.locationId}|${p.productId}`} value={`${p.locationId}|${p.productId}`}>{p.locationName} — {p.productName}</option>)}
        </select>
      </div>

      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-3 px-4 border-b border-border/60 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground/80">{sel.locationName} · {sel.productName} — projected stock</CardTitle>
          <div className="flex gap-2 text-[10px]">
            {sel.firstDryOutDay !== null && <span className="px-2 py-0.5 rounded-full bg-bad/10 text-bad border border-bad/20">DRY-OUT day {sel.firstDryOutDay}</span>}
            {sel.firstTankTopDay !== null && <span className="px-2 py-0.5 rounded-full bg-warn/10 text-warn border border-warn/20">TANK-TOP day {sel.firstTankTopDay}</span>}
            {sel.firstDryOutDay === null && sel.firstTankTopDay === null && <span className="px-2 py-0.5 rounded-full bg-ok/10 text-ok border border-ok/20">WITHIN LIMITS</span>}
          </div>
        </CardHeader>
        <CardContent className="p-4 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={6} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [`${Number(v).toLocaleString()} MT`, 'Stock']} />
              <ReferenceLine y={sel.smax} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Tank-top', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
              <ReferenceLine y={sel.smin} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Dry-out', fill: '#ef4444', fontSize: 10, position: 'insideBottomRight' }} />
              <Line type="stepAfter" dataKey="stock" stroke="#6366f1" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-3 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80">Nodes at risk ({atRisk.length})</CardTitle></CardHeader>
        <CardContent className="p-3">
          {atRisk.length === 0 ? <div className="text-xs text-ok p-2">All nodes stay within dry-out and tank-top limits across the horizon.</div> :
            <div className="grid grid-cols-2 gap-2">
              {atRisk.map(p => (
                <div key={`${p.locationId}|${p.productId}`} className="flex justify-between items-center bg-background/50 p-2 rounded-md border border-border/80 text-xs">
                  <button className="text-foreground/80 hover:text-cyan-300" onClick={() => setKey(`${p.locationId}|${p.productId}`)}>{p.locationName} · {p.productName}</button>
                  <div className="flex items-center gap-2">
                    <span className={p.firstDryOutDay !== null ? 'text-bad' : 'text-warn'}>{p.firstDryOutDay !== null ? `dry-out d${p.firstDryOutDay}` : `tank-top d${p.firstTankTopDay}`}</span>
                    {tankFor(p.locationId, p.productId) && <button onClick={() => setOpenTank(tankFor(p.locationId, p.productId))} className="px-2 py-0.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-[10px]">Tank ›</button>}
                  </div>
                </div>
              ))}
            </div>}
        </CardContent>
      </Card>

      <Modal open={!!openTank} onClose={() => setOpenTank(null)}
        title={openTank ? `${openTank.name} — ${data.products.find(p => p.id === openTank.productId)?.name}` : ''}
        subtitle={openTank ? data.locations.find(l => l.id === openTank.locationId)?.name : ''} width="max-w-3xl">
        {openTank && <TankDetail tank={openTank} data={data} onNavigate={(tab, f) => { setOpenTank(null); goto?.(tab, f); }} />}
      </Modal>
    </div>
  );
}
