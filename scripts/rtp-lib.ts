// Pure scoring helpers for scripts/rtp-check.ts (no game imports).

export interface Stat { n: number; mean: number; sd: number; se: number }

/** Streaming mean / sample sd / standard error of the mean. */
export class Acc {
  n = 0;
  private sum = 0;
  private sumSq = 0;
  add(x: number): void { this.n++; this.sum += x; this.sumSq += x * x; }
  stat(): Stat { return statOf(this.n, this.sum, this.sumSq); }
}

export function statOf(n: number, sum: number, sumSq: number): Stat {
  if (n <= 0) return { n: 0, mean: 0, sd: 0, se: 0 };
  const mean = sum / n;
  const sd = n > 1 ? Math.sqrt(Math.max(0, (sumSq - n * mean * mean) / (n - 1))) : 0;
  return { n, mean, sd, se: sd / Math.sqrt(n) };
}

/** |sample - exact| / se. 0 when both equal; Infinity when se is 0 and they differ. */
export function zScore(sample: number, exact: number, se: number): number {
  const d = Math.abs(sample - exact);
  if (d === 0) return 0;
  return se > 0 ? d / se : Infinity;
}

/** Monte-Carlo check: pass when |sample - exact| <= k * se. */
export function mcVerdict(sample: number, exact: number, se: number, k = 4): boolean {
  return zScore(sample, exact, se) <= k;
}

/** Exact check: pass when |value - target| <= tol (tiny slack for float noise). */
export function exactVerdict(value: number, target: number, tol: number): boolean {
  return Math.abs(value - target) <= tol + 1e-12;
}

/** Range check: pass when lo <= value <= hi (slack widens both ends, used for --quick). */
export function rangeVerdict(value: number, lo: number, hi: number, slack = 0): boolean {
  return value >= lo - slack && value <= hi + slack;
}

export interface Row {
  check: string;
  exact: number | null;
  sample: number | null;
  se: number | null;
  z: number | null;
  pass: boolean;
  note?: string;
}

const pct = (x: number | null, d = 4) => (x === null ? "-" : (x * 100).toFixed(d) + "%");

export function formatRows(rows: readonly Row[]): string {
  const head = ["check", "exact", "sample", "SE", "|diff|/SE", "verdict"];
  const body = rows.map((r) => [
    r.check,
    pct(r.exact),
    pct(r.sample),
    r.se === null ? "-" : (r.se * 100).toFixed(4) + "%",
    r.z === null ? "-" : r.z.toFixed(2),
    (r.pass ? "PASS" : "FAIL") + (r.note ? " (" + r.note + ")" : ""),
  ]);
  const all = [head, ...body];
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join("  ");
  return [line(head), w.map((x) => "-".repeat(x)).join("  "), ...body.map(line)].join("\n");
}
