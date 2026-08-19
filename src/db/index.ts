import * as schema from './schema';

/**
 * One dialect, two drivers.
 *
 * Without DATABASE_URL the app runs Postgres in-process via PGlite — Postgres
 * compiled to WebAssembly, persisted to ./.pgdata. No service to install, no
 * account to create, no native build step: clone the repo and it works.
 *
 * With DATABASE_URL set, the same schema and the same queries run against a real
 * Postgres (Cloud SQL, RDS, self-hosted, or a managed provider). Because both
 * sides speak Postgres there is no dialect drift between what is developed
 * against and what is deployed.
 *
 * PGlite is a single-connection embedded engine — right for development, demo and
 * CI, not for a shared production instance. Each process gets its own file, so two
 * container instances would diverge; that is precisely why a deployed instance
 * points at a real Postgres.
 *
 * Two URLs, because managed Postgres wants different endpoints for different jobs:
 *
 *   DATABASE_URL            pooled endpoint — app queries. Neon's pooler handles
 *                           connection churn and supports protocol-level prepared
 *                           statements (PgBouncer 1.22+).
 *   MIGRATION_DATABASE_URL  direct endpoint — migrations. Neon documents pooled
 *                           connections as error-prone for ORM migrations.
 *
 * Timeouts matter on a serverless plan. Neon's compute autosuspends after five
 * minutes and cannot be told not to, so `idle_timeout` has to be short enough that
 * lingering pool connections do not hold it awake and burn the monthly compute
 * budget. `connect_timeout` has to be long enough to survive a resume.
 */

const url = process.env.DATABASE_URL?.trim();
const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim() || url;

export const driver: 'pglite' | 'postgres' = url ? 'postgres' : 'pglite';
export const dataDir = process.env.PGLITE_DIR || './.pgdata';

function pgOptions() {
  return {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    // Release connections promptly so a suspend-capable compute can actually suspend.
    idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT_SEC ?? 20),
    // A cold compute has to wake before it can answer; the default is too impatient.
    connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT_SEC ?? 15),
    // Off only if a pooler in transaction mode rejects prepared statements.
    prepare: process.env.DATABASE_PREPARE !== 'false',
  };
}

async function connectPostgres(connectionString: string, opts: Record<string, unknown> = {}) {
  const [{ drizzle }, postgresMod] = await Promise.all([
    import('drizzle-orm/postgres-js'),
    import('postgres'),
  ]);
  const sql = postgresMod.default(connectionString, { ...pgOptions(), ...opts });
  return { db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
}

async function connect() {
  if (url) return (await connectPostgres(url)).db;
  const [{ drizzle }, { PGlite }] = await Promise.all([
    import('drizzle-orm/pglite'),
    import('@electric-sql/pglite'),
  ]);
  const client = new PGlite(dataDir);
  await client.waitReady;
  return drizzle(client, { schema });
}

/**
 * A handle for schema migrations. On managed Postgres this is a short-lived
 * connection to the DIRECT endpoint with a pool of one, closed as soon as the
 * migration finishes. On PGlite there is only one database, so the caller reuses
 * the shared handle and `close` is a no-op.
 */
export async function getMigrationDb(): Promise<{ db: Awaited<ReturnType<typeof connect>>; close: () => Promise<void> }> {
  if (!migrationUrl) return { db: await getDb(), close: async () => {} };
  const { db, close } = await connectPostgres(migrationUrl, { max: 1, prepare: false });
  return { db: db as Awaited<ReturnType<typeof connect>>, close: async () => { await close(); } };
}

// A single shared handle. Awaited once at startup; every caller reuses it.
let handle: Awaited<ReturnType<typeof connect>> | null = null;
let connecting: Promise<Awaited<ReturnType<typeof connect>>> | null = null;

export async function getDb() {
  if (handle) return handle;
  if (!connecting) connecting = connect().then(h => { handle = h; return h; });
  return connecting;
}

/**
 * Convenience proxy so existing call sites keep working as `db.select()...`.
 * Every method is forwarded to the resolved handle; `getDb()` must have been
 * awaited at least once first (server startup does this).
 */
export const db = new Proxy({} as Awaited<ReturnType<typeof connect>>, {
  get(_t, prop) {
    if (!handle) throw new Error('Database used before getDb() resolved — await getDb() during startup.');
    const value = (handle as any)[prop];
    return typeof value === 'function' ? value.bind(handle) : value;
  },
});

export { schema };
