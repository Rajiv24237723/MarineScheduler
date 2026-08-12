// Frontend types mirroring the /api/dashboard + /api/optimize payloads.

export interface Product {
  id: string; stream: string; name: string; type: string; color: string; cargoClass: string;
  density?: number | null; flashPoint?: number | null; pourPoint?: number | null;
  sulphur?: string | null; rating?: string | null; parcelMin?: number | null; parcelMax?: number | null;
}
export interface Location { id: string; stream: string; name: string; type: string; lat: number; lng: number; }
export interface Vessel {
  id: string; stream: string; name: string; class: string; dwt: number;
  charterType: string; pool: string; service: string; speed: number; charterCost: number; voyageRate: number;
  draftLaden: number; draftBallast: number; compartments: { id: string; cap: number }[];
}
export interface Tank {
  id: string; stream: string; locationId: string; productId: string;
  capacity: number; minStock: number; currentStock: number; name: string;
}
export interface NodeFlow { id: string; stream: string; locationId: string; productId: string; dailyIn: number; dailyOut: number; }
export interface PlanLine { id: string; stream: string; periodId?: string | null; kind: string; productId: string; locationId: string; qty: number; windowStart: string; windowEnd: string; priority: number; }
export interface Berth { id: string; stream: string; locationId: string; name: string; nsim: number; rateMtPerHr: number; berthingHours: number; maxDraft: number; }
export interface ProductCompat { id: string; stream: string; scope: string; fromProduct: string; toProduct: string; allowed: number; changeoverHours: number; changeoverCost: number; }

export interface Op { op: 'LOAD' | 'DISCHARGE'; productId: string; qty: number; compartmentId: string; }
export interface Stop { seq: number; locationId: string; arriveDay: number; departDay: number; kind: string; ops: Op[]; }
export interface Leg { fromLoc: string; toLoc: string; departDay: number; arriveDay: number; ballast: boolean; distanceNm: number; }
export interface CostBreakdown { bunker: number; freight: number; portDA: number; demurrage: number; changeover: number; }
export interface Voyage {
  id: string; stream: string; vesselId: string | null; vesselName: string; vesselClass: string; pool: string;
  startDay: number; endDay: number; stops: Stop[]; legs: Leg[]; cost: number; costBreakdown: CostBreakdown;
}
export interface CharterRecommendation { voyageId: string; vesselClass: string; reason: string; estCost: number; fromLoc: string | null; toLoc: string; productId: string; qty: number; byDay: number; }
export interface DayStock { day: number; stock: number; }
export interface InventoryProjection {
  locationId: string; productId: string; locationName: string; productName: string;
  smin: number; smax: number; series: DayStock[]; firstDryOutDay: number | null; firstTankTopDay: number | null;
}
export interface Dual { constraint: string; shadowPrice: number; }
export interface Resilience {
  iterations: number;
  resilientPct: number;
  stockoutProbPct: number;
  expectedShortfallMt: number;
  p90ShortfallMt: number;
  meanSlipDays: number;
  p90SlipDays: number;
  worstNodes: { locationId: string; productId: string; name: string; failPct: number }[];
}
export interface Kpis {
  totalCost: number; demurrage: number; utilizationPct: number; dryOutDays: number; tankTopDays: number;
  voyageCount: number; charterRecommendationCount: number; demandServedPct: number;
  /** Cost attributed by category, so variance can be explained not just measured. */
  costBreakdown?: CostBreakdown;
  /** Total MT discharged across the plan — the volume denominator for ₹/MT. */
  liftedMt?: number;
  resilience?: Resilience;
}
export interface Unserved { locationId: string; productId: string; day: number; shortfallMt: number; reason: string; }
export interface VersionSummary {
  id: string; version: number; status: string; trigger: string; objectiveCost: number;
  achievable: number; createdAt: string; periodId?: string | null; isBaseline?: number; kpi?: Kpis | null;
}

// --- Periods, actuals, performance -----------------------------------------

export interface PlanPeriod {
  id: string; stream: string; code: string; label: string;
  startDate: string; endDate: string; horizonDays: number;
  status: 'Open' | 'Closed' | string; createdAt: string;
}
export interface Actual {
  id: string; stream: string; periodId: string; versionId: string | null; planVoyageId: string | null;
  vesselName: string; vesselClass: string; pool: string;
  fromLocationId: string | null; toLocationId: string | null; productId: string | null;
  qtyMt: number; startDay: number; endDay: number; cost: number;
  costBreakdown: CostBreakdown | null;
  status: string; source: string; note: string | null; createdAt: string;
}
/** One cost line compared three ways. */
export interface VarianceLine {
  key: string; label: string;
  baseline: number; plan: number; actual: number;
  varVsBaseline: number; varVsPlan: number; varPctVsBaseline: number | null;
}
export interface PerformanceRef { versionId: string; version: number; status: string; trigger: string; kpi: Kpis | null; }
export interface VoyageMatch {
  planVoyageId: string | null; vesselName: string; pool: string;
  planCost: number | null; actualCost: number | null; variance: number | null;
  planQtyMt: number | null; actualQtyMt: number | null;
  state: 'matched' | 'unplanned' | 'not-executed'; status: string | null;
}
export interface PerformanceReport {
  period: PlanPeriod | null;
  baseline: PerformanceRef | null;
  current: PerformanceRef | null;
  actual: {
    totalCost: number; costBreakdown: CostBreakdown; liftedMt: number;
    voyageCount: number; spotVoyageCount: number; cancelledCount: number; unplannedCount: number;
    recordCount: number; coveragePct: number;
  };
  lines: VarianceLine[];
  volume: { baselineMt: number; planMt: number; actualMt: number; varVsPlanMt: number };
  unitCost: { baseline: number | null; plan: number | null; actual: number | null };
  service: { baselineServedPct: number | null; planServedPct: number | null; deliveredPct: number | null };
  voyageMatches: VoyageMatch[];
}
export interface TrendPoint {
  periodId: string; code: string; label: string; status: string;
  baselineCost: number | null; planCost: number | null; actualCost: number | null;
  baselineMt: number | null; planMt: number | null; actualMt: number | null;
  actualUnitCost: number | null; planUnitCost: number | null;
  servedPct: number | null; versionCount: number; hasActuals: boolean;
}

