import { DashboardData, Voyage, Goto } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { VoyageDetail } from './VoyageDetail';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { CloudLightning } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';

/** Frames the map to the current stream's ports so vessels/sources sit in view. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => { if (points.length) map.fitBounds(points as any, { padding: [45, 45] }); }, [map, points]);
  return null;
}

const START = new Date('2026-07-01T00:00:00Z');
const portIcon = new L.DivIcon({ html: `<div style="width:12px;height:12px;background:#6366f1;border:2px solid #0b1220;border-radius:9999px"></div>`, className: '', iconSize: [12, 12], iconAnchor: [6, 6] });
const vesselIcon = new L.DivIcon({ html: `<div style="color:#f59e0b;background:rgba(11,18,32,.85);border-radius:9999px;padding:3px;border:1px solid rgba(245,158,11,.5)"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></div>`, className: '', iconSize: [20, 20], iconAnchor: [10, 10] });

export default function TrackingView({ data, goto }: { data: DashboardData; goto?: Goto }) {
  const [weather, setWeather] = useState<any>(null);
  const [modalVoyage, setModalVoyage] = useState<Voyage | null>(null);
  const maxDay = Math.max(31, ...(data.voyages ?? []).map(v => v.endDay));
  const [asOf, setAsOf] = useState(Math.min(15, maxDay));
  useEffect(() => { fetch('/api/weather?lat=15.0&lng=72.0').then(r => r.json()).then(setWeather).catch(console.error); }, []);
  const locById = useMemo(() => new Map(data.locations.map(l => [l.id, l])), [data.locations]);
  const bounds = useMemo(() => data.locations.map(l => [l.lat, l.lng] as [number, number]), [data.locations]);

  const live = useMemo(() => {
    const out: Array<{ id: string; name: string; cls: string; lat: number; lng: number; status: string; heading: string; voyage: Voyage }> = [];
    for (const v of data.voyages ?? []) {
      if (asOf < v.startDay || asOf > v.endDay) continue;
      // sailing?
      const leg = v.legs.find(l => l.departDay <= asOf && asOf < l.arriveDay);
      if (leg) {
        const a = locById.get(leg.fromLoc), b = locById.get(leg.toLoc);
        if (!a || !b) continue;
        const f = (asOf - leg.departDay) / Math.max(1, leg.arriveDay - leg.departDay);
        out.push({ id: v.id, name: v.vesselName, cls: v.vesselClass, lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, status: leg.ballast ? 'Ballast sailing' : 'Laden sailing', heading: b.name, voyage: v });
        continue;
      }
      const stop = v.stops.find(s => s.arriveDay <= asOf && asOf <= s.departDay);
      if (stop) { const l = locById.get(stop.locationId); if (l) out.push({ id: v.id, name: v.vesselName, cls: v.vesselClass, lat: l.lat, lng: l.lng, status: stop.kind === 'LOAD' ? 'Loading' : 'Discharging', heading: l.name, voyage: v }); }
    }
    return out;
  }, [data.voyages, asOf, locById]);

  return (
    <div className="flex-1 flex flex-col space-y-4 relative min-h-0">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Live Fleet — voyage playback</h3>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">As of {format(addDays(START, asOf), 'MMM d')}</span>
          <input type="range" min={0} max={maxDay} value={asOf} onChange={e => setAsOf(Number(e.target.value))} className="w-48 accent-cyan-500" />
          <span className="inline-flex items-center rounded-md bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-400 ring-1 ring-inset ring-cyan-500/30">{live.length} at sea/port</span>
        </div>
      </div>

      {weather && (
        <div className="absolute top-20 right-8 z-[1000] bg-background/80 p-4 rounded-md shadow-lg border border-border/80 w-56 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-2"><CloudLightning className="w-4 h-4 text-cyan-400" /><h4 className="text-xs font-semibold text-foreground/80">Marine Weather (Arabian Sea)</h4></div>
          <div className="flex justify-between items-end border-b border-border/60 pb-2"><div className="text-[11px] text-muted-foreground/80 uppercase">Temp</div><div className="text-xl font-mono text-foreground font-semibold">{weather.temperature}°C</div></div>
          <div className="flex justify-between items-end pt-2"><div className="text-[10px] text-white/40 uppercase tracking-widest">Wind</div><div className="text-sm font-mono text-purple-400">{weather.windspeed} kn</div></div>
        </div>
      )}

      <Card className="flex-1 overflow-hidden bg-card/50 border-border/80 rounded-md relative">
        <CardContent className="p-0 h-full relative">
          <MapContainer center={[20.5937, 78.9629]} zoom={4} style={{ height: '100%', width: '100%' }} className="bg-background">
            <FitBounds points={bounds} />
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            {data.locations.map(loc => (
              <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={portIcon}>
                <Popup><div className="font-semibold text-slate-900">{loc.name}</div><div className="text-xs">{loc.type.replace(/_/g, ' ')}</div></Popup>
              </Marker>
            ))}
            {live.map(v => (
              <Marker key={v.id} position={[v.lat, v.lng]} icon={vesselIcon} eventHandlers={{ click: () => setModalVoyage(v.voyage) }}>
                <Popup>
                  <div className="font-semibold text-slate-900">{v.name}</div>
                  <div className="text-xs">{v.cls}</div>
                  <div className="text-xs mt-1 border-t border-slate-200 pt-1">{v.status} → <span className="font-medium text-cyan-600">{v.heading}</span></div>
                  <button onClick={() => setModalVoyage(v.voyage)} className="mt-2 w-full px-2 py-1 bg-primary text-primary-foreground rounded-md text-[11px] font-medium">View full voyage plan</button>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </CardContent>
      </Card>

      <Modal open={!!modalVoyage} onClose={() => setModalVoyage(null)}
        title={modalVoyage ? `${modalVoyage.vesselName} · ${modalVoyage.vesselClass}` : ''}
        subtitle={modalVoyage ? `${modalVoyage.pool} · voyage days ${modalVoyage.startDay}–${modalVoyage.endDay}` : ''} width="max-w-3xl">
        {modalVoyage && <VoyageDetail voyage={modalVoyage} locations={data.locations} products={data.products} vessels={data.vessels} onNavigate={(tab, f) => { setModalVoyage(null); goto?.(tab, f); }} />}
      </Modal>
    </div>
  );
}
