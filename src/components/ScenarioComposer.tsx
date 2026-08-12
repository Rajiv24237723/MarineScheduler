import { useMemo, useState } from 'react';
import {
  DashboardData, ScenarioEvent, ScenarioEventType, SavedScenario, dayToDate,
} from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Tip } from './ui/tooltip';
import { format } from 'date-fns';
import {
  Plus, Trash2, Pencil, AlertTriangle, TrendingDown, PackagePlus, Ship,
  Anchor, Factory, Save, FolderOpen, Copy, X,
} from 'lucide-react';

/** Type catalogue — label, icon, tone and a one-line description of what it does. */
const TYPES: Record<ScenarioEventType, { label: string; icon: any; tone: string; hint: string }> = {
  DEMAND_REVISION: { label: 'Demand / production revision', icon: TrendingDown, tone: 'text-cyan-300', hint: 'Offtake or production at a node changes, for the month or a window of it.' },
  SPOT_CARGO: { label: 'Spot cargo', icon: PackagePlus, tone: 'text-warn', hint: 'A one-off extra lifting, or an unexpected receipt, on a single day.' },
  TANK_OUTAGE: { label: 'Tank outage', icon: Factory, tone: 'text-bad', hint: 'A shore tank is out of service — it can neither receive nor dispatch.' },
  PORT_CLOSURE: { label: 'Port / berth disruption', icon: Anchor, tone: 'text-warn', hint: 'A port shut, one berth down, or reduced pumping rate for a window.' },
  VESSEL_DELAY: { label: 'Vessel delay', icon: Ship, tone: 'text-cyan-300', hint: 'A hull is ready later than planned — laycan slip, repair, re-route.' },
  VESSEL_OUTAGE: { label: 'Vessel off-hire', icon: Ship, tone: 'text-bad', hint: 'A hull is unavailable for a window (drydock, survey) or the whole month.' },
};
const TYPE_ORDER: ScenarioEventType[] = ['DEMAND_REVISION', 'SPOT_CARGO', 'TANK_OUTAGE', 'PORT_CLOSURE', 'VESSEL_DELAY', 'VESSEL_OUTAGE'];

const uid = () => `ev_${Math.random().toString(36).slice(2, 9)}`;
const dayLabel = (d: number | null | undefined) => d == null ? '—' : format(dayToDate(d), 'MMM d');

/** Day entry that always shows the date it lands on, and cannot leave the horizon. */
function DayField({ label, value, onChange, horizon, allowEmpty = false }: {
  label: string; value: number | null; onChange: (v: number | null) => void; horizon: number; allowEmpty?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min={0} max={horizon}
          value={value ?? ''}
          placeholder={allowEmpty ? 'any' : '0'}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') { onChange(allowEmpty ? null : 0); return; }
            onChange(Math.max(0, Math.min(horizon, Number(raw))));
          }}
          className="w-16 bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs"
        />
        <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">{value == null ? '' : dayLabel(value)}</span>
      </div>
    </label>
  );
}

/** One line of plain English describing an event, used in the list and the summary. */
export function describeEvent(e: ScenarioEvent, data: DashboardData): string {
  const loc = (id: string) => data.locations.find(l => l.id === id)?.name ?? id;
  const prod = (id: string) => data.products.find(p => p.id === id)?.name ?? id;
  const ves = (id: string) => data.vessels.find(v => v.id === id)?.name ?? id;
  const win = (a: number | null | undefined, b: number | null | undefined) =>
    a == null && b == null ? 'all month' : `${dayLabel(a ?? 0)} – ${dayLabel(b ?? 0)}`;
  switch (e.type) {
    case 'DEMAND_REVISION': {
      const what = e.side === 'IN' ? 'production' : 'offtake';
      const how = e.basis === 'ABS' ? `to ${e.value.toLocaleString()}/d`
        : e.basis === 'DELTA' ? `by ${e.value >= 0 ? '+' : ''}${e.value.toLocaleString()}/d`
          : `by ${e.value >= 0 ? '+' : ''}${e.value}%`;
      return `${loc(e.locationId)} · ${prod(e.productId)} — ${what} ${how}, ${win(e.fromDay, e.toDay)}`;
    }
    case 'SPOT_CARGO':
      return `${loc(e.locationId)} · ${prod(e.productId)} — ${e.direction === 'RECEIPT' ? 'receipt' : 'extra lifting'} ${e.qty.toLocaleString()} MT on ${dayLabel(e.day)}`;
    case 'TANK_OUTAGE':
      return `${loc(e.locationId)} · ${prod(e.productId)} — tank out of service ${win(e.fromDay, e.toDay)}`;
    case 'PORT_CLOSURE': {
      const berth = e.berthId ? (data.berths.find(b => b.id === e.berthId)?.name ?? 'one berth') : null;
      const sev = e.capacityPct == null ? 'shut' : `at ${e.capacityPct}% throughput`;
      return `${loc(e.locationId)}${berth ? ` · ${berth}` : ''} — ${sev} ${win(e.fromDay, e.toDay)}`;
    }
    case 'VESSEL_DELAY':
      return e.basis === 'SLIP'
        ? `${ves(e.vesselId)} — ${e.value} day${e.value === 1 ? '' : 's'} late`
        : `${ves(e.vesselId)} — ready ${dayLabel(e.value)}`;
    case 'VESSEL_OUTAGE':
      return e.fromDay == null && e.toDay == null
        ? `${ves(e.vesselId)} — unavailable all month`
        : `${ves(e.vesselId)} — off-hire ${win(e.fromDay, e.toDay)}`;
  }
}

