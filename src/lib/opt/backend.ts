import { Model } from './model';

/**
 * Solver backend contract. Two implementations ship: HiGHS in-process (always
 * available, MIT, no runtime to deploy) and a remote HTTP backend for anyone who
 * has a licensed solver and somewhere to host it. Formulation code depends on
 * this interface only.
 */

export type SolveStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNBOUNDED' | 'TIME_LIMIT' | 'ERROR';

export interface SolveOptions {
  timeLimitSec?: number;
  /** Stop once the proven gap is within this fraction (0.01 = 1%). */
  mipGap?: number;
  /** Drop integrality — used for bounding, not for producing a plan. */
  relaxIntegrality?: boolean;
  /** Ask for row duals. Only meaningful on a relaxation. */
  wantDuals?: boolean;
}

export interface SolveOutcome {
  status: SolveStatus;
  /** Objective of the incumbent, if one was found. */
  objective: number | null;
  /** Best proven bound on the objective (the dual bound for a MIP). */
  bound: number | null;
  /** (objective − bound) / |bound| as a percentage, when both are known. */
  gapPct: number | null;
  /** True only when the solver proved optimality. */
  proven: boolean;
  values: Record<string, number>;
  duals?: Record<string, number>;
  solver: string;
  wallMs: number;
  message?: string;
}

export interface SolverBackend {
  readonly name: string;
  available(): Promise<boolean>;
  solve(model: Model, opts?: SolveOptions): Promise<SolveOutcome>;
}

export const emptyOutcome = (solver: string, status: SolveStatus, message?: string): SolveOutcome => ({
  status, objective: null, bound: null, gapPct: null, proven: false,
  values: {}, solver, wallMs: 0, message,
});

export function gapOf(objective: number | null, bound: number | null): number | null {
  if (objective == null || bound == null) return null;
  const d = Math.abs(bound);
  if (d < 1e-9) return null;
  return Math.round(((objective - bound) / d) * 1000) / 10;
}
