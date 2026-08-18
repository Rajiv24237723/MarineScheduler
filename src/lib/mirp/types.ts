/** Domain + solve I/O types for the operational MIRP engine (Model B). */

export interface Product { id: string; stream: string; name: string; type: string; color: string; cargoClass: string; density?: number | null; }
export interface Location { id: string; stream: string; name: string; type: string; lat: number; lng: number; }

export interface Compartment { id: string; cap: number; }
export interface Vessel {
  id: string; stream: string; name: string; class: string; dwt: number;
  charterType: string; pool: string;            // OWNED | TC | SPOT
  service: string;                              // CLEAN | BLACK | CRUDE | LNG (must match product cargoClass)
  speed: number; charterCost: number; voyageRate: number;
  availFrom?: string | null; availTo?: string | null;
  draftLaden: number; draftBallast: number;
  compartments: Compartment[];
}

export interface Tank {
  id: string; stream: string; locationId: string; productId: string;
  capacity: number; minStock: number; currentStock: number; name: string;
}
export interface NodeFlow {
  id: string; stream: string; locationId: string; productId: string;
  dailyIn: number; dailyOut: number;
}
export interface PlanLine {
  id: string; stream: string; kind: string;    // DEMAND | SUPPLY
  productId: string; locationId: string; qty: number;
  windowStart: string; windowEnd: string; priority: number;
}
export interface Berth {
  id: string; stream: string; locationId: string; name: string;
  nsim: number; rateMtPerHr: number; berthingHours: number; maxDraft: number;
}
export interface ProductCompat {
  id: string; stream: string; scope: string;   // COMPARTMENT | TANK
  fromProduct: string; toProduct: string; allowed: boolean;
  changeoverHours: number; changeoverCost: number;
}

export interface EngineInput {
  stream: string;
  startDate: string;      // ISO date of day 0
  horizonDays: number;
  products: Product[];
  locations: Location[];
  vessels: Vessel[];
  tanks: Tank[];
  nodeFlows: NodeFlow[];
  berths: Berth[];
  compatibility: ProductCompat[];
  planLines: PlanLine[];
  options?: EngineOptions;
}

/** Revised daily production (in) / consumption (out). Windowed: absent days keep the base rate. */
export interface FlowOverride {
  locationId: string; productId: string;
  dailyIn?: number; dailyOut?: number;
  fromDay?: number; toDay?: number;       // default: whole horizon
}
/** A one-off inventory movement outside the daily rate: extra draw, or an unexpected receipt. */
export interface EmergencyDemand {
  locationId: string; productId: string; qty: number; day: number;
  direction?: 'DRAW' | 'RECEIPT';         // default DRAW
}
export interface TankOutage { locationId: string; productId: string; fromDay: number; toDay: number; }
/**
 * Port or berth unavailable / degraded for a window.
 * - no berthId, no capacityPct → whole port shut; ships wait at anchorage
 * - berthId, no capacityPct    → that berth down; the port runs on what's left
 * - capacityPct                → open but degraded (reduced pumping rate)
 */
export interface PortClosure {
  locationId: string; berthId?: string | null;
  fromDay: number; toDay: number;
  capacityPct?: number | null;            // 1..99 = degraded throughput
  reason?: string | null;
}
/** Vessel free only from this day (laycan slip, repair, Cape re-route). */
export interface VesselDelay { vesselId: string; availFromDay: number; reason?: string | null; }
/** Vessel unavailable across a window (drydock, off-hire, survey) — not just from a day. */
export interface VesselOutage { vesselId: string; fromDay: number; toDay: number; reason?: string | null; }

export interface EngineOptions {
  seed?: number;
  alnsIterations?: number;
  excludeVessels?: string[];              // out for the whole horizon (diverted / unavailable)
  vesselOutages?: VesselOutage[];         // out for a window (drydock, off-hire)
  emergencyDemands?: EmergencyDemand[];   // one-off draws / receipts
  tankOutages?: TankOutage[];             // tank unavailable for a day range
  flowOverrides?: FlowOverride[];         // revised daily production/consumption
  portClosures?: PortClosure[];           // port/berth shut or degraded for a window
  vesselDelays?: VesselDelay[];           // vessel available only from a later day
  asOfDay?: number;                       // "today" — voyages before this are committed/frozen
  mode?: string;                          // recovery posture (minimal-change | cost-optimal)
  frozenVoyages?: Voyage[];               // committed voyages preserved by a rolling-horizon replan
  // Operational slack (defaults applied in the engine): pad port time, deliver early, turn around.
  portSlack?: number;                     // multiplier on berth+pump+changeover time (default 1.25)
  safetyDays?: number;                    // arrive this many days before dry-out (default 2)
  turnaroundDays?: number;                // buffer between a vessel's voyages (default 1)
}

// --- Scenario events -------------------------------------------------------
// What the planner composes. A scenario is an ordered LIST of events, any number
// of any type; the server compiles it down to EngineOptions (see compileEvents).
// Keeping events as the authored form — rather than pre-folded options — is what
// lets a scenario be listed, edited, named and re-run.

export type ScenarioEventType =
  | 'DEMAND_REVISION' | 'SPOT_CARGO' | 'TANK_OUTAGE'
  | 'PORT_CLOSURE' | 'VESSEL_DELAY' | 'VESSEL_OUTAGE';

