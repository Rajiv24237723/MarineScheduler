import { DashboardData, Tank } from '../types';
import { TankGauge } from '@/components/ui/TankGauge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, addDays } from 'date-fns';

const START = new Date('2026-07-01T00:00:00Z');

/** Shared tank-detail body: large gauge, metrics, projection sparkline, incoming
 *  parcels. Used by the Tank Farm grid and the Inventory Forecast at-risk list. */
export function TankDetail({ tank, data }: { tank: Tank; data: DashboardData }) {
  const prod = (id: string) => data.products.find(p => p.id === id);
  const p = prod(tank.productId);
  const inc = (data.voyages ?? []).flatMap(v => v.stops.filter(s => s.locationId === tank.locationId)
    .flatMap(s => s.ops.filter(o => o.op === 'DISCHARGE' && o.productId === tank.productId).map(o => ({ qty: o.qty, day: s.arriveDay, vessel: v.vesselName }))))
    .sort((a, b) => a.day - b.day);
  const pr = data.projection?.find(x => x.locationId === tank.locationId && x.productId === tank.productId);
  const series = (pr?.series ?? []).map(s => ({ date: format(addDays(START, s.day), 'MMM d'), stock: s.stock }));
  const flow = data.nodeFlows?.find(f => f.locationId === tank.locationId && f.productId === tank.productId);
  const dailyIn = flow?.dailyIn ?? 0, dailyOut = flow?.dailyOut ?? 0, net = dailyIn - dailyOut;
  const ullage = Math.max(0, tank.capacity - tank.currentStock);       // headroom to tank-top
  const available = Math.max(0, tank.currentStock - tank.minStock);    // loadable surplus above floor
  const fillPct = Math.round((tank.currentStock / Math.max(1, tank.capacity)) * 100);
  const minPct = Math.round((tank.minStock / Math.max(1, tank.capacity)) * 100);
  const incTotal = inc.reduce((s, i) => s + i.qty, 0);
  const daysCover = dailyOut > 0 ? Math.floor(available / dailyOut) : null;
  const kMT = (n: number) => `${Math.round(n).toLocaleString()} MT`;
  const metric = (l: string, v: string, tone = 'text-foreground/90') => <div className="flex justify-between bg-background/50 px-3 py-2 rounded-md border border-border/70 text-xs"><span className="text-muted-foreground">{l}</span><span className={`font-mono ${tone}`}>{v}</span></div>;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="flex flex-col items-center">
        <TankGauge id={`d-${tank.id}`} color={p?.color ?? '#64748b'} fillPct={tank.currentStock / tank.capacity} minPct={tank.minStock / tank.capacity} incomingPct={inc.reduce((s, i) => s + i.qty, 0) / tank.capacity} height={190} />
        {pr && <div className={`mt-2 text-[10px] px-2 py-0.5 rounded-full ${pr.firstDryOutDay != null ? 'bg-bad/10 text-bad' : pr.firstTankTopDay != null ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}>{pr.firstDryOutDay != null ? `Dry-out day ${pr.firstDryOutDay}` : pr.firstTankTopDay != null ? `Tank-top day ${pr.firstTankTopDay}` : 'Within limits'}</div>}
      </div>
      <div className="col-span-2 space-y-2">
        {/* Fill bar with the dry-out floor marked */}
        <div className="bg-background/50 rounded-md border border-border/70 px-3 py-2">
          <div className="flex justify-between text-[11px] mb-1"><span className="text-muted-foreground">Fill</span><span className="font-mono text-foreground/90">{fillPct}% · {kMT(tank.currentStock)} / {kMT(tank.capacity)}</span></div>
          <div className="relative h-2.5 rounded bg-muted/50 overflow-hidden">
            <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, fillPct)}%`, background: p?.color ?? '#22d3ee' }} />
            <div className="absolute inset-y-0 w-0.5 bg-bad" style={{ left: `${minPct}%` }} title="dry-out floor" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {metric('Inventory (stock)', kMT(tank.currentStock))}
          {metric('Ullage (to tank-top)', kMT(ullage), 'text-cyan-300')}
          {metric('Available (above floor)', kMT(available), 'text-ok')}
          {metric('Days of cover', daysCover == null ? 'net positive' : `${daysCover} d`, daysCover != null && daysCover < 10 ? 'text-bad' : 'text-foreground/90')}
          {metric('Capacity (tank-top)', kMT(tank.capacity))}
          {metric('Dry-out floor (smin)', kMT(tank.minStock))}
          {metric('Daily in / out', `${Math.round(dailyIn).toLocaleString()} / ${Math.round(dailyOut).toLocaleString()}`)}
          {metric('Net change', `${net >= 0 ? '+' : ''}${Math.round(net).toLocaleString()} MT/d`, net >= 0 ? 'text-ok' : 'text-warn')}
        </div>
        <div className="h-32 rounded-md border border-border/70 bg-background/40 p-2">
          {series.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -10 }}>
                <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#94a3b8' }} interval={9} />
                <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #ffffff20', borderRadius: 8, fontSize: 11 }} formatter={(v: any) => [`${Number(v).toLocaleString()} MT`, 'Stock']} />
                <ReferenceLine y={tank.capacity} stroke="#f59e0b" strokeDasharray="3 3" />
                <ReferenceLine y={tank.minStock} stroke="#ef4444" strokeDasharray="3 3" />
                <Line type="stepAfter" dataKey="stock" stroke={p?.color ?? '#6366f1'} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">Run the optimizer to project this tank.</div>}
        </div>
        <div>
          <div className="text-[11px] font-medium text-muted-foreground mb-1">Incoming parcels ({inc.length})</div>
          <div className="max-h-24 overflow-auto space-y-1">
            {inc.length === 0 ? <div className="text-[11px] text-muted-foreground">None scheduled.</div> :
              inc.map((i, idx) => (
                <div key={idx} className="flex justify-between text-[11px] bg-background/50 px-2 py-1 rounded-md border border-border/60">
                  <span className="text-foreground/80">{i.vessel}</span>
                  <span className="text-muted-foreground">{i.qty.toLocaleString()} MT · {format(addDays(START, i.day), 'MMM d')}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