function blankEvent(type: ScenarioEventType, data: DashboardData, horizon: number): ScenarioEvent {
  const id = uid();
  const demandNode = data.nodeFlows.find(f => f.dailyOut > 0);
  const supplyNode = data.nodeFlows.find(f => f.dailyIn > 0);
  const firstLoc = data.locations[0]?.id ?? '';
  const firstVessel = data.vessels.find(v => v.pool !== 'SPOT')?.id ?? data.vessels[0]?.id ?? '';
  const mid = Math.round(horizon * 0.45), late = Math.round(horizon * 0.75);
  switch (type) {
    case 'DEMAND_REVISION':
      return { id, type, locationId: demandNode?.locationId ?? firstLoc, productId: demandNode?.productId ?? data.products[0]?.id ?? '', side: 'OUT', basis: 'PCT', value: -15, fromDay: null, toDay: null };
    case 'SPOT_CARGO':
      return { id, type, locationId: demandNode?.locationId ?? firstLoc, productId: demandNode?.productId ?? data.products[0]?.id ?? '', qty: 40000, day: late, direction: 'DRAW' };
    case 'TANK_OUTAGE':
      return { id, type, locationId: supplyNode?.locationId ?? firstLoc, productId: supplyNode?.productId ?? data.products[0]?.id ?? '', fromDay: mid, toDay: Math.min(horizon, mid + 6) };
    case 'PORT_CLOSURE':
      return { id, type, locationId: firstLoc, berthId: null, fromDay: mid, toDay: Math.min(horizon, mid + 5), capacityPct: null };
    case 'VESSEL_DELAY':
      return { id, type, vesselId: firstVessel, basis: 'SLIP', value: 3 };
    case 'VESSEL_OUTAGE':
      return { id, type, vesselId: firstVessel, fromDay: mid, toDay: Math.min(horizon, mid + 10) };
  }
}

