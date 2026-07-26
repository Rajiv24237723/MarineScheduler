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

export interface EngineOptions {
  seed?: number;
  alnsIterations?: number;
  excludeVessels?: string[];              // diverted / unavailable vessels
  emergencyDemands?: EmergencyDemand[];   // sudden one-off demand spikes
  tankOutages?: TankOutage[];             // tank unavailable for a day range
  flowOverrides?: FlowOverride[];         // revised daily production/consumption
  asOfDay?: number;                       // "today" — voyages before this are committed/frozen
  mode?: string;                          // recovery posture (minimal-change | cost-optimal)
  frozenVoyages?: Voyage[];               // committed voyages preserved by a rolling-horizon replan
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

export interface Kpis {
  totalCost: number; demurrage: number; utilizationPct: number;
  dryOutDays: number; tankTopDays: number;
  voyageCount: number; charterRecommendationCount: number;
  demandServedPct: number;
}

export interface Unserved {
  locationId: string; productId: string; day: number; shortfallMt: number; reason: string;
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
  validation: { ok: boolean; breaches: string[] };
  message: string;
}
