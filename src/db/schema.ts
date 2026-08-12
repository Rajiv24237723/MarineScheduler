import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/**
 * Marine Scheduler schema — full operational MIRP (Model B).
 * All tables are stream-scoped (CRUDE | LNG | POL); the three streams are isolated.
 */

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  color: text('color').notNull(), // UI colour for Gantt / charts
  cargoClass: text('cargo_class').notNull().default('CLEAN'), // CLEAN (white oil) | BLACK (FO/residual) | BITUMEN | CRUDE | LNG
  // Grade specification (illustrative planning values). flash/pour null = below ambient / n.a.
  density: real('density'),          // kg/m³ at 15 °C
  flashPoint: real('flash_point'),   // °C
  pourPoint: real('pour_point'),     // °C
  sulphur: text('sulphur'),          // e.g. "10 ppm", "0.50%"
  rating: text('rating'),            // e.g. "91 RON", "51 CN", "VG30", "Jet A-1"
  parcelMin: real('parcel_min'),     // typical parcel size band, MT
  parcelMax: real('parcel_max'),
});

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // SOURCE, REFINERY, CRUDE_STORAGE, LNG_TERMINAL, COASTAL_TERMINAL, DEMAND
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
});

export const vessels = sqliteTable('vessels', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  class: text('class').notNull(),
  dwt: real('dwt').notNull(),
  charterType: text('charter_type').notNull(),          // TC | VOYAGE (legacy label)
  pool: text('pool').notNull().default('OWNED'),        // OWNED | TC | SPOT (spot = charterable pool)
  service: text('service').notNull().default('CLEAN'),  // CLEAN (white oil) | BLACK (FO/dirty) | CRUDE | LNG — never mixed
  speed: real('speed').notNull(),                       // service speed, knots
  charterCost: real('charter_cost').notNull().default(0), // $/day hire for OWNED/TC
  voyageRate: real('voyage_rate').notNull().default(0),   // $/MT freight for SPOT charters
  availFrom: text('avail_from'),                        // ISO date (null = always)
  availTo: text('avail_to'),
  draftLaden: real('draft_laden').notNull().default(0),   // m
  draftBallast: real('draft_ballast').notNull().default(0),
  compartments: text('compartments', { mode: 'json' }).$type<{ id: string; cap: number }[]>().notNull().default([]),
});

/** Shore tanks — opening stock, dry-out floor (minStock) and tank-top ceiling (capacity). */
export const tanks = sqliteTable('tanks', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  productId: text('product_id').notNull(),
  capacity: real('capacity').notNull(),        // smax
  minStock: real('min_stock').notNull(),       // smin (dry-out floor)
  currentStock: real('current_stock').notNull(), // opening stock at horizon start
  name: text('name').notNull(),
});

/** Exogenous daily inventory flow per (location, product): production/receipt in, consumption/lifting out. */
export const nodeFlows = sqliteTable('node_flows', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  productId: text('product_id').notNull(),
  dailyIn: real('daily_in').notNull().default(0),   // MT/day produced or piped in
  dailyOut: real('daily_out').notNull().default(0), // MT/day consumed or lifted out
});

/** The monthly plan: demand to satisfy and supply available, per node/product with a window. */
export const planLines = sqliteTable('plan_lines', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  periodId: text('period_id'),  // planning month this line belongs to (null = unscoped/legacy)
  kind: text('kind').notNull(), // DEMAND | SUPPLY
  productId: text('product_id').notNull(),
  locationId: text('location_id').notNull(),
  qty: real('qty').notNull(),
  windowStart: text('window_start').notNull(), // ISO date
  windowEnd: text('window_end').notNull(),
  priority: integer('priority').notNull().default(1),
});

export const berths = sqliteTable('berths', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  nsim: integer('nsim').notNull().default(1),          // max simultaneous vessels
  rateMtPerHr: real('rate_mt_per_hr').notNull().default(1000),
  berthingHours: real('berthing_hours').notNull().default(12), // fixed pilot/moor/deballast
  maxDraft: real('max_draft').notNull().default(20),   // m (daily tidal parked — static)
});

/** Compartment (and tank) product-transition rules: allowed?, changeover time & cost. */
export const productCompatibility = sqliteTable('product_compatibility', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  scope: text('scope').notNull(),        // COMPARTMENT | TANK
  fromProduct: text('from_product').notNull(),
  toProduct: text('to_product').notNull(),
  allowed: integer('allowed').notNull().default(1), // 0 = forbidden even after cleaning
  changeoverHours: real('changeover_hours').notNull().default(0),
  changeoverCost: real('changeover_cost').notNull().default(0),
});

// ---------------------------------------------------------------------------
// Planning periods — the month a plan version belongs to. One period holds many
// versions; exactly one of them may be flagged the baseline (the frozen
// start-of-month plan that actual performance is measured against).
// ---------------------------------------------------------------------------

