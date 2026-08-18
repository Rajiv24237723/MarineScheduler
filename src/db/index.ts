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
 * CI, not for a shared production instance. That is the point of the split.
 */

const url = process.env.DATABASE_URL?.trim();

export const driver: 'pglite' | 'postgres' = url ? 'postgres' : 'pglite';
export const dataDir = process.env.PGLITE_DIR || './.pgdata';

async function connect() {
  if (url) {
    const [{ drizzle }, postgresMod] = await Promise.all([
      import('drizzle-orm/postgres-js'),
      import('postgres'),
    ]);
    // Modest pool: this process runs one solve at a time and long solves are CPU-bound.
    const sql = postgresMod.default(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
    return drizzle(sql, { schema });
  }
  const [{ drizzle }, { PGlite }] = await Promise.all([
    import('drizzle-orm/pglite'),
    import('@electric-sql/pglite'),
  ]);
  const client = new PGlite(dataDir);
  await client.waitReady;
  return drizzle(client, { schema });
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
