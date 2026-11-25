// Exact distribution of one slot round (all 32^5 stop combinations), for the `slotStats` job and for sampling slot
// rounds in the bankroll simulation. Same evaluation rules as shared/rules/slot.ts `evaluate`/`slotExact`
// (reel 1 sets the line symbol and has no W; W on reels 2..5 substitutes for everything, 7 included), but it keeps
// the full histogram of the round's total line pay, so the "win smaller than the bet" rate and an exact sampler
// come out of the same pass. The test suite checks every field shared with slotExact for equality.

import { TIER_MIN } from "@shared/config";
import type { SlotConfig } from "@shared/rules/slot";
import { runSync, type Job } from "./scheduler";

const SYMS = ["W", "7", "B", "R", "C", "H", "s", "h", "c", "d"] as const;
const WILD = 0;
const ROWS = 3;

export interface SlotDist {
  id: string;
  lines: number;
  /** Number of stop combinations (32^5 = 33,554,432). */
  cycle: number;
  /** Distinct total line pays m (in line-bet units), ascending, and how many combinations give each. */
  m: Float64Array;
  count: Float64Array;
  // --- the slotExact fields ---
  sumLinePay: number;
  ret: number;
  sigma: number;
  hit: number;
  tierFreq: number[];
  // --- extra ---
  /** Combinations that pay something but less than the total bet (0 < m < lines). */
  under: number;
  hitRate: number;
  underRate: number;
  /** Rounds per tier â‰¥ 2 ("BIG" or better) on average. */
  bigEvery: number;
}

function codesOf(cfg: SlotConfig) {
  const code = (ch: string): number => {
    const i = (SYMS as readonly string[]).indexOf(ch);
    if (i < 0) throw new RangeError(`slotDist: unknown symbol "${ch}"`);
    return i;
  };
  const cells = cfg.strips.map((s) => {
    const n = s.length, a = new Uint8Array(n * ROWS);
    for (let st = 0; st < n; st++) for (let r = 0; r < ROWS; r++) a[st * ROWS + r] = code(s[(st + r) % n]);
    return a;
  });
  const nLines = cfg.lines.length;
  const lineRows = new Uint8Array(nLines * 5);
  cfg.lines.forEach((l, i) => l.forEach((row, r) => { lineRows[i * 5 + r] = row; }));
  const pays = new Int32Array(SYMS.length * 3);
  let maxPay = 0;
  for (let c = 1; c < SYMS.length; c++) {
    const p = cfg.pay[SYMS[c] as Exclude<(typeof SYMS)[number], "W">];
    for (let k = 0; k < 3; k++) { pays[c * 3 + k] = p[k]; if (p[k] > maxPay) maxPay = p[k]; }
  }
  return { cells, lens: cfg.strips.map((s) => s.length), lineRows, nLines, pays, maxPay };
}

/** Generator form (yields progress per (reel-1, reel-2) stop pair, ~32K combinations each). */
export function* slotDistJob(cfg: SlotConfig): Job<SlotDist> {
  const { cells, lens, lineRows, nLines, pays, maxPay } = codesOf(cfg);
  const [n0, n1, n2, n3, n4] = lens;
  const [c0, c1, c2, c3, c4] = cells;
  const hist = new Float64Array(maxPay * nLines + 1);
  const aX = new Int32Array(nLines), aR3 = new Int32Array(nLines), aR4 = new Int32Array(nLines);
  const bX = new Int32Array(nLines), bR4 = new Int32Array(nLines);
  const tail = n3 * n4;
  for (let s0 = 0; s0 < n0; s0++) {
    const o0 = s0 * ROWS;
    for (let s1 = 0; s1 < n1; s1++) {
      const o1 = s1 * ROWS;
      for (let s2 = 0; s2 < n2; s2++) {
        const o2 = s2 * ROWS;
        let k = 0;
        for (let l = 0, o = 0; l < nLines; l++, o += 5) {
          const x = c0[o0 + lineRows[o]];
          if (x === WILD) continue;
          let y = c1[o1 + lineRows[o + 1]];
          if (y !== x && y !== WILD) continue;
          y = c2[o2 + lineRows[o + 2]];
          if (y !== x && y !== WILD) continue;
          aX[k] = x; aR3[k] = lineRows[o + 3]; aR4[k] = lineRows[o + 4]; k++;
        }
        if (k === 0) { hist[0] += tail; continue; }
        for (let s3 = 0; s3 < n3; s3++) {
          const o3 = s3 * ROWS;
          let base = 0, k4 = 0;
          for (let j = 0; j < k; j++) {
            const x = aX[j], y = c3[o3 + aR3[j]];
            if (y === x || y === WILD) { bX[k4] = x; bR4[k4] = aR4[j]; k4++; } else base += pays[x * 3];
          }
          if (k4 === 0) { hist[base] += n4; continue; }
          for (let s4 = 0; s4 < n4; s4++) {
            const o4 = s4 * ROWS;
            let m = base;
            for (let j = 0; j < k4; j++) {
              const x = bX[j], y = c4[o4 + bR4[j]];
              m += pays[x * 3 + (y === x || y === WILD ? 2 : 1)];
            }
            hist[m]++;
          }
        }
      }
      yield (s0 * n1 + s1 + 1) / (n0 * n1);
    }
  }
  return finish(cfg.id, nLines, n0 * n1 * n2 * n3 * n4, hist);
}

function finish(id: string, nLines: number, cycle: number, hist: Float64Array): SlotDist {
  const t1 = TIER_MIN[0] * nLines, t2 = TIER_MIN[1] * nLines, t3 = TIER_MIN[2] * nLines, t4 = TIER_MIN[3] * nLines;
  const ms: number[] = [], cs: number[] = [];
  let sum = 0, sumSq = 0, hit = 0, under = 0;
  const tierFreq = [0, 0, 0, 0, 0];
  for (let m = 0; m < hist.length; m++) {
    const c = hist[m];
    if (c === 0) continue;
    ms.push(m); cs.push(c);
    sum += m * c; sumSq += m * m * c;
    if (m > 0) hit += c;
    if (m > 0 && m < nLines) under += c;
    tierFreq[m >= t4 ? 4 : m >= t3 ? 3 : m >= t2 ? 2 : m >= t1 ? 1 : 0] += c;
  }
  const ret = sum / nLines / cycle;
  const ex2 = sumSq / (nLines * nLines) / cycle;
  const big = tierFreq[2] + tierFreq[3] + tierFreq[4];
  return {
    id, lines: nLines, cycle, m: Float64Array.from(ms), count: Float64Array.from(cs),
    sumLinePay: sum / nLines, ret, sigma: Math.sqrt(Math.max(0, ex2 - ret * ret)), hit, tierFreq,
    under, hitRate: hit / cycle, underRate: under / cycle, bigEvery: big > 0 ? cycle / big : Infinity,
  };
}

const cache = new WeakMap<SlotConfig, SlotDist>();

/** Cached per config object. Callers must not mutate or transfer the returned arrays (copy them). */
export function getSlotDist(cfg: SlotConfig): SlotDist | undefined {
  return cache.get(cfg);
}

/** Generator that fills the cache (yields nothing when already cached). */
export function* slotDistCached(cfg: SlotConfig): Job<SlotDist> {
  const hit = cache.get(cfg);
  if (hit) return hit;
  const d = yield* slotDistJob(cfg);
  cache.set(cfg, d);
  return d;
}

/** Synchronous, cached. 1â€“3 s per variant: workers, tests and scripts only. */
export function slotDist(cfg: SlotConfig): SlotDist {
  return runSync(slotDistCached(cfg));
}
