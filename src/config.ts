import { z } from 'zod';

/**
 * Environment schema, validated once at boot.
 *
 * Configuration errors should fail immediately with a readable message rather
 * than surfacing as a confusing runtime fault an hour later. Everything here has
 * a working default except DATABASE_URL, whose absence is itself the default:
 * no URL means the in-process PGlite database, which is what makes a fresh clone
 * run without setup.
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Absent → in-process PGlite. Present → that Postgres (use the POOLED endpoint). */
  DATABASE_URL: z.string().url().optional(),
  /** The DIRECT (non-pooled) endpoint, used only for migrations. */
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  PGLITE_DIR: z.string().default('./.pgdata'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
  /** Short, so a suspend-capable compute can actually go idle. */
  DATABASE_IDLE_TIMEOUT_SEC: z.coerce.number().int().min(1).max(3600).default(20),
  /** Long enough for a suspended compute to wake before the first query fails. */
  DATABASE_CONNECT_TIMEOUT_SEC: z.coerce.number().int().min(1).max(120).default(15),
  /** Set false only for a transaction-mode pooler that rejects prepared statements. */
  DATABASE_PREPARE: z.enum(['true', 'false']).default('true'),

  /** Optional external MILP solver. Absent → in-process HiGHS. */
  SOLVER_URL: z.string().url().optional(),
  SOLVER_TOKEN: z.string().min(1).optional(),

  /** Default solve budget, seconds. */
  SOLVE_TIME_LIMIT_SEC: z.coerce.number().int().min(1).max(3600).default(60),
}).superRefine((v, ctx) => {
  if (v.SOLVER_TOKEN && !v.SOLVER_URL) {
    ctx.addIssue({ code: 'custom', path: ['SOLVER_TOKEN'], message: 'SOLVER_TOKEN is set but SOLVER_URL is not — the token would never be used.' });
  }
  for (const k of ['DATABASE_URL', 'MIGRATION_DATABASE_URL'] as const) {
    const val = v[k];
    if (val && !/^postgres(ql)?:\/\//.test(val)) {
      ctx.addIssue({ code: 'custom', path: [k], message: `${k} must be a postgres:// or postgresql:// URL — this app is Postgres-only.` });
    }
  }
  if (v.MIGRATION_DATABASE_URL && !v.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['MIGRATION_DATABASE_URL'], message: 'MIGRATION_DATABASE_URL is set but DATABASE_URL is not — the app would run on PGlite and never use it.' });
  }
  // On a pooled provider these must differ, or migrations run over the pooler.
  if (v.DATABASE_URL && v.MIGRATION_DATABASE_URL === v.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['MIGRATION_DATABASE_URL'], message: 'MIGRATION_DATABASE_URL is identical to DATABASE_URL — point it at the direct (non-pooled) endpoint, or unset it.' });
  }
});

export type Config = z.infer<typeof Env>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    console.error(`\nInvalid environment configuration:\n${lines.join('\n')}\n`);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}

/** One line at startup describing how this process is actually configured. */
export function describeConfig(c: Config): string {
  return [
    `env=${c.NODE_ENV}`,
    `port=${c.PORT}`,
    `db=${c.DATABASE_URL ? `postgres${c.MIGRATION_DATABASE_URL ? ' (pooled + direct)' : ' (single endpoint)'}` : `pglite (${c.PGLITE_DIR})`}`,
    `solver=${c.SOLVER_URL ? `remote (${c.SOLVER_URL})` : 'highs-wasm (in-process)'}`,
    `solveLimit=${c.SOLVE_TIME_LIMIT_SEC}s`,
  ].join(' · ');
}
