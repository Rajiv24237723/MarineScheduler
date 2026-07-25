import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { toast } from './ui/toast';
import { Plus, Trash2, Maximize2, Upload, Download } from 'lucide-react';
import { DashboardData, Vessel } from '../types';

const fmtM = (n: number) => `₹${(n / 1e6).toFixed(1)}M`;

type Col = { key: string; label: string; num?: boolean };
const TABS: Record<string, { table: string; cols: Col[]; rows: (d: DashboardData) => any[]; make: (stream: string, d: DashboardData) => any; note?: string }> = {
  Products: {
    table: 'products', cols: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'cargoClass', label: 'Cargo class' }, { key: 'color', label: 'Colour' }],
    rows: d => d.products, make: (s) => ({ id: `p_${Date.now() % 100000}`, stream: s, name: 'New Grade', type: s, cargoClass: 'CLEAN', color: '#8b5cf6' }),
  },
  Locations: {
    table: 'locations', cols: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'lat', label: 'Lat', num: true }, { key: 'lng', label: 'Lng', num: true }],
    rows: d => d.locations, make: (s) => ({ id: `l_${Date.now() % 100000}`, stream: s, name: 'New Location', type: 'COASTAL_TERMINAL', lat: 20, lng: 75 }),
  },
  Vessels: {
    table: 'vessels', cols: [{ key: 'name', label: 'Name' }, { key: 'class', label: 'Class' }, { key: 'pool', label: 'Pool' }, { key: 'service', label: 'Service' }, { key: 'dwt', label: 'DWT', num: true }, { key: 'speed', label: 'Speed', num: true }, { key: 'charterCost', label: 'Hire $/d', num: true }, { key: 'voyageRate', label: 'Voy $/MT', num: true }, { key: 'draftLaden', label: 'Draft', num: true }],
    rows: d => d.vessels, make: (s) => ({ stream: s, name: 'New Vessel', class: 'MR', charterType: 'TC', pool: 'OWNED', service: s === 'POL' ? 'CLEAN' : s, dwt: 45000, speed: 13, charterCost: 15000, voyageRate: 0, draftLaden: 11, draftBallast: 6.5, compartments: [{ id: 'C1', cap: 15000 }] }),
  },
  Tanks: {
    table: 'tanks', cols: [{ key: 'name', label: 'Name' }, { key: 'locationId', label: 'Location' }, { key: 'productId', label: 'Product' }, { key: 'capacity', label: 'Capacity', num: true }, { key: 'minStock', label: 'Min', num: true }, { key: 'currentStock', label: 'Opening', num: true }],
    rows: d => d.tanks, make: (s, d) => ({ stream: s, name: 'New Tank', locationId: d.locations[0]?.id, productId: d.products[0]?.id, capacity: 60000, minStock: 8000, currentStock: 30000 }),
  },
  'Demand / Supply': {
    table: 'nodeFlows', note: 'Daily production (in) and demand/lifting (out) — this is the monthly plan the optimizer uses.',
    cols: [{ key: 'locationId', label: 'Location' }, { key: 'productId', label: 'Product' }, { key: 'dailyIn', label: 'Daily in (MT)', num: true }, { key: 'dailyOut', label: 'Daily out (MT)', num: true }],
    rows: d => d.nodeFlows, make: (s, d) => ({ stream: s, locationId: d.locations[0]?.id, productId: d.products[0]?.id, dailyIn: 0, dailyOut: 3000 }),
  },
  'Plan Lines': {
    table: 'planLines', note: 'Monthly demand/supply summary with delivery windows (informational).',
    cols: [{ key: 'kind', label: 'Kind' }, { key: 'productId', label: 'Product' }, { key: 'locationId', label: 'Location' }, { key: 'qty', label: 'Qty', num: true }, { key: 'windowStart', label: 'From' }, { key: 'windowEnd', label: 'To' }, { key: 'priority', label: 'Prio', num: true }],
    rows: d => d.planLines, make: (s, d) => ({ stream: s, kind: 'DEMAND', productId: d.products[0]?.id, locationId: d.locations[0]?.id, qty: 50000, windowStart: '2026-07-01', windowEnd: '2026-08-31', priority: 1 }),
  },
  Berths: {
    table: 'berths', cols: [{ key: 'locationId', label: 'Location' }, { key: 'name', label: 'Name' }, { key: 'nsim', label: 'N-sim', num: true }, { key: 'rateMtPerHr', label: 'Rate MT/h', num: true }, { key: 'berthingHours', label: 'Berth h', num: true }, { key: 'maxDraft', label: 'Max draft', num: true }],
    rows: d => d.berths, make: (s, d) => ({ stream: s, locationId: d.locations[0]?.id, name: 'New Berth', nsim: 1, rateMtPerHr: 2000, berthingHours: 12, maxDraft: 14 }),
  },
  Compatibility: {
    table: 'productCompatibility', cols: [{ key: 'scope', label: 'Scope' }, { key: 'fromProduct', label: 'From' }, { key: 'toProduct', label: 'To' }, { key: 'allowed', label: 'Allowed', num: true }, { key: 'changeoverHours', label: 'Chg h', num: true }, { key: 'changeoverCost', label: 'Chg ₹', num: true }],
    rows: d => d.compatibility, make: (s, d) => ({ stream: s, scope: 'COMPARTMENT', fromProduct: d.products[0]?.id, toProduct: d.products[1]?.id ?? d.products[0]?.id, allowed: 1, changeoverHours: 12, changeoverCost: 100000 }),
  },
};

