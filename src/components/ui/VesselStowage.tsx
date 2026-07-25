import { Product } from '../../types';

/** Visual cargo-stowage / manifest: the vessel's compartment layout (port /
 *  centre / starboard, bow→stern) with each tank filled and coloured by the
 *  grade loaded into it. `stow` is the voyage manifest (total loaded); optional
 *  `current` is on-board-now per compartment (net of discharges) — shown as the
 *  solid fill against the manifest ghost. Empty compartments show hollow. */
export function VesselStowage({ compartments, stow, products, current }: {
  compartments: { id: string; cap: number }[];
  stow: Record<string, { productId: string; qty: number }>;
  products: Product[];
  current?: Record<string, number>;
}) {
  const prod = (id: string) => products.find(p => p.id === id);
  const side = (id: string) => (id.endsWith('P') ? 'P' : id.endsWith('S') ? 'S' : 'C');
  const pos = (id: string) => { const s = side(id); return (s !== 'C' || id.endsWith('C')) ? (id.slice(0, -1) || id) : id; };
  const rowsPresent = ['P', 'C', 'S'].filter(r => compartments.some(c => side(c.id) === r));
  const positions = [...new Set(compartments.map(c => pos(c.id)))].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  const cellFor = (p: string, r: string) => compartments.find(c => pos(c.id) === p && side(c.id) === r);
  const rowLabel: Record<string, string> = { P: 'PORT', C: 'CTR', S: 'STBD' };
  const totalCap = compartments.reduce((s, c) => s + c.cap, 0);
  const totalLoad = Object.values(stow).reduce((s, o) => s + o.qty, 0);
  const totalNow = current ? compartments.reduce((s, c) => s + (current[c.id] ?? 0), 0) : totalLoad;

  return (
    <div>
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col justify-center text-[8px] font-medium text-muted-foreground/70 gap-1">
          {rowsPresent.map(r => <div key={r} className="h-14 flex items-center">{rowLabel[r]}</div>)}
        </div>
        <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${positions.length}, minmax(0,1fr))` }}>
          {rowsPresent.map(r => positions.map(p => {
            const c = cellFor(p, r);
            if (!c) return <div key={`${r}${p}`} />;
            const s = stow[c.id];
            const pc = s ? prod(s.productId) : null;
            const man = s ? s.qty : 0;
            const cur = current ? (current[c.id] ?? 0) : man;
            const manFill = Math.min(100, (man / c.cap) * 100);
            const curFill = Math.min(100, (cur / c.cap) * 100);
            const discharged = current && s && cur < man - 1e-6;
            return (
              <div key={c.id} title={`${c.id} · cap ${c.cap.toLocaleString()} MT${s ? ` · ${pc?.name} — on board ${Math.round(cur).toLocaleString()} / manifest ${man.toLocaleString()} MT` : ' · empty'}`}
                className="relative rounded-md border h-14 overflow-hidden bg-background/40" style={{ borderColor: pc ? `${pc.color}66` : '#ffffff20' }}>
                {/* manifest ghost (what was loaded) */}
                <div className="absolute bottom-0 left-0 right-0" style={{ height: `${manFill}%`, background: pc ? `${pc.color}22` : 'transparent' }} />
                {/* current on-board (solid) */}
                <div className="absolute bottom-0 left-0 right-0 transition-all" style={{ height: `${curFill}%`, background: pc ? `${pc.color}66` : 'transparent' }} />
                <div className="relative p-1 flex flex-col h-full justify-between">
                  <div className="flex justify-between text-[8px] text-muted-foreground/80"><span className="font-mono">{c.id}</span><span>{Math.round(c.cap / 1000)}k</span></div>
                  <div className="text-[9px] font-medium leading-tight" style={{ color: pc?.color ?? undefined }}>{s ? `${pc?.name}${discharged && cur < 1 ? ' ·out' : ''}` : '—'}</div>
                  {s && <div className="text-[8px] text-foreground/70">{current ? `${Math.round(cur / 1000)}k / ${Math.round(man / 1000)}k` : `${Math.round(man / 1000)}k MT`}</div>}
                </div>
              </div>
            );
          }))}
        </div>
        <div className="flex flex-col justify-center text-[9px] text-muted-foreground/60"><span>▶</span><span>BOW</span></div>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground text-right">
        {current
          ? <>On board now <span className="text-foreground/80">{Math.round(totalNow / 1000)}k</span> · manifest {Math.round(totalLoad / 1000)}k / {Math.round(totalCap / 1000)}k MT capacity</>
          : <>Manifest {Math.round(totalLoad / 1000)}k / {Math.round(totalCap / 1000)}k MT · {Math.round((totalLoad / Math.max(1, totalCap)) * 100)}% utilised</>}
      </div>
    </div>
  );
}
