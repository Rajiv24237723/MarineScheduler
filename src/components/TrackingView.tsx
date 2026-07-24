import { DashboardData } from '../types';
import { Card, CardContent } from '@/components/ui/card';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Navigation, CloudLightning } from 'lucide-react';
import { useEffect, useState } from 'react';

// Custom icon for ports
const portIcon = new L.DivIcon({
  html: `<div class="w-4 h-4 bg-primary border-2 border-background rounded-full shadow-md"></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// Custom icon for vessels
const vesselIcon = new L.DivIcon({
  html: `<div class="text-amber-500 bg-background/80 rounded-full p-1 border border-amber-500/50 shadow-md transform -rotate-45">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
  </div>`,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

export default function TrackingView({ data }: { data: DashboardData }) {
  // Center map on India
  const position: [number, number] = [20.5937, 78.9629];
  const [weatherData, setWeatherData] = useState<any>(null);

  useEffect(() => {
    // Fetch live weather using the free Open-Meteo API proxy
    fetch('/api/weather?lat=15.0&lng=72.0')
      .then(r => r.json())
      .then(d => setWeatherData(d))
      .catch(console.error);
  }, []);

  // Dummy mid-voyage vessel positions for demo
  const liveVessels = [];
  if (data.vessels.length > 0) {
    liveVessels.push({ ...data.vessels[0], lat: 15.0, lng: 72.0, heading: 'Kochi' });
  }
  if (data.vessels.length > 1) {
    liveVessels.push({ ...data.vessels[1], lat: 18.0, lng: 85.0, heading: 'Paradip' });
  }

  return (
    <div className="flex-1 flex flex-col space-y-4 relative min-h-0">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Live AIS Tracking & Execution</h3>
        <div className="flex gap-2">
          <span className="inline-flex items-center rounded-md bg-indigo-500/10 px-3 py-1 text-[11px] font-medium text-indigo-400 ring-1 ring-inset ring-indigo-500/30">
            AIS Live
          </span>
          <span className="inline-flex items-center rounded-md bg-teal-500/10 px-3 py-1 text-[11px] font-medium text-teal-400 ring-1 ring-inset ring-teal-500/30">
            Open-Meteo Feed
          </span>
        </div>
      </div>

      {weatherData && (
        <div className="absolute top-20 right-8 z-[1000] bg-background/80 p-4 rounded-lg shadow-lg border border-border/80 w-64 backdrop-blur-md">
          <div className="flex items-center gap-2 mb-2">
            <CloudLightning className="w-4 h-4 text-indigo-400" />
            <h4 className="text-xs font-semibold text-foreground/80">Marine Weather</h4>
          </div>
          <div className="flex justify-between items-end border-b border-border/60 pb-2">
            <div className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">Arabian Sea</div>
            <div className="text-xl font-mono text-foreground font-semibold">{weatherData.temperature}°C</div>
          </div>
          <div className="flex justify-between items-end pt-2">
            <div className="text-[10px] text-white/40 uppercase tracking-widest">Wind Speed</div>
            <div className="text-sm font-mono text-purple-400">{weatherData.windspeed} kn</div>
          </div>
        </div>
      )}

      <Card className="flex-1 overflow-hidden bg-card/50 border-border/80 rounded-lg relative">
        <CardContent className="p-0 h-full relative">
          <MapContainer center={position} zoom={5} style={{ height: '100%', width: '100%' }} className="bg-background">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            
            {/* Render Ports */}
            {data.locations.map(loc => (
              <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={portIcon}>
                <Popup className="custom-popup">
                  <div className="font-semibold text-slate-900">{loc.name}</div>
                  <div className="text-xs text-muted-foreground/80">{loc.type.replace('_', ' ')}</div>
                </Popup>
              </Marker>
            ))}

            {/* Render Live Vessels */}
            {liveVessels.map(v => (
              <Marker key={v.id} position={[v.lat, v.lng]} icon={vesselIcon}>
                <Popup>
                  <div className="font-semibold text-slate-900">{v.name}</div>
                  <div className="text-xs text-muted-foreground/80">{v.class} • {v.speed} knots</div>
                  <div className="text-xs mt-2 border-t border-slate-200 pt-2">Heading to: <span className="font-medium text-indigo-600">{v.heading}</span></div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </CardContent>
      </Card>
    </div>
  );
}