export const planPeriods = sqliteTable('plan_periods', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  code: text('code').notNull(),          // sortable key, e.g. '2026-07'
  label: text('label').notNull(),        // display, e.g. 'Jul 2026'
  startDate: text('start_date').notNull(), // ISO date — day 0 of this period's horizon
  endDate: text('end_date').notNull(),
  horizonDays: integer('horizon_days').notNull().default(30),
  status: text('status').notNull().default('Open'), // Open (planning/executing) | Closed (month settled)
  createdAt: text('created_at').notNull(),
});

/**
 * Executed reality: what actually moved and what it actually cost. One row per
 * executed voyage-leg. `planVoyageId` links back to the planned voyage it
 * fulfilled — null means an unplanned lift, which is itself a variance signal.
 */
export const actuals = sqliteTable('actuals', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  periodId: text('period_id').notNull(),
  versionId: text('version_id'),          // plan version executed against (null = unknown)
  planVoyageId: text('plan_voyage_id'),   // matched planned voyage id (null = unplanned lift)
  vesselName: text('vessel_name').notNull(),
  vesselClass: text('vessel_class').notNull().default(''),
  pool: text('pool').notNull().default('OWNED'),
  fromLocationId: text('from_location_id'),
  toLocationId: text('to_location_id'),
  productId: text('product_id'),
  qtyMt: real('qty_mt').notNull().default(0),
  startDay: integer('start_day').notNull().default(0),  // day index from period start
  endDay: integer('end_day').notNull().default(0),
  cost: real('cost').notNull().default(0),
  costBreakdown: text('cost_breakdown', { mode: 'json' }).$type<{ bunker: number; freight: number; portDA: number; demurrage: number; changeover: number }>(),
  status: text('status').notNull().default('COMPLETED'), // COMPLETED | PARTIAL | CANCELLED
  source: text('source').notNull().default('MANUAL'),    // MANUAL | UPLOAD | SIMULATED | SEED
  note: text('note'),
  createdAt: text('created_at').notNull(),
});

// ---------------------------------------------------------------------------
// Solve outputs (persisted, versioned).
// ---------------------------------------------------------------------------

export const scheduleVersions = sqliteTable('schedule_versions', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  runId: text('run_id').notNull(),
  version: integer('version').notNull(),
  periodId: text('period_id'),          // planning month this version plans for
  isBaseline: integer('is_baseline').notNull().default(0), // frozen benchmark for its period
  parentId: text('parent_id'),
  trigger: text('trigger').notNull(),   // initial | reoptimize | disruption:* | manual
  status: text('status').notNull(),     // Active | Draft | Superseded
  objectiveCost: real('objective_cost').notNull(),
  achievable: integer('achievable').notNull().default(1),
  kpi: text('kpi', { mode: 'json' }),
  projection: text('projection', { mode: 'json' }), // inventory projection snapshot
  duals: text('duals', { mode: 'json' }),           // shadow-price bottlenecks
  payload: text('payload', { mode: 'json' }),       // full SolveResult (voyages, recommendations, unserved, validation)
  createdAt: text('created_at').notNull(),
});

export const voyages = sqliteTable('voyages', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  versionId: text('version_id').notNull(),
  vesselId: text('vessel_id'),                 // null until a SPOT recommendation is contracted
  vesselName: text('vessel_name').notNull(),
  vesselClass: text('vessel_class').notNull(),
  pool: text('pool').notNull(),                // OWNED | TC | SPOT
  startDay: integer('start_day').notNull(),    // day index from horizon start
  endDay: integer('end_day').notNull(),
  cost: real('cost').notNull(),
  costBreakdown: text('cost_breakdown', { mode: 'json' }),
});

export const voyageStops = sqliteTable('voyage_stops', {
  id: text('id').primaryKey(),
  voyageId: text('voyage_id').notNull(),
  seq: integer('seq').notNull(),
  locationId: text('location_id').notNull(),
  arriveDay: integer('arrive_day').notNull(),
  departDay: integer('depart_day').notNull(),
  kind: text('kind').notNull(), // LOAD | DISCHARGE | LOAD_DISCHARGE
});

export const voyageOps = sqliteTable('voyage_ops', {
  id: text('id').primaryKey(),
  voyageId: text('voyage_id').notNull(),
  stopId: text('stop_id').notNull(),
  op: text('op').notNull(), // LOAD | DISCHARGE
  productId: text('product_id').notNull(),
  qty: real('qty').notNull(),
  compartmentId: text('compartment_id').notNull(),
});

export const charterRecommendations = sqliteTable('charter_recommendations', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  versionId: text('version_id').notNull(),
  voyageId: text('voyage_id'),
  vesselClass: text('vessel_class').notNull(),
  reason: text('reason').notNull(),
  estCost: real('est_cost').notNull(),
});
