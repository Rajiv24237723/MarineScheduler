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
export interface PlanLine { id: string; stream: string; kind: string; productId: string; locationId: string; qty: number; windowStart: string; windowEnd: string; priority: number; }
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
  resilience?: Resilience;
}
export interface Unserved { locationId: string; productId: string; day: number; shortfallMt: number; reason: string; }
export interface VersionSummary { id: string; version: number; status: string; trigger: string; objectiveCost: number; achievable: number; createdAt: string; }

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

/** Cross-view navigation context: land on a tab focused on a specific entity. */
export type Focus = { node?: { loc: string; product: string }; tankId?: string; vesselId?: string; locationId?: string } | null;
export type Goto = (tab: string, focus?: Focus) => void;

export const START_DATE = new Date('2026-07-01T00:00:00Z');
export function dayToDate(day: number): Date { const d = new Date(START_DATE); d.setUTCDate(d.getUTCDate() + day); return d; }
