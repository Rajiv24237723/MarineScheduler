import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Att { attempt: number; elapsedMs: number; rawCost: number; rawUnservedMt: number; bestCost: number; bestUnservedMt: number; }
interface St { recv: Att[]; streamDone: boolean; result: any; phase: string; error: string | null; }
const SPEED = 0.005; // reveal ~5 attempts / second

const PHASE: Record<string, string> = { construct: 'Constructing voyages', diagnose: 'Diagnostics & feasibility', done: 'Finalising', stress: 'Resilience stress test' };
const money = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

/** Live solver console — streams the multi-start convergence and animates cost vs elapsed time. */
export function GenerationConsole({ stream, attempts, onDone, onClose }: {
  stream: string; attempts: number; onDone: (res: any) => void; onClose: () => void;
}) {
  const [, force] = useState(0);
  const bump = () => force(x => x + 1);
  const S = useRef<St>({ recv: [], streamDone: false, result: null, phase: 'construct', error: null });
  const start = useRef(0);
  const fired = useRef(false);

  useEffect(() => {
    start.current = performance.now();
    let alive = true; let raf = 0; const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(`/api/optimize/stream?stream=${stream}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ options: { alnsIterations: attempts } }), signal: ctrl.signal,
        });
        const reader = resp.body!.getReader(); const dec = new TextDecoder(); let buf = '';
        while (alive) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
            let ev: any; try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === 'attempt') S.current.recv.push(ev);
            else if (ev.type === 'phase') S.current.phase = ev.phase;
            else if (ev.type === 'result') S.current.result = ev;
            else if (ev.type === 'error') S.current.error = ev.message;
            bump();   // re-render on every frame — correct even if rAF is throttled
          }
        }
      } catch (e: any) { if (alive && e?.name !== 'AbortError') S.current.error = e?.message ?? 'stream failed'; }
      S.current.streamDone = true; bump();
    })();

    // rAF only smooths the playhead between frames; the wall-clock head below is the source of truth.
    const loop = () => { bump(); if (alive) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); ctrl.abort(); };
  }, [stream, attempts]);

  const s = S.current, recv = s.recv, n = recv.length;
  const head = Math.min((performance.now() - start.current) * SPEED, n);
  const finished = s.streamDone && !!s.result && head >= n;

  useEffect(() => {
    if (finished && !fired.current) { fired.current = true; const id = setTimeout(() => onDone(s.result), 1500); return () => clearTimeout(id); }
  });

  // chart geometry — x is elapsed time, y is running-best cost
  const W = 660, H = 250, PL = 54, PR = 20, PT = 20, PB = 36;
  const costs = n ? recv.flatMap(a => [a.rawCost, a.bestCost]) : [0, 1];
  let cMin = Math.min(...costs), cMax = Math.max(...costs); if (cMin === cMax) { cMin *= 0.98; cMax *= 1.02; }
  const cp = (cMax - cMin) * 0.14 || 1; cMin -= cp; cMax += cp;
  const maxEl = n ? Math.max(1, recv[n - 1].elapsedMs) : 1;
  const xEl = (el: number) => PL + (W - PL - PR) * (el / maxEl);
  const yC = (c: number) => (H - PB) - (H - PB - PT) * ((c - cMin) / (cMax - cMin));

  const h = head; const base = Math.floor(h); const frac = h - base;
  const line: string[] = []; const dots: Att[] = [];
  for (let i = 0; i < base && i < n; i++) { line.push(`${xEl(recv[i].elapsedMs)},${yC(recv[i].bestCost)}`); dots.push(recv[i]); }
  let tipX = 0, tipY = 0;
  if (base >= 1 && base < n && frac > 0) {
    const a = recv[base - 1], b = recv[base];
    tipX = xEl(a.elapsedMs) + (xEl(b.elapsedMs) - xEl(a.elapsedMs)) * frac;
    tipY = yC(a.bestCost) + (yC(b.bestCost) - yC(a.bestCost)) * frac;
    line.push(`${tipX},${tipY}`);
  } else if (base >= 1) { tipX = xEl(recv[base - 1].elapsedMs); tipY = yC(recv[base - 1].bestCost); }
  const cur = recv[Math.min(n - 1, Math.max(0, base - 1))];

  const gridC = [0.25, 0.5, 0.75].map(f => cMin + (cMax - cMin) * f);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-[760px] max-w-[94vw] rounded-lg border border-border/80 bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
          <div className="flex items-center gap-3">
            <span className="font-serif text-lg font-medium text-foreground">Generating {stream} plan</span>
            {!finished && !s.error && <span className="w-3.5 h-3.5 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-cond text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.error ? 'error' : finished ? 'complete' : (PHASE[s.phase] ?? s.phase)}</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-5">
          {s.error ? (
            <div className="text-sm text-bad py-8 text-center">Solve failed — {s.error}</div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground mb-1 flex justify-between">
                <span>Running-best freight bill vs elapsed time</span>
                <span className="font-mono tabular-nums">attempt {cur ? cur.attempt + 1 : 0} / {attempts} · {((cur?.elapsedMs ?? 0) / 1000).toFixed(1)}s</span>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
                <line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="#94a3b8" strokeWidth="0.5" opacity="0.35" />
                <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="#94a3b8" strokeWidth="0.5" opacity="0.35" />
                {gridC.map((c, i) => (
                  <g key={i}>
                    <line x1={PL} y1={yC(c)} x2={W - PR} y2={yC(c)} stroke="#94a3b8" strokeWidth="0.5" opacity="0.12" />
                    <text x={PL - 6} y={yC(c) + 3} fontSize="9" fill="#94a3b8" textAnchor="end">{Math.round(c / 1e6)}</text>
                  </g>
                ))}
                <text x={16} y={PT - 4} fontSize="9" fill="#94a3b8">₹M</text>
                <text x={(PL + W - PR) / 2} y={H - 8} fontSize="9" fill="#94a3b8" textAnchor="middle">elapsed →</text>
                {dots.map((a, i) => <circle key={i} cx={xEl(a.elapsedMs)} cy={yC(a.rawCost)} r="2.5" fill="#64748b" opacity="0.5" />)}
                {line.length > 1 && <polyline points={line.join(' ')} fill="none" stroke="#49b4c4" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
                {base >= 1 && (
                  <>
                    <line x1={tipX} y1={PT} x2={tipX} y2={H - PB} stroke="#49b4c4" strokeWidth="0.5" opacity="0.25" />
                    <circle cx={tipX} cy={tipY} r="3.5" fill="#49b4c4" />
                  </>
                )}
              </svg>

              <div className="grid grid-cols-4 gap-2 mt-3">
                {[
                  ['Best cost', finished ? money(s.result.kpis.totalCost) : (cur ? money(cur.bestCost) : '—')],
                  ['Unserved', cur ? (cur.bestUnservedMt === 0 ? '0' : `${Math.round(cur.bestUnservedMt / 1000)}k MT`) : '—'],
                  ['Served', finished ? `${s.result.kpis.demandServedPct}%` : (cur && cur.bestUnservedMt === 0 ? '~100%' : '—')],
                  ['Voyages', finished ? String(s.result.kpis.voyageCount) : '—'],
                ].map(([l, v]) => (
                  <div key={l} className="bg-background/50 rounded-md border border-border/70 px-3 py-2">
                    <div className="font-cond text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{l}</div>
                    <div className="text-lg font-serif tabular-nums text-foreground mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-card/70">
          <span className="text-[11px] text-muted-foreground">
            {finished
              ? (s.result.achievable ? 'Feasible — all demand served within limits. Opening the plan…' : `Shortfall — ${s.result.unserved?.length ?? 0} node(s) unserved.`)
              : 'Kept: the cheapest feasible construction of the multi-start search.'}
          </span>
          {finished
            ? <button onClick={() => onDone(s.result)} className="px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-medium">View plan</button>
            : <button onClick={onClose} className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Cancel</button>}
        </div>
      </div>
    </div>
  );
}
