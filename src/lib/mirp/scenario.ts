import {
  EngineOptions, NodeFlow, ScenarioEvent, Vessel, Voyage,
  FlowOverride, EmergencyDemand, TankOutage, PortClosure, VesselDelay, VesselOutage,
} from './types';

/**
 * Compile an authored scenario (a list of events, any number of any type) into
 * EngineOptions.
 *
 * Every option the engine reads is a plural array, so N events of the same type
 * compose naturally. Where two events target the same thing the rule is stated
 * rather than left to whichever happened to be applied last:
 *
 *  - DEMAND_REVISION  overlapping windows on one node → later event wins for the
 *                     overlapping days (InventoryModel applies overrides in order)
 *  - VESSEL_DELAY     same hull twice → the latest readiness day binds
 *  - VESSEL_OUTAGE    windows accumulate; a full-horizon one collapses to exclude
 *  - PORT_CLOSURE     windows accumulate; the tightest capacity on a day applies
 *  - TANK_OUTAGE      windows accumulate (union of days)
 *  - SPOT_CARGO       always additive
 *
 * Anything unresolvable is returned in `warnings` instead of being dropped
 * silently.
 */
export interface CompileContext {
  horizonDays: number;
  nodeFlows: Pick<NodeFlow, 'locationId' | 'productId' | 'dailyIn' | 'dailyOut'>[];
  vessels: Pick<Vessel, 'id' | 'name'>[];
  /** Planned voyages — resolve a slip-based delay, and spot events that clash with a sailing hull. */
  baseVoyages?: Pick<Voyage, 'vesselId' | 'startDay' | 'endDay'>[];
  /** "Today". A voyage that began before this is underway and cannot be recalled. */
  asOfDay?: number;
}

export interface CompileResult {
  options: EngineOptions;
  warnings: string[];
  /** One short human line per event, in order — drives the scenario summary. */
  summary: string[];
}

const clampDay = (d: number, H: number) => Math.max(0, Math.min(H, Math.round(d)));

