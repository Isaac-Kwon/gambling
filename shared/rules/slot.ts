// ORO SEVENS reel rules (ARCHITECTURE.md 5.6, 7). Pure functions; randomness only from the Rng argument.
import type { SlotVariant } from "../config";
import { TIER_MIN } from "../config";
import type { Rng } from "../rng";

export type Sym = "W" | "7" | "B" | "R" | "C" | "H" | "s" | "h" | "c" | "d";

export interface SlotConfig {
  id: string;
  /** One circular strip per reel. Stop i shows rows 0..2 = strip[i], strip[i+1], strip[i+2]. */
  strips: readonly string[];
  /** Row index (0..2) per reel, one entry per payline. */
  lines: readonly (readonly number[])[];
  /** Line-bet multiples for 3 / 4 / 5 of a kind. */
  pay: Readonly<Record<Exclude<Sym, "W">, readonly [number, number, number]>>;
  top: "7";
}

/** Paylines (row per reel 1..5), shared by every variant and by the ocean machine. */
const LINES: readonly (readonly number[])[] = Object.freeze(
  ("11111 00000 22222 01210 21012 10001 12221 00122 22100 12101 " +
    "10121 01110 21112 01010 21212 11011 11211 00200 22022 02220")
    .split(" ")
    .map((l) => Object.freeze([...l].map(Number))),
);

type PayTable = SlotConfig["pay"];
function payTable(t: {
  "7": readonly [number, number, number]; B: readonly [number, number, number]; R: readonly [number, number, number];
  C: readonly [number, number, number]; H: readonly [number, number, number];
  sh: readonly [number, number, number]; cd: readonly [number, number, number];
}): PayTable {
  return Object.freeze({ "7": t["7"], B: t.B, R: t.R, C: t.C, H: t.H, s: t.sh, h: t.sh, c: t.cd, d: t.cd });
}

/** Variant a (default): frequent small wins. R3 repeats `d` across the seam (index 31 -> 0) on purpose. */
export const SLOT_A: SlotConfig = Object.freeze({
  id: "a",
  strips: Object.freeze([
    "shcdHCBRshcdH7CshcdHBshcdRCHshcd",
    "shcdCHWBRshcd7CHshcdWshcBRCHdshc",
    "dHshcRCWBdHshc7RdCHshcdWBRCHshcd",
    "sdHhcCWBRsdHhc7CsdHhcsdWBRCHhcsd",
    "scdHhRCBscdHh7RCscdHhscdBRCHhscd",
  ]),
  lines: LINES,
  pay: payTable({
    "7": [150, 750, 3000], B: [60, 250, 1000], R: [50, 200, 750], C: [30, 100, 400], H: [20, 80, 300],
    sh: [12, 40, 150], cd: [10, 25, 100],
  }),
  top: "7",
});

/** Variant b (`?sv=b`): fewer, larger wins. Same paylines. */
export const SLOT_B: SlotConfig = Object.freeze({
  id: "b",
  strips: Object.freeze([
    "shcdHCRshcdBH7CshcdRHCshcdBRhsHC",
    "shcdCHWshcdBRHshcd7CRshcdHCBcRCH",
    "shcdHRCWshcdBH7CshcdRBHCshcdBRHC",
    "shcdHCWshcdBRHshcdC7RshcdHCBdRCH",
    "shcdHBRCshcdH7CHshcdRBHCshcdBRHC",
  ]),
  lines: LINES,
  pay: payTable({
    "7": [250, 1000, 3000], B: [100, 400, 2000], R: [75, 250, 1000], C: [40, 150, 600], H: [30, 100, 400],
    sh: [15, 50, 200], cd: [10, 40, 150],
  }),
  top: "7",
});

export const SLOTS: Readonly<Record<SlotVariant, SlotConfig>> = Object.freeze({ a: SLOT_A, b: SLOT_B });

/** line: 0-based index into cfg.lines. pay: line-bet multiple. */
export interface LineWin { line: number; sym: Sym; count: 3 | 4 | 5; pay: number }
/** mult: sum of line pays in line-bet units. payout = mult * lineBet (total bet = lines * lineBet). */
export interface SlotResult { stops: number[]; wins: LineWin[]; mult: number; payout: number; top5: boolean }

