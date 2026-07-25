import { useState } from 'react';
import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sliders, Database, RotateCcw, Info } from 'lucide-react';

export default function SettingsView({ data, stream, attempts, setAttempts, onReseed }: {
  data: DashboardData; stream: string; attempts: number; setAttempts: (n: number) => void; onReseed: () => Promise<void>;
}) {
  const [reseeding, setReseeding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const doReseed = async () => { setReseeding(true); try { await onReseed(); } catch (e) { console.error(e); } setReseeding(false); setConfirm(false); };
  const active = data.versions?.find(v => v.status === 'Active');

  const stat = (l: string, v: string | number) => <div className="bg-background/50 p-3 rounded-lg border border-border/70"><div className="text-[11px] text-muted-foreground">{l}</div><div className="text-lg font-semibold text-foreground mt-0.5">{v}</div></div>;

  return (
    <div className="space-y-5 max-w-3xl">
      <h3 className="text-lg font-semibold text-foreground">Settings</h3>

      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Sliders className="w-3.5 h-3.5 text-sky-400" /> Optimizer</CardTitle></CardHeader>
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1"><label className="text-muted-foreground">Solver effort (multi-start attempts)</label><span className="font-mono text-foreground/90">{attempts}</span></div>
            <input type="range" min={4} max={20} value={attempts} onChange={e => setAttempts(Number(e.target.value))} className="w-full accent-sky-500" />
            <div className="flex justify-between text-[10px] text-muted-foreground/70 mt-0.5"><span>faster</span><span>higher-quality plans</span></div>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Each attempt is a fresh greedy construction with perturbed routing; the best feasible, lowest-cost plan is kept. The search stops early once all demand is served. Applies to the next <span className="text-sky-400">Run Optimizer</span>.</p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Database className="w-3.5 h-3.5 text-sky-400" /> Network summary — {stream}</CardTitle></CardHeader>
        <CardContent className="p-4 grid grid-cols-3 gap-3">
          {stat('Locations', data.locations.length)}
          {stat('Products', data.products.length)}
          {stat('Vessels', data.vessels.length)}
          {stat('Tanks', data.tanks.length)}
          {stat('Berths', data.berths.length)}
          {stat('Plan lines', data.planLines.length)}
          {stat('Active plan', active ? `v${active.version}` : '—')}
          {stat('Versions', data.versions?.length ?? 0)}
          {stat('Demand served', `${data.kpis?.demandServedPct ?? 0}%`)}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-amber-500/25 rounded-lg">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-amber-400 flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5" /> Data administration</CardTitle></CardHeader>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-3">Reset all master data, plans and versions across every stream back to the seeded demo network. This cannot be undone.</p>
          {!confirm ? (
            <button onClick={() => setConfirm(true)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs">Reset demo data…</button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-400">Reset everything to defaults?</span>
              <button onClick={doReseed} disabled={reseeding} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs disabled:opacity-50">{reseeding ? 'Resetting…' : 'Yes, reset'}</button>
              <button onClick={() => setConfirm(false)} className="px-3 py-1.5 bg-muted border border-border/80 rounded-lg text-xs">Cancel</button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
