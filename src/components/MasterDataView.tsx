import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Plus, Search, Trash2, Edit2, Upload, Download, Ship } from 'lucide-react';
import { DashboardData } from '../types';

export default function MasterDataView({ stream, data }: { stream: string, data: DashboardData }) {
  const [activeTab, setActiveTab] = useState('vessels');

  const tabs = [
    { id: 'locations', label: 'Locations' },
    { id: 'tanks', label: 'Tanks' },
    { id: 'vessels', label: 'Vessels' },
    { id: 'products', label: 'Products' },
    { id: 'tank_changeover', label: 'Tank Changeover (Constraint)' },
    { id: 'comp_changeover', label: 'Compartment Changeover (Constraint)' },
  ];

  const streamVessels = data.vessels.filter(v => v.stream === stream);

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Master Data & Constraints</h3>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-card/50 text-foreground/80 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2">
            <Upload className="w-3.5 h-3.5" /> Import CSV
          </button>
          <button className="px-4 py-2 bg-card/50 text-foreground/80 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors flex items-center gap-2">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 transition-colors flex items-center gap-2 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Add Record
          </button>
        </div>
      </div>

      <div className="flex space-x-1 bg-card/50 p-1 rounded-lg border border-border/80 shrink-0 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              activeTab === tab.id ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground/80 hover:text-foreground/80 hover:bg-muted/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card className="flex-1 bg-card/50 border border-border/80 rounded-lg overflow-hidden flex flex-col">
        <CardHeader className="py-3 px-4 border-b border-border/60 bg-card/80 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground/80">{tabs.find(t => t.id === activeTab)?.label} Data</CardTitle>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/80" />
            <input type="text" placeholder="Filter..." className="bg-background text-xs border border-border rounded-lg pl-8 pr-3 py-1.5 text-foreground/90 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all" />
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto">
          {activeTab === 'vessels' && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-background/50 border-b border-border/80">
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">ID</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Vessel Name</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Class</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Capacity (DWT)</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Charter Info</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Speed (Knots)</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Compartments</th>
                  <th className="p-3 text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {streamVessels.map(v => (
                  <tr key={v.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="p-3 text-xs font-mono text-muted-foreground/80">{v.id}</td>
                    <td className="p-3 text-sm font-medium text-foreground/90 flex items-center gap-2">
                       <Ship className="w-4 h-4 text-indigo-400" />
                       {v.name}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{v.class}</td>
                    <td className="p-3 text-xs font-mono text-emerald-400">{v.dwt.toLocaleString()} MT</td>
                    <td className="p-3">
                       <div className="flex flex-col gap-1.5">
                          <span className={`px-2 py-0.5 w-fit text-[10px] font-medium rounded-md ${v.charterType === 'TC' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                            {v.charterType === 'TC' ? 'Time Charter' : 'Voyage Charter'}
                          </span>
                          <span className="text-[11px] font-mono text-muted-foreground/80">Cost: ${v.charterCost.toLocaleString()}{v.charterType === 'TC' ? '/day' : '/MT'}</span>
                       </div>
                    </td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">{v.speed.toFixed(1)}</td>
                    <td className="p-3">
                       <div className="flex flex-wrap gap-1.5 items-center">
                          {v.compartments?.map((c, i) => (
                             <span key={i} className="px-1.5 py-0.5 text-[10px] bg-card border border-border rounded font-mono text-muted-foreground" title={`${c.cap} MT`}>
                               {c.id}
                             </span>
                          ))}
                          <span className="text-[11px] text-muted-foreground/80 ml-1">({v.compartments?.length || 0})</span>
                       </div>
                    </td>
                    <td className="p-3 text-right flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-1.5 text-muted-foreground/80 hover:text-foreground/90 hover:bg-muted rounded transition-colors mr-1"><Edit2 className="w-4 h-4" /></button>
                      <button className="p-1.5 text-muted-foreground/80 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeTab !== 'vessels' && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/80 gap-3">
              <Database className="w-10 h-10 text-slate-800" />
              <div className="text-sm font-medium">Select stream-specific data rows to edit</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
