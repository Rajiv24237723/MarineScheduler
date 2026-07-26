import { useState } from 'react';
import { Voyage, Location, Product, Vessel } from '../types';
import { VesselStowage } from './ui/VesselStowage';
import { format, addDays } from 'date-fns';

const START = new Date('2026-07-01T00:00:00Z');
const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

/** Shared voyage-detail body: cargo stowage manifest + current on-board inventory,
 *  cost breakdown, route, legs. Used by the Scheduler, Live Fleet map, version modals. */
export function VoyageDetail({ voyage, locations, products, vessels = [] }: { voyage: Voyage; locations: Location[]; products: Product[]; vessels?: Vessel[] }) {
  const loc = (id: string) => locations.find(l => l.id === id)?.name ?? id;
  const prod = (id: string) => products.find(p => p.id === id);
  const vessel = vessels.find(v => v.id === voyage.vesselId || v.name === voyage.vesselName);

  // Manifest: total loaded into each compartment over the voyage.
  const stow: Record<string, { productId: string; qty: number }> = {};
  for (const s of voyage.stops) for (const o of s.ops) if (o.op === 'LOAD') stow[o.compartmentId] = { productId: o.productId, qty: o.qty };

  // As-of scrubber: on-board inventory = loads − discharges up to the selected day.
  const today = Math.round((Date.now() - START.getTime()) / 86400000);
  const clampDay = (d: number) => Math.max(voyage.startDay, Math.min(voyage.endDay, d));
  const [asOf, setAsOf] = useState(clampDay(today));
  const onboardAt = (compId: string, day: number) => {
    let q = 0;
    for (const s of voyage.stops) for (const o of s.ops) if (o.compartmentId === compId && s.arriveDay <= day) q += (o.op === 'LOAD' ? o.qty : -o.qty);
    return Math.max(0, q);
  };
  const current: Record<string, number> = {};
  for (const cid of Object.keys(stow)) current[cid] = onboardAt(cid, asOf);
  const inTransit = asOf >= voyage.startDay && asOf <= voyage.endDay;

  const b = voyage.costBreakdown;
  const parts: [string, number, string][] = [
    ['Bunker', b.bunker, '#6366f1'], ['Freight/hire', b.freight, '#0ea5e9'],
    ['Port DA', b.portDA, '#8b5cf6'], ['Demurrage', b.demurrage, '#f59e0b'], ['Changeover', b.changeover, '#ef4444'],
  ];
  const tot = Math.max(1, parts.reduce((s, p) => s + p[1], 0));

  return (
    <div className="space-y-4">
      {vessel && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">Cargo stowage — {vessel.name} ({vessel.class}, {vessel.service ?? 'CLEAN'})</div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-md bg-white/60" /> on board</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-md border border-white/40" /> manifest</span>
            </div>
          </div>
          <VesselStowage compartments={vessel.compartments} stow={stow} products={products} current={current} />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">As of {format(addDays(START, asOf), 'MMM d')}</span>
            <input type="range" min={voyage.startDay} max={voyage.endDay} value={asOf} onChange={e => setAsOf(Number(e.target.value))} className="flex-1 accent-cyan-500" />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{inTransit ? (asOf >= voyage.endDay ? 'voyage complete (empty)' : 'in transit') : ''}</span>
          </div>
        </div>
      )}
      <div>
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Cost breakdown — {fmtM(voyage.cost)} total</div>
        <div className="flex h-4 rounded-full overflow-hidden border border-border/60">
          {parts.map(([l, val, c]) => val > 0 && <div key={l} title={`${l}: ${fmtM(val)}`} style={{ width: `${(val / tot) * 100}%`, backgroundColor: c }} />)}
        </div>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {parts.map(([l, val, c]) => (
            <div key={l} className="bg-background/50 rounded-md border border-border/60 px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-md" style={{ background: c }} />{l}</div>
              <div className="text-xs font-mono text-foreground/90 mt-0.5">{fmtM(val)}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Route ({voyage.stops.length} stops, {voyage.legs.length} legs)</div>
        <div className="space-y-1">
          {voyage.stops.map(s => (
            <div key={s.seq} className="flex items-center gap-2 bg-background/50 rounded-md border border-border/60 px-3 py-1.5 text-xs">
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-medium" style={{ background: s.kind === 'LOAD' ? 'color-mix(in srgb, var(--sea-sand) 16%, transparent)' : 'color-mix(in srgb, var(--sea-green) 16%, transparent)', color: s.kind === 'LOAD' ? 'var(--sea-sand)' : 'var(--sea-green)' }}>{s.kind}</span>
              <span className="text-foreground/90 flex-1">{loc(s.locationId)}</span>
              <span className="text-muted-foreground">{format(addDays(START, s.arriveDay), 'MMM d')}</span>
              <span className="text-foreground/70 font-mono text-[10px]">{s.ops.map(o => `${prod(o.productId)?.name} ${(o.qty / 1000).toFixed(0)}k→${o.compartmentId}`).join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Legs</div>
        <div className="grid grid-cols-2 gap-1.5">
          {voyage.legs.map((lg, i) => (
            <div key={i} className="flex items-center justify-between bg-background/50 rounded-md border border-border/60 px-3 py-1.5 text-[11px]">
              <span className="text-foreground/80">{loc(lg.fromLoc)} → {loc(lg.toLoc)}</span>
              <span className="text-muted-foreground">{lg.distanceNm.toLocaleString()} nm · <span className={lg.ballast ? 'text-muted-foreground/70' : 'text-cyan-400'}>{lg.ballast ? 'ballast' : 'laden'}</span></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
