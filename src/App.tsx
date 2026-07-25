/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { Ship, LayoutDashboard, CalendarDays, Factory, Map as MapIcon, Settings, AlertTriangle, Search, Database, TrendingUp, Bell } from 'lucide-react';
import { DashboardData } from './types';
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
      await fetch(`/api/optimize?stream=${stream}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options: { alnsIterations: attempts } }) });
      await load();
    } catch (e) { console.error(e); }
    setOptimizing(false);
  }, [stream, load, attempts]);

  const reseed = useCallback(async () => { await fetch('/api/admin/reseed', { method: 'POST' }); await load(); }, [load]);

  if (!data) return <div className="flex items-center justify-center h-screen w-screen bg-zinc-950 text-zinc-300">Loading Marine Scheduler...</div>;

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
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans selection:bg-indigo-500/30">
      {/* Refined Sidebar */}
      <div className="w-64 border-r border-border/60 bg-card/80 backdrop-blur-md flex flex-col z-10 flex-shrink-0">
        <div className="h-16 flex flex-col justify-center px-5 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Ship className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-tight text-foreground">Marine Scheduler</h1>
              <div className="text-[10px] text-muted-foreground/80 font-medium">Enterprise Edition v4.2</div>
            </div>
          </div>
        </div>
        
        {/* Stream Switcher */}
        <div className="p-4 border-b border-border/60">
          <label className="text-[11px] font-medium text-muted-foreground/80 mb-2 block">Active Stream</label>
          <div className="grid grid-cols-3 gap-1 p-1 bg-background/50 rounded-lg border border-border/80">
            {['CRUDE', 'LNG', 'POL'].map(s => (
              <button
                key={s}
                onClick={() => setStream(s)}
                className={cn(
                  "py-1.5 text-[11px] font-medium rounded-md transition-all duration-200",
                  stream === s 
                    ? "bg-muted text-foreground shadow-sm border border-border/80/50" 
                    : "text-muted-foreground hover:text-foreground/90 hover:bg-muted/50"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 py-4 flex flex-col gap-4 px-3 overflow-y-auto">
          {navigationGroups.map((group, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <div className="px-2 mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground/80 uppercase tracking-wider">{group.label}</span>
              </div>
              {group.items.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group w-full text-left",
                    activeTab === tab.id 
                      ? "bg-indigo-500/10 text-indigo-300" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground/90"
                  )}
                >
                  <tab.icon className={cn(
                    "w-4 h-4 mr-3 transition-transform duration-200",
                    activeTab === tab.id ? "text-indigo-400" : "text-muted-foreground/80 group-hover:text-foreground/80"
                  )} />
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border/60">
          <button onClick={() => setActiveTab('settings')} className={cn("flex items-center w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors", activeTab === 'settings' ? "bg-indigo-500/10 text-indigo-300" : "text-muted-foreground hover:text-foreground/90 hover:bg-muted")}>
            <Settings className={cn("w-4 h-4 mr-3", activeTab === 'settings' ? "text-indigo-400" : "text-muted-foreground/80")} />
            <span className="truncate">Settings</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 z-10 relative bg-background">
        {/* Subtle background radial gradient for depth */}
        <div className="absolute top-0 left-0 w-full h-[300px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/5 via-background to-background pointer-events-none opacity-50"></div>

        {/* Global Context Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-border/60 bg-card/80 backdrop-blur-md relative z-20 shadow-sm">
          <div className="flex flex-col">
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="text-muted-foreground/80">ACTIVE PLAN:</span> <span className="text-foreground/90 font-medium font-sans">Jul-Aug 2026 · {stream}</span> {activeVersion ? <span className="text-indigo-400 border border-indigo-400/30 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium">v{activeVersion.version}</span> : <span className="text-muted-foreground/60 font-sans">no plan yet</span>}</span>
              <span className="text-border">|</span>
              <span className="flex items-center gap-1.5"><span className="text-muted-foreground/80">HORIZON:</span> <span className="font-sans">01 Jul - 31 Aug 2026</span></span>
              <span className="text-border">|</span>
              <span className="flex items-center gap-1.5"><span className="text-muted-foreground/80">SERVED:</span> <span className="font-sans">{data.kpis?.demandServedPct ?? 0}%</span></span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveTab('replan')} className="px-3 py-1.5 text-xs font-medium bg-muted hover:bg-accent border border-border/80 rounded-md text-foreground/90 transition-colors">
              Versions
            </button>
            <button onClick={runOptimize} disabled={optimizing} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors shadow-sm disabled:opacity-50">
              {optimizing ? 'Optimizing…' : 'Run Optimizer'}
            </button>
          </div>
        </header>

        {/* Page Sub-Header */}
        <header className="h-14 flex items-center justify-between px-8 border-b border-border/40 bg-background/40 backdrop-blur-md relative z-20">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-foreground">{activeTabLabel}</h2>
          </div>
          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/80 group-focus-within:text-indigo-400 transition-colors" />
              <input 
                type="text" 
                placeholder="Search resources..." 
                className="bg-card/50 text-sm rounded-full pl-9 pr-4 py-1.5 border border-border/80 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 w-64 text-foreground/90 placeholder:text-muted-foreground/80 transition-all"
              />
            </div>
            <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-muted">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-background"></span>
            </button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-8 relative z-10 flex flex-col">
          {activeTab === 'dashboard' && <DashboardView data={data} onGoto={setActiveTab} />}
          {activeTab === 'scheduler' && <SchedulerView data={data} stream={stream} onOptimize={runOptimize} optimizing={optimizing} />}
          {activeTab === 'inventory' && <InventoryView data={data} />}
          {activeTab === 'tanks' && <TankFarmView data={data} />}
          {activeTab === 'tracking' && <TrackingView data={data} />}
          {activeTab === 'replan' && <ReplanningView data={data} stream={stream} refresh={load} />}
          {activeTab === 'master' && <MasterDataView stream={stream} data={data} refresh={load} />}
          {activeTab === 'settings' && <SettingsView data={data} stream={stream} attempts={attempts} setAttempts={setAttempts} onReseed={reseed} />}
        </main>
      </div>
    </div>
  );
}
