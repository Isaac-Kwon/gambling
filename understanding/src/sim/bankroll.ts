// Bankroll Monte Carlo ("sim" section): many players, each with the same bankroll, play `rounds` rounds of one
// payoff with a betting system. Deterministic by seed and independent of how the work is sliced: player i always
// uses its own generator createRoundRng(seed, "sim:bankroll").at(i).

import { createRoundRng } from "@shared/rng";
import { SLOTS } from "@shared/rules/slot";
import type { SlotVariant } from "@shared/config";
import { CHECK_EVERY, runSync, type Job } from "./scheduler";
import { histogram, linearEdges, moments, quantileSorted, Q_LEVELS } from "./stats";
import { getSlotDist, slotDistCached } from "./slotDist";

export type BetSystem = "flat" | "martingale" | "fibonacci" | "dalembert";
export const BET_SYSTEMS: readonly BetSystem[] = ["flat", "martingale", "fibonacci", "dalembert"];

/**
 * What one round pays, as a multiple of the stake (stake included).
 * - even: wins 2× with probability (1 − edge) / 2, else 0 (red/black-style bet with the given house edge).
 * - straight: wins 36× with probability (1 − edge) / 36, else 0 (single-number bet, same edge, high variance).
 * - slot: the exact distribution of that slot variant (edge is the machine's own; the `edge` param is ignored).
 */
export type Payoff = { kind: "even" } | { kind: "straight" } | { kind: "slot"; sv: SlotVariant };

export interface BankrollParams {
  /** House edge (0.027 = 2.7%). Used by "even" and "straight". */
  edge: number;
  rounds: number;
  system: BetSystem;
  /** Starting credits per player. */
  bankroll: number;
  /** Base (minimum) bet. A player whose balance falls below it is ruined and stops. */
  baseBet: number;
  players: number;
  seed: string;
  payoff?: Payoff;
  /** Table limit on one bet (default: none). */
  maxBet?: number;
  /** Number of players whose balance path is returned (default 20). */
  paths?: number;
  /** Max points per sample path / ruin curve (default 200). */
  points?: number;
  /** Histogram bins for the final balance (default 40). */
  bins?: number;
}

export interface BankrollResult {
  players: number; rounds: number; system: BetSystem; bankroll: number; baseBet: number;
  /** Effective house edge of the payoff (1 − expected return per credit wagered). */
  edge: number;
  /** Final balance of every player (index = player). */
  finals: Float64Array;
  hist: { edges: Float64Array; counts: Uint32Array };
  mean: number; sd: number;
  /** Final balance at Q_LEVELS. */
  q: number[];
  /** Fraction of players ruined (balance < baseBet) by the end. */
  ruinRate: number;
  /** x: round numbers (0 … rounds); ruined[k]: fraction ruined by round x[k]. */
  ruinCurve: { x: Float64Array; ruined: Float64Array };
  /** Sample paths: balance of player p at round x[k] is paths[p * x.length + k]. */
  paths: { n: number; x: Float64Array; y: Float64Array };
  /** Players who ended above the starting bankroll. */
  ahead: { n: number; rate: number; mean: number };
  /** The top 1% by final balance ("the ones you hear about"). */
  top1: { n: number; threshold: number; mean: number };
  /** Players who were never ruined. */
  survivors: { n: number; mean: number };
  /** Credits wagered per player, mean. */
  wageredMean: number;
  /** Net result per credit wagered over all players (Σnet / Σwagered) and its standard error. ≈ −edge. */
  perWagered: { mean: number; se: number };
}

const FIB: number[] = [1, 1];
function fib(i: number): number {
  while (FIB.length <= i) FIB.push(FIB[FIB.length - 1] + FIB[FIB.length - 2]);
  return FIB[i];
}

/** Resolved payoff: return multiples x[] with cumulative probabilities cum[] (cum[last] = 1). */
interface Table { x: Float64Array; cum: Float64Array; edge: number }

function tableOf(values: number[], probs: number[]): Table {
  const cum = new Float64Array(probs.length);
  let s = 0, ev = 0;
  for (let i = 0; i < probs.length; i++) { s += probs[i]; cum[i] = s; ev += values[i] * probs[i]; }
  for (let i = 0; i < cum.length; i++) cum[i] /= s;
  cum[cum.length - 1] = 1;
  return { x: Float64Array.from(values), cum, edge: 1 - ev / s };
}

