// "Your strategy vs random vs optimal" (strategyCheck section) and the crash target sweep.
//
// Every arm reports the per-round net in units of the round's initial stake (blackjack: the initial bet, so
// doubles/splits can lose up to 2–4 units; roulette: the layout's total; crash/slot/ocean: the bet).
// Arms of one game share their outcome stream (common random numbers): the same shoes, wheel numbers or crash
// points, so differences between arms come from the decisions, not from luck.
//
// Arm definitions:
// blackjack  yours   = per (hand category, dealer up) action frequencies from the log; unseen situations and
//                      unavailable actions fall back to the basic-strategy chart (D unavailable → H).
//            random  = a uniformly random legal action at every decision (H, S, D on two cards, P on a pair).
//            optimal = the basic-strategy chart (optimalAction), same engine as simulateBj.
// roulette   yours   = the player's actual layouts resampled with replacement.
//            random  = one chip on a bet drawn uniformly from all 109 valid single bets.
//            optimal = no layout can beat −1/37; "optimal" is the lowest-variance one: one even-money bet (red).
// crash      yours   = cashout multipliers resampled from the log (censored rounds: resampled among the observed
//                      multipliers above that crash point; none above → the round is lost, as it was).
//            random  = a target drawn log-uniformly on the 0.01 grid in [1.01, 1000].
//            optimal = every target returns 99%; "optimal" is the lowest-variance one: target 1.01.
// slot/ocean: no decision affects the outcome; only the machine's own distribution ("machine").
//            Ocean counts a triggered bonus in the trigger round (its total is fixed there), so rounds are i.i.d.

import { createRng, createRoundRng, type Rng } from "@shared/rng";
import type { SlotVariant } from "@shared/config";
import { newShoe, needsShuffle, optimalAction, playRound, type Action, type BjPolicy, type Card, type HandView, type Shoe, cardValue } from "@shared/rules/blackjack";
import { returnOf, isValid, type Placed, type RouletteBet } from "@shared/rules/roulette";
import { CRASH, crashPoint, settleCrash } from "@shared/rules/crash";
import { SLOTS, drawStops, evaluate } from "@shared/rules/slot";
import { OCEAN, oceanInit, oceanSpin } from "@shared/rules/ocean";
import { CHECK_EVERY, runSync, type Job } from "./scheduler";
import { blockSums, linearEdges, summarize, type DistSummary } from "./stats";
import { BJ_ACTIONS, bjCategory, bjKey, type BjModel, type CrashModel, type RouletteModel, type StrategyModel } from "./model";

export type StrategyGame = "blackjack" | "roulette" | "crash" | "slot" | "ocean";
export type ArmId = "yours" | "random" | "optimal" | "machine";

export interface StrategyParams {
  game: StrategyGame;
  /** From buildModel. Missing parts → the "yours" arm is omitted. */
  model: StrategyModel | null;
  /** Rounds per arm (spec: 10^5). */
  n: number;
  seed: string;
  /** Also summarize sums over consecutive blocks of this many rounds (e.g. the player's own round count). */
  block?: number;
  /** Slot variant for game "slot" when no model is given (default "a"). */
  sv?: SlotVariant;
}

export interface ArmResult {
  arm: ArmId;
  n: number;
  /** Per-round net in stake units: mean, sd, se, quantiles, histogram, atoms. */
  dist: DistSummary;
  /** Net summed over blocks of `block` rounds (pPos = share of blocks that ended ahead). */
  blocks?: DistSummary;
}

export interface StrategyResult { game: StrategyGame; n: number; block?: number; arms: ArmResult[] }

// ---------------------------------------------------------------------------
// blackjack policies

/** "Yours": sample from the logged frequencies for this situation; fall back to the chart. */
export function modelPolicy(m: BjModel, rng: Rng): BjPolicy {
  return (hand, up) => {
    const c = m.cells[bjKey(bjCategory(hand.cards, hand.can.split), cardValue(up))];
    if (c) {
      const canD = hand.cards.length === 2 && hand.can.double;
      const w = [c[0] + (canD ? 0 : c[2]), c[1], canD ? c[2] : 0, hand.can.split ? c[3] : 0];
      if (w[0] + w[1] + w[2] + w[3] > 0) return BJ_ACTIONS[rng.weighted(w)];
    }
    return optimalAction(hand, up);
  };
}

