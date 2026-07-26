/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { Ship, LayoutDashboard, CalendarDays, Factory, Map as MapIcon, Settings, AlertTriangle, Database, TrendingUp, Bell } from 'lucide-react';
import { DashboardData } from './types';
import { Toaster, TopProgress, toast } from './components/ui/toast';
import { StreamFlag, Pennant } from './components/ui/SignalFlag';
import DashboardView from './components/DashboardView';
import SchedulerView from './components/SchedulerView';
import TankFarmView from './components/TankFarmView';
import TrackingView from './components/TrackingView';
import ReplanningView from './components/ReplanningView';
import MasterDataView from './components/MasterDataView';
import InventoryView from './components/InventoryView';
import SettingsView from './components/SettingsView';
import { cn } from './lib/utils';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stream, setStream] = useState('POL');
  const [data, setData] = useState<DashboardData | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [attempts, setAttempts] = useState(12);

  const load = useCallback(async () => {
    const r = await fetch(`/api/dashboard?stream=${stream}`);
    setData(await r.json());
  }, [stream]);

  useEffect(() => { setData(null); load().catch(console.error); }, [load]);

  const runOptimize = useCallback(async () => {
    setOptimizing(true);
    try {
      const r = await fetch(`/api/optimize?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { alnsIterations: attempts } }) });
      const res = await r.json();
      await load();
      if (res?.achievable) toast(`${stream} plan optimised — ${res.kpis?.demandServedPct ?? 0}% served, ${res.kpis?.voyageCount ?? 0} voyages${res.kpis?.charterRecommendationCount ? `, ${res.kpis.charterRecommendationCount} charter rec(s)` : ''}.`, 'success');
      else toast(`${stream} plan has a shortfall — ${res?.unserved?.length ?? 0} node(s) unserved (${res?.kpis?.demandServedPct ?? 0}% served).`, 'info');
    } catch (e) { console.error(e); toast('Optimisation failed — check the server logs.', 'error'); }
    setOptimizing(false);
  }, [stream, load, attempts]);

  const reseed = useCallback(async () => {
    try { await fetch('/api/admin/reseed', { method: 'POST' }); await load(); toast('Demo data reset to the seeded network.', 'success'); }
    catch (e) { console.error(e); toast('Reset failed.', 'error'); }
  }, [load]);

  if (!data) return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background text-muted-foreground gap-3">
      <div className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      <span className="text-sm">Loading Marine Scheduler…</span>
    </div>
  );

  const alertCount = (data.unserved?.length ?? 0) + (data.kpis?.dryOutDays ?? 0) + (data.kpis?.tankTopDays ?? 0);

  const readout = (label: string, value: string, tone = 'text-foreground') => (
    <div className="px-4 border-l border-border/50 first:border-l-0 first:pl-0">
      <div className="font-cond text-[9px] uppercase tracking-[0.16em] text-muted-foreground leading-none">{label}</div>
      <div className={cn('text-sm font-semibold font-mono leading-tight mt-1', tone)}>{value}</div>
    </div>
  );

  const activeVersion = data.versions?.find(v => v.status === 'Active');

  const navigationGroups = [
    {
      label: 'My Work',
      items: [
        { id: 'dashboard', label: 'Command Center', icon: LayoutDashboard },
        { id: 'replan', label: 'Alerts & Actions', icon: AlertTriangle },
      ]
    },
    {
      label: 'Planning',
      items: [
        { id: 'scheduler', label: 'Operational Plan', icon: CalendarDays },
      ]
    },
    {
      label: 'Execution',
      items: [
        { id: 'tracking', label: 'Live Fleet / AIS', icon: MapIcon },
      ]
    },
    {
      label: 'Inventory',
      items: [
        { id: 'tanks', label: 'Tank Farm', icon: Factory },
        { id: 'inventory', label: 'Network Forecast', icon: TrendingUp },
      ]
    },
    {
      label: 'Data & Administration',
      items: [
        { id: 'master', label: 'Master Data', icon: Database },
      ]
    }
  ];

  const allTabs = navigationGroups.flatMap(g => g.items);
  const activeTabLabel = allTabs.find(t => t.id === activeTab)?.label || (activeTab === 'settings' ? 'Settings' : 'Command Center');

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-cyan-500/30">
      {/* Refined Sidebar */}
      <div className="w-64 border-r border-border/60 bg-card/80 backdrop-blur-md flex flex-col z-10 flex-shrink-0">
        <div className="h-16 flex flex-col justify-center px-5 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="shrink-0"><StreamFlag stream={stream} size={22} /></div>
            <div>
              <h1 className="font-serif font-semibold text-[17px] tracking-tight text-foreground leading-none">Marine Scheduler</h1>
              <div className="font-cond text-[10px] text-muted-foreground uppercase tracking-[0.16em] mt-1">Coastal marine · MIRP</div>
            </div>
          </div>
        </div>

        {/* Stream Switcher — coded flags */}
        <div className="p-4 border-b border-border/60">
          <label className="font-cond text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2 block">Stream</label>
          <div className="grid grid-cols-3 gap-1.5">
            {['CRUDE', 'LNG', 'POL'].map(s => (
              <button
                key={s}
                onClick={() => setStream(s)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-2 rounded-md border transition-all",
                  stream === s ? "bg-muted border-border text-foreground" : "bg-background/40 border-border/60 text-muted-foreground hover:text-foreground/90 hover:border-border"
                )}
              >
                <StreamFlag stream={s} size={16} />
                <span className="font-cond text-[10px] font-semibold tracking-wide">{s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 py-4 flex flex-col gap-4 px-3 overflow-y-auto">
          {navigationGroups.map((group, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="px-2 mb-1">
                <span className="font-cond text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.18em]">{group.label}</span>
              </div>
              {group.items.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group w-full text-left",
                    activeTab === tab.id 
                      ? "bg-cyan-500/10 text-cyan-300" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground/90"
                  )}
                >
                  <tab.icon className={cn(
                    "w-4 h-4 mr-3 transition-transform duration-200",
                    activeTab === tab.id ? "text-cyan-400" : "text-muted-foreground/80 group-hover:text-foreground/80"
                  )} />
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border/60">
          <button onClick={() => setActiveTab('settings')} className={cn("flex items-center w-full px-3 py-2 text-sm font-medium rounded-md transition-colors", activeTab === 'settings' ? "bg-cyan-500/10 text-cyan-300" : "text-muted-foreground hover:text-foreground/90 hover:bg-muted")}>
            <Settings className={cn("w-4 h-4 mr-3", activeTab === 'settings' ? "text-cyan-400" : "text-muted-foreground/80")} />
            <span className="truncate">Settings</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 z-10 relative bg-background">
        {/* Subtle background radial gradient for depth */}
        <div className="absolute top-0 left-0 w-full h-[300px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.07] via-background to-background pointer-events-none opacity-60"></div>

        {/* Global Context Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-border/60 bg-card/80 backdrop-blur-md relative z-20 shadow-sm">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-2.5">
              <StreamFlag stream={stream} size={26} />
              <div>
                <div className="font-cond text-[9px] uppercase tracking-[0.16em] text-muted-foreground leading-none">Operating plan</div>
                <div className="text-sm font-semibold text-foreground leading-tight mt-1">{stream} {activeVersion ? <span className="font-mono text-cyan-300">v{activeVersion.version}</span> : <span className="text-muted-foreground font-normal">— none</span>}</div>
              </div>
            </div>
            <div className="h-8 w-px bg-border/70" />
            <div className="flex items-stretch">
              {readout('Served', `${data.kpis?.demandServedPct ?? 0}%`, (data.kpis?.demandServedPct ?? 0) >= 100 ? 'text-ok' : 'text-warn')}
              {readout('Voyages', String(data.kpis?.voyageCount ?? 0))}
              {readout('Horizon', 'Jul–Aug')}
              {alertCount > 0 && (
                <div className="flex items-center gap-2 pl-4 border-l border-border/50">
                  <Pennant tone={(data.unserved?.length || data.kpis?.dryOutDays) ? 'critical' : 'warn'} size={16} />
                  <div><div className="font-cond text-[9px] uppercase tracking-[0.16em] text-muted-foreground leading-none">Alerts</div><div className="text-sm font-semibold text-foreground font-mono leading-tight mt-1">{alertCount}</div></div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveTab('replan')} className="px-3.5 py-2 text-xs font-medium bg-muted hover:bg-accent border border-border/80 rounded-md text-foreground/90 transition-colors">
              Versions
            </button>
            <button onClick={runOptimize} disabled={optimizing} className="px-4 py-2 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-md transition-colors disabled:opacity-50">
              {optimizing ? 'Optimising…' : 'Run optimiser'}
            </button>
          </div>
        </header>

        {/* Page Sub-Header */}
        <header className="h-14 flex items-center justify-between px-8 border-b border-border/40 bg-background/40 backdrop-blur-md relative z-20">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-2xl font-medium text-foreground">{activeTabLabel}</h2>
          </div>
          <div className="flex items-center gap-3">
            {alertCount > 0 && <span className="text-[11px] text-muted-foreground hidden sm:inline">{alertCount} open alert{alertCount === 1 ? '' : 's'}</span>}
            <button onClick={() => setActiveTab('replan')} aria-label={`Alerts and actions${alertCount ? ` (${alertCount})` : ''}`} title="Alerts & Actions" className="relative p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted">
              <Bell className="w-4 h-4" />
              {alertCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center text-[8px] font-semibold bg-destructive text-destructive-foreground rounded-full border border-background">{alertCount > 9 ? '9+' : alertCount}</span>}
            </button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-8 relative z-10 flex flex-col">
          <div key={activeTab} className="animate-fade-in-up flex-1 flex flex-col min-h-0">
            {activeTab === 'dashboard' && <DashboardView data={data} onGoto={setActiveTab} />}
            {activeTab === 'scheduler' && <SchedulerView data={data} stream={stream} onOptimize={runOptimize} optimizing={optimizing} />}
            {activeTab === 'inventory' && <InventoryView data={data} />}
            {activeTab === 'tanks' && <TankFarmView data={data} />}
            {activeTab === 'tracking' && <TrackingView data={data} />}
            {activeTab === 'replan' && <ReplanningView data={data} stream={stream} refresh={load} />}
            {activeTab === 'master' && <MasterDataView stream={stream} data={data} refresh={load} />}
            {activeTab === 'settings' && <SettingsView data={data} stream={stream} attempts={attempts} setAttempts={setAttempts} onReseed={reseed} />}
          </div>
        </main>
      </div>

      <TopProgress active={optimizing} />
      <Toaster />
    </div>
  );
}