function* payoffTable(p: BankrollParams): Job<Table> {
  const po = p.payoff ?? { kind: "even" };
  if (po.kind === "slot") {
    const cfg = SLOTS[po.sv];
    const d = getSlotDist(cfg) ?? (yield* slotDistCached(cfg));
    return tableOf(Array.from(d.m, (m) => m / d.lines), Array.from(d.count, (c) => c / d.cycle));
  }
  const e = Math.min(1, Math.max(-1, p.edge));
  if (po.kind === "straight") return tableOf([0, 36], [1 - (1 - e) / 36, (1 - e) / 36]);
  return tableOf([0, 2], [(1 + e) / 2, (1 - e) / 2]);
}

function check(p: BankrollParams): void {
  const posInt = (v: number) => Number.isInteger(v) && v > 0;
  if (!posInt(p.rounds) || !posInt(p.players)) throw new RangeError("bankroll: rounds and players must be positive integers");
  if (!(p.baseBet > 0) || !(p.bankroll >= p.baseBet)) throw new RangeError("bankroll: need bankroll >= baseBet > 0");
  if (!BET_SYSTEMS.includes(p.system)) throw new RangeError(`bankroll: unknown system ${String(p.system)}`);
  if (!(p.edge > -1 && p.edge < 1)) throw new RangeError("bankroll: edge must be in (-1, 1)");
}

/**
 * Betting systems (state updated after every round; a push — return exactly 1× — leaves it unchanged):
 * - flat: always baseBet.
 * - martingale: double after a loss, back to baseBet after a win.
 * - fibonacci: baseBet × F(i), F = 1,1,2,3,5,…; one step up after a loss, two steps down after a win.
 * - dalembert: baseBet × level; level +1 after a loss, −1 (min 1) after a win.
 * The stake is min(system bet, maxBet, balance): a player who cannot cover the system's bet goes all in with
 * what is left. A balance below baseBet ends that player's session (ruin).
 */