export interface DashboardData {
  stream: string;
  vessels: Vessel[]; tanks: Tank[]; locations: Location[]; products: Product[];
  planLines: PlanLine[]; berths: Berth[]; nodeFlows: NodeFlow[]; compatibility: ProductCompat[];
  projection: InventoryProjection[];
  voyages: Voyage[];
  charterRecommendations: CharterRecommendation[];
  unserved: Unserved[];
  duals: Dual[];
  kpis: Kpis;
  validation: { ok: boolean; breaches: string[] } | null;
  activeVersionId: string | null;
  versions: VersionSummary[];
  period: PlanPeriod | null;
  periods: PlanPeriod[];
}

/** Replan-decision thresholds (Settings-editable), passed to the scenario endpoints. */
export interface ReplanThresholds {
  dryOutDaysCover: number; ullageMarginPct: number; demurrageInr: number; costVariancePct: number; qtyChangePct: number;
}
export const DEFAULT_THRESHOLDS: ReplanThresholds = {
  dryOutDaysCover: 3, ullageMarginPct: 8, demurrageInr: 30_000_000, costVariancePct: 7, qtyChangePct: 10,
};
export interface ReplanDecision {
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  label: string; reasons: string[];
  blast: { voyages: number; nodes: number; fromDay: number | null; toDay: number | null };
  recommend: string;
}

// --- Scenario composition --------------------------------------------------
// A scenario is an ordered LIST of events — any number of any type. The server
// compiles it to engine options, so the UI never has to fold them itself.

export type ScenarioEventType =
  | 'DEMAND_REVISION' | 'SPOT_CARGO' | 'TANK_OUTAGE'
  | 'PORT_CLOSURE' | 'VESSEL_DELAY' | 'VESSEL_OUTAGE';

interface EventBase { id: string; type: ScenarioEventType; note?: string | null }
export interface DemandRevisionEvent extends EventBase {
  type: 'DEMAND_REVISION'; locationId: string; productId: string;
  side: 'OUT' | 'IN'; basis: 'ABS' | 'DELTA' | 'PCT'; value: number;
  fromDay?: number | null; toDay?: number | null;
}
export interface SpotCargoEvent extends EventBase {
  type: 'SPOT_CARGO'; locationId: string; productId: string;
  qty: number; day: number; direction: 'DRAW' | 'RECEIPT';
}
export interface TankOutageEvent extends EventBase {
  type: 'TANK_OUTAGE'; locationId: string; productId: string; fromDay: number; toDay: number;
}
export interface PortClosureEvent extends EventBase {
  type: 'PORT_CLOSURE'; locationId: string; berthId?: string | null;
  fromDay: number; toDay: number; capacityPct?: number | null;
}
export interface VesselDelayEvent extends EventBase {
  type: 'VESSEL_DELAY'; vesselId: string; basis: 'ABS' | 'SLIP'; value: number;
}
export interface VesselOutageEvent extends EventBase {
  type: 'VESSEL_OUTAGE'; vesselId: string; fromDay?: number | null; toDay?: number | null;
}
export type ScenarioEvent =
  | DemandRevisionEvent | SpotCargoEvent | TankOutageEvent
  | PortClosureEvent | VesselDelayEvent | VesselOutageEvent;

export interface SavedScenario {
  id: string; stream: string; name: string; description: string | null;
  events: ScenarioEvent[]; asOfDay: number; mode: string;
  createdAt: string; updatedAt: string;
}

/** Cross-view navigation context: land on a tab focused on a specific entity. */
export type Focus = { node?: { loc: string; product: string }; tankId?: string; vesselId?: string; locationId?: string } | null;
export type Goto = (tab: string, focus?: Focus) => void;

/**
 * Day 0 of the horizon. Day indices throughout the app are relative to the open
 * planning period, so this follows whichever period the dashboard returns —
 * `setHorizonStart` is called once per load in App.
 */
export const START_DATE = new Date('2026-07-01T00:00:00Z');
let horizonStart = new Date(START_DATE);
export function setHorizonStart(iso: string | null | undefined) {
  horizonStart = iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : new Date(START_DATE);
}
export function horizonStartDate(): Date { return new Date(horizonStart); }
export function dayToDate(day: number): Date { const d = new Date(horizonStart); d.setUTCDate(d.getUTCDate() + day); return d; }
