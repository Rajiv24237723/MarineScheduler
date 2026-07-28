import { EngineInput, Voyage, Resilience } from './types';
import { rng } from './distance';

/**
 * Monte-Carlo stress test: replay the committed plan against sampled port/transit delays
 * and measure how often a node still runs dry. Answers the planner's real worry — "will
 * this 30-day plan survive real-world variance, or fall apart after the first leg?" — and
 * lets us check whether the built-in slack actually earns its keep. Delay magnitudes are
 * illustrative and late-skewed (things run late more than early).
 */
export function assessResilience(input: EngineInput, voyages: Voyage[], iterations = 160): Resilience {
  const H = input.horizonDays;
  const locName = new Map(input.locations.map(l => [l.id, l.name]));
  const prodName = new Map(input.products.map(p => [p.id, p.name]));

  // Demand (consumer) nodes: floor + exogenous baseline stock(day) = opening + net·day.
  const flow = new Map<string, { in: number; out: number }>();
  for (const f of input.nodeFlows) flow.set(`${f.locationId}|${f.productId}`, { in: f.dailyIn, out: f.dailyOut });
  interface Node { key: string; loc: string; prod: string; smin: number; opening: number; net: number; }
  const nodes: Node[] = [];
  for (const t of input.tanks) {
    const fl = flow.get(`${t.locationId}|${t.productId}`) ?? { in: 0, out: 0 };
    const net = fl.in - fl.out;
    const isConsumer = net < 0 || input.planLines.some(pl => pl.kind === 'DEMAND' && pl.locationId === t.locationId && pl.productId === t.productId);
    if (isConsumer) nodes.push({ key: `${t.locationId}|${t.productId}`, loc: t.locationId, prod: t.productId, smin: t.minStock, opening: t.currentStock, net });
  }

  // Incoming discharge events per node, each tagged with its voyage and how far into that
  // voyage it falls (later stops inherit more of a slipping voyage's delay).
  interface Ev { day: number; qty: number; frac: number; voy: number; }
  const evByNode = new Map<string, Ev[]>();
  voyages.forEach((v, vi) => {
    const span = Math.max(1, v.endDay - v.startDay);
    for (const s of v.stops) for (const o of s.ops) if (o.op === 'DISCHARGE') {
      const key = `${s.locationId}|${o.productId}`;
      if (!nodes.some(n => n.key === key)) continue;
      if (!evByNode.has(key)) evByNode.set(key, []);
      evByNode.get(key)!.push({ day: s.arriveDay, qty: o.qty, frac: Math.min(1, Math.max(0, (s.arriveDay - v.startDay) / span)), voy: vi });
    }
  });

  const seedBase = ((input.options?.seed ?? 20260724) ^ 0x9e3779b9) >>> 0;
  // Per-voyage slip (days), late-skewed and floored at 0. Magnitude grows modestly with
  // voyage length — a long Gulf haul slips more than a one-day coastal hop — and is
  // calibrated to real coastal-India variance (port congestion, monsoon), not worst case.
  const sampleDelay = (r: () => number, base: number) => {
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
    return Math.max(0, (0.35 + 0.05 * base) + (0.6 + 0.07 * base) * z);
  };

  const shortfalls: number[] = [], slipSamples: number[] = [], failRates: number[] = [];
  const nodeFail = new Map<string, number>();

  for (let it = 0; it < iterations; it++) {
    const r = rng((seedBase + it * 2654435761) >>> 0);
    const voySlip = voyages.map(v => { const d = sampleDelay(r, Math.max(1, v.endDay - v.startDay)); slipSamples.push(d); return d; });

    let runShort = 0, breached = 0;
    for (const n of nodes) {
      const evs = (evByNode.get(n.key) ?? []).map(e => ({ day: Math.min(H, Math.round(e.day + voySlip[e.voy] * e.frac)), qty: e.qty })).sort((a, b) => a.day - b.day);
      let minStock = Infinity, ei = 0, cum = 0;
      for (let d = 0; d <= H; d++) {
        while (ei < evs.length && evs[ei].day <= d) { cum += evs[ei].qty; ei++; }
        const s = n.opening + n.net * d + cum;
        if (s < minStock) minStock = s;
      }
      if (minStock < n.smin - 1e-6) { breached++; runShort += (n.smin - minStock); nodeFail.set(n.key, (nodeFail.get(n.key) ?? 0) + 1); }
    }
    failRates.push(nodes.length ? breached / nodes.length : 0);
    shortfalls.push(runShort);
  }

  const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * a.length))]; };
  // Node-level exposure: expected share of demand nodes that breach their floor under sampled
  // delays. Smooth and calibratable, unlike "any node breaches" which saturates for big plans.
  const stockoutProbPct = Math.round(mean(failRates) * 1000) / 10;
  const worstNodes = [...nodeFail.entries()]
    .map(([key, c]) => { const [loc, prod] = key.split('|'); return { locationId: loc, productId: prod, name: `${locName.get(loc) ?? loc} · ${prodName.get(prod) ?? prod}`, failPct: Math.round((c / iterations) * 1000) / 10 }; })
    .sort((a, b) => b.failPct - a.failPct).slice(0, 4);

  return {
    iterations,
    resilientPct: Math.round((100 - stockoutProbPct) * 10) / 10,
    stockoutProbPct,
    expectedShortfallMt: Math.round(mean(shortfalls)),
    p90ShortfallMt: Math.round(pct(shortfalls, 0.9)),
    meanSlipDays: Math.round(mean(slipSamples) * 10) / 10,
    p90SlipDays: Math.round(pct(slipSamples, 0.9) * 10) / 10,
    worstNodes,
  };
}