// ---- compiled form (typed arrays; derived data only, cached per config object) ----
const SYMS: readonly Sym[] = ["W", "7", "B", "R", "C", "H", "s", "h", "c", "d"];
const WILD = 0;
const ROWS = 3;
const REELS = 5;

interface Compiled {
  lens: Int32Array;
  /** cells[r][stop * 3 + row] = symbol code at that row for that stop. */
  cells: Uint8Array[];
  /** lines flattened: lineRows[l * 5 + r]. */
  lineRows: Uint8Array;
  nLines: number;
  /** pays[code * 3 + (count - 3)] */
  pays: Int32Array;
  top: number;
}

const compiledCache = new WeakMap<SlotConfig, Compiled>();

function codeOf(ch: string): number {
  const i = SYMS.indexOf(ch as Sym);
  if (i < 0) throw new RangeError(`slot: unknown symbol "${ch}"`);
  return i;
}

function compile(cfg: SlotConfig): Compiled {
  const hit = compiledCache.get(cfg);
  if (hit) return hit;
  if (cfg.strips.length !== REELS) throw new RangeError(`slot: need ${REELS} strips`);
  const lens = new Int32Array(REELS);
  const cells = cfg.strips.map((s, r) => {
    const n = s.length;
    if (n < ROWS) throw new RangeError("slot: strip too short");
    lens[r] = n;
    const a = new Uint8Array(n * ROWS);
    for (let st = 0; st < n; st++) for (let row = 0; row < ROWS; row++) a[st * ROWS + row] = codeOf(s[(st + row) % n]);
    return a;
  });
  const nLines = cfg.lines.length;
  const lineRows = new Uint8Array(nLines * REELS);
  cfg.lines.forEach((l, i) => {
    if (l.length !== REELS) throw new RangeError("slot: line needs 5 rows");
    l.forEach((row, r) => {
      if (!(row >= 0 && row < ROWS)) throw new RangeError("slot: bad line row");
      lineRows[i * REELS + r] = row;
    });
  });
  const pays = new Int32Array(SYMS.length * 3);
  for (let c = 1; c < SYMS.length; c++) {
    const p = cfg.pay[SYMS[c] as Exclude<Sym, "W">];
    for (let k = 0; k < 3; k++) pays[c * 3 + k] = p[k];
  }
  const out: Compiled = { lens, cells, lineRows, nLines, pays, top: codeOf(cfg.top) };
  compiledCache.set(cfg, out);
  return out;
}

// ---- draw and evaluate ----

export function drawStops(cfg: SlotConfig, rng: Rng): number[] {
  return cfg.strips.map((s) => rng.int(s.length));
}

/** grid[reel][row 0..2] */
export function gridOf(cfg: SlotConfig, stops: readonly number[]): Sym[][] {
  return cfg.strips.map((s, r) => {
    const n = s.length, i = stops[r];
    return [0, 1, 2].map((row) => s[(i + row) % n] as Sym);
  });
}

/**
 * Left-to-right line wins. The line symbol is reel 1's symbol (reel 1 has no W); W on reels 2..5
 * substitutes for every symbol, `7` included. top5: some line is 7 on reel 1 and 7/W on all five.
 */