interface EventBase { id: string; type: ScenarioEventType; note?: string | null }

/** Revised offtake or production at a node. Entered absolute, as a delta, or as a percentage. */
export interface DemandRevisionEvent extends EventBase {
  type: 'DEMAND_REVISION';
  locationId: string; productId: string;
  side: 'OUT' | 'IN';                     // OUT = offtake/lifting, IN = production/receipt
  basis: 'ABS' | 'DELTA' | 'PCT';
  value: number;                          // MT/day for ABS & DELTA, percent for PCT
  fromDay?: number | null; toDay?: number | null;
}
export interface SpotCargoEvent extends EventBase {
  type: 'SPOT_CARGO';
  locationId: string; productId: string;
  qty: number; day: number;
  direction: 'DRAW' | 'RECEIPT';
}
export interface TankOutageEvent extends EventBase {
  type: 'TANK_OUTAGE';
  locationId: string; productId: string; fromDay: number; toDay: number;
}
export interface PortClosureEvent extends EventBase {
  type: 'PORT_CLOSURE';
  locationId: string; berthId?: string | null;
  fromDay: number; toDay: number;
  capacityPct?: number | null;            // null/absent = fully shut
}
export interface VesselDelayEvent extends EventBase {
  type: 'VESSEL_DELAY';
  vesselId: string;
  basis: 'ABS' | 'SLIP';                  // ABS = ready on this day, SLIP = n days later than planned
  value: number;
}
export interface VesselOutageEvent extends EventBase {
  type: 'VESSEL_OUTAGE';
  vesselId: string;
  fromDay?: number | null; toDay?: number | null;  // both absent = out for the whole horizon
}

export type ScenarioEvent =
  | DemandRevisionEvent | SpotCargoEvent | TankOutageEvent
  | PortClosureEvent | VesselDelayEvent | VesselOutageEvent;

// --- Solve outputs ---------------------------------------------------------

export interface Op { op: 'LOAD' | 'DISCHARGE'; productId: string; qty: number; compartmentId: string; }
export interface Stop {
  seq: number; locationId: string; arriveDay: number; departDay: number;
  kind: 'LOAD' | 'DISCHARGE' | 'LOAD_DISCHARGE'; ops: Op[];
}
export interface Leg { fromLoc: string; toLoc: string; departDay: number; arriveDay: number; ballast: boolean; distanceNm: number; }
export interface CostBreakdown { bunker: number; freight: number; portDA: number; demurrage: number; changeover: number; }
export interface Voyage {
  id: string; stream: string;
  vesselId: string | null; vesselName: string; vesselClass: string; pool: string;
  startDay: number; endDay: number;
  stops: Stop[]; legs: Leg[];
  cost: number; costBreakdown: CostBreakdown;
}

export interface CharterRecommendation {
  voyageId: string; vesselClass: string; reason: string; estCost: number;
  fromLoc: string | null; toLoc: string; productId: string; qty: number; byDay: number;
}

export interface DayStock { day: number; stock: number; }
export interface InventoryProjection {
  locationId: string; productId: string; locationName: string; productName: string;
  smin: number; smax: number;
  series: DayStock[];
  firstDryOutDay: number | null;   // in the FINAL (post-schedule) projection; null if none
  firstTankTopDay: number | null;
}

export interface Dual { constraint: string; shadowPrice: number; }

/** Monte-Carlo stress test of the committed plan against sampled port/transit delays. */
export interface Resilience {
  iterations: number;
  resilientPct: number;       // 100 − stockout probability
  stockoutProbPct: number;    // % of simulated runs where any node breaches its floor
  expectedShortfallMt: number;
  p90ShortfallMt: number;
  meanSlipDays: number;       // mean of the worst voyage slip per run
  p90SlipDays: number;
  worstNodes: { locationId: string; productId: string; name: string; failPct: number }[];
}

export interface Kpis {
  totalCost: number; demurrage: number; utilizationPct: number;
  dryOutDays: number; tankTopDays: number;
  voyageCount: number; charterRecommendationCount: number;
  demandServedPct: number;
  /** Plan cost attributed by category — lets variance be explained, not just measured. */
  costBreakdown?: CostBreakdown;
  /** Total MT discharged across the plan; the volume denominator for ₹/MT. */
  liftedMt?: number;
  resilience?: Resilience;
}

export interface Unserved {
  locationId: string; productId: string; day: number; shortfallMt: number; reason: string;
}

/** Resource gap when a plan can't fully serve demand — the "what would close it" summary. */
export interface ShortfallSummary {
  totalMt: number;
  nodes: number;
  earliestFeasibleDay: number | null;   // soonest a lift dispatched day 0 could physically arrive
  addlVesselVoyages: number;             // approx extra voyages needed to close the gap
  addlBerthHours: number;                // approx extra berth time those lifts require
}

export interface SolveResult {
  stream: string;
  achievable: boolean;
  status: 'success' | 'infeasible';
  voyages: Voyage[];
  charterRecommendations: CharterRecommendation[];
  projection: InventoryProjection[];
  duals: Dual[];
  kpis: Kpis;
  unserved: Unserved[];
  shortfall?: ShortfallSummary;
  validation: { ok: boolean; breaches: string[] };
  message: string;
}
