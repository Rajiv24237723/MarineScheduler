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
  fromProduct: string; toProduct: string; allowed: number;
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

export interface FlowOverride { locationId: string; productId: string; dailyIn?: number; dailyOut?: number; }
export interface EmergencyDemand { locationId: string; productId: string; qty: number; day: number; }
export interface TankOutage { locationId: string; productId: string; fromDay: number; toDay: number; }
export interface PortClosure { locationId: string; fromDay: number; toDay: number; }   // berth shut for a window
export interface VesselDelay { vesselId: string; availFromDay: number; }                // vessel free only from this day

export interface EngineOptions {
  seed?: number;
  alnsIterations?: number;
  excludeVessels?: string[];              // diverted / unavailable vessels
  emergencyDemands?: EmergencyDemand[];   // sudden one-off demand spikes
  tankOutages?: TankOutage[];             // tank unavailable for a day range
  flowOverrides?: FlowOverride[];         // revised daily production/consumption
  portClosures?: PortClosure[];           // berth/port shut for a window (weather, swell, SPM fault, congestion) — ships wait it out
  vesselDelays?: VesselDelay[];           // vessel available only from a later day (laycan slip, off-hire repair, Cape re-route)
  asOfDay?: number;                       // "today" — voyages before this are committed/frozen
  mode?: string;                          // recovery posture (minimal-change | cost-optimal)
  frozenVoyages?: Voyage[];               // committed voyages preserved by a rolling-horizon replan
  // Operational slack (defaults applied in the engine): pad port time, deliver early, turn around.
  portSlack?: number;                     // multiplier on berth+pump+changeover time (default 1.25)
  safetyDays?: number;                    // arrive this many days before dry-out (default 2)
  turnaroundDays?: number;                // buffer between a vessel's voyages (default 1)
}

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
