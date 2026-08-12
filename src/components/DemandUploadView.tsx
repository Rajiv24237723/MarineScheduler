import { useState } from 'react';
import * as XLSX from 'xlsx';
import { DashboardData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from './ui/toast';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Trash2 } from 'lucide-react';

interface Row {
  source: string; destination: string; product: string; monthly: number; priority: number;
  srcId?: string; destId?: string; prodId?: string; ok: boolean; issue?: string;
}

// Loosely match a spreadsheet header to a field regardless of exact wording.
const pick = (keys: string[], re: RegExp) => keys.find(k => re.test(k.toLowerCase().trim()));

export default function DemandUploadView({ data, stream, refresh }: { data: DashboardData; stream: string; refresh: () => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const locName = (id?: string) => data.locations.find(l => l.id === id)?.name ?? '';
  const matchLoc = (name: string) => {
    const n = name.trim().toLowerCase(); if (!n) return undefined;
    return (data.locations.find(l => l.name.toLowerCase() === n)
      ?? data.locations.find(l => l.name.toLowerCase().includes(n) || n.includes(l.name.toLowerCase())))?.id;
  };
  const matchProd = (name: string) => {
    const n = name.trim().toLowerCase(); if (!n) return undefined;
    return (data.products.find(p => p.name.toLowerCase() === n)
      ?? data.products.find(p => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())))?.id;
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setFileName(f.name);
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const json: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!json.length) { toast('No rows found in the first sheet.', 'error'); return; }
      const keys = Object.keys(json[0]);
      const kSrc = pick(keys, /source|origin|from|refinery/);
      const kDst = pick(keys, /destination|dest|terminal|deliver|^to$/);
      const kProd = pick(keys, /product|grade|sku/);
      const kQty = pick(keys, /month|volume|qty|quantity|demand|tonne|\bmt\b/);
      const kPrio = pick(keys, /priorit|prio/);
      const parsed: Row[] = json.map(r => {
        const source = String(kSrc ? r[kSrc] : '').trim();
        const destination = String(kDst ? r[kDst] : '').trim();
        const product = String(kProd ? r[kProd] : '').trim();
        const monthly = Number(String(kQty ? r[kQty] : '').replace(/[,\s]/g, '')) || 0;
        const priority = Number(kPrio ? r[kPrio] : 1) || 1;
        const destId = matchLoc(destination); const prodId = matchProd(product); const srcId = matchLoc(source);
        const issues: string[] = [];
        if (!destId) issues.push('destination');
        if (!prodId) issues.push('product');
        if (!(monthly > 0)) issues.push('quantity');
        return { source, destination, product, monthly, priority, srcId, destId, prodId, ok: issues.length === 0, issue: issues.join(', ') };
      });
      setRows(parsed);
      toast(`Parsed ${parsed.length} movement(s) from ${f.name}.`, 'success');
    } catch (e) { console.error(e); toast('Could not read that file — expected .xlsx or .csv.', 'error'); }
  };

  const okRows = rows.filter(r => r.ok);
  const totalMt = okRows.reduce((s, r) => s + r.monthly, 0);
  const dests = new Set(okRows.map(r => r.destId)).size;
  const unmatched = rows.length - okRows.length;

  const loadForReview = async () => {
    if (!okRows.length) return;
    setBusy(true);
    try {
      const p = data.period;
      const planRows = okRows.map(r => ({ stream, periodId: p?.id ?? null, kind: 'DEMAND', productId: r.prodId, locationId: r.destId, qty: r.monthly, windowStart: p?.startDate ?? '', windowEnd: p?.endDate ?? '', priority: r.priority }));
      await fetch(`/api/master/planLines/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: planRows, replaceStream: stream }) });
      await refresh();
      toast(`Loaded ${planRows.length} movement(s) as the ${stream} ${p?.label ?? ''} plan (review). Open Operational Plan → Run optimiser to generate voyages.`, 'success');
    } catch (e) { console.error(e); toast('Load failed.', 'error'); }
    setBusy(false);
  };

  const kt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-2xl font-medium text-foreground">Monthly movement plan — {stream}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Upload the month's source → destination movements. Loaded for review only — the operating plan is untouched until you run the optimiser.</p>
        </div>
        <label className="flex items-center gap-2 px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-medium cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> Upload Excel / CSV
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
        </label>
      </div>

      {rows.length === 0 ? (
        <Card className="bg-card/50 border-dashed border-border/80 rounded-md">
          <CardContent className="p-10 text-center">
            <FileSpreadsheet className="w-8 h-8 text-cyan-400/70 mx-auto mb-3" />
            <div className="text-sm text-foreground/80">Drop in a monthly movement workbook</div>
            <div className="text-[11px] text-muted-foreground mt-2 max-w-md mx-auto">
              One row per lane. Columns (any order, header names matched loosely):
              <span className="block mt-1 font-mono text-foreground/70">Source · Destination · Product · Monthly (MT) · Priority</span>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border/40 rounded-md border border-border/70 overflow-hidden">
            {[
              ['Lanes', String(rows.length), ''],
              ['Total volume', `${kt(totalMt)} MT`, 'text-foreground'],
              ['Destinations', String(dests), ''],
              ['Unmatched', String(unmatched), unmatched > 0 ? 'text-warn' : 'text-ok'],
            ].map(([l, v, tone]) => (
              <div key={l} className="bg-card px-3.5 py-3">
                <div className="font-cond text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{l}</div>
                <div className={`text-2xl font-serif mt-1 tabular-nums ${tone || 'text-foreground'}`}>{v}</div>
              </div>
            ))}
          </div>

          {unmatched > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-warn/10 border border-warn/25 text-warn text-xs">
              <AlertTriangle className="w-4 h-4" /> {unmatched} row(s) couldn't be matched to the {stream} network and will be skipped — check the highlighted names.
            </div>
          )}

          <Card className="bg-card/50 border-border/80 rounded-md overflow-hidden">
            <CardHeader className="py-2.5 px-4 border-b border-border/60 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground/80 flex items-center gap-2"><FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" /> {fileName}</CardTitle>
              <button onClick={() => { setRows([]); setFileName(''); }} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"><Trash2 className="w-3 h-3" /> Clear</button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[46vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95 text-muted-foreground border-b border-border/60">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Destination</th>
                      <th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 font-medium text-right">Monthly (MT)</th>
                      <th className="px-3 py-2 font-medium text-center">Prio</th><th className="px-3 py-2 font-medium text-center">Match</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {rows.map((r, i) => (
                      <tr key={i} className={r.ok ? 'hover:bg-muted/20' : 'bg-warn/5'}>
                        <td className="px-3 py-1.5 text-foreground/80">{r.srcId ? locName(r.srcId) : <span className="text-muted-foreground">{r.source || '—'}</span>}</td>
                        <td className={`px-3 py-1.5 ${r.destId ? 'text-foreground/90' : 'text-warn'}`}>{r.destId ? locName(r.destId) : (r.destination || '—')}</td>
                        <td className={`px-3 py-1.5 ${r.prodId ? 'text-foreground/80' : 'text-warn'}`}>{r.product || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground/90">{r.monthly ? r.monthly.toLocaleString() : <span className="text-warn">0</span>}</td>
                        <td className="px-3 py-1.5 text-center text-muted-foreground">{r.priority}</td>
                        <td className="px-3 py-1.5 text-center">{r.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-ok inline" /> : <span className="text-[10px] text-warn">{r.issue}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <button disabled={busy || !okRows.length} onClick={loadForReview} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-xs font-medium disabled:opacity-50">
              {busy ? 'Loading…' : `Load ${okRows.length} movement(s) into the ${stream} plan`}
            </button>
            <span className="text-[11px] text-muted-foreground">Review only — persists as the monthly plan; generate voyages from Operational Plan.</span>
          </div>
        </>
      )}
    </div>
  );
}
