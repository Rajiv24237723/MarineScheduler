/**
 * Solver-agnostic optimisation model.
 *
 * A model is data: variables, rows, an objective sense. Nothing here knows how
 * it will be solved. That is what lets the same formulation run on the bundled
 * HiGHS today and on a licensed Gurobi/OR-Tools service later without the
 * formulation code changing.
 */

export type VarKind = 'CONT' | 'BIN' | 'INT';
export type RowOp = '<=' | '>=' | '=';

export interface Var { name: string; kind: VarKind; lo: number; hi: number; obj: number }
export interface Row { name: string; terms: Array<[number, string]>; op: RowOp; rhs: number }

export class Model {
  readonly sense: 'MIN' | 'MAX';
  private varMap = new Map<string, Var>();
  private rowList: Row[] = [];

  constructor(sense: 'MIN' | 'MAX' = 'MIN') { this.sense = sense; }

  /**
   * Declare a variable. Idempotent on name: re-declaring accumulates the
   * objective coefficient and tightens bounds, so callers can add cost to a
   * variable from more than one place without bookkeeping.
   */
  v(name: string, opts: { kind?: VarKind; lo?: number; hi?: number; obj?: number } = {}): string {
    const existing = this.varMap.get(name);
    if (existing) {
      if (opts.obj) existing.obj += opts.obj;
      if (opts.lo !== undefined) existing.lo = Math.max(existing.lo, opts.lo);
      if (opts.hi !== undefined) existing.hi = Math.min(existing.hi, opts.hi);
      if (opts.kind && opts.kind !== 'CONT') existing.kind = opts.kind;
      return name;
    }
    const kind = opts.kind ?? 'CONT';
    this.varMap.set(name, {
      name, kind,
      lo: opts.lo ?? 0,
      hi: opts.hi ?? (kind === 'BIN' ? 1 : Infinity),
      obj: opts.obj ?? 0,
    });
    return name;
  }

  /** Add a row. Empty rows are dropped — they constrain nothing and confuse solvers. */
  row(name: string, terms: Array<[number, string]>, op: RowOp, rhs: number): void {
    const kept = terms.filter(([c]) => c !== 0 && isFinite(c));
    if (!kept.length) return;
    this.rowList.push({ name, terms: kept, op, rhs });
  }

  vars(): Var[] { return [...this.varMap.values()]; }
  rows(): Row[] { return this.rowList; }
  has(name: string): boolean { return this.varMap.has(name); }

  /** Size report — used to decide whether an instance is worth handing to a solver. */
  size() {
    const vs = this.vars();
    const bin = vs.filter(v => v.kind === 'BIN').length;
    const int = vs.filter(v => v.kind === 'INT').length;
    return {
      vars: vs.length, binaries: bin, integers: int, continuous: vs.length - bin - int,
      rows: this.rowList.length,
      nonZeros: this.rowList.reduce((s, r) => s + r.terms.length, 0),
    };
  }
}
