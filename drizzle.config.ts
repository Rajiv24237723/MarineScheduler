import { defineConfig } from 'drizzle-kit';

/**
 * Postgres dialect. Migrations are generated from the schema and committed, so
 * schema history is reviewable and replayable — `drizzle-kit push` is not used on
 * boot any more (see src/db/migrate.ts).
 *
 * Generating migrations does not need a live database. Applying them to a real
 * Postgres does: set DATABASE_URL. The default PGlite path is migrated in-process
 * at startup.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/marine',
  },
  verbose: true,
  strict: true,
});
