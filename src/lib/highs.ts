/**
 * HiGHS (WebAssembly) helper — the all-TypeScript LP/MILP solver used for
 * shadow-price (dual) diagnostics and small allocation sub-problems.
 *
 * The heavy routing/inventory logic lives in src/lib/mirp/ (heuristic engine);
 * HiGHS is used here only where an LP relaxation gives genuine marginal values.
 */

// ---------------------------------------------------------------------------
// Loader (cached).
// ---------------------------------------------------------------------------

let highsPromise: Promise<any> | null = null;

export async function getHighs(): Promise<any> {
  if (!highsPromise) {
    // @ts-ignore - the "highs" package ships loose types
    const highsLoader = (await import('highs')).default;
    highsPromise = highsLoader();
  }
  return highsPromise;
}

// ---------------------------------------------------------------------------
// Minimal CPLEX-LP-format builder.
// ---------------------------------------------------------------------------

export class LpBuilder {
  private objTerms: string[] = [];
  private sense: 'Minimize' | 'Maximize' = 'Minimize';
  private rows: string[] = [];
  private bounds: string[] = [];
  private binaries = new Set<string>();
  private generals = new Set<string>();

  setObjective(sense: 'Minimize' | 'Maximize', terms: Array<[number, string]>) {
    this.sense = sense;
    this.objTerms = terms.filter(([c]) => c !== 0).map(([c, v]) => `${fmt(c)} ${v}`);
  }

  /** op ∈ {"<=", ">=", "="}. Rows with no non-zero terms are skipped. */
  addRow(name: string, terms: Array<[number, string]>, op: string, rhs: number) {
    const kept = terms.filter(([c]) => c !== 0);
    if (kept.length === 0) return;
    const lhs = kept.map(([c, v]) => `${fmt(c)} ${v}`).join(' + ');
    this.rows.push(`  ${name}: ${lhs} ${op} ${fmt(rhs)}`);
  }

  setBound(varName: string, lo: number, hi: number) {
    this.bounds.push(`  ${fmt(lo)} <= ${varName} <= ${fmt(hi)}`);
  }

  binary(varName: string) { this.binaries.add(varName); }
  general(varName: string) { this.generals.add(varName); }

  build(): string {
    const parts: string[] = [];
    parts.push(this.sense);
    parts.push(` obj: ${this.objTerms.join(' + ') || '0'}`);
    parts.push('Subject To');
    parts.push(...this.rows);
    if (this.bounds.length) { parts.push('Bounds'); parts.push(...this.bounds); }
    if (this.generals.size) { parts.push('General'); parts.push('  ' + [...this.generals].join(' ')); }
    if (this.binaries.size) { parts.push('Binary'); parts.push('  ' + [...this.binaries].join(' ')); }
    parts.push('End');
    return parts.join('\n');
  }
}

export function fmt(n: number): string {
  if (!isFinite(n)) return '0';
  return (Math.round(n * 1e6) / 1e6).toString();
}

// ---------------------------------------------------------------------------
// Solve + dual extraction.
// ---------------------------------------------------------------------------

export interface HighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<string, { Primal: number; Dual?: number }>;
  Rows: Array<{ Name?: string; Primal?: number; Dual?: number }>;
}

export async function solveLp(lp: string): Promise<HighsSolution> {
  const highs = await getHighs();
  return highs.solve(lp, { output_flag: false });
}

/** Read absolute row duals for the named rows from an LP solution (0 if absent). */
export function rowDuals(sol: HighsSolution, names: string[]): Record<string, number> {
  const byName: Record<string, any> = {};
  if (Array.isArray(sol.Rows)) for (const r of sol.Rows) if (r && r.Name) byName[r.Name] = r;
  const out: Record<string, number> = {};
  for (const n of names) out[n] = byName[n] ? Math.abs(byName[n].Dual ?? 0) : 0;
  return out;
}
