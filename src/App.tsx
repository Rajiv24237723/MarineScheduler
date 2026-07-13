/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Ship, LayoutDashboard, CalendarDays, Factory, Map as MapIcon, Repeat2, Settings, AlertTriangle, Search, Database, TrendingUp, Bell } from 'lucide-react';
import { DashboardData } from './types';
import DashboardView from './components/DashboardView';
import SchedulerView from './components/SchedulerView';
import TankFarmView from './components/TankFarmView';
import TrackingView from './components/TrackingView';
import ReplanningView from './components/ReplanningView';
import MasterDataView from './components/MasterDataView';
import InventoryView from './components/InventoryView';
import { cn } from './lib/utils';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stream, setStream] = useState('POL');
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch(`/api/dashboard?stream=${stream}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error(e));
  }, [stream]);

  if (!data) return <div className="flex items-center justify-center h-screen w-screen bg-zinc-950 text-zinc-300">Loading Marine Scheduler...</div>;

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
  const activeTabLabel = allTabs.find(t => t.id === activeTab)?.label || 'Command Center';

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans selection:bg-indigo-500/30">
      {/* Refined Sidebar */}
      <div className="w-64 border-r border-slate-800/60 bg-slate-900/80 backdrop-blur-md flex flex-col z-10 flex-shrink-0">
        <div className="h-16 flex flex-col justify-center px-5 border-b border-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Ship className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-tight text-slate-100">Marine Scheduler</h1>
              <div className="text-[10px] text-slate-500 font-medium">Enterprise Edition v4.2</div>
            </div>
          </div>
        </div>
        
        {/* Stream Switcher */}
        <div className="p-4 border-b border-slate-800/60">
          <label className="text-[11px] font-medium text-slate-500 mb-2 block">Active Stream</label>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950/50 rounded-lg border border-slate-800/80">
            {['CRUDE', 'LNG', 'POL'].map(s => (
              <button
                key={s}
                onClick={() => setStream(s)}
                className={cn(
                  "py-1.5 text-[11px] font-medium rounded-md transition-all duration-200",
                  stream === s 
                    ? "bg-slate-800 text-slate-100 shadow-sm border border-slate-700/50" 
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
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
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{group.label}</span>
              </div>
              {group.items.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group w-full text-left",
                    activeTab === tab.id 
                      ? "bg-indigo-500/10 text-indigo-300" 
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                >
                  <tab.icon className={cn(
                    "w-4 h-4 mr-3 transition-transform duration-200",
                    activeTab === tab.id ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-300"
                  )} />
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-800/60">
          <button className="flex items-center w-full px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors">
            <Settings className="w-4 h-4 mr-3 text-slate-500" />
            <span className="truncate">Planner Settings</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 z-10 relative bg-slate-950">
        {/* Subtle background radial gradient for depth */}
        <div className="absolute top-0 left-0 w-full h-[300px] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/15 via-slate-950 to-slate-950 pointer-events-none"></div>

        {/* Global Context Header */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800/60 bg-slate-900/80 backdrop-blur-md relative z-20 shadow-sm">
          <div className="flex flex-col">
            <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1.5"><span className="text-slate-500">ACTIVE PLAN:</span> <span className="text-slate-200 font-medium font-sans">Jul-2026 Operational Plan</span> <span className="text-indigo-400 border border-indigo-400/30 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium">v17</span></span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1.5"><span className="text-slate-500">HORIZON:</span> <span className="font-sans">10 Jul - 31 Aug 2026</span></span>
              <span className="text-slate-700">|</span>
              <span className="flex items-center gap-1.5"><span className="text-slate-500">AS OF:</span> <span className="font-sans">10 Jul 2026, 14:02 PDT</span></span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md text-slate-200 transition-colors">
              Compare Plan
            </button>
            <button className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors shadow-sm">
              Run / Replan
            </button>
          </div>
        </header>

        {/* Page Sub-Header */}
        <header className="h-14 flex items-center justify-between px-8 border-b border-slate-800/40 bg-slate-950/40 backdrop-blur-md relative z-20">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-100">{activeTabLabel}</h2>
          </div>
          <div className="flex items-center gap-5">
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
              <input 
                type="text" 
                placeholder="Search resources..." 
                className="bg-slate-900/50 text-sm rounded-full pl-9 pr-4 py-1.5 border border-slate-700 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 w-64 text-slate-200 placeholder:text-slate-500 transition-all"
              />
            </div>
            <button className="relative p-2 text-slate-400 hover:text-slate-100 transition-colors rounded-full hover:bg-slate-800">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border-2 border-slate-950"></span>
            </button>
          </div>
        </header>
        
        <main className="flex-1 overflow-auto p-8 relative z-10">
          {activeTab === 'dashboard' && <DashboardView data={data} />}
          {activeTab === 'scheduler' && <SchedulerView data={data} stream={stream} />}
          {activeTab === 'inventory' && <InventoryView data={data} />}
          {activeTab === 'tanks' && <TankFarmView data={data} />}
          {activeTab === 'tracking' && <TrackingView data={data} />}
          {activeTab === 'replan' && <ReplanningView data={data} />}
          {activeTab === 'master' && <MasterDataView stream={stream} data={data} />}
        </main>
      </div>
    </div>
  );
}