export default function ScenarioComposer({
  data, events, setEvents, horizon, scenarios, onSave, onLoad, onDelete,
}: {
  data: DashboardData;
  events: ScenarioEvent[];
  setEvents: (e: ScenarioEvent[]) => void;
  horizon: number;
  scenarios: SavedScenario[];
  onSave: (name: string) => Promise<void>;
  onLoad: (s: SavedScenario) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<ScenarioEvent | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const nodes = useMemo(() => data.nodeFlows.map(f => ({
    key: `${f.locationId}|${f.productId}`, locationId: f.locationId, productId: f.productId,
    label: `${data.locations.find(l => l.id === f.locationId)?.name ?? f.locationId} · ${data.products.find(p => p.id === f.productId)?.name ?? f.productId}`,
    rate: f.dailyOut > 0 ? `${f.dailyOut.toLocaleString()}/d out` : `${f.dailyIn.toLocaleString()}/d in`,
  })).sort((a, b) => a.label.localeCompare(b.label)), [data.nodeFlows, data.locations, data.products]);

  const add = (type: ScenarioEventType) => { setPicking(false); setEditing(blankEvent(type, data, horizon)); };
  const commit = (e: ScenarioEvent) => {
    setEvents(events.some(x => x.id === e.id) ? events.map(x => x.id === e.id ? e : x) : [...events, e]);
    setEditing(null);
  };
  const remove = (id: string) => setEvents(events.filter(e => e.id !== id));
  const duplicate = (e: ScenarioEvent) => setEvents([...events, { ...e, id: uid() }]);

  // How many of each type — makes "three delays, two closures" legible at a glance.
  const counts = events.reduce<Record<string, number>>((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a; }, {});

  return (
    <Card className="bg-card/50 border-border/80 rounded-md">
      <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-xs font-semibold text-foreground/80 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-warn" /> Scenario events ({events.length})
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {Object.entries(counts).map(([t, n]) => n > 1 && (
            <span key={t} className="px-1.5 py-0.5 rounded-full bg-muted text-[9px] text-muted-foreground border border-border/60">{TYPES[t as ScenarioEventType].label.split(' ')[0]} ×{n}</span>
          ))}
          <button onClick={() => setLoadOpen(true)} className="px-2 py-1 text-[10px] bg-muted hover:bg-accent border border-border/70 rounded-md flex items-center gap-1"><FolderOpen className="w-3 h-3" /> Load</button>
          <button disabled={!events.length} onClick={() => { setSaveName(''); setSaveOpen(true); }} className="px-2 py-1 text-[10px] bg-muted hover:bg-accent border border-border/70 rounded-md flex items-center gap-1 disabled:opacity-40"><Save className="w-3 h-3" /> Save</button>
          {events.length > 0 && <button onClick={() => setEvents([])} className="px-2 py-1 text-[10px] bg-muted hover:bg-accent border border-border/70 rounded-md">Clear</button>}
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-2">
        {events.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-3">
            No events yet. Add as many as the situation needs — several closures, several delayed hulls, a demand revision and a tank outage together.
          </div>
        )}

        <div className="space-y-1.5">
          {events.map((e, i) => {
            const T = TYPES[e.type];
            return (
              <div key={e.id} className="group flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2.5 py-2">
                <span className="font-mono text-[10px] text-muted-foreground/70 w-4 shrink-0">{i + 1}</span>
                <Tip content={T.hint} side="right"><T.icon className={`w-3.5 h-3.5 shrink-0 ${T.tone}`} /></Tip>
                <span className="text-xs text-foreground/85 min-w-0 flex-1 truncate">{describeEvent(e, data)}</span>
                <span className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setEditing(e)} title="Edit" className="p-1 text-muted-foreground hover:text-foreground rounded"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => duplicate(e)} title="Duplicate" className="p-1 text-muted-foreground hover:text-foreground rounded"><Copy className="w-3 h-3" /></button>
                  <button onClick={() => remove(e.id)} title="Remove" className="p-1 text-muted-foreground hover:text-bad rounded"><Trash2 className="w-3 h-3" /></button>
                </span>
              </div>
            );
          })}
        </div>

        <button onClick={() => setPicking(true)} className="w-full mt-1 px-3 py-2 rounded-md border border-dashed border-border/80 text-xs text-muted-foreground hover:text-foreground hover:border-cyan-500/40 flex items-center justify-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add event
        </button>
      </CardContent>

      {/* Type picker */}
      <Modal open={picking} onClose={() => setPicking(false)} title="Add a disruption" subtitle="Any number of each type can go in one scenario." width="max-w-lg">
        <div className="space-y-1.5">
          {TYPE_ORDER.map(t => {
            const T = TYPES[t];
            return (
              <button key={t} onClick={() => add(t)} className="w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-md border border-border/70 bg-background/50 hover:border-cyan-500/40">
                <T.icon className={`w-4 h-4 mt-0.5 shrink-0 ${T.tone}`} />
                <span>
                  <span className="block text-xs font-medium text-foreground/90">{T.label}{counts[t] ? <span className="ml-2 text-[10px] text-muted-foreground">{counts[t]} already</span> : null}</span>
                  <span className="block text-[11px] text-muted-foreground mt-0.5">{T.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>

      {/* Per-type editor */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? TYPES[editing.type].label : ''} subtitle={editing ? TYPES[editing.type].hint : ''} width="max-w-lg">
        {editing && <EventForm e={editing} data={data} nodes={nodes} horizon={horizon} onChange={setEditing} onCommit={commit} onCancel={() => setEditing(null)} />}
      </Modal>

      {/* Save */}
      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save scenario" subtitle={`${events.length} event(s)`} width="max-w-md">
        <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. Cyclone + Vadinar drydock"
          className="w-full bg-background/50 rounded-md px-3 py-2 border border-border/80 text-sm" />
        <div className="flex gap-2 mt-3">
          <button disabled={!saveName.trim()} onClick={async () => { await onSave(saveName.trim()); setSaveOpen(false); }} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs disabled:opacity-50">Save</button>
          <button onClick={() => setSaveOpen(false)} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Cancel</button>
        </div>
      </Modal>

      {/* Load */}
      <Modal open={loadOpen} onClose={() => setLoadOpen(false)} title="Saved scenarios" width="max-w-lg">
        <div className="space-y-1.5">
          {scenarios.length === 0 && <div className="text-xs text-muted-foreground">Nothing saved yet for this stream.</div>}
          {scenarios.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-border/70 bg-background/50">
              <button onClick={() => { onLoad(s); setLoadOpen(false); }} className="text-left min-w-0 flex-1">
                <span className="block text-xs text-foreground/90 truncate">{s.name}</span>
                <span className="block text-[10px] text-muted-foreground">{s.events.length} event(s) · as-of day {s.asOfDay} · {s.mode}</span>
              </button>
              <button onClick={() => onDelete(s.id)} className="p-1 text-muted-foreground hover:text-bad shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type NodeOpt = { key: string; locationId: string; productId: string; label: string; rate: string };

function EventForm({ e, data, nodes, horizon, onChange, onCommit, onCancel }: {
  e: ScenarioEvent; data: DashboardData; nodes: NodeOpt[]; horizon: number;
  onChange: (e: ScenarioEvent) => void; onCommit: (e: ScenarioEvent) => void; onCancel: () => void;
}) {
  const set = (patch: any) => onChange({ ...e, ...patch } as ScenarioEvent);
  // Every node is offered — a refinery or import source is as valid a target as a
  // marketing terminal, which the old composer could not express.
  const nodeSelect = (locationId: string, productId: string) => (
    <label className="flex flex-col gap-1 col-span-2">
      <span className="text-[11px] text-muted-foreground">Node (location · product)</span>
      <select
        value={`${locationId}|${productId}`}
        onChange={ev => { const [l, p] = ev.target.value.split('|'); set({ locationId: l, productId: p }); }}
        className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs"
      >
        {nodes.map(n => <option key={n.key} value={n.key}>{n.label} ({n.rate})</option>)}
      </select>
    </label>
  );

  const vessels = data.vessels.filter(v => v.pool !== 'SPOT');
  const berthsAt = data.berths.filter(b => b.locationId === (e as any).locationId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {e.type === 'DEMAND_REVISION' && <>
          {nodeSelect(e.locationId, e.productId)}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Side</span>
            <select value={e.side} onChange={ev => set({ side: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="OUT">Offtake / lifting (out)</option>
              <option value="IN">Production / receipt (in)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Entered as</span>
            <select value={e.basis} onChange={ev => set({ basis: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="PCT">Percent change</option>
              <option value="DELTA">Delta MT/day</option>
              <option value="ABS">Absolute MT/day</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-muted-foreground">{e.basis === 'PCT' ? 'Change (%)' : e.basis === 'DELTA' ? 'Change (MT/day, ± )' : 'New rate (MT/day)'}</span>
            <input type="number" value={e.value} onChange={ev => set({ value: Number(ev.target.value) })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs" />
          </label>
          <DayField label="From day (blank = start)" value={e.fromDay ?? null} onChange={v => set({ fromDay: v })} horizon={horizon} allowEmpty />
          <DayField label="To day (blank = month end)" value={e.toDay ?? null} onChange={v => set({ toDay: v })} horizon={horizon} allowEmpty />
        </>}

        {e.type === 'SPOT_CARGO' && <>
          {nodeSelect(e.locationId, e.productId)}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Direction</span>
            <select value={e.direction} onChange={ev => set({ direction: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="DRAW">Extra lifting (stock out)</option>
              <option value="RECEIPT">Unexpected receipt (stock in)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Quantity (MT)</span>
            <input type="number" value={e.qty} onChange={ev => set({ qty: Number(ev.target.value) })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs" />
          </label>
          <DayField label="Day it lands" value={e.day} onChange={v => set({ day: v ?? 0 })} horizon={horizon} />
        </>}

        {e.type === 'TANK_OUTAGE' && <>
          {nodeSelect(e.locationId, e.productId)}
          <DayField label="Out from day" value={e.fromDay} onChange={v => set({ fromDay: v ?? 0 })} horizon={horizon} />
          <DayField label="Back in service after" value={e.toDay} onChange={v => set({ toDay: v ?? 0 })} horizon={horizon} />
        </>}

        {e.type === 'PORT_CLOSURE' && <>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-muted-foreground">Port</span>
            <select value={e.locationId} onChange={ev => set({ locationId: ev.target.value, berthId: null })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              {data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Scope</span>
            <select value={e.berthId ?? ''} onChange={ev => set({ berthId: ev.target.value || null })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="">Whole port</option>
              {berthsAt.map(b => <option key={b.id} value={b.id}>{b.name} ({b.nsim} slot{b.nsim === 1 ? '' : 's'})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Severity</span>
            <select value={e.capacityPct == null ? 'SHUT' : String(e.capacityPct)} onChange={ev => set({ capacityPct: ev.target.value === 'SHUT' ? null : Number(ev.target.value) })}
              className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="SHUT">Fully shut — ships wait</option>
              <option value="75">Degraded — 75% rate</option>
              <option value="50">Degraded — 50% rate</option>
              <option value="25">Degraded — 25% rate</option>
            </select>
          </label>
          <DayField label="Shut from day" value={e.fromDay} onChange={v => set({ fromDay: v ?? 0 })} horizon={horizon} />
          <DayField label="Reopens after day" value={e.toDay} onChange={v => set({ toDay: v ?? 0 })} horizon={horizon} />
          {e.capacityPct != null && e.berthId && (
            <p className="col-span-2 text-[11px] text-muted-foreground">Throughput is modelled at the port, so a degraded rate applies to the whole call regardless of berth.</p>
          )}
        </>}

        {e.type === 'VESSEL_DELAY' && <>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-muted-foreground">Vessel</span>
            <select value={e.vesselId} onChange={ev => set({ vesselId: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name} · {v.class} · {v.pool} · {Math.round(v.dwt / 1000)}k dwt</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Entered as</span>
            <select value={e.basis} onChange={ev => set({ basis: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              <option value="SLIP">Days late vs plan</option>
              <option value="ABS">Ready on a given day</option>
            </select>
          </label>
          {e.basis === 'SLIP'
            ? <label className="flex flex-col gap-1"><span className="text-[11px] text-muted-foreground">Days late</span>
              <input type="number" min={0} value={e.value} onChange={ev => set({ value: Number(ev.target.value) })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs" /></label>
            : <DayField label="Ready from day" value={e.value} onChange={v => set({ value: v ?? 0 })} horizon={horizon} />}
        </>}

        {e.type === 'VESSEL_OUTAGE' && <>
          <label className="flex flex-col gap-1 col-span-2">
            <span className="text-[11px] text-muted-foreground">Vessel</span>
            <select value={e.vesselId} onChange={ev => set({ vesselId: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs">
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name} · {v.class} · {v.pool} · {Math.round(v.dwt / 1000)}k dwt</option>)}
            </select>
          </label>
          <DayField label="Off-hire from (blank = all month)" value={e.fromDay ?? null} onChange={v => set({ fromDay: v })} horizon={horizon} allowEmpty />
          <DayField label="Back on hire after" value={e.toDay ?? null} onChange={v => set({ toDay: v })} horizon={horizon} allowEmpty />
        </>}

        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[11px] text-muted-foreground">Note (optional — kept with the scenario)</span>
          <input value={e.note ?? ''} onChange={ev => set({ note: ev.target.value })} className="bg-background/50 rounded-md px-2 py-1.5 border border-border/80 text-xs" />
        </label>
      </div>

      <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-[11px] text-foreground/75">{describeEvent(e, data)}</div>

      <div className="flex gap-2">
        <button onClick={() => onCommit(e)} className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs">Done</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-md text-xs">Cancel</button>
      </div>
    </div>
  );
}
