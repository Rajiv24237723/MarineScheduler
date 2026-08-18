import { pgTable, text, integer, doublePrecision, boolean, jsonb } from 'drizzle-orm/pg-core';

/**
 * Marine Scheduler schema — full operational MIRP (Model B).
 * All tables are stream-scoped (CRUDE | LNG | POL); the three streams are isolated.
 *
 * Dialect is Postgres. Development and demo run it in-process via PGlite (Postgres
 * compiled to WASM — no service, no signup, no native build); a deployment points
 * DATABASE_URL at any real Postgres. One dialect, so there is no drift between what
 * is developed against and what runs.
 *
 * Timestamps are deliberately ISO-8601 UTC text rather than timestamptz: the app
 * treats them as opaque, they sort lexicographically, and they cross the JSON API
 * without conversion. Money and quantities use doublePrecision — Postgres `real` is
 * a 4-byte float and would lose digits on values in the ₹10⁸–10⁹ range.
 */

export const products = pgTable('products', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  color: text('color').notNull(), // UI colour for Gantt / charts
  cargoClass: text('cargo_class').notNull().default('CLEAN'), // CLEAN (white oil) | BLACK (FO/residual) | BITUMEN | CRUDE | LNG
  // Grade specification (illustrative planning values). flash/pour null = below ambient / n.a.
  density: doublePrecision('density'),          // kg/m³ at 15 °C
  flashPoint: doublePrecision('flash_point'),   // °C
  pourPoint: doublePrecision('pour_point'),     // °C
  sulphur: text('sulphur'),          // e.g. "10 ppm", "0.50%"
  rating: text('rating'),            // e.g. "91 RON", "51 CN", "VG30", "Jet A-1"
  parcelMin: doublePrecision('parcel_min'),     // typical parcel size band, MT
  parcelMax: doublePrecision('parcel_max'),
});

export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // SOURCE, REFINERY, CRUDE_STORAGE, LNG_TERMINAL, COASTAL_TERMINAL, DEMAND
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
});

export const vessels = pgTable('vessels', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  class: text('class').notNull(),
  dwt: doublePrecision('dwt').notNull(),
  charterType: text('charter_type').notNull(),          // TC | VOYAGE (legacy label)
  pool: text('pool').notNull().default('OWNED'),        // OWNED | TC | SPOT (spot = charterable pool)
  service: text('service').notNull().default('CLEAN'),  // CLEAN (white oil) | BLACK (FO/dirty) | CRUDE | LNG — never mixed
  speed: doublePrecision('speed').notNull(),                       // service speed, knots
  charterCost: doublePrecision('charter_cost').notNull().default(0), // $/day hire for OWNED/TC
  voyageRate: doublePrecision('voyage_rate').notNull().default(0),   // $/MT freight for SPOT charters
  availFrom: text('avail_from'),                        // ISO date (null = always)
  availTo: text('avail_to'),
  draftLaden: doublePrecision('draft_laden').notNull().default(0),   // m
  draftBallast: doublePrecision('draft_ballast').notNull().default(0),
  compartments: jsonb('compartments').$type<{ id: string; cap: number }[]>().notNull().default([]),
});

/** Shore tanks — opening stock, dry-out floor (minStock) and tank-top ceiling (capacity). */
export const tanks = pgTable('tanks', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  productId: text('product_id').notNull(),
  capacity: doublePrecision('capacity').notNull(),        // smax
  minStock: doublePrecision('min_stock').notNull(),       // smin (dry-out floor)
  currentStock: doublePrecision('current_stock').notNull(), // opening stock at horizon start
  name: text('name').notNull(),
});

/** Exogenous daily inventory flow per (location, product): production/receipt in, consumption/lifting out. */
export const nodeFlows = pgTable('node_flows', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  productId: text('product_id').notNull(),
  dailyIn: doublePrecision('daily_in').notNull().default(0),   // MT/day produced or piped in
  dailyOut: doublePrecision('daily_out').notNull().default(0), // MT/day consumed or lifted out
});

/** The monthly plan: demand to satisfy and supply available, per node/product with a window. */
export const planLines = pgTable('plan_lines', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  periodId: text('period_id'),  // planning month this line belongs to (null = unscoped/legacy)
  kind: text('kind').notNull(), // DEMAND | SUPPLY
  productId: text('product_id').notNull(),
  locationId: text('location_id').notNull(),
  qty: doublePrecision('qty').notNull(),
  windowStart: text('window_start').notNull(), // ISO date
  windowEnd: text('window_end').notNull(),
  priority: integer('priority').notNull().default(1),
});

export const berths = pgTable('berths', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').notNull(),
  name: text('name').notNull(),
  nsim: integer('nsim').notNull().default(1),          // max simultaneous vessels
  rateMtPerHr: doublePrecision('rate_mt_per_hr').notNull().default(1000),
  berthingHours: doublePrecision('berthing_hours').notNull().default(12), // fixed pilot/moor/deballast
  maxDraft: doublePrecision('max_draft').notNull().default(20),   // m (daily tidal parked — static)
});

/** Compartment (and tank) product-transition rules: allowed?, changeover time & cost. */
export const productCompatibility = pgTable('product_compatibility', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  scope: text('scope').notNull(),        // COMPARTMENT | TANK
  fromProduct: text('from_product').notNull(),
  toProduct: text('to_product').notNull(),
  allowed: boolean('allowed').notNull().default(true), // false = forbidden even after cleaning
  changeoverHours: doublePrecision('changeover_hours').notNull().default(0),
  changeoverCost: doublePrecision('changeover_cost').notNull().default(0),
});