export function randomPolicy(rng: Rng): BjPolicy {
  return (hand: HandView) => {
    const legal: Action[] = ["H", "S"];
    if (hand.cards.length === 2 && hand.can.double) legal.push("D");
    if (hand.can.split) legal.push("P");
    return legal[rng.int(legal.length)];
  };
}

/** Shoe generator shared by all blackjack arms. */
export const bjShoeRng = (seed: string) => {
  const rr = createRoundRng(seed, "sim:bj:shoe");
  return (no: number) => rr.at(no);
};

function* bjArm(n: number, seed: string, policy: BjPolicy, out: Float64Array, p0: number, pw: number): Job<void> {
  const shoeRng = bjShoeRng(seed);
  let shoe: Shoe = newShoe(1, shoeRng(1));
  for (let i = 0; i < n; i++) {
    if (needsShuffle(shoe)) shoe = newShoe(shoe.no + 1, shoeRng(shoe.no + 1));
    const r = playRound(shoe, 1, policy);
    shoe = r.shoe;
    out[i] = r.payout - r.totalBet;
    if ((i + 1) % CHECK_EVERY === 0) yield p0 + (pw * (i + 1)) / n;
  }
}

// ---------------------------------------------------------------------------
// roulette

/** All valid single bets: 37 straight + 60 split + 6 even-money + 3 dozens + 3 columns = 109. */
export const ALL_BETS: readonly RouletteBet[] = (() => {
  const out: RouletteBet[] = [];
  for (let n = 0; n <= 36; n++) out.push({ kind: "straight", n });
  for (let a = 0; a <= 36; a++) for (let b = a + 1; b <= 36; b++) { const s: RouletteBet = { kind: "split", a, b }; if (isValid(s)) out.push(s); }
  for (const kind of ["red", "black", "odd", "even", "low", "high"] as const) out.push({ kind });
  for (const kind of ["dozen", "column"] as const) for (const i of [1, 2, 3] as const) out.push({ kind, i });
  return out;
})();

type RoulettePick = (rng: Rng) => { bets: readonly Placed[]; total: number };

function* rouletteArm(n: number, seed: string, pick: RoulettePick, pickRng: Rng, out: Float64Array, p0: number, pw: number): Job<void> {
  const wheel = createRng(seed, "sim:roulette:n");
  for (let i = 0; i < n; i++) {
    const L = pick(pickRng);
    const num = wheel.int(37);
    out[i] = (returnOf(L.bets, num) - L.total) / L.total;
    if ((i + 1) % CHECK_EVERY === 0) yield p0 + (pw * (i + 1)) / n;
  }
}

// ---------------------------------------------------------------------------
// crash

const TARGET_SPAN = Math.log(CRASH.maxTarget / CRASH.minTarget);
export function randomTarget(rng: Rng): number {
  const x = CRASH.minTarget * Math.exp(rng.float() * TARGET_SPAN);
  return Math.min(CRASH.maxTarget, Math.max(CRASH.minTarget, Math.round(x * 100) / 100));
}

/** Target picker for the "yours" arm (null = never cash out). */
export function crashModelPicker(m: CrashModel): (rng: Rng) => number | null {
  const obs = m.observed.slice().sort((a, b) => a - b);
  const total = obs.length + m.censored.length;
  return (rng) => {
    const k = rng.int(total);
    if (k < obs.length) return obs[k];
    const c = m.censored[k - obs.length];
    // first observed value strictly above c
    let lo = 0, hi = obs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (obs[mid] > c) hi = mid; else lo = mid + 1; }
    return lo < obs.length ? obs[lo + rng.int(obs.length - lo)] : null;
  };
}

