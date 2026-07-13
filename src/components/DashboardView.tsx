import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Anchor, Droplet, TrendingDown, AlertTriangle, Zap, CheckCircle2, Navigation, Ship, Clock, BarChart3, AlertOctagon, TrendingUp, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DashboardView({ data }: { data: DashboardData }) {
  const outcomeCards = [
    { 
      title: "Projected Logistics Cost", 
      value: "₹ 4.82M", 
      target: "+ ₹ 214K vs approved plan",
      trend: "up",
      driver: "Main driver: 472 excess ballast NM",
      icon: TrendingDown, 
      color: "text-indigo-400" 
    },
    { 
      title: "Plan Service Level", 
      value: "98.4%", 
      target: "-1.6% vs target",
      trend: "down",
      driver: "1 location under safety stock limit",
      icon: CheckCircle2, 
      color: "text-emerald-400" 
    },
    { 
      title: "Locations at Dry-Out Risk", 
      value: "1", 
      target: "Chennai (ATF)",
      trend: "up",
      driver: "ETA slipped by 14 hours",
      icon: AlertOctagon, 
      color: "text-rose-500" 
    },
    { 
      title: "Vessels at Demurrage Risk", 
      value: "2", 
      target: "Expected exposure: ₹ 84K",
      trend: "up",
      driver: "Paradip port congestion",
      icon: Clock, 
      color: "text-amber-500" 
    },
    { 
      title: "Time-Charter Utilization", 
      value: "94.2%", 
      target: "+2.1% vs Q2 baseline",
      trend: "up",
      driver: "Reduced idle availability",
      icon: Anchor, 
      color: "text-teal-400" 
    },
    { 
      title: "Uncovered VC Requirements", 
      value: "3", 
      target: "Next 14 days",
      trend: "neutral",
      driver: "Requires spot market fixing",
      icon: HelpCircle, 
      color: "text-slate-400" 
    }
  ];

  const exceptionQueue = [
    { severity: 'Critical', issue: 'Chennai ATF dry-out', impactTime: '29 h', impact: '8 h stockout', action: 'Redirect MT Samudra', status: 'Unresolved' },
    { severity: 'Critical', issue: 'Paradip crude tank unavailable', impactTime: '41 h', impact: 'VLCC demurrage', action: 'Split discharge', status: 'Unresolved' },
    { severity: 'Warning', issue: 'Kochi HSD ullage below requirement', impactTime: '63 h', impact: '14 h waiting', action: 'Advance rake dispatch', status: 'In Review' },
    { severity: 'Warning', issue: 'LNGC ETA outside unloading slot', impactTime: '4 d', impact: '₹ 180K exposure', action: 'Swap terminal slot', status: 'New' },
    { severity: 'Info', issue: 'MT Swarna arriving early', impactTime: '18 h', impact: 'None', action: 'Adjust berth schedule', status: 'Acknowledged' },
  ];

  const pendingDecisions = [
    { id: 1, action: "Redirect MT Samudra from Chennai to Ennore", impact: "Resolves dry-out, +₹ 82K bunker cost", deadline: "2 h" },
    { id: 2, action: "Voyage-charter one MR vessel for 22-27 July", impact: "Covers spot demand, est. ₹ 1.2M", deadline: "14 h" },
  ];

  return (
    <div className="space-y-6">
      {/* Outcome Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {outcomeCards.map((kpi, i) => (
          <Card key={i} className="bg-slate-900/50 border-slate-800/80 rounded-xl hover:border-slate-700/80 transition-colors group">
            <CardContent className="p-5 flex flex-col justify-between h-full">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-semibold text-slate-400">{kpi.title}</h4>
                <div className={cn("p-1.5 rounded-lg bg-slate-800/50", kpi.color)}>
                  <kpi.icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-mono font-semibold text-slate-100 mb-1">{kpi.value}</div>
                <div className={cn("text-xs font-medium mb-2", 
                  kpi.trend === 'down' && kpi.color.includes('emerald') ? 'text-rose-400' :
                  kpi.trend === 'up' && kpi.color.includes('rose') ? 'text-rose-400' :
                  kpi.trend === 'up' && kpi.color.includes('amber') ? 'text-amber-400' :
                  'text-slate-400'
                )}>
                  {kpi.target}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  {kpi.driver}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Exception Queue */}
        <Card className="xl:col-span-2 bg-slate-900/50 border-slate-800/80 rounded-xl flex flex-col">
          <CardHeader className="border-b border-slate-800/50 bg-slate-950/50 rounded-t-xl px-5 py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <AlertOctagon className="w-4 h-4 text-rose-500" />
              Exception Queue
            </CardTitle>
            <div className="text-xs font-medium text-slate-500">4 Unresolved</div>
          </CardHeader>
          <CardContent className="p-0 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/50 bg-slate-900/30">
                  <th className="p-3 pl-5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Severity</th>
                  <th className="p-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Exception</th>
                  <th className="p-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">Time to Impact</th>
                  <th className="p-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Estimated Impact</th>
                  <th className="p-3 pr-5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Recommended Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {exceptionQueue.map((ex, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors group cursor-pointer">
                    <td className="p-3 pl-5">
                      <span className={cn("px-2 py-1 rounded text-[10px] font-semibold border",
                        ex.severity === 'Critical' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
                        ex.severity === 'Warning' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                        "bg-slate-800 text-slate-400 border-slate-700"
                      )}>
                        {ex.severity}
                      </span>
                    </td>
                    <td className="p-3 text-sm font-medium text-slate-200">{ex.issue}</td>
                    <td className="p-3 text-sm font-mono text-slate-400 text-right">{ex.impactTime}</td>
                    <td className="p-3 text-sm text-slate-400">{ex.impact}</td>
                    <td className="p-3 pr-5 text-sm text-indigo-400 font-medium hover:text-indigo-300 transition-colors">{ex.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Recommended Decisions */}
        <Card className="bg-slate-900/50 border-slate-800/80 rounded-xl flex flex-col">
          <CardHeader className="border-b border-slate-800/50 bg-slate-950/50 rounded-t-xl px-5 py-4">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Recommended Decisions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-800/50">
              {pendingDecisions.map(decision => (
                <div key={decision.id} className="p-5 hover:bg-slate-800/30 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <h5 className="text-sm font-medium text-slate-200">{decision.action}</h5>
                    <span className="text-[10px] font-mono text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">
                      {decision.deadline}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mb-4">{decision.impact}</p>
                  <div className="flex gap-2">
                    <button className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors">
                      Approve
                    </button>
                    <button className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium rounded-lg transition-colors">
                      Review
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
