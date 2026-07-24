import { useState, useMemo } from 'react';
import { DashboardData, Tank } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Factory, Waves, ArrowRight, Truck, Filter, AlertOctagon } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TankFarmView({ data }: { data: DashboardData }) {
  const [selectedLocId, setSelectedLocId] = useState<string>('ALL');
  const [selectedProdId, setSelectedProdId] = useState<string>('ALL');

  const filteredTanks = useMemo(() => {
    return data.tanks.filter(t => 
      (selectedLocId === 'ALL' || t.locationId === selectedLocId) &&
      (selectedProdId === 'ALL' || t.productId === selectedProdId)
    );
  }, [data.tanks, selectedLocId, selectedProdId]);

  // Group filtered tanks by location
  const tanksByLoc = useMemo(() => {
    return filteredTanks.reduce((acc, tank) => {
      if (!acc[tank.locationId]) acc[tank.locationId] = [];
      acc[tank.locationId].push(tank);
      return acc;
    }, {} as Record<string, Tank[]>);
  }, [filteredTanks]);

  const getLocData = (locId: string) => {
    return data.locations.find(l => l.id === locId);
  };

  const multimodalBoard = [
    { time: '11 Jul 08:00', mode: 'Pipeline', direction: 'Inbound', product: 'HSD', qty: '18,000 KL', source: 'Refinery', status: 'Confirmed' },
    { time: '11 Jul 16:00', mode: 'Rake', direction: 'Outbound', product: 'HSD', qty: '3,800 KL', source: 'Inland Depot', status: 'Rake pending' },
    { time: '12 Jul 02:00', mode: 'Vessel', direction: 'Inbound', product: 'ATF', qty: '12,000 KL', source: 'MT Samudra', status: 'ETA risk', alert: true },
    { time: '12 Jul 06:00', mode: 'Road', direction: 'Outbound', product: 'ATF', qty: '900 KL', source: 'Airport Depot', status: 'Planned' },
  ];

  return (
    <div className="space-y-6 flex flex-col flex-1 min-h-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between bg-card/50 p-4 rounded-lg border border-border/80 shadow-sm">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Factory className="w-5 h-5 text-indigo-400" />
            Tank Farm Management
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="w-4 h-4 text-muted-foreground/80" />
            <select 
              value={selectedLocId} 
              onChange={(e) => setSelectedLocId(e.target.value)}
              className="bg-background text-foreground/80 border border-border/80 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            >
              <option value="ALL">All Locations</option>
              {data.locations.filter(l => ['REFINERY', 'COASTAL_TERMINAL', 'CRUDE_STORAGE', 'LNG_TERMINAL'].includes(l.type)).map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <select 
              value={selectedProdId} 
              onChange={(e) => setSelectedProdId(e.target.value)}
              className="bg-background text-foreground/80 border border-border/80 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
            >
              <option value="ALL">All Products</option>
              {data.products.map(prod => (
                <option key={prod.id} value={prod.id}>{prod.name}</option>
              ))}
            </select>
          </div>
          <button className="px-4 py-1.5 bg-muted text-foreground/90 border border-border/80 rounded-lg text-xs font-medium hover:bg-accent transition-colors ml-4 shadow-sm">
            Inter-tank Transfer
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10 space-y-8 pr-2">
        {Object.entries(tanksByLoc).length === 0 ? (
          <div className="h-40 flex items-center justify-center bg-card/50 rounded-lg border border-border/80">
            <span className="text-sm font-medium text-muted-foreground/80">No tanks match the selected filters</span>
          </div>
        ) : (
          (Object.entries(tanksByLoc) as [string, Tank[]][]).map(([locId, tanks]) => {
            const loc = getLocData(locId);
            return (
              <div key={locId} className="space-y-4">
                <div className="flex items-center gap-3 pb-2 border-b border-border/60">
                  <h4 className="text-sm font-semibold text-foreground/90">{loc?.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-border/80 bg-muted font-medium text-muted-foreground uppercase">{loc?.type?.replace('_', ' ')}</span>
                  <span className="text-[11px] font-medium text-muted-foreground/80 ml-auto">{tanks.length} TANKS</span>
                </div>
                
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {tanks.map((tank, idx) => {
                    const product = data.products.find(p => p.id === tank.productId);
                    const fillRatio = tank.currentStock / tank.capacity;
                    const safeCapacity = tank.capacity * 0.95;
                    const currentUllage = safeCapacity - tank.currentStock;
                    const incoming = idx === 0 ? 12000 : 0; // Deterministic random replacement for UI stability
                    const ullageAtEta = currentUllage - incoming;
                    
                    const isTankTopRisk = ullageAtEta < 0;

                    return (
                      <div key={tank.id} className="flex flex-col p-4 rounded-lg border border-border/80 bg-card/40 relative group hover:border-border/80 transition-colors">
                        {/* Top Header */}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex flex-col gap-1.5">
                            <span className="font-mono text-sm flex items-center gap-2">
                              <span className="text-foreground font-semibold">{tank.name}</span>
                            </span>
                            <span className="text-xs font-medium text-muted-foreground/80 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: product?.color }}></span>
                              {product?.name}
                            </span>
                          </div>
                          <span className={cn("px-2 py-1 text-[10px] font-semibold border rounded-md",
                            isTankTopRisk 
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20" 
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}>
                            {isTankTopRisk ? 'TANK-TOP RISK' : 'QC RELEASED'}
                          </span>
                        </div>
                        
                        {/* Detailed Metrics Table */}
                        <div className="grid grid-cols-2 gap-y-2 mb-4 text-xs font-mono">
                           <div className="text-muted-foreground/80">Current stock</div>
                           <div className="text-right text-foreground/90 font-semibold">{tank.currentStock.toLocaleString()} MT</div>
                           
                           <div className="text-muted-foreground/80">Safe capacity</div>
                           <div className="text-right text-muted-foreground">{safeCapacity.toLocaleString()} MT</div>
                           
                           <div className="text-muted-foreground/80">Current ullage</div>
                           <div className="text-right text-indigo-400">{currentUllage.toLocaleString()} MT</div>
                           
                           <div className="text-muted-foreground/80">Incoming parcel</div>
                           <div className="text-right text-teal-400">{incoming > 0 ? `${incoming.toLocaleString()} MT` : '-'}</div>

                           <div className="text-muted-foreground/80 font-semibold mt-1">Ullage at ETA</div>
                           <div className={cn("text-right font-semibold mt-1", isTankTopRisk ? "text-rose-400" : "text-emerald-400")}>
                             {ullageAtEta.toLocaleString()} MT
                           </div>
                        </div>

                        {/* Interactive Bar */}
                        <div className="relative h-3 bg-background rounded overflow-hidden border border-border">
                          <div 
                            className="absolute top-0 bottom-0 left-0 transition-all duration-1000"
                            style={{ 
                              width: `${fillRatio * 100}%`,
                              backgroundColor: product?.color,
                              opacity: 0.9,
                            }}
                          ></div>
                          {incoming > 0 && (
                            <div 
                              className="absolute top-0 bottom-0 transition-all duration-1000 bg-teal-400/50"
                              style={{ 
                                left: `${fillRatio * 100}%`,
                                width: `${(incoming / tank.capacity) * 100}%`,
                              }}
                            ></div>
                          )}
                          <div 
                            className="absolute top-0 bottom-0 w-[2px] bg-rose-500/80 z-10"
                            style={{ left: `95%` }}
                            title="Safe fill limit"
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          })
        )}

        {/* Multimodal Board */}
        <div className="pt-6">
           <div className="flex items-center gap-3 pb-3 border-b border-border/60">
             <h4 className="text-sm font-semibold text-foreground/90">Multimodal Inbound & Outbound</h4>
           </div>
           <div className="mt-4 bg-card/50 rounded-lg border border-border/80 overflow-hidden">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-border/50 bg-background/50">
                   <th className="p-3 pl-5 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Time</th>
                   <th className="p-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Mode</th>
                   <th className="p-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Direction</th>
                   <th className="p-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Product</th>
                   <th className="p-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider text-right">Quantity</th>
                   <th className="p-3 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Source / Destination</th>
                   <th className="p-3 pr-5 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider">Status</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-border/50">
                 {multimodalBoard.map((row, i) => (
                   <tr key={i} className="hover:bg-muted/30 transition-colors">
                     <td className="p-3 pl-5 text-sm font-mono text-muted-foreground">{row.time}</td>
                     <td className="p-3 text-sm font-medium text-foreground/80">
                        <span className="flex items-center gap-2">
                          {row.mode === 'Pipeline' && <Activity className="w-3.5 h-3.5 text-indigo-400" />}
                          {row.mode === 'Rake' && <Truck className="w-3.5 h-3.5 text-orange-400" />}
                          {row.mode === 'Vessel' && <Waves className="w-3.5 h-3.5 text-teal-400" />}
                          {row.mode === 'Road' && <Truck className="w-3.5 h-3.5 text-amber-400" />}
                          {row.mode}
                        </span>
                     </td>
                     <td className="p-3 text-sm text-muted-foreground">{row.direction}</td>
                     <td className="p-3 text-sm font-medium text-foreground/90">{row.product}</td>
                     <td className="p-3 text-sm font-mono text-foreground/80 text-right">{row.qty}</td>
                     <td className="p-3 text-sm text-muted-foreground">{row.source}</td>
                     <td className="p-3 pr-5">
                       <span className={cn("flex items-center gap-1.5 text-xs font-medium", row.alert ? "text-rose-400" : "text-muted-foreground")}>
                         {row.alert && <AlertOctagon className="w-3.5 h-3.5" />}
                         {row.status}
                       </span>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      </div>
    </div>
  );
}
