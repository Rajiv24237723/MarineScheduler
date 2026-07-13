import { useState, useMemo } from 'react';
import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Filter } from 'lucide-react';

export default function InventoryView({ data }: { data: DashboardData }) {
  const [selectedLocId, setSelectedLocId] = useState<string>('l_koyali');
  const [selectedProdId, setSelectedProdId] = useState<string>('p1');

  // Generate 30 days of inventory projection based on current stock and dummy movements
  const chartData = useMemo(() => {
    // Find tank for selected location and product
    const tank = data.tanks.find(t => t.locationId === selectedLocId && t.productId === selectedProdId);
    
    if (!tank) return [];

    let currentStock = tank.currentStock;
    const capacity = tank.capacity;
    const minStock = tank.minStock;
    
    // Simulate daily consumption or production
    // Refinery: Produces. Terminal: Consumes.
    const loc = data.locations.find(l => l.id === selectedLocId);
    const isProducer = loc?.type === 'REFINERY' || loc?.type === 'SOURCE';
    const dailyChange = isProducer ? 2000 : -1500; // Base daily change

    const points = [];
    const now = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      
      // Simulate a ship arriving and changing stock abruptly
      // E.g. every 7 days
      if (i > 0 && i % 7 === 0) {
         if (isProducer) {
             currentStock -= 25000; // Ship loads
         } else {
             currentStock += 25000; // Ship discharges
         }
      }

      currentStock += dailyChange;
      
      // Clamp stock just to be safe it doesn't go crazy
      if (currentStock > capacity * 1.2) currentStock = capacity;
      if (currentStock < 0) currentStock = 0;

      points.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        stock: currentStock,
        capacity: capacity,
        min: minStock
      });
    }

    return points;
  }, [data.tanks, data.locations, selectedLocId, selectedProdId]);

  const selectedLocName = data.locations.find(l => l.id === selectedLocId)?.name || 'Unknown Location';
  const selectedProdColor = data.products.find(p => p.id === selectedProdId)?.color || '#22d3ee';

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-800/80">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-400" />
            Inventory Forecast (30 Days)
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Filter className="w-4 h-4 text-slate-500" />
            <select 
              value={selectedLocId} 
              onChange={(e) => setSelectedLocId(e.target.value)}
              className="bg-slate-950 text-slate-200 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
            >
              {data.locations.filter(l => ['REFINERY', 'COASTAL_TERMINAL', 'CRUDE_STORAGE', 'LNG_TERMINAL'].includes(l.type)).map(loc => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <select 
              value={selectedProdId} 
              onChange={(e) => setSelectedProdId(e.target.value)}
              className="bg-slate-950 text-slate-200 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
            >
              {data.products.map(prod => (
                <option key={prod.id} value={prod.id}>{prod.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[400px]">
        {chartData.length > 0 ? (
          <Card className="bg-slate-900/50 border-slate-800/80 rounded-xl h-full flex flex-col">
            <CardHeader className="border-b border-slate-800/60 pb-4 bg-slate-950/50 rounded-t-xl">
              <CardTitle className="text-sm font-semibold text-slate-400">
                Projected Stock Profile: <span className="text-slate-100">{selectedLocName}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-6">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#888" 
                    fontSize={12} 
                    tickMargin={15}
                  />
                  <YAxis 
                    stroke="#888" 
                    fontSize={12} 
                    tickFormatter={(val) => `${(val/1000).toFixed(0)}k`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}
                    itemStyle={{ color: selectedProdColor, fontFamily: 'monospace' }}
                    labelStyle={{ color: '#888', marginBottom: '8px' }}
                    formatter={(value: number) => [`${value.toLocaleString()} MT`, 'Inventory']}
                  />
                  
                  {/* Safe Fill Limit / Capacity */}
                  <ReferenceLine y={chartData[0]?.capacity * 0.95} stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'top', value: 'Tank Top Limit', fill: '#f59e0b', fontSize: 10 }} />
                  
                  {/* Min Stock Limit */}
                  <ReferenceLine y={chartData[0]?.min} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'top', value: 'Dry-out Limit', fill: '#ef4444', fontSize: 10 }} />

                  <Line 
                    type="stepAfter" 
                    dataKey="stock" 
                    stroke={selectedProdColor} 
                    strokeWidth={3} 
                    dot={false}
                    activeDot={{ r: 6, fill: selectedProdColor, stroke: '#000', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : (
          <div className="h-full flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-800/80">
            <span className="text-sm font-medium text-slate-500">No tank configuration exists for this Location and Product combination.</span>
          </div>
        )}
      </div>
    </div>
  );
}