export function evaluate(cfg: SlotConfig, stops: readonly number[]): { wins: LineWin[]; mult: number; top5: boolean } {
  const c = compile(cfg);
  const { cells, lineRows, pays } = c;
  const b0 = stops[0] * ROWS, b1 = stops[1] * ROWS, b2 = stops[2] * ROWS, b3 = stops[3] * ROWS, b4 = stops[4] * ROWS;
  const c0 = cells[0], c1 = cells[1], c2 = cells[2], c3 = cells[3], c4 = cells[4];
  const wins: LineWin[] = [];
  let mult = 0, top5 = false;
  for (let l = 0, o = 0; l < c.nLines; l++, o += REELS) {
    const x = c0[b0 + lineRows[o]];
    if (x === WILD) continue;
    let y = c1[b1 + lineRows[o + 1]];
    if (y !== x && y !== WILD) continue;
    y = c2[b2 + lineRows[o + 2]];
    if (y !== x && y !== WILD) continue;
    let count: 3 | 4 | 5 = 3;
    y = c3[b3 + lineRows[o + 3]];
    if (y === x || y === WILD) {
      count = 4;
      y = c4[b4 + lineRows[o + 4]];
      if (y === x || y === WILD) count = 5;
    }
    const pay = pays[x * 3 + count - 3];
    mult += pay;
    if (count === 5 && x === c.top) top5 = true;
    wins.push({ line: l, sym: SYMS[x], count, pay });
  }
  return { wins, mult, top5 };
}

export function spin(cfg: SlotConfig, rng: Rng, lineBet: number): SlotResult {
  const stops = drawStops(cfg, rng);
  const e = evaluate(cfg, stops);
  return { stops, wins: e.wins, mult: e.mult, payout: e.mult * lineBet, top5: e.top5 };
}

// ---- presentation (presentation stream only; called after the result is fixed) ----

const DISP_P = 0.28;
const DISP_TWO = 0.4;

/**
 * dispVar: peek cells (above = strip[i-1] "a", below = strip[i+3] "b") are the only cells that may differ
 * from the strip. Reel indices in `cells` are 0-based. antic: number of reels slowed after two reels show `7`.
 * Never changes the result; only `pre` is consumed.
 */
export function slotPresentation(cfg: SlotConfig, r: SlotResult, pre: Rng): { dispVar?: { cells: [number, "a" | "b"][] }; antic?: number } {
  const c = compile(cfg);
  const out: { dispVar?: { cells: [number, "a" | "b"][] }; antic?: number } = {};
  const shown = (reel: number): boolean => {
    const a = c.cells[reel], b = r.stops[reel] * ROWS;
    return a[b] === c.top || a[b + 1] === c.top || a[b + 2] === c.top;
  };
  const u = pre.float();
  if (!r.top5 && u < DISP_P) {
    const cand: number[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      const s = cfg.strips[reel], n = s.length, i = r.stops[reel];
      const above = s[(i - 1 + n) % n], below = s[(i + 3) % n];
      if (!shown(reel) && above !== cfg.top && below !== cfg.top) cand.push(reel);
    }
    if (cand.length > 0) {
      const k = cand.length >= 2 && pre.float() < DISP_TWO ? 2 : 1;
      const picked: number[] = [];
      for (let j = 0; j < k; j++) picked.push(cand.splice(pre.int(cand.length), 1)[0]);
      picked.sort((x, y) => x - y);
      out.dispVar = { cells: picked.map((reel): [number, "a" | "b"] => [reel, pre.int(2) === 0 ? "a" : "b"]) };
    }
  }
  let seen = 0;
  for (let reel = 0; reel < REELS - 1; reel++) {
    if (shown(reel)) seen++;
    if (reel >= 1 && seen >= 2) { out.antic = REELS - 1 - reel; break; }
  }
  return out;
}

// ---- exact enumeration ----

/**
 * Full pass over every stop combination (32^5 for the shipped strips). Tests, scripts and workers only.
 * sumLinePay: (sum over combos of all line pays) / lines, i.e. the total return in total-bet units.
 * cycle: number of combos. ret = sumLinePay / cycle. sigma: sd of one round in total-bet units.
 * hit: number of combos with any line win. tierFreq[t]: number of combos of tier t (0..4, losses in 0).
 */
