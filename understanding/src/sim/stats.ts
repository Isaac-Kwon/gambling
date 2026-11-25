// Small numeric helpers shared by the simulation jobs. Pure; no DOM, no globals.

/** Histogram of `values` over half-open bins [edges[i], edges[i+1]). Values below edges[0] go to the first bin, values at/above the last edge to the last bin. */
export function histogram(values: ArrayLike<number>, edges: ArrayLike<number>): Uint32Array {
  const nb = edges.length - 1;
  const counts = new Uint32Array(Math.max(0, nb));
  if (nb <= 0) return counts;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    // binary search: last edge <= v
    let lo = 0, hi = nb - 1;
    if (v >= edges[nb]) lo = nb - 1;
    else if (v < edges[0]) lo = 0;
    else {
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (edges[mid] <= v) lo = mid; else hi = mid - 1;
      }
    }
    counts[lo]++;
  }
  return counts;
}

/** `n + 1` evenly spaced edges from lo to hi. */
export function linearEdges(lo: number, hi: number, n: number): Float64Array {
  const e = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) e[i] = lo + ((hi - lo) * i) / n;
  return e;
}

/** Quantile of an ascending-sorted array (linear interpolation, "type 7"). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const h = (n - 1) * Math.min(1, Math.max(0, q));
  const i = Math.floor(h);
  const f = h - i;
  return i + 1 < n ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

export interface Moments { n: number; mean: number; sd: number; se: number }

export function moments(values: ArrayLike<number>): Moments {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN, se: NaN };
  let s = 0;
  for (let i = 0; i < n; i++) s += values[i];
  const mean = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) { const d = values[i] - mean; ss += d * d; }
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return { n, mean, sd, se: sd / Math.sqrt(n) };
}

/** Quantile levels reported in every distribution summary. */
export const Q_LEVELS = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99] as const;

/** Fixed bins for per-round net in units of the stake (see DistSummary.hist). */
export const NET_EDGES: readonly number[] = [-8, -4, -2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 3, 5, 10, 20, 50, 100, 1000, 1e9];

/**
 * Distribution summary of a sample.
 * - atoms: the distinct values and their frequencies when there are at most `maxAtoms` of them (discrete games:
 *   blackjack, roulette, a fixed crash target), else null.
 * - hist: counts over `edges` (default NET_EDGES).
 */
export interface DistSummary extends Moments {
  min: number; max: number;
  pPos: number; pZero: number; pNeg: number;
  /** Values at Q_LEVELS. */
  q: number[];
  atoms: { x: Float64Array; p: Float64Array } | null;
  hist: { edges: Float64Array; counts: Uint32Array };
}

export function summarize(values: ArrayLike<number>, o: { edges?: ArrayLike<number>; maxAtoms?: number } = {}): DistSummary {
  const m = moments(values);
  const n = values.length;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  let pos = 0, zero = 0, neg = 0;
  for (let i = 0; i < n; i++) { const v = sorted[i]; if (v > 0) pos++; else if (v < 0) neg++; else zero++; }
  const maxAtoms = o.maxAtoms ?? 64;
  let atoms: DistSummary["atoms"] = null;
  if (n > 0) {
    const xs: number[] = [], cs: number[] = [];
    for (let i = 0; i < n && xs.length <= maxAtoms; i++) {
      if (i > 0 && sorted[i] === sorted[i - 1]) cs[cs.length - 1]++;
      else { xs.push(sorted[i]); cs.push(1); }
    }
    if (xs.length <= maxAtoms) atoms = { x: Float64Array.from(xs), p: Float64Array.from(cs, (c) => c / n) };
  }
  const edges = Float64Array.from(o.edges ?? NET_EDGES);
  return {
    ...m,
    min: n ? sorted[0] : NaN, max: n ? sorted[n - 1] : NaN,
    pPos: n ? pos / n : NaN, pZero: n ? zero / n : NaN, pNeg: n ? neg / n : NaN,
    q: Q_LEVELS.map((l) => quantileSorted(sorted, l)),
    atoms,
    hist: { edges, counts: histogram(sorted, edges) },
  };
}

/** Sums of consecutive blocks of `size` values (a trailing partial block is dropped). */
export function blockSums(values: ArrayLike<number>, size: number): Float64Array {
  const k = size >= 1 ? Math.floor(values.length / size) : 0;
  const out = new Float64Array(k);
  for (let b = 0; b < k; b++) {
    let s = 0;
    for (let i = b * size, e = i + size; i < e; i++) s += values[i];
    out[b] = s;
  }
  return out;
}
