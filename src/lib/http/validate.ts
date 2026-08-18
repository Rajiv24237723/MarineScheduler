import { z } from 'zod';
import type { Request, Response } from 'express';

/**
 * Request validation for the write endpoints.
 *
 * The master-data routes previously did `db.insert(table).values({ ...req.body })`,
 * so the request body decided which columns were written. That trusts the caller
 * with the shape of the row. These schemas make the contract explicit and strip
 * anything not in it.
 */

/** Parse `body` against a schema; on failure send 400 with field-level detail and return null. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const r = schema.safeParse(req.body ?? {});
  if (r.success) return r.data;
  res.status(400).json({
    error: 'invalid request body',
    issues: r.error.issues.map(i => ({ field: i.path.join('.') || '(root)', message: i.message })),
  });
  return null;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request, res: Response): z.infer<T> | null {
  const r = schema.safeParse(req.query ?? {});
  if (r.success) return r.data;
  res.status(400).json({
    error: 'invalid query parameters',
    issues: r.error.issues.map(i => ({ field: i.path.join('.') || '(root)', message: i.message })),
  });
  return null;
}

export const Stream = z.enum(['CRUDE', 'LNG', 'POL']);
const id = z.string().min(1).max(128);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date, YYYY-MM-DD');
const money = z.coerce.number().finite().min(0);
const qty = z.coerce.number().finite().min(0);

export const CostBreakdownSchema = z.object({
  bunker: money.default(0), freight: money.default(0), portDA: money.default(0),
  demurrage: money.default(0), changeover: money.default(0),
}).partial().transform(v => ({
  bunker: v.bunker ?? 0, freight: v.freight ?? 0, portDA: v.portDA ?? 0,
  demurrage: v.demurrage ?? 0, changeover: v.changeover ?? 0,
}));

export const ActualSchema = z.object({
  id: id.optional(),
  periodId: id.optional(),
  versionId: id.nullish(),
  planVoyageId: id.nullish(),
  vesselName: z.string().min(1).max(200),
  vesselClass: z.string().max(80).default(''),
  pool: z.enum(['OWNED', 'TC', 'COA', 'SPOT']).default('OWNED'),
  fromLocationId: id.nullish(),
  toLocationId: id.nullish(),
  productId: id.nullish(),
  qtyMt: qty.default(0),
  startDay: z.coerce.number().int().min(0).max(400).default(0),
  endDay: z.coerce.number().int().min(0).max(400).default(0),
  cost: money.default(0),
  costBreakdown: CostBreakdownSchema.nullish(),
  status: z.enum(['COMPLETED', 'PARTIAL', 'CANCELLED']).default('COMPLETED'),
  source: z.enum(['MANUAL', 'UPLOAD', 'SIMULATED', 'SEED']).default('MANUAL'),
  note: z.string().max(2000).nullish(),
});

export const ActualPatchSchema = ActualSchema.partial().omit({ id: true });

export const ActualBulkSchema = z.object({
  periodId: id.optional(),
  stream: Stream.optional(),
  replace: z.boolean().default(false),
  rows: z.array(ActualSchema).max(5000),
});

export const PeriodSchema = z.object({
  stream: Stream,
  code: z.string().regex(/^\d{4}-\d{2}$/, 'expected a period code, YYYY-MM'),
  label: z.string().min(1).max(60).optional(),
  startDate: isoDate,
  endDate: isoDate,
  horizonDays: z.coerce.number().int().min(1).max(400).optional(),
  status: z.enum(['Open', 'Closed']).optional(),
  copyPlanLinesFrom: id.optional(),
}).refine(v => v.endDate >= v.startDate, { path: ['endDate'], message: 'endDate must not precede startDate' });

export const PeriodPatchSchema = z.object({
  label: z.string().min(1).max(60).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  horizonDays: z.coerce.number().int().min(1).max(400).optional(),
  status: z.enum(['Open', 'Closed']).optional(),
});

export const ScenarioSchema = z.object({
  id: id.optional(),
  stream: Stream.optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  // Events are validated structurally by the compiler, which reports what it could
  // not read; over-constraining here would reject forward-compatible additions.
  events: z.array(z.object({ id: z.string().min(1), type: z.string().min(1) }).passthrough()).max(500).default([]),
  asOfDay: z.coerce.number().int().min(0).max(400).default(0),
  mode: z.enum(['minimal-edit', 'minimal-change', 'cost-optimal']).default('minimal-edit'),
});

export const ScenarioPatchSchema = ScenarioSchema.partial().omit({ id: true, stream: true });

/** Per-table master-data schemas. Unknown keys are stripped, not written. */
export const MasterSchemas = {
  products: z.object({
    id: id.optional(), stream: Stream, name: z.string().min(1).max(120), type: z.string().min(1).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #22d3ee'),
    cargoClass: z.enum(['CLEAN', 'BLACK', 'BITUMEN', 'CRUDE', 'LNG']).default('CLEAN'),
    density: z.coerce.number().finite().nullish(), flashPoint: z.coerce.number().finite().nullish(),
    pourPoint: z.coerce.number().finite().nullish(), sulphur: z.string().max(40).nullish(),
    rating: z.string().max(40).nullish(), parcelMin: qty.nullish(), parcelMax: qty.nullish(),
  }),
  locations: z.object({
    id: id.optional(), stream: Stream, name: z.string().min(1).max(160), type: z.string().min(1).max(40),
    lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180),
  }),
  vessels: z.object({
    id: id.optional(), stream: Stream, name: z.string().min(1).max(160), class: z.string().min(1).max(40),
    dwt: qty, charterType: z.string().min(1).max(20),
    pool: z.enum(['OWNED', 'TC', 'COA', 'SPOT']).default('OWNED'),
    service: z.enum(['CLEAN', 'BLACK', 'BITUMEN', 'CRUDE', 'LNG']).default('CLEAN'),
    speed: z.coerce.number().min(1).max(40), charterCost: money.default(0), voyageRate: money.default(0),
    availFrom: isoDate.nullish(), availTo: isoDate.nullish(),
    draftLaden: z.coerce.number().min(0).max(40).default(0), draftBallast: z.coerce.number().min(0).max(40).default(0),
    compartments: z.array(z.object({ id: z.string().min(1).max(20), cap: qty })).max(100).default([]),
  }),
  tanks: z.object({
    id: id.optional(), stream: Stream, locationId: id, productId: id,
    capacity: qty, minStock: qty, currentStock: qty, name: z.string().min(1).max(120),
  }).refine(v => v.minStock <= v.capacity, { path: ['minStock'], message: 'minStock cannot exceed capacity' }),
  nodeFlows: z.object({
    id: id.optional(), stream: Stream, locationId: id, productId: id,
    dailyIn: qty.default(0), dailyOut: qty.default(0),
  }),
  planLines: z.object({
    id: id.optional(), stream: Stream, periodId: id.nullish(),
    kind: z.enum(['DEMAND', 'SUPPLY']), productId: id, locationId: id, qty,
    windowStart: isoDate, windowEnd: isoDate,
    priority: z.coerce.number().int().min(1).max(9).default(1),
  }),
  berths: z.object({
    id: id.optional(), stream: Stream, locationId: id, name: z.string().min(1).max(120),
    nsim: z.coerce.number().int().min(1).max(20).default(1),
    rateMtPerHr: z.coerce.number().min(1).default(1000),
    berthingHours: z.coerce.number().min(0).max(240).default(12),
    maxDraft: z.coerce.number().min(0).max(40).default(20),
  }),
  productCompatibility: z.object({
    id: id.optional(), stream: Stream, scope: z.enum(['COMPARTMENT', 'TANK']),
    fromProduct: id, toProduct: id, allowed: z.coerce.boolean().default(true),
    changeoverHours: z.coerce.number().min(0).max(500).default(0),
    changeoverCost: money.default(0),
  }),
} as const;

export type MasterTable = keyof typeof MasterSchemas;