export function* bankrollJob(p: BankrollParams): Job<BankrollResult> {
  check(p);
  const tab = yield* payoffTable(p);
  const { x: tx, cum } = tab;
  const nOut = tx.length;
  const N = p.players, R = p.rounds, base = p.baseBet, start = p.bankroll;
  const maxBet = p.maxBet ?? Infinity;
  const nPaths = Math.min(N, Math.max(0, p.paths ?? 20));
  const pts = Math.max(2, Math.min(p.points ?? 200, R + 1));
  // grid of round numbers 0..R (inclusive) with at most `pts` points
  const stride = Math.max(1, Math.ceil(R / (pts - 1)));
  const xs: number[] = [];
  for (let r = 0; r < R; r += stride) xs.push(r);
  xs.push(R);
  const gx = Float64Array.from(xs);
  const G = gx.length;
  const paths = new Float64Array(nPaths * G);

  const finals = new Float64Array(N);
  const wagered = new Float64Array(N);
  const ruinAt = new Int32Array(N).fill(-1);
  const rr = createRoundRng(p.seed, "sim:bankroll");
  const sys = p.system;
  let work = 0;

  for (let i = 0; i < N; i++) {
    const rng = rr.at(i);
    let bal = start, w = 0, step = 0;   // step: martingale bet / fibonacci index / d'Alembert level
    if (sys === "martingale") step = base; else if (sys === "dalembert") step = 1;
    const rec = i < nPaths;
    let gk = 0;
    if (rec) { paths[i * G] = bal; gk = 1; }
    let r = 0;
    for (; r < R; r++) {
      if (bal < base) break;
      let want = sys === "flat" ? base : sys === "martingale" ? step : sys === "fibonacci" ? base * fib(step) : base * step;
      if (want > maxBet) want = maxBet;
      const stake = want < bal ? want : bal;
      // draw the outcome
      const u = rng.float();
      let k = 0;
      if (nOut === 2) k = u < cum[0] ? 0 : 1;
      else { let lo = 0, hi = nOut - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (u < cum[mid]) hi = mid; else lo = mid + 1; } k = lo; }
      const mult = tx[k];
      bal += stake * (mult - 1);
      w += stake;
      if (mult > 1) {
        if (sys === "martingale") step = base;
        else if (sys === "fibonacci") step = step >= 2 ? step - 2 : 0;
        else if (sys === "dalembert") step = step > 1 ? step - 1 : 1;
      } else if (mult < 1) {
        if (sys === "martingale") step *= 2;
        else if (sys === "fibonacci") step++;
        else if (sys === "dalembert") step++;
      }
      if (rec) while (gk < G && gx[gk] === r + 1) paths[i * G + gk++] = bal;
    }
    if (bal < base) ruinAt[i] = r;   // r = rounds actually played
    if (rec) while (gk < G) paths[i * G + gk++] = bal;
    finals[i] = bal;
    wagered[i] = w;
    work += r + 1;
    if (work >= CHECK_EVERY) { work = 0; yield (i + 1) / N; }
  }

  // --- summaries ---
  const m = moments(finals);
  const sorted = finals.slice().sort();
  const q = Q_LEVELS.map((l) => quantileSorted(sorted, l));
  const bins = Math.max(1, p.bins ?? 40);
  const hi = Math.max(start * 1.5, quantileSorted(sorted, 0.995)) * 1.0001;
  const edges = linearEdges(0, hi, bins);
  const counts = histogram(finals, edges);

  let ruined = 0;
  const ruinByRound = new Float64Array(G);
  for (let i = 0; i < N; i++) {
    if (ruinAt[i] < 0) continue;
    ruined++;
    // first grid point at or after the ruin round
    let lo = 0, h = G - 1;
    while (lo < h) { const mid = (lo + h) >> 1; if (gx[mid] >= ruinAt[i]) h = mid; else lo = mid + 1; }
    ruinByRound[lo]++;
  }
  const ruinCurve = new Float64Array(G);
  let acc = 0;
  for (let k = 0; k < G; k++) { acc += ruinByRound[k]; ruinCurve[k] = acc / N; }

  let aheadN = 0, aheadSum = 0, survN = 0, survSum = 0;
  for (let i = 0; i < N; i++) {
    if (finals[i] > start) { aheadN++; aheadSum += finals[i]; }
    if (ruinAt[i] < 0) { survN++; survSum += finals[i]; }
  }
  const topN = Math.max(1, Math.ceil(N * 0.01));
  let topSum = 0;
  for (let i = N - topN; i < N; i++) topSum += sorted[i];

  // ratio estimator Σnet / Σwagered with its delta-method standard error
  let sNet = 0, sW = 0;
  for (let i = 0; i < N; i++) { sNet += finals[i] - start; sW += wagered[i]; }
  const ratio = sW > 0 ? sNet / sW : 0;
  let ssr = 0;
  for (let i = 0; i < N; i++) { const d = finals[i] - start - ratio * wagered[i]; ssr += d * d; }
  const wMean = sW / N;
  const se = N > 1 && wMean > 0 ? Math.sqrt(ssr / (N * (N - 1))) / wMean : 0;

  return {
    players: N, rounds: R, system: sys, bankroll: start, baseBet: base, edge: tab.edge,
    finals, hist: { edges, counts }, mean: m.mean, sd: m.sd, q,
    ruinRate: ruined / N, ruinCurve: { x: gx, ruined: ruinCurve },
    paths: { n: nPaths, x: gx.slice(), y: paths },
    ahead: { n: aheadN, rate: aheadN / N, mean: aheadN ? aheadSum / aheadN : NaN },
    top1: { n: topN, threshold: sorted[N - topN], mean: topSum / topN },
    survivors: { n: survN, mean: survN ? survSum / survN : NaN },
    wageredMean: wMean,
    perWagered: { mean: ratio, se },
  };
}

/** Synchronous form: simPlayers({edge, rounds, system, bankroll, baseBet, players, seed}, onProgress). */
export function simPlayers(p: BankrollParams, onProgress?: (p: number) => void): BankrollResult {
  return runSync(bankrollJob(p), onProgress);
}
