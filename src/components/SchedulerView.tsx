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
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-slate-100">Operational Movement Scheduler</h3>
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
          <button className="px-6 py-2 bg-slate-900/50 text-slate-300 border border-slate-800 rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors">
            Lock Plan
          </button>
        </div>
      </div>

      {result && result.duals && result.duals.length > 0 && (
        <Card className="bg-slate-900/50 border-amber-500/30 rounded-xl">
          <CardHeader className="py-3 px-4 bg-amber-500/10 border-b border-amber-500/20 rounded-t-xl">
            <CardTitle className="text-xs font-semibold text-amber-500">Binding Constraints / Bottlenecks</CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-2 gap-4">
            {result.duals.map((d: any, idx: number) => (
              <div key={idx} className="flex justify-between items-center bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-sm font-medium text-slate-300">{d.constraint}</span>
                <span className="text-xs font-mono text-amber-400">+₹{d.shadowPrice.toLocaleString()}/unit</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="flex-1 min-h-[400px] flex flex-col overflow-hidden bg-slate-900/50 border-slate-800/80 rounded-xl">
        <CardHeader className="py-3 px-4 border-b border-slate-800/60 bg-slate-900/80">
          <CardTitle className="text-sm font-semibold text-slate-300">Vessel Schedule (7 Days)</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-auto">
          <div className="min-w-[800px]">
            {/* Header row */}
            <div className="flex border-b border-slate-800/60 bg-slate-950/50">
              <div className="w-48 p-3 font-medium text-xs text-slate-500 border-r border-slate-800/60 shrink-0">Vessel</div>
              <div className="flex-1 flex">
                {days.map((d, i) => (
                  <div key={i} className="flex-1 p-2 text-xs font-medium text-slate-500 text-center border-r border-slate-800/60 border-dashed">
                    {format(d, 'MMM dd')}
                  </div>
                ))}
              </div>
            </div>

            {/* Vessel Rows */}
            {data.vessels.map(vessel => (
              <div key={vessel.id} className="flex border-b border-slate-800/60 group hover:bg-slate-800/30 transition-colors">
                <div className="w-48 p-3 text-sm border-r border-slate-800/60 shrink-0 flex flex-col justify-center">
                  <span className="font-mono text-slate-200 font-semibold">{vessel.name}</span>
                  <span className="text-[11px] font-medium text-slate-500 mt-1">{vessel.class} • {vessel.charterType}</span>
                </div>
                <div className="flex-1 relative min-h-[60px]">
                  {/* Grid lines */}
                  <div className="absolute inset-0 flex pointer-events-none">
                    {days.map((_, i) => (
                      <div key={i} className="flex-1 border-r border-slate-800/40 border-dashed"></div>
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
                        className={`absolute top-2 bottom-2 rounded-lg shadow-sm border p-2 text-xs overflow-hidden cursor-pointer transition-all hover:ring-1 hover:ring-slate-300 hover:z-10`}
                        style={{
                          left: '5%', // hardcoded positions for demo
                          width: '40%',
                          backgroundColor: product?.color ? `${product.color}20` : 'rgba(255,255,255,0.05)',
                          borderColor: product?.color ? `${product.color}50` : 'transparent'
                        }}
                      >
                        <div className="font-semibold truncate" style={{ color: product?.color }}>
                          {product?.name} <span className="font-mono text-[10px] ml-1">({movement.qty / 1000}k)</span>
                        </div>
                        <div className="truncate text-slate-400 text-[11px] font-medium mt-0.5">
                          {source?.name.split(' ')[0]} → {dest?.name.split(' ')[0]}
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
