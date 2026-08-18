import { SolverBackend } from './backend';
import { HighsBackend } from './highsBackend';
import { RemoteBackend } from './remoteBackend';

export { Model } from './model';
export type { Var, Row, VarKind, RowOp } from './model';
export type { SolverBackend, SolveOptions, SolveOutcome, SolveStatus } from './backend';
export { gapOf } from './backend';
export { HighsBackend } from './highsBackend';
export { RemoteBackend } from './remoteBackend';

let cached: { backend: SolverBackend; checkedAt: number } | null = null;
const PROBE_TTL_MS = 60_000;

/**
 * Pick a backend. A remote solver is used when SOLVER_URL is configured and its
 * /health responds; otherwise the in-process HiGHS. The probe result is cached
 * briefly so a solve never pays for a health check it just did, and a remote
 * outage degrades to HiGHS instead of failing the request.
 */
export async function getBackend(): Promise<SolverBackend> {
  const now = Date.now();
  if (cached && now - cached.checkedAt < PROBE_TTL_MS) return cached.backend;

  const url = process.env.SOLVER_URL;
  if (url) {
    try {
      const remote = new RemoteBackend(url, process.env.SOLVER_TOKEN);
      if (await remote.available()) { cached = { backend: remote, checkedAt: now }; return remote; }
      console.warn(`[opt] SOLVER_URL is set but ${url}/health did not respond; using in-process HiGHS.`);
    } catch (e) {
      console.warn(`[opt] SOLVER_URL is invalid (${(e as Error).message}); using in-process HiGHS.`);
    }
  }
  const highs = new HighsBackend();
  cached = { backend: highs, checkedAt: now };
  return highs;
}

/** What the API reports so the UI can name the solver actually in use. */
export async function backendInfo(): Promise<{ name: string; remote: boolean; configuredUrl: string | null }> {
  const b = await getBackend();
  return { name: b.name, remote: b.name.startsWith('remote'), configuredUrl: process.env.SOLVER_URL ?? null };
}
