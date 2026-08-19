import { useState } from 'react';
import { DashboardData, ReplanThresholds, DEFAULT_THRESHOLDS } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sliders, Database, RotateCcw, Info, Gauge } from 'lucide-react';

export default function SettingsView({ data, stream, attempts, setAttempts, thresholds, setThresholds, onReseed }: {
  data: DashboardData; stream: string; attempts: number; setAttempts: (n: number) => void;
  thresholds: ReplanThresholds; setThresholds: (t: ReplanThresholds) => void; onReseed: () => Promise<void>;
}) {
  const [reseeding, setReseeding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const doReseed = async () => { setReseeding(true); try { await onReseed(); } catch (e) { console.error(e); } setReseeding(false); setConfirm(false); setTyped(''); };
  const active = data.versions?.find(v => v.status === 'Active');

  const stat = (l: string, v: string | number) => <div className="bg-background/50 p-3 rounded-md border border-border/70"><div className="text-[11px] text-muted-foreground">{l}</div><div className="text-lg font-semibold text-foreground mt-0.5">{v}</div></div>;

  const setT = (k: keyof ReplanThresholds, v: number) => setThresholds({ ...thresholds, [k]: v });
  const thRow = (k: keyof ReplanThresholds, label: string, help: string, step = 1, suffix = '') => (
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-xs text-foreground/90">{label}</div><div className="text-[10px] text-muted-foreground leading-tight">{help}</div></div>
      <div className="flex items-center gap-1 shrink-0"><input type="number" step={step} value={thresholds[k]} onChange={e => setT(k, Number(e.target.value))} className="w-24 bg-background/50 rounded-md px-2 py-1 border border-border/80 text-right text-xs" />{suffix && <span className="text-[10px] text-muted-foreground w-6">{suffix}</span>}</div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <h3 className="text-lg font-semibold text-foreground">Settings</h3>

      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Sliders className="w-3.5 h-3.5 text-cyan-400" /> Optimizer</CardTitle></CardHeader>
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1"><label className="text-muted-foreground">Solver effort (multi-start attempts)</label><span className="font-mono text-foreground/90">{attempts}</span></div>
            <input type="range" min={4} max={20} value={attempts} onChange={e => setAttempts(Number(e.target.value))} className="w-full accent-cyan-500" />
            <div className="flex justify-between text-[10px] text-muted-foreground/70 mt-0.5"><span>faster</span><span>higher-quality plans</span></div>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Each attempt is a fresh greedy construction with perturbed routing; the best feasible, lowest-cost plan is kept. The search stops early once all demand is served. Applies to the next <span className="text-cyan-400">Run Optimizer</span>.</p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Gauge className="w-3.5 h-3.5 text-cyan-400" /> Replan-decision thresholds</CardTitle><button onClick={() => setThresholds(DEFAULT_THRESHOLDS)} className="text-[10px] text-muted-foreground hover:text-foreground/80">Reset defaults</button></CardHeader>
        <CardContent className="p-4 space-y-3">
          {thRow('dryOutDaysCover', 'Dry-out cover floor', 'Flag service risk when a node’s cover falls below this many days', 1, 'd')}
          {thRow('ullageMarginPct', 'Ullage margin', 'Required headroom over an incoming parcel before discharge', 1, '%')}
          {thRow('costVariancePct', 'Cost-variance trigger', 'Recovery cost above baseline by more than this flags a cheaper candidate', 1, '%')}
          {thRow('qtyChangePct', 'Quantity-change trigger', 'A movement quantity change beyond this forces feasibility revalidation', 1, '%')}
          {thRow('demurrageInr', 'Demurrage tolerance', 'Demurrage exposure (₹) that itself justifies a replan', 1000000, '₹')}
          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> These drive the replan-decision level (L0 actualize → L4 full replan) and trigger reasons in the <span className="text-cyan-400">Alerts &amp; Actions</span> workbench. Demo defaults — calibrate per product / terminal.</p>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/80 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2"><Database className="w-3.5 h-3.5 text-cyan-400" /> Network summary — {stream}</CardTitle></CardHeader>
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

      <Card className="bg-card/50 border-warn/25 rounded-md">
        <CardHeader className="py-2.5 px-4 border-b border-border/60"><CardTitle className="text-xs font-semibold text-warn flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5" /> Data administration</CardTitle></CardHeader>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-3">
            Reset all master data, plans and versions back to the seeded demo network.
          </p>
          {/*
            The reset is server-wide, not per-session. On a shared instance it discards
            work belonging to anyone else using it at the same time, which is worth
            saying out loud rather than discovering.
          */}
          <div className="rounded-md border border-bad/25 bg-bad/5 p-3 mb-3 text-[11px] space-y-1.5">
            <div className="text-bad font-medium">This affects everyone using this instance</div>
            <ul className="text-muted-foreground space-y-1 pl-4 list-disc">
              <li>Every stream is wiped — CRUDE, LNG and POL, not just the one you are viewing.</li>
              <li>All generated plans, drafts, saved scenarios and recorded actuals are deleted.</li>
              <li>If someone else is mid-session, their work goes too. There is no per-user data.</li>
              <li>Sealed months are recreated from seed, so their hash chains change.</li>
            </ul>
          </div>
          {!confirm ? (
            <button onClick={() => setConfirm(true)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Reset demo data…</button>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs text-warn">
                Type <span className="font-mono text-foreground/90">RESET</span> to confirm you want to wipe every stream for every user:
              </label>
              <div className="flex items-center gap-2">
                <input
                  autoFocus value={typed} onChange={e => setTyped(e.target.value)}
                  placeholder="RESET"
                  className="w-28 bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs font-mono"
                />
                <button
                  onClick={doReseed}
                  disabled={reseeding || typed.trim().toUpperCase() !== 'RESET'}
                  className="px-3 py-1.5 bg-bad hover:bg-bad/90 text-background rounded-md text-xs disabled:opacity-40"
                >{reseeding ? 'Resetting…' : 'Reset everything'}</button>
                <button onClick={() => { setConfirm(false); setTyped(''); }} className="px-3 py-1.5 bg-muted border border-border/80 rounded-md text-xs">Cancel</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
