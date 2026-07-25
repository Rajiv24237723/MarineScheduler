import { EngineInput, InventoryProjection } from './types';

const key = (loc: string, p: string) => `${loc}|${p}`;

interface Node {
  locationId: string; productId: string;
  opening: number; smin: number; smax: number;
  netDaily: number;              // dailyIn - dailyOut
  outageDays: Set<number>;       // days the tank is unavailable (capacity frozen)
}

/**
 * Daily shore-inventory projection per (location, product).
 * Stock(day) = opening + netDaily·day + Σ vessel ops on/before day.
 * Vessel loads are negative deltas (at depart day); discharges positive (at arrive day).
 */
export class InventoryModel {
  private nodes = new Map<string, Node>();
  private deltas = new Map<string, Array<{ day: number; qty: number }>>();
  readonly horizon: number;

  constructor(input: EngineInput) {
    this.horizon = input.horizonDays;
    const flow = new Map<string, { in: number; out: number }>();
    for (const f of input.nodeFlows) flow.set(key(f.locationId, f.productId), { in: f.dailyIn, out: f.dailyOut });
    // Revised demand / production overrides.
    for (const ov of input.options?.flowOverrides ?? []) {
      const k = key(ov.locationId, ov.productId); const cur = flow.get(k) ?? { in: 0, out: 0 };
      flow.set(k, { in: ov.dailyIn ?? cur.in, out: ov.dailyOut ?? cur.out });
    }
    for (const t of input.tanks) {
      const fl = flow.get(key(t.locationId, t.productId)) ?? { in: 0, out: 0 };
      this.nodes.set(key(t.locationId, t.productId), {
        locationId: t.locationId, productId: t.productId,
        opening: t.currentStock, smin: t.minStock, smax: t.capacity,
        netDaily: fl.in - fl.out, outageDays: new Set(),
      });
    }
    // Sudden demand: one-off extra draws.
    for (const ed of input.options?.emergencyDemands ?? []) this.addOp(ed.locationId, ed.productId, ed.day, -ed.qty);
    // Tank outages: mark days unavailable for receipt/dispatch.
    for (const to of input.options?.tankOutages ?? []) {
      const n = this.nodes.get(key(to.locationId, to.productId));
      if (n) for (let d = to.fromDay; d <= to.toDay; d++) n.outageDays.add(d);
    }
  }

  has(loc: string, p: string) { return this.nodes.has(key(loc, p)); }
  node(loc: string, p: string) { return this.nodes.get(key(loc, p)); }

  addOp(loc: string, p: string, day: number, qty: number) {
    const k = key(loc, p);
    if (!this.deltas.has(k)) this.deltas.set(k, []);
    this.deltas.get(k)!.push({ day, qty });
  }

  stockAt(loc: string, p: string, day: number): number {
    const n = this.nodes.get(key(loc, p));
    if (!n) return 0;
    let s = n.opening + n.netDaily * day;
    for (const d of this.deltas.get(key(loc, p)) ?? []) if (d.day <= day) s += d.qty;
    return s;
  }

  /** Loadable surplus above the dry-out floor at a source on a given day. */
  availableAt(loc: string, p: string, day: number): number {
    const n = this.nodes.get(key(loc, p));
    if (!n) return 0;
    return Math.max(0, this.stockAt(loc, p, day) - n.smin);
  }

  /** Headroom below tank-top at a destination on a given day. */
  ullageAt(loc: string, p: string, day: number): number {
    const n = this.nodes.get(key(loc, p));
    if (!n) return 0;
    return Math.max(0, n.smax - this.stockAt(loc, p, day));
  }

  outageOn(loc: string, p: string, day: number): boolean {
    return this.nodes.get(key(loc, p))?.outageDays.has(day) ?? false;
  }

  /** Max qty loadable at `fromDay` without breaching the floor on ANY later day
   *  (robust to out-of-order commits: accounts for all committed future draws). */
  minAvailableFrom(loc: string, p: string, fromDay: number): number {
    const n = this.nodes.get(key(loc, p)); if (!n) return 0;
    let m = Infinity;
    for (let d = Math.max(0, fromDay); d <= this.horizon; d++) m = Math.min(m, this.stockAt(loc, p, d) - n.smin);
    return Math.max(0, m);
  }
  /** Max qty dischargeable at `fromDay` without breaching the ceiling on any later day. */
  minUllageFrom(loc: string, p: string, fromDay: number): number {
    const n = this.nodes.get(key(loc, p)); if (!n) return 0;
    let m = Infinity;
    for (let d = Math.max(0, fromDay); d <= this.horizon; d++) m = Math.min(m, n.smax - this.stockAt(loc, p, d));
    return Math.max(0, m);
  }

  /** First day (1..H) the node breaches its dry-out floor, else null. */
  firstDryOut(loc: string, p: string): number | null {
    for (let d = 0; d <= this.horizon; d++) if (this.stockAt(loc, p, d) < this.nodes.get(key(loc, p))!.smin - 1e-6) return d;
    return null;
  }
  firstTankTop(loc: string, p: string): number | null {
    for (let d = 0; d <= this.horizon; d++) if (this.stockAt(loc, p, d) > this.nodes.get(key(loc, p))!.smax + 1e-6) return d;
    return null;
  }

  projections(products: Map<string, string>, locations: Map<string, string>): InventoryProjection[] {
    const out: InventoryProjection[] = [];
    for (const [k, n] of this.nodes) {
      const series = [];
      for (let d = 0; d <= this.horizon; d++) series.push({ day: d, stock: Math.round(this.stockAt(n.locationId, n.productId, d)) });
      out.push({
        locationId: n.locationId, productId: n.productId,
        locationName: locations.get(n.locationId) ?? n.locationId,
        productName: products.get(n.productId) ?? n.productId,
        smin: n.smin, smax: n.smax, series,
        firstDryOutDay: this.firstDryOut(n.locationId, n.productId),
        firstTankTopDay: this.firstTankTop(n.locationId, n.productId),
      });
    }
    return out;
  }
}