export function compileEvents(events: ScenarioEvent[], ctx: CompileContext): CompileResult {
  const H = ctx.horizonDays;
  const warnings: string[] = [];
  const summary: string[] = [];

  const flowOverrides: FlowOverride[] = [];
  const emergencyDemands: EmergencyDemand[] = [];
  const tankOutages: TankOutage[] = [];
  const portClosures: PortClosure[] = [];
  const vesselOutages: VesselOutage[] = [];
  const excludeVessels: string[] = [];
  const delayByVessel = new Map<string, number>();

  const baseFlow = new Map(ctx.nodeFlows.map(f => [`${f.locationId}|${f.productId}`, f]));
  const vesselName = new Map(ctx.vessels.map(v => [v.id, v.name]));
  const asOf = Math.max(0, ctx.asOfDay ?? 0);
  // Earliest planned departure per hull — the reference a slip is measured from.
  const firstStart = new Map<string, number>();
  // Hulls already at sea at the as-of day: an availability event on one of these
  // cannot recall the ship, so it is reported rather than quietly half-applied.
  const sailing = new Map<string, { startDay: number; endDay: number }>();
  for (const v of ctx.baseVoyages ?? []) {
    if (!v.vesselId) continue;
    const cur = firstStart.get(v.vesselId);
    if (cur == null || v.startDay < cur) firstStart.set(v.vesselId, v.startDay);
    if (v.startDay < asOf && v.endDay >= asOf) sailing.set(v.vesselId, { startDay: v.startDay, endDay: v.endDay });
  }
  const noteIfSailing = (vesselId: string, what: string) => {
    const s = sailing.get(vesselId);
    if (s) warnings.push(`${vesselName.get(vesselId) ?? vesselId} is already at sea (days ${s.startDay}–${s.endDay}) at the as-of day, so the ${what} only binds from its next voyage.`);
  };

  /** Normalise a day range, tolerating inverted input rather than no-op'ing on it. */
  const range = (from: number | null | undefined, to: number | null | undefined, label: string) => {
    let a = clampDay(from ?? 0, H), b = clampDay(to ?? H, H);
    if (b < a) { warnings.push(`${label}: day range ${a}–${b} was inverted; read as ${b}–${a}.`); [a, b] = [b, a]; }
    return { from: a, to: b };
  };

  for (const e of events) {
    switch (e.type) {
      case 'DEMAND_REVISION': {
        const k = `${e.locationId}|${e.productId}`;
        const base = baseFlow.get(k);
        if (!base) { warnings.push(`Demand revision skipped: no flow record for ${k}.`); break; }
        const cur = e.side === 'IN' ? base.dailyIn : base.dailyOut;
        let next = e.basis === 'ABS' ? e.value
          : e.basis === 'DELTA' ? cur + e.value
            : cur * (1 + e.value / 100);
        if (next < 0) { warnings.push(`Demand revision at ${k} computed ${Math.round(next)}/d; floored at 0.`); next = 0; }
        const r = range(e.fromDay, e.toDay, 'Demand revision');
        flowOverrides.push({
          locationId: e.locationId, productId: e.productId,
          ...(e.side === 'IN' ? { dailyIn: Math.round(next) } : { dailyOut: Math.round(next) }),
          fromDay: r.from, toDay: r.to,
        });
        const verb = e.side === 'IN' ? 'Production' : 'Offtake';
        summary.push(`${verb} ${Math.round(cur)}→${Math.round(next)}/d, days ${r.from}–${r.to}`);
        break;
      }
      case 'SPOT_CARGO': {
        const day = clampDay(e.day, H);
        emergencyDemands.push({
          locationId: e.locationId, productId: e.productId,
          qty: Math.abs(e.qty), day, direction: e.direction,
        });
        summary.push(`${e.direction === 'RECEIPT' ? 'Receipt' : 'Extra draw'} ${Math.abs(e.qty).toLocaleString()} MT on day ${day}`);
        break;
      }
      case 'TANK_OUTAGE': {
        const r = range(e.fromDay, e.toDay, 'Tank outage');
        tankOutages.push({ locationId: e.locationId, productId: e.productId, fromDay: r.from, toDay: r.to });
        summary.push(`Tank out of service days ${r.from}–${r.to}`);
        break;
      }
      case 'PORT_CLOSURE': {
        const r = range(e.fromDay, e.toDay, 'Port closure');
        const pct = e.capacityPct == null ? null : Math.max(1, Math.min(99, Math.round(e.capacityPct)));
        portClosures.push({ locationId: e.locationId, berthId: e.berthId ?? null, fromDay: r.from, toDay: r.to, capacityPct: pct, reason: e.note ?? null });
        summary.push(pct == null
          ? `${e.berthId ? 'Berth' : 'Port'} shut days ${r.from}–${r.to}`
          : `${e.berthId ? 'Berth' : 'Port'} at ${pct}% throughput, days ${r.from}–${r.to}`);
        break;
      }
      case 'VESSEL_DELAY': {
        const planned = firstStart.get(e.vesselId);
        if (e.basis === 'SLIP' && planned == null)
          warnings.push(`${vesselName.get(e.vesselId) ?? e.vesselId}: no planned voyage to slip from; ${e.value}-day slip read from day 0.`);
        const readyDay = clampDay(e.basis === 'SLIP' ? (planned ?? 0) + e.value : e.value, H);
        const prev = delayByVessel.get(e.vesselId);
        if (prev != null) {
          // Two delays on one hull: the later readiness binds. Only worth saying so
          // when they actually disagree.
          if (prev !== readyDay) warnings.push(`${vesselName.get(e.vesselId) ?? e.vesselId} has delays to day ${prev} and day ${readyDay}; the later one binds.`);
          delayByVessel.set(e.vesselId, Math.max(prev, readyDay));
        } else delayByVessel.set(e.vesselId, readyDay);
        noteIfSailing(e.vesselId, 'delay');
        summary.push(`${vesselName.get(e.vesselId) ?? 'Vessel'} ready from day ${readyDay}${e.basis === 'SLIP' ? ` (+${e.value}d slip)` : ''}`);
        break;
      }
      case 'VESSEL_OUTAGE': {
        noteIfSailing(e.vesselId, 'off-hire window');
        const whole = e.fromDay == null && e.toDay == null;
        if (whole) {
          excludeVessels.push(e.vesselId);
          summary.push(`${vesselName.get(e.vesselId) ?? 'Vessel'} unavailable all month`);
        } else {
          const r = range(e.fromDay, e.toDay, 'Vessel outage');
          if (r.from <= 0 && r.to >= H) {
            excludeVessels.push(e.vesselId);
            summary.push(`${vesselName.get(e.vesselId) ?? 'Vessel'} unavailable all month`);
          } else {
            vesselOutages.push({ vesselId: e.vesselId, fromDay: r.from, toDay: r.to, reason: e.note ?? null });
            summary.push(`${vesselName.get(e.vesselId) ?? 'Vessel'} off-hire days ${r.from}–${r.to}`);
          }
        }
        break;
      }
    }
  }

  const vesselDelays: VesselDelay[] = [...delayByVessel].map(([vesselId, availFromDay]) => ({ vesselId, availFromDay }));
  // A hull excluded outright makes any delay or window on it moot.
  const gone = new Set(excludeVessels);

  const options: EngineOptions = {};
  if (flowOverrides.length) options.flowOverrides = flowOverrides;
  if (emergencyDemands.length) options.emergencyDemands = emergencyDemands;
  if (tankOutages.length) options.tankOutages = tankOutages;
  if (portClosures.length) options.portClosures = portClosures;
  if (excludeVessels.length) options.excludeVessels = [...gone];
  const outs = vesselOutages.filter(o => !gone.has(o.vesselId));
  if (outs.length) options.vesselOutages = outs;
  const dels = vesselDelays.filter(d => !gone.has(d.vesselId));
  if (dels.length) options.vesselDelays = dels;

  // Two events on one hull can raise the same context note twice.
  return { options, warnings: [...new Set(warnings)], summary };
}

/** Count of events per type — used for the composer's grouped list and badges. */
export function countByType(events: ScenarioEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}