function* crashArm(n: number, seed: string, pick: (rng: Rng) => number | null, pickRng: Rng, out: Float64Array, p0: number, pw: number): Job<void> {
  const pts = createRng(seed, "sim:crash:pt");
  for (let i = 0; i < n; i++) {
    const target = pick(pickRng);
    const crash = crashPoint(pts);
    out[i] = settleCrash(100, crash, target) / 100 - 1;
    if ((i + 1) % CHECK_EVERY === 0) yield p0 + (pw * (i + 1)) / n;
  }
}

// ---------------------------------------------------------------------------
// machines

function* slotArm(n: number, seed: string, sv: SlotVariant, out: Float64Array): Job<void> {
  const cfg = SLOTS[sv];
  const rng = createRng(seed, "sim:slot:" + sv);
  const lines = cfg.lines.length;
  for (let i = 0; i < n; i++) {
    out[i] = evaluate(cfg, drawStops(cfg, rng)).mult / lines - 1;
    if ((i + 1) % CHECK_EVERY === 0) yield (i + 1) / n;
  }
}

function* oceanArm(n: number, seed: string, out: Float64Array): Job<void> {
  const rng = createRng(seed, "sim:ocean");
  const bet = OCEAN.slot.lines.length;
  const st0 = oceanInit();
  for (let i = 0; i < n; i++) {
    const r = oceanSpin(OCEAN, st0, rng, bet).result;
    out[i] = (r.basePay + (r.triggered ? r.triggered.total : 0)) / bet - 1;
    if ((i + 1) % CHECK_EVERY === 0) yield (i + 1) / n;
  }
}

// ---------------------------------------------------------------------------

function arm(id: ArmId, values: Float64Array, block?: number): ArmResult {
  const r: ArmResult = { arm: id, n: values.length, dist: summarize(values) };
  if (block && block >= 1 && values.length >= block) {
    const bs = blockSums(values, block);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < bs.length; i++) { if (bs[i] < lo) lo = bs[i]; if (bs[i] > hi) hi = bs[i]; }
    r.blocks = summarize(bs, { edges: linearEdges(lo, hi + 1e-9, 40) });
  }
  return r;
}

export function* strategyJob(p: StrategyParams): Job<StrategyResult> {
  const n = Math.floor(p.n);
  if (!(n >= 1)) throw new RangeError("strategy: n must be >= 1");
  const block = p.block && p.block >= 1 ? Math.floor(p.block) : undefined;
  const m = p.model;
  const arms: ArmResult[] = [];
  const buf = () => new Float64Array(n);

  switch (p.game) {
    case "blackjack": {
      const list: [ArmId, BjPolicy][] = [];
      if (m?.blackjack) list.push(["yours", modelPolicy(m.blackjack, createRng(p.seed, "sim:bj:yours"))]);
      list.push(["random", randomPolicy(createRng(p.seed, "sim:bj:random"))]);
      list.push(["optimal", (h: HandView, up: Card) => optimalAction(h, up)]);
      for (let k = 0; k < list.length; k++) {
        const v = buf();
        yield* bjArm(n, p.seed, list[k][1], v, k / list.length, 1 / list.length);
        arms.push(arm(list[k][0], v, block));
      }
      break;
    }
    case "roulette": {
      const list: [ArmId, RoulettePick][] = [];
      const rm: RouletteModel | null | undefined = m?.roulette;
      if (rm) list.push(["yours", (rng) => rm.layouts[rng.int(rm.layouts.length)]]);
      list.push(["random", (rng) => ({ bets: [{ bet: ALL_BETS[rng.int(ALL_BETS.length)], amt: 1 }], total: 1 })]);
      const red: { bets: Placed[]; total: number } = { bets: [{ bet: { kind: "red" }, amt: 1 }], total: 1 };
      list.push(["optimal", () => red]);
      for (let k = 0; k < list.length; k++) {
        const v = buf();
        yield* rouletteArm(n, p.seed, list[k][1], createRng(p.seed, "sim:roulette:" + list[k][0]), v, k / list.length, 1 / list.length);
        arms.push(arm(list[k][0], v, block));
      }
      break;
    }
    case "crash": {
      const list: [ArmId, (rng: Rng) => number | null][] = [];
      if (m?.crash && m.crash.rounds > 0) list.push(["yours", crashModelPicker(m.crash)]);
      list.push(["random", randomTarget]);
      list.push(["optimal", () => CRASH.minTarget]);
      for (let k = 0; k < list.length; k++) {
        const v = buf();
        yield* crashArm(n, p.seed, list[k][1], createRng(p.seed, "sim:crash:" + list[k][0]), v, k / list.length, 1 / list.length);
        arms.push(arm(list[k][0], v, block));
      }
      break;
    }
    case "slot": {
      const v = buf();
      yield* slotArm(n, p.seed, m?.slot.sv ?? p.sv ?? "a", v);
      arms.push(arm("machine", v, block));
      break;
    }
    case "ocean": {
      const v = buf();
      yield* oceanArm(n, p.seed, v);
      arms.push(arm("machine", v, block));
      break;
    }
    default:
      throw new RangeError(`strategy: unknown game ${String(p.game)}`);
  }
  return { game: p.game, n, block, arms };
}

