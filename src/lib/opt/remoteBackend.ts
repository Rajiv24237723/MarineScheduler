import { Model } from './model';
import { SolverBackend, SolveOptions, SolveOutcome, emptyOutcome, gapOf } from './backend';

/**
 * Remote solver backend — posts the model as JSON to an HTTP service that fronts a
 * stronger solver (Gurobi, CPLEX, OR-Tools/CP-SAT). Off by default: it activates
 * only when SOLVER_URL is set, so nothing about the default deployment changes.
 *
 * Exists so the escape hatch is designed rather than retrofitted. The wire format
 * is the model itself, which keeps the service dumb and the formulation here.
 *
 * Expected response:
 *   { status, objective, bound, values: {name: number}, duals?, solver?, message? }
 */
export class RemoteBackend implements SolverBackend {
  readonly name: string;
  private url: string;
  private token?: string;

  constructor(url: string, token?: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
    this.name = `remote(${new URL(this.url).host})`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async available(): Promise<boolean> {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      const r = await fetch(`${this.url}/health`, { headers: this.headers(), signal: ac.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  async solve(model: Model, opts: SolveOptions = {}): Promise<SolveOutcome> {
    const t0 = Date.now();
    const payload = {
      sense: model.sense,
      vars: model.vars().map(v => ({ name: v.name, kind: opts.relaxIntegrality ? 'CONT' : v.kind, lo: v.lo, hi: isFinite(v.hi) ? v.hi : null, obj: v.obj })),
      rows: model.rows(),
      options: {
        timeLimitSec: opts.timeLimitSec ?? null,
        mipGap: opts.mipGap ?? null,
        wantDuals: opts.wantDuals ?? false,
      },
    };
    try {
      const r = await fetch(`${this.url}/solve`, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) });
      if (!r.ok) return { ...emptyOutcome(this.name, 'ERROR', `solver returned ${r.status}`), wallMs: Date.now() - t0 };
      const d: any = await r.json();
      const objective = d.objective ?? null, bound = d.bound ?? null;
      return {
        status: d.status ?? 'ERROR', objective, bound,
        gapPct: d.gapPct ?? gapOf(objective, bound),
        proven: d.status === 'OPTIMAL',
        values: d.values ?? {}, duals: d.duals,
        solver: d.solver ? `${this.name}:${d.solver}` : this.name,
        wallMs: Date.now() - t0, message: d.message,
      };
    } catch (e) {
      return { ...emptyOutcome(this.name, 'ERROR', (e as Error).message), wallMs: Date.now() - t0 };
    }
  }
}