// ---------------------------------------------------------------------------
// Planning periods — the month a plan version belongs to. One period holds many
// versions; exactly one of them may be flagged the baseline (the frozen
// start-of-month plan that actual performance is measured against).
// ---------------------------------------------------------------------------

export const planPeriods = pgTable('plan_periods', {
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
 *
 * This is a ledger. Rows are append-only, enforced by the database rather than by
 * convention (see db/ledger.ts), and hash-chained so the history is verifiable
 * independently of what the storage layer claims.
 */
export const actuals = pgTable('actuals', {
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
  qtyMt: doublePrecision('qty_mt').notNull().default(0),
  startDay: integer('start_day').notNull().default(0),  // day index from period start
  endDay: integer('end_day').notNull().default(0),
  cost: doublePrecision('cost').notNull().default(0),
  costBreakdown: jsonb('cost_breakdown').$type<{ bunker: number; freight: number; portDA: number; demurrage: number; changeover: number }>(),
  status: text('status').notNull().default('COMPLETED'), // COMPLETED | PARTIAL | CANCELLED
  source: text('source').notNull().default('MANUAL'),    // MANUAL | UPLOAD | SIMULATED | SEED
  note: text('note'),
  createdAt: text('created_at').notNull(),
  // --- tamper-evidence ---
  schemaVersion: integer('schema_version').notNull().default(1),
  prevHash: text('prev_hash'),   // digest of the previous row in this stream's chain
  hash: text('hash'),            // digest of this row's material fields + prevHash
});

// ---------------------------------------------------------------------------
// Solve outputs (persisted, versioned).
// ---------------------------------------------------------------------------

/**
 * A named what-if: an ordered list of disruption events, any number of any type.
 * Stored as authored (not as compiled EngineOptions) so it can be reopened,
 * edited and re-run against a different month.
 */
export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  events: jsonb('events').$type<unknown[]>().notNull().default([]),
  asOfDay: integer('as_of_day').notNull().default(0),
  mode: text('mode').notNull().default('minimal-edit'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Plan versions. `status` and `isBaseline` legitimately change over a version's
 * life (publish, supersede, re-baseline), so this is not append-only in the way
 * `actuals` is — but a version belonging to a Closed period is frozen, and the
 * lineage is hash-chained through `parentId` so history cannot be rewritten.
 */
export const scheduleVersions = pgTable('schedule_versions', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  runId: text('run_id').notNull(),
  version: integer('version').notNull(),
  periodId: text('period_id'),          // planning month this version plans for
  isBaseline: boolean('is_baseline').notNull().default(false), // frozen benchmark for its period
  parentId: text('parent_id'),
  trigger: text('trigger').notNull(),   // initial | reoptimize | disruption:* | manual
  status: text('status').notNull(),     // Active | Draft | Superseded
  objectiveCost: doublePrecision('objective_cost').notNull(),
  achievable: boolean('achievable').notNull().default(true),
  kpi: jsonb('kpi'),
  projection: jsonb('projection'), // inventory projection snapshot
  duals: jsonb('duals'),           // shadow-price bottlenecks
  payload: jsonb('payload'),       // full SolveResult (voyages, recommendations, unserved, validation)
  createdAt: text('created_at').notNull(),
  // --- tamper-evidence ---
  schemaVersion: integer('schema_version').notNull().default(1),
  prevHash: text('prev_hash'),
  hash: text('hash'),
});

export const voyages = pgTable('voyages', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  versionId: text('version_id').notNull(),
  vesselId: text('vessel_id'),                 // null until a SPOT recommendation is contracted
  vesselName: text('vessel_name').notNull(),
  vesselClass: text('vessel_class').notNull(),
  pool: text('pool').notNull(),                // OWNED | TC | SPOT
  startDay: integer('start_day').notNull(),    // day index from horizon start
  endDay: integer('end_day').notNull(),
  cost: doublePrecision('cost').notNull(),
  costBreakdown: jsonb('cost_breakdown'),
});

export const voyageStops = pgTable('voyage_stops', {
  id: text('id').primaryKey(),
  voyageId: text('voyage_id').notNull(),
  seq: integer('seq').notNull(),
  locationId: text('location_id').notNull(),
  arriveDay: integer('arrive_day').notNull(),
  departDay: integer('depart_day').notNull(),
  kind: text('kind').notNull(), // LOAD | DISCHARGE | LOAD_DISCHARGE
});

export const voyageOps = pgTable('voyage_ops', {
  id: text('id').primaryKey(),
  voyageId: text('voyage_id').notNull(),
  stopId: text('stop_id').notNull(),
  op: text('op').notNull(), // LOAD | DISCHARGE
  productId: text('product_id').notNull(),
  qty: doublePrecision('qty').notNull(),
  compartmentId: text('compartment_id').notNull(),
});

export const charterRecommendations = pgTable('charter_recommendations', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  versionId: text('version_id').notNull(),
  voyageId: text('voyage_id'),
  vesselClass: text('vessel_class').notNull(),
  reason: text('reason').notNull(),
  estCost: doublePrecision('est_cost').notNull(),
});