/** Synchronous form. */
export function simStrategy(game: StrategyGame, model: StrategyModel | null, n: number, seed: string, o: { block?: number; sv?: SlotVariant; onProgress?: (p: number) => void } = {}): StrategyResult {
  return runSync(strategyJob({ game, model, n, seed, block: o.block, sv: o.sv }), o.onProgress);
}

// ---------------------------------------------------------------------------
// crash target sweep ("any multiplier gives RTP 99%")

export interface CrashTargetsParams { n: number; seed: string; targets?: number[] }
export interface CrashTargetsResult {
  n: number;
  targets: Float64Array;
  /** Mean return per credit bet (payout / bet) and its standard error, per target. */
  rtp: Float64Array;
  se: Float64Array;
  /** Share of rounds cashed out. */
  pWin: Float64Array;
  /** Exact return of the target under crashPoint's discrete u (≈ 0.99). */
  exact: Float64Array;
}

export const DEFAULT_TARGETS = [1.01, 1.2, 1.5, 2, 3, 5, 10, 20, 50, 100, 1000];

/** Exact P(crash ≥ x) · x for crashPoint: u = (k + 1) / 2^32, crash ≥ x ⇔ u ≤ 99 / (100 x) (x on the 0.01 grid, ≤ cap). */
export function crashExactReturn(x: number): number {
  const TWO32 = 4294967296;
  const k = Math.floor((TWO32 * (100 * (1 - CRASH.edge))) / Math.round(100 * x));
  return (Math.min(TWO32, k) / TWO32) * x;
}

export function* crashTargetsJob(p: CrashTargetsParams): Job<CrashTargetsResult> {
  const n = Math.floor(p.n);
  if (!(n >= 1)) throw new RangeError("crashTargets: n must be >= 1");
  const T = Float64Array.from(p.targets ?? DEFAULT_TARGETS);
  const K = T.length;
  const sum = new Float64Array(K), sumSq = new Float64Array(K), wins = new Float64Array(K);
  const rng = createRng(p.seed, "sim:crash:targets");
  for (let i = 0; i < n; i++) {
    const c = crashPoint(rng);   // one crash sequence for every target (common random numbers)
    for (let k = 0; k < K; k++) {
      if (T[k] <= c) { const r = settleCrash(100, c, T[k]) / 100; sum[k] += r; sumSq[k] += r * r; wins[k]++; }
    }
    if ((i + 1) % CHECK_EVERY === 0) yield (i + 1) / n;
  }
  const rtp = new Float64Array(K), se = new Float64Array(K), pWin = new Float64Array(K), exact = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const mean = sum[k] / n;
    const v = n > 1 ? Math.max(0, (sumSq[k] - n * mean * mean) / (n - 1)) : 0;
    rtp[k] = mean; se[k] = Math.sqrt(v / n); pWin[k] = wins[k] / n; exact[k] = crashExactReturn(T[k]);
  }
  return { n, targets: T, rtp, se, pWin, exact };
}
