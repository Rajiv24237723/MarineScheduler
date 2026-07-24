import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, addDays, parseISO } from 'date-fns';
import { useState } from 'react';

export default function SchedulerView({ data, stream }: { data: DashboardData, stream: string }) {
  // Simple custom CSS grid Gantt for demo
  const startDate = new Date();
  const days = Array.from({length: 7}).map((_, i) => addDays(startDate, i));
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch(`/api/optimize?stream=${stream}`, { method: 'POST' });
      const optimized = await res.json();
      setResult(optimized);
    } catch (e) {
      console.error(e);
    }
    setOptimizing(false);
  };

  return (
    <div className="space-y-6 flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-foreground">Operational Movement Scheduler</h3>
          {result?.status === 'success' && (
            <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-medium tracking-wider">
              Achievable
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button 
            onClick={handleOptimize}
            disabled={optimizing}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 shadow-sm"
          >
            {optimizing ? 'Optimizing...' : 'Run Optimizer'}
          </button>
          <button className="px-6 py-2 bg-card/50 text-foreground/80 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors">
            Lock Plan
          </button>
        </div>
      </div>

      {result && result.duals && result.duals.length > 0 && (
        <Card className="bg-card/50 border-amber-500/30 rounded-lg">
          <CardHeader className="py-3 px-4 bg-amber-500/10 border-b border-amber-500/20 rounded-t-xl">
            <CardTitle className="text-xs font-semibold text-amber-500">Binding Constraints / Bottlenecks</CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 gap-4">
            {result.duals.map((d: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center bg-background/50 p-2.5 rounded-lg border border-border/80">
                <span className="text-sm font-medium text-foreground/80">{d.constraint}</span>
                <span className="text-xs font-mono text-amber-400">+₹{d.shadowPrice.toLocaleString()}/unit</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="flex-1 min-h-[400px] flex flex-col overflow-hidden bg-card/50 border-border/80 rounded-lg">
        <CardHeader className="py-3 px-4 border-b border-border/60 bg-card/80 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-foreground/80">Vessel Schedule (7 Days)</CardTitle>
          <div className="flex bg-background p-1 rounded-lg border border-border">
            <button className="px-3 py-1 text-xs font-medium bg-muted text-foreground rounded shadow-sm">Vessels</button>
            <button className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground/90">Berths</button>
            <button className="px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground/90">Tanks</button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-auto">
          <div className="min-w-[800px]">
            {/* Header row */}
            <div className="flex border-b border-border/60 bg-background/50">
              <div className="w-48 p-3 font-medium text-xs text-muted-foreground/80 border-r border-border/60 shrink-0">Vessel</div>
              <div className="flex-1 flex">
                {days.map((d, i) => (
                  <div key={i} className="flex-1 p-2 text-xs font-medium text-muted-foreground/80 text-center border-r border-border/60 border-dashed">
                    {format(d, 'MMM dd')}
                  </div>
                ))}
              </div>
            </div>

            {/* Vessel Rows */}
            {data.vessels.map(vessel => (
              <div key={vessel.id} className="flex border-b border-border/60 group hover:bg-muted/30 transition-colors">
                <div className="w-48 p-3 text-sm border-r border-border/60 shrink-0 flex flex-col justify-center">
                  <span className="font-mono text-foreground/90 font-semibold">{vessel.name}</span>
                  <span className="text-[11px] font-medium text-muted-foreground/80 mt-1">{vessel.class} • {vessel.charterType}</span>
                </div>
                <div className="flex-1 relative min-h-[60px]">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map((_, i) => (
                      <div key={i} className="flex-1 border-r border-border/40 border-dashed"></div>
                    ))}
                  </div>
                  
                  {/* Render movements for this vessel */}
                  {data.movements.filter(m => m.vesselId === vessel.id).map(movement => {
                    const product = data.products.find(p => p.id === movement.productId);
                    const source = data.locations.find(l => l.id === movement.sourceId);
                    const dest = data.locations.find(l => l.id === movement.destId);
                    
                    return (
                      <div 
                        key={movement.id}
                        className={`absolute top-2 bottom-2 flex rounded-lg shadow-sm border p-0.5 text-xs overflow-hidden cursor-pointer transition-all hover:ring-1 hover:ring-slate-400 hover:z-10 group`}
                        style={{
                          left: '5%', // hardcoded positions for demo
                          width: '80%',
                          backgroundColor: 'rgba(15, 23, 42, 0.4)', // slate-900/40
                          borderColor: product?.color ? `${product.color}40` : 'transparent'
                        }}
                      >
                        {/* Ballast Phase */}
                        <div className="h-full bg-muted/80 border-r border-border/80/50 flex flex-col justify-center px-2 overflow-hidden relative" style={{ width: '15%' }}>
                          <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Ballast</span>
                          <span className="text-[10px] text-muted-foreground/80 truncate whitespace-nowrap">to {source?.name.split(' ')[0]}</span>
                        </div>
                        {/* Loading Phase */}
                        <div className="h-full bg-indigo-500/10 border-r border-indigo-500/20 flex flex-col justify-center px-2 overflow-hidden relative" style={{ width: '15%' }}>
                           <span className="text-[9px] font-medium text-indigo-400 uppercase tracking-wider">Load</span>
                           <span className="text-[10px] text-indigo-300 truncate whitespace-nowrap">{source?.name.split(' ')[0]}</span>
                        </div>
                        {/* Sailing Phase */}
                        <div className="h-full border-r flex flex-col justify-center px-3 overflow-hidden relative" style={{ width: '50%', backgroundColor: product?.color ? `${product.color}15` : '', borderColor: product?.color ? `${product.color}30` : '' }}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold truncate" style={{ color: product?.color }}>
                              {product?.name}
                            </span>
                            <span className="font-mono text-[10px] bg-background/50 px-1.5 py-0.5 rounded text-foreground/80">
                              {movement.qty.toLocaleString()} MT
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                             <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                               {source?.name.split(' ')[0]} <span className="text-muted-foreground">→</span> {dest?.name.split(' ')[0]}
                             </span>
                             <span className="text-[9px] text-muted-foreground/80 uppercase">Laden Sail</span>
                          </div>
                          
                          {/* Hover Details Tooltip Simulation */}
                          <div className="absolute inset-0 bg-card flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] text-foreground/80 font-medium">Click to view voyage details & costs</span>
                          </div>
                        </div>
                        {/* Discharge Phase */}
                        <div className="h-full bg-indigo-500/10 flex flex-col justify-center px-2 overflow-hidden relative" style={{ width: '20%' }}>
                           <span className="text-[9px] font-medium text-indigo-400 uppercase tracking-wider">Discharge</span>
                           <span className="text-[10px] text-indigo-300 truncate whitespace-nowrap">{dest?.name.split(' ')[0]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