export function slotExact(cfg: SlotConfig): { sumLinePay: number; cycle: number; ret: number; sigma: number; hit: number; tierFreq: number[] } {
  const c = compile(cfg);
  const { lens, cells, lineRows, pays, nLines } = c;
  const [n0, n1, n2, n3, n4] = lens;
  const c0 = cells[0], c1 = cells[1], c2 = cells[2], c3 = cells[3], c4 = cells[4];
  const t1 = TIER_MIN[0] * nLines, t2 = TIER_MIN[1] * nLines, t3 = TIER_MIN[2] * nLines, t4 = TIER_MIN[3] * nLines;
  const aX = new Int32Array(nLines), aR3 = new Int32Array(nLines), aR4 = new Int32Array(nLines);
  const bX = new Int32Array(nLines), bR4 = new Int32Array(nLines);
  let sum = 0, sumSq = 0, hit = 0, f0 = 0, f1 = 0, f2 = 0, f3 = 0, f4 = 0;
  const tail = n3 * n4;
  for (let s0 = 0; s0 < n0; s0++) {
    const o0 = s0 * ROWS;
    for (let s1 = 0; s1 < n1; s1++) {
      const o1 = s1 * ROWS;
      for (let s2 = 0; s2 < n2; s2++) {
        const o2 = s2 * ROWS;
        let k = 0;
        for (let l = 0, o = 0; l < nLines; l++, o += REELS) {
          const x = c0[o0 + lineRows[o]];
          if (x === WILD) continue;
          let y = c1[o1 + lineRows[o + 1]];
          if (y !== x && y !== WILD) continue;
          y = c2[o2 + lineRows[o + 2]];
          if (y !== x && y !== WILD) continue;
          aX[k] = x; aR3[k] = lineRows[o + 3]; aR4[k] = lineRows[o + 4]; k++;
        }
        if (k === 0) { f0 += tail; continue; }
        for (let s3 = 0; s3 < n3; s3++) {
          const o3 = s3 * ROWS;
          let base = 0, k4 = 0;
          for (let j = 0; j < k; j++) {
            const x = aX[j], y = c3[o3 + aR3[j]];
            if (y === x || y === WILD) { bX[k4] = x; bR4[k4] = aR4[j]; k4++; } else base += pays[x * 3];
          }
          for (let s4 = 0; s4 < n4; s4++) {
            const o4 = s4 * ROWS;
            let m = base;
            for (let j = 0; j < k4; j++) {
              const x = bX[j], y = c4[o4 + bR4[j]];
              m += pays[x * 3 + (y === x || y === WILD ? 2 : 1)];
            }
            sum += m; sumSq += m * m;
            if (m > 0) hit++;
            if (m >= t4) f4++; else if (m >= t3) f3++; else if (m >= t2) f2++; else if (m >= t1) f1++; else f0++;
          }
        }
      }
    }
  }
  const cycle = n0 * n1 * n2 * n3 * n4;
  const ret = sum / nLines / cycle;
  const ex2 = sumSq / (nLines * nLines) / cycle;
  return { sumLinePay: sum / nLines, cycle, ret, sigma: Math.sqrt(Math.max(0, ex2 - ret * ret)), hit, tierFreq: [f0, f1, f2, f3, f4] };
}

/**
 * Closed form (ARCHITECTURE.md 7.3): reels are independent and strips circular, so every row has the strip's
 * symbol mix and the per-line return does not depend on the line shape. Returns the same `sumLinePay` as
 * slotExact (integer arithmetic) without enumerating.
 */
export function slotFormula(cfg: SlotConfig): { sumLinePay: number; ret: number } {
  const c = compile(cfg);
  const count = (r: number, code: number) => { let n = 0; for (const ch of cfg.strips[r]) if (codeOf(ch) === code) n++; return n; };
  const [, , , n3, n4] = c.lens;
  let s = 0;
  for (let x = 1; x < SYMS.length; x++) {
    const p1 = count(0, x);
    if (p1 === 0) continue;
    const m = [1, 2, 3, 4].map((r) => count(r, x) + count(r, WILD));
    const [m2, m3, m4, m5] = m;
    const p3 = c.pays[x * 3], p4 = c.pays[x * 3 + 1], p5 = c.pays[x * 3 + 2];
    s += p1 * m2 * m3 * (p3 * (n3 - m4) * n4 + p4 * m4 * (n4 - m5) + p5 * m4 * m5);
  }
  const cycle = c.lens.reduce((a, b) => a * b, 1);
  return { sumLinePay: s, ret: s / cycle };
}
