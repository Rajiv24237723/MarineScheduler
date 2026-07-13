import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(), // 'CRUDE' | 'LNG' | 'POL'
  name: text('name').notNull(),
  type: text('type').notNull(), // CRUDE, POL, LNG
  color: text('color').notNull(), // For UI Gantt
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
  charterType: text('charter_type').notNull(), // TC, VOYAGE
  speed: real('speed').notNull(),
  charterCost: real('charter_cost').notNull().default(0),
  compartments: text('compartments', { mode: 'json' }).$type<{id: string, cap: number}[]>().notNull().default([]),
});

export const tanks = sqliteTable('tanks', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  locationId: text('location_id').references(() => locations.id).notNull(),
  productId: text('product_id').references(() => products.id).notNull(),
  capacity: real('capacity').notNull(),
  minStock: real('min_stock').notNull(),
  currentStock: real('current_stock').notNull(),
  name: text('name').notNull(),
});

export const constraints = sqliteTable('constraints', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  type: text('type').notNull(), // tank_changeover, compartment_changeover, berth, tank, vessel, planning
  scopeRef: text('scope_ref'), // ID of the referenced entity if any
  params: text('params', { mode: 'json' }).notNull(), // JSON
  effectiveFrom: text('effective_from').notNull(),
  version: integer('version').notNull(),
  active: integer('active').notNull(), // boolean 0/1
});

export const planningInputs = sqliteTable('planning_inputs', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  kind: text('kind').notNull(), // UPLIFT, DEMAND, MOVEMENT
  name: text('name').notNull(),
  activeVersionId: text('active_version_id'),
});

export const planningInputVersions = sqliteTable('planning_input_versions', {
  id: text('id').primaryKey(),
  inputId: text('input_id').notNull(),
  version: integer('version').notNull(),
  rows: text('rows', { mode: 'json' }).notNull(), // JSON
  author: text('author').notNull(),
  createdAt: text('created_at').notNull(),
  diff: text('diff', { mode: 'json' }), // JSON
});

export const scheduleVersions = sqliteTable('schedule_versions', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  runId: text('run_id').notNull(),
  version: integer('version').notNull(),
  parentId: text('parent_id'),
  planningInputVersionId: text('planning_input_version_id'),
  constraintChangeRef: text('constraint_change_ref'),
  trigger: text('trigger').notNull(), // initial, input_edit, constraint_change, disruption, manual
  status: text('status').notNull(), // Draft, UnderReview, Approved, Active, Superseded, Archived
  objectiveCost: real('objective_cost').notNull(),
  kpi: text('kpi', { mode: 'json' }), // JSON
  createdAt: text('created_at').notNull(),
});

export const scheduleMovements = sqliteTable('schedule_movements', {
  id: text('id').primaryKey(),
  stream: text('stream').notNull(),
  scheduleVersionId: text('schedule_version_id').notNull(),
  vesselId: text('vessel_id').notNull(),
  productId: text('product_id').notNull(),
  sourceId: text('source_id').notNull(),
  destId: text('dest_id').notNull(),
  qty: real('qty').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  status: text('status').notNull(), // PLANNED, IN_TRANSIT, COMPLETED
});
