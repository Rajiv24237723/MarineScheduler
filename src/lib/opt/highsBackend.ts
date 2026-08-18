import { getHighs, LpBuilder, fmt } from '../highs';
import { Model } from './model';
import { SolverBackend, SolveOptions, SolveOutcome, emptyOutcome, gapOf } from './backend';

/**
 * HiGHS backend — in-process WebAssembly build of the HiGHS solver (MIT). It is a
 * genuine branch-and-cut MILP solver, the same one behind SciPy's `milp`, so this
 * needs no extra runtime and deploys wherever Node does.
 *
 * Limits worth knowing: single-threaded in WASM, and it holds the whole model in
 * memory as LP text, so very large instances should be bounded rather than solved
 * exactly. Callers check `Model.size()` first.
 */
export class HighsBackend implements SolverBackend {
  readonly name = 'highs-wasm';

  async available(): Promise<boolean> {
    try { await getHighs(); return true; } catch { return false; }
  }

  async solve(model: Model, opts: SolveOptions = {}): Promise<SolveOutcome> {
    const t0 = Date.now();
    let highs: any;
    try { highs = await getHighs(); }
    catch (e) { return { ...emptyOutcome(this.name, 'ERROR', `HiGHS failed to load: ${(e as Error).message}`) }; }

    const lp = this.toLp(model, opts.relaxIntegrality === true);
    const options: Record<string, unknown> = { output_flag: false };
    if (opts.timeLimitSec != null) options.time_limit = opts.timeLimitSec;
    if (opts.mipGap != null) options.mip_rel_gap = opts.mipGap;

    let sol: any;
    try { sol = highs.solve(lp, options); }
    catch (e) { return { ...emptyOutcome(this.name, 'ERROR', (e as Error).message), wallMs: Date.now() - t0 }; }

    const wallMs = Date.now() - t0;
    const raw = String(sol?.Status ?? '').toLowerCase();
    const status = raw.includes('optimal') ? 'OPTIMAL'
      : raw.includes('infeasible') ? 'INFEASIBLE'
        : raw.includes('unbounded') ? 'UNBOUNDED'
          : raw.includes('time') || raw.includes('interrupt') ? 'TIME_LIMIT'
            : sol?.ObjectiveValue != null ? 'FEASIBLE' : 'ERROR';

    const values: Record<string, number> = {};
    const cols = sol?.Columns ?? {};
    for (const k of Object.keys(cols)) values[k] = Number(cols[k]?.Primal ?? 0);

    let duals: Record<string, number> | undefined;
    if (opts.wantDuals && Array.isArray(sol?.Rows)) {
      duals = {};
      for (const r of sol.Rows) if (r?.Name) duals[r.Name] = Number(r.Dual ?? 0);
    }

    const objective = sol?.ObjectiveValue != null ? Number(sol.ObjectiveValue) : null;
    // HiGHS-JS does not surface the dual bound, so a relaxation is its own bound
    // and a proved-optimal MIP is exact. Otherwise the bound is unknown.
    const bound = opts.relaxIntegrality || status === 'OPTIMAL' ? objective : null;

    return {
      status, objective, bound,
      gapPct: gapOf(objective, bound),
      proven: status === 'OPTIMAL',
      values, duals, solver: this.name, wallMs,
      message: status === 'OPTIMAL' ? undefined : `HiGHS status: ${sol?.Status ?? 'unknown'}`,
    };
  }

  /** Render the model as CPLEX LP text. Integrality is dropped when relaxing. */
  private toLp(model: Model, relax: boolean): string {
    const b = new LpBuilder();
    const vars = model.vars();
    b.setObjective(model.sense === 'MIN' ? 'Minimize' : 'Maximize', vars.filter(v => v.obj !== 0).map(v => [v.obj, v.name] as [number, string]));
    for (const r of model.rows()) b.addRow(r.name, r.terms, r.op, r.rhs);
    for (const v of vars) {
      // A free upper bound is left implicit; LP format defaults to +inf.
      if (v.lo !== 0 || isFinite(v.hi)) b.setBound(v.name, v.lo, isFinite(v.hi) ? v.hi : 1e15);
      if (relax) continue;
      if (v.kind === 'BIN') b.binary(v.name);
      else if (v.kind === 'INT') b.general(v.name);
    }
    return b.build();
  }
}

export { fmt };