function toCSV(rows: any[], cols: Col[]): string {
  const keys = ['id', ...cols.map(c => c.key)];
  const head = keys.join(',');
  const body = rows.map(r => keys.map(k => { const v = r[k]; const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  return `${head}\n${body}`;
}
function parseCSV(text: string, cols: Col[], stream: string): any[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const numKeys = new Set(cols.filter(c => c.num).map(c => c.key));
  return lines.slice(1).map(line => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i, a) => i < a.length - 1) ?? line.split(',');
    const row: any = { stream };
    headers.forEach((h, i) => {
      let v: any = (cells[i] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      if (numKeys.has(h)) v = Number(v);
      else if (v.startsWith('[') || v.startsWith('{')) { try { v = JSON.parse(v); } catch { } }
      if (h && v !== '') row[h] = v;
    });
    return row;
  });
}

export default function MasterDataView({ stream, data, refresh }: { stream: string; data: DashboardData; refresh: () => Promise<void> }) {
  const [tab, setTab] = useState('Products');
  const [vesselDetail, setVesselDetail] = useState<Vessel | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const cfg = TABS[tab];
  const rows = cfg.rows(data);

  const util = (v: Vessel) => {
    const vs = (data.voyages ?? []).filter(x => x.vesselId === v.id || x.vesselName === v.name);
    const mt = vs.reduce((s, x) => s + x.stops.flatMap(st => st.ops).filter(o => o.op === 'LOAD').reduce((a, o) => a + o.qty, 0), 0);
    return { voyages: vs.length, mt, cost: vs.reduce((s, x) => s + x.cost, 0), days: vs.reduce((s, x) => s + (x.endDay - x.startDay), 0) };
  };

  const put = async (id: string, key: string, value: string, num?: boolean) => { await fetch(`/api/master/${cfg.table}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: num ? Number(value) : value }) }); await refresh(); };
  const del = async (id: string) => { await fetch(`/api/master/${cfg.table}/${id}`, { method: 'DELETE' }); await refresh(); };
  const add = async () => { await fetch(`/api/master/${cfg.table}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg.make(stream, data)) }); await refresh(); };

  const exportCSV = () => {
    const blob = new Blob([toCSV(rows, cfg.cols)], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cfg.table}_${stream}.csv`; a.click();
  };
  const doImport = async (replace: boolean) => {
    setImporting(true);
    try {
      const parsed = parseCSV(csvText, cfg.cols, stream);
      await fetch(`/api/master/${cfg.table}/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: parsed, replaceStream: replace ? stream : undefined }) });
      await refresh(); setImportOpen(false); setCsvText('');
      toast(`Imported ${parsed.length} row(s) into ${tab}${replace ? ` (replaced ${stream})` : ''}. Re-run the optimiser to apply.`, 'success');
    } catch (e) { console.error(e); toast('Import failed — check the CSV format.', 'error'); }
    setImporting(false);
  };
  const onFile = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => setCsvText(String(r.result)); r.readAsText(f); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Master Data — {stream}</h3>
        <div className="flex gap-2">
          <button onClick={() => { setCsvText(toCSV(rows, cfg.cols)); setImportOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs"><Upload className="w-3.5 h-3.5" /> Import CSV</button>
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs"><Download className="w-3.5 h-3.5" /> Export</button>
          <button onClick={add} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs"><Plus className="w-3.5 h-3.5" /> Add row</button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-border/60 flex-wrap">
        {Object.keys(TABS).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-xs font-medium -mb-px border-b-2 ${tab === t ? 'border-sky-500 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground/80'}`}>{t}</button>
        ))}
      </div>
      {cfg.note && <p className="text-[11px] text-sky-300/80 -mt-1">{cfg.note}</p>}
      <Card className="bg-card/50 border-border/80 rounded-lg">
        <CardContent className="p-0 overflow-auto max-h-[62vh]">
          <table className="w-full text-xs">
            <thead className="bg-background/50 border-b border-border/60 sticky top-0"><tr>{cfg.cols.map(c => <th key={c.key} className="text-left px-3 py-2 font-medium text-muted-foreground/80">{c.label}</th>)}<th className="w-16" /></tr></thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  {cfg.cols.map(c => (
                    <td key={c.key} className="px-2 py-1">
                      <input defaultValue={row[c.key]} type={c.num ? 'number' : 'text'} readOnly={c.key === 'id'}
                        onBlur={e => { if (c.key !== 'id' && String(e.target.value) !== String(row[c.key])) put(row.id, c.key, e.target.value, c.num); }}
                        className="w-full bg-transparent px-1.5 py-1 rounded border border-transparent hover:border-border/60 focus:border-sky-500/50 focus:bg-background/50 outline-none text-foreground/90 read-only:text-muted-foreground/60" />
                    </td>
                  ))}
                  <td className="px-2"><div className="flex items-center gap-2 justify-end">
                    {tab === 'Vessels' && <button onClick={() => setVesselDetail(row as Vessel)} className="text-muted-foreground hover:text-sky-400" title="Vessel details"><Maximize2 className="w-3.5 h-3.5" /></button>}
                    <button onClick={() => del(row.id)} className="text-muted-foreground hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={cfg.cols.length + 1} className="px-3 py-4 text-muted-foreground text-center">No rows.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-[11px] text-muted-foreground">Edit a cell and click away to save. Changes take effect on the next <span className="text-sky-400">Run Optimizer</span>.</p>

      {/* CSV import modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={`Import ${tab} (CSV)`} subtitle={`Stream ${stream} · header row required (id optional)`} width="max-w-2xl">
        <div className="space-y-3">
          <input type="file" accept=".csv,text/csv" onChange={e => onFile(e.target.files?.[0])} className="text-xs text-muted-foreground" />
          <textarea value={csvText} onChange={e => setCsvText(e.target.value)} spellCheck={false} className="w-full h-56 bg-background/60 border border-border/70 rounded-lg p-2 font-mono text-[11px] text-foreground/90 outline-none focus:border-sky-500/50" />
          <div className="flex justify-end gap-2">
            <button onClick={() => doImport(false)} disabled={importing} className="px-3 py-1.5 bg-muted hover:bg-accent border border-border/80 rounded-lg text-xs disabled:opacity-50">Append rows</button>
            <button onClick={() => doImport(true)} disabled={importing} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs disabled:opacity-50">{importing ? 'Importing…' : `Replace all ${stream} rows`}</button>
          </div>
        </div>
      </Modal>

      {/* Vessel detail */}
      <Modal open={!!vesselDetail} onClose={() => setVesselDetail(null)} title={vesselDetail ? vesselDetail.name : ''} subtitle={vesselDetail ? `${vesselDetail.class} · ${vesselDetail.pool}` : ''} width="max-w-xl">
        {vesselDetail && (() => {
          const v = vesselDetail; const u = util(v);
          const totalCap = v.compartments.reduce((s, c) => s + c.cap, 0); const maxCap = Math.max(1, ...v.compartments.map(c => c.cap));
          const spec = (l: string, val: string) => <div className="flex justify-between bg-background/50 px-3 py-1.5 rounded-lg border border-border/70 text-xs"><span className="text-muted-foreground">{l}</span><span className="text-foreground/90 font-mono">{val}</span></div>;
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {spec('DWT', `${v.dwt.toLocaleString()} MT`)}{spec('Service speed', `${v.speed} kn`)}
                {spec('Draft laden / ballast', `${v.draftLaden} / ${v.draftBallast} m`)}{spec('Total compartment cap', `${totalCap.toLocaleString()} MT`)}
                {v.pool === 'SPOT' ? spec('Voyage rate', `$${v.voyageRate}/MT`) : spec('TC hire', `$${v.charterCost.toLocaleString()}/day`)}{spec('Compartments', String(v.compartments.length))}
              </div>
              <div>
                <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Compartment layout</div>
                <div className="space-y-1.5">{v.compartments.map(c => (
                  <div key={c.id} className="flex items-center gap-2"><span className="w-10 text-[11px] font-mono text-foreground/80">{c.id}</span>
                    <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden border border-border/60"><div className="h-full bg-sky-500/50 flex items-center px-2" style={{ width: `${(c.cap / maxCap) * 100}%` }}><span className="text-[10px] font-mono text-foreground/90">{c.cap.toLocaleString()} MT</span></div></div>
                  </div>))}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-muted-foreground mb-1.5">Utilisation in current {stream} plan</div>
                <div className="grid grid-cols-4 gap-2 text-center">{[['Voyages', String(u.voyages)], ['MT carried', u.mt.toLocaleString()], ['Days at work', String(u.days)], ['Cost', fmtM(u.cost)]].map(([l, val]) => (
                  <div key={l} className="bg-background/50 p-2 rounded-lg border border-border/70"><div className="text-[10px] text-muted-foreground">{l}</div><div className="text-sm font-semibold text-foreground mt-0.5">{val}</div></div>))}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
