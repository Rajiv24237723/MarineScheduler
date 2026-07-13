import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, GitMerge, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';

export default function ReplanningView({ data }: { data: DashboardData }) {
  const [activeMode, setActiveMode] = useState('service-protection');

  const modes = [
    { id: 'minimal-change', label: 'Minimal-change repair', icon: GitMerge, desc: 'Preserve approved plan, change only what disruption forces' },
    { id: 'service-protection', label: 'Service-protection', icon: ShieldCheck, desc: 'Protect service (dry-out/unmet) even at higher cost' },
    { id: 'cost-minimize', label: 'Cost-minimize (Re-opt)', icon: Zap, desc: 'Allow larger disruption to reduce total cost' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-rose-500/5 p-6 rounded-xl border border-rose-500/20 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
        <h3 className="text-sm font-semibold text-rose-500 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 animate-pulse" />
          Active Disruption Detected
        </h3>
        <p className="text-xs text-rose-400/80 mt-2 font-mono">
          [CRITICAL] Chennai CPCL ATF Tank TK-301 unscheduled outage. Emergency demand of 12kMT ATF required at CPCL before DD/MM.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {modes.map(mode => (
          <Card 
            key={mode.id} 
            className={`cursor-pointer transition-all ${activeMode === mode.id ? 'ring-1 ring-indigo-500 border-indigo-500/50 shadow-sm bg-indigo-500/5' : 'hover:border-slate-700'}`}
            onClick={() => setActiveMode(mode.id)}
          >
            <CardHeader className="p-4 pb-2 border-b border-slate-800/60 bg-slate-900/80">
              <CardTitle className="text-xs font-semibold flex items-center gap-2">
                <mode.icon className={`w-4 h-4 ${activeMode === mode.id ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span className={activeMode === mode.id ? 'text-indigo-400' : 'text-slate-400'}>{mode.label}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-3">
              <p className="text-[11px] text-slate-500 font-medium leading-relaxed">{mode.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-slate-900/50 border-slate-800/80 rounded-xl">
        <CardHeader className="border-b border-slate-800/60 bg-slate-950/50">
          <CardTitle className="text-sm font-semibold text-slate-300">Plan Diff Summary <span className="font-mono text-indigo-400 mx-2 text-xs">PV_BASE → PV_REPLAN</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-800/60">
            <div className="p-6 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="space-y-1.5">
                <div className="font-semibold text-sm text-slate-200">Add Emergency Lift</div>
                <div className="text-[11px] text-slate-500 font-mono">MT Swarna diverted to load 12kMT ATF for Chennai</div>
              </div>
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-500 ring-1 ring-inset ring-amber-500/20">
                +1 Voyage Leg
              </span>
            </div>
            
            <div className="p-6 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="space-y-1.5">
                <div className="font-semibold text-sm text-slate-200">Cost Delta</div>
                <div className="text-[11px] text-slate-500 font-mono">Increased bunker (speed up) & port DA</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-mono text-rose-400 font-semibold">+ ₹ 1.2M</div>
                <div className="text-[11px] text-slate-500 font-medium mt-1">vs Base Plan</div>
              </div>
            </div>

            <div className="p-6 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
              <div className="space-y-1.5">
                <div className="font-semibold text-sm text-slate-200">Service Delta</div>
                <div className="text-[11px] text-slate-500 font-mono">Chennai dry-out prevented</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-mono text-emerald-400 font-semibold">0 Dry-outs</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <button className="px-6 py-2.5 border border-slate-700 bg-slate-900/50 text-slate-300 rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors flex items-center gap-2">
          <RotateCcw className="w-4 h-4" />
          Rollback
        </button>
        <button className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 transition-colors shadow-sm">
          Approve & Publish (PV_REPLAN)
        </button>
      </div>
    </div>
  );
}
