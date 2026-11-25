/**
 * strategyCheck (BASE_PROMPT §6.5): what the player's choices did, per game.
 *  - blackjack: basic-strategy match rate and the expected value given up by each deviation;
 *  - roulette: betting-pattern detection (martingale progression, betting against a colour streak);
 *  - crash: target / cash-out distribution (every choice returns 99% in the long run);
 *  - slot, ocean: no decision changes the expected return (listed in `noStrategy`).
 */
import type { GameId } from "@shared/config";
import type { Ev, Session } from "@shared/schema";
import { cardFromStr, cardStr, cardValue, handValue, optimalAction, type Action, type Card, type HandView } from "@shared/rules/blackjack";
import { actionEv } from "@shared/rules/blackjackEv";
import { CRASH } from "@shared/rules/crash";
import { RED, type Placed } from "@shared/rules/roulette";
import { STREAK_MIN } from "./constants";
import { crashTarget, isFlush, manualCashoutAt, stakeOf } from "./mapping";

// =========================================================================================== blackjack

export interface BjDecision {
  /** Index in session.events. */
  i: number;
  round: number;
  hand: number;
  cards: string[];
  up: string;
  total: number;
  soft: boolean;
  action: Action;
  optimal: Action;
  match: boolean;
  /** EV given up vs the basic-strategy action, in units of the hand's stake (0 when matched; null if not computable). */
  evLoss: number | null;
  /** evLoss × stake, in credits. */
  evLossCredits: number | null;
}

export interface BlackjackCheck {
  rounds: number;
  decisions: number;
  matches: number;
  /** matches / decisions; null with no decisions. */
  matchRate: number | null;
  /** Σ expected credits given up by deviations. */
  evLossCredits: number;
  /** evLossCredits / Σ initial stakes: how much the deviations added to the house edge. */
  edgeAdded: number | null;
  deviations: BjDecision[];
  all: BjDecision[];
  /** Steps whose hand could not be rebuilt from the log (should be 0). */
  unresolved: number;
}

type BjOut = { dealer?: string[]; hands?: { cards: string[]; bet: number }[] };
type BjStep = { hand: number; action: Action; optimal: Action };

const ACTIONS: readonly string[] = ["H", "S", "D", "P"];
const isAction = (x: unknown): x is Action => typeof x === "string" && ACTIONS.includes(x);

/**
 * Rebuilds the hand at each logged decision from the final cards (a hand's cards are in draw order: two cards at its
 * first decision, one more per hit/double; a split takes the pair [hand0[0], hand1[0]]). `can` (double/split
 * affordability) is not logged, so it is inferred as the most permissive option consistent with the logged
 * `optimal` and the player's own action.
 */
export function bjDecisions(e: Ev, i: number): { list: BjDecision[]; unresolved: number } {
  const out = (e.out ?? {}) as BjOut;
  const steps = ((e.dec as { steps?: unknown } | undefined)?.steps ?? []) as BjStep[];
  const list: BjDecision[] = [];
  let unresolved = 0;
  let hands: Card[][], up: Card;
  try {
    hands = (out.hands ?? []).map((h) => h.cards.map(cardFromStr));
    up = cardFromStr(out.dealer?.[0] ?? "");
  } catch {
    return { list, unresolved: steps.length };
  }
  const cnt = hands.map(() => 2);
  let split = false;
  const stake = stakeOf(e);
  for (const st of steps) {
    if (!st || !isAction(st.action) || !isAction(st.optimal)) { unresolved++; continue; }
    const h = st.hand;
    let cards: Card[];
    if (!split && st.action === "P") cards = [hands[0]?.[0], hands[1]?.[0]];
    else cards = (hands[h] ?? []).slice(0, cnt[h] ?? 0);
    const fromSplit = split;
    if (cards.length < 2 || cards.some((c) => c === undefined)) { unresolved++; continue; }
    const two = cards.length === 2;
    const pair = two && !split && cardValue(cards[0]) === cardValue(cards[1]);
    const cands: HandView["can"][] = [];
    for (const d of two ? [true, false] : [false]) for (const p of pair ? [true, false] : [false]) {
      if (st.action === "D" && !d) continue;
      if (st.action === "P" && !p) continue;
      cands.push({ double: d, split: p });
    }
    const can = cands.find((c) => optimalAction({ cards, fromSplit, can: c }, up) === st.optimal) ?? cands[0] ?? { double: false, split: false };
    const view: HandView = { cards, fromSplit, can };
    const match = st.action === st.optimal;
    let loss: number | null = 0;
    if (!match) {
      const x = actionEv(view, up, st.optimal) - actionEv(view, up, st.action);
      loss = Number.isFinite(x) ? Math.max(0, x) : null;
    }
    const hv = handValue(cards);
    list.push({
      i, round: e.round, hand: h, cards: cards.map(cardStr), up: cardStr(up), total: hv.total, soft: hv.soft,
      action: st.action, optimal: st.optimal, match, evLoss: loss, evLossCredits: loss === null ? null : loss * stake,
    });
    if (st.action === "P") split = true;
    else if (st.action === "H" || st.action === "D") cnt[h] = (cnt[h] ?? 2) + 1;
  }
  return { list, unresolved };
}

export function blackjackCheck(s: Session): BlackjackCheck | null {
  const all: BjDecision[] = [];
  let rounds = 0, unresolved = 0, stakes = 0;
  s.events.forEach((e, i) => {
    if (e.game !== "blackjack" || isFlush(e)) return;
    rounds++;
    stakes += stakeOf(e);
    const r = bjDecisions(e, i);
    all.push(...r.list);
    unresolved += r.unresolved;
  });
  if (rounds === 0) return null;
  const matches = all.filter((d) => d.match).length;
  const deviations = all.filter((d) => !d.match);
  let loss = 0;
  for (const d of deviations) loss += d.evLossCredits ?? 0;
  return {
    rounds, decisions: all.length, matches, matchRate: all.length ? matches / all.length : null,
    evLossCredits: loss, edgeAdded: stakes > 0 ? loss / stakes : null, deviations, all, unresolved,
  };
}

// =========================================================================================== roulette

export type Colour = "red" | "black" | "green";
export const colourOf = (n: number): Colour => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

export interface RouletteCheck {
  rounds: number;
  martingale: {
    /** Rounds whose total stake was about doubled (×1.8–2.2) right after a losing round. */
    doublings: number;
    /** Chains of consecutive doublings (len = number of doublings in the chain). */
    runs: { from: number; to: number; len: number; maxStake: number }[];
    /** Two or more doublings. */
    detected: boolean;
    maxStake: number;
  };
  streak: {
    /** Rounds played right after a run of ≥ STREAK_MIN same-colour results. */
    opportunities: number;
    /** …of which the colour bet was on the other colour (the "it's due" bet). */
    against: number;
    /** …of which the colour bet followed the streak. */
    with: number;
    cases: { i: number; round: number; streakColour: "red" | "black"; streakLen: number; bet: "against" | "with"; amt: number }[];
  };
  /** Credits staked by bet kind. */
  mix: Record<string, number>;
}

export function rouletteCheck(s: Session): RouletteCheck | null {
  const evs: { e: Ev; i: number }[] = [];
  s.events.forEach((e, i) => { if (e.game === "roulette" && !isFlush(e)) evs.push({ e, i }); });
  if (evs.length === 0) return null;
  const mix: Record<string, number> = {};
  let doublings = 0, maxStake = 0;
  const runs: RouletteCheck["martingale"]["runs"] = [];
  let cur: (typeof runs)[number] | null = null;
  const cases: RouletteCheck["streak"]["cases"] = [];
  let opps = 0;
  let sColour: Colour | null = null, sLen = 0;
  evs.forEach(({ e, i }, k) => {
    const bets = ((e.dec as { bets?: Placed[] } | undefined)?.bets ?? []) as Placed[];
    let red = 0, black = 0;
    for (const p of bets) {
      const kind = p?.bet?.kind ?? "?";
      mix[kind] = (mix[kind] ?? 0) + (p?.amt ?? 0);
      if (kind === "red") red += p.amt;
      else if (kind === "black") black += p.amt;
    }
    maxStake = Math.max(maxStake, e.bet);
    // martingale
    const prev = k > 0 ? evs[k - 1].e : null;
    const dbl = !!prev && prev.net < 0 && prev.bet > 0 && e.bet >= prev.bet * 1.8 && e.bet <= prev.bet * 2.2;
    if (dbl) {
      doublings++;
      if (cur && cur.to === evs[k - 1].i) { cur.to = i; cur.len++; cur.maxStake = Math.max(cur.maxStake, e.bet); }
      else { cur = { from: evs[k - 1].i, to: i, len: 1, maxStake: e.bet }; runs.push(cur); }
    }
    // streak (results before this round)
    if (sColour && sColour !== "green" && sLen >= STREAK_MIN) {
      opps++;
      const same = sColour === "red" ? red : black, other = sColour === "red" ? black : red;
      if (other > 0 && same === 0) cases.push({ i, round: e.round, streakColour: sColour, streakLen: sLen, bet: "against", amt: other });
      else if (same > 0 && other === 0) cases.push({ i, round: e.round, streakColour: sColour, streakLen: sLen, bet: "with", amt: same });
    }
    const n = (e.out as { n?: unknown } | undefined)?.n;
    if (typeof n === "number") {
      const c = colourOf(n);
      if (c === sColour) sLen++; else { sColour = c; sLen = 1; }
    }
  });
  return {
    rounds: evs.length,
    martingale: { doublings, runs, detected: doublings >= 2, maxStake },
    streak: {
      opportunities: opps,
      against: cases.filter((c) => c.bet === "against").length,
      with: cases.filter((c) => c.bet === "with").length,
      cases,
    },
    mix,
  };
}

// =========================================================================================== crash

export const CRASH_BINS: readonly number[] = [1.01, 1.5, 2, 3, 5, 10, 100, Infinity];

export interface CrashCheck {
  rounds: number;
  /** Rounds ended by the auto target (or that crashed below it) without a tap. */
  auto: number;
  /** Rounds with a manual cash-out tap. */
  manual: number;
  /** Rounds with neither a target nor a tap (rode to the crash). */
  none: number;
  targets: number[];
  manualAt: number[];
  /** The multiple the player went for: the tap if any, else the target. */
  chosen: number[];
  /** Histogram of `chosen` over CRASH_BINS ([lo, hi)). */
  bins: { lo: number; hi: number; n: number }[];
  wagered: number;
  paid: number;
  /** paid / wagered in this session (null when nothing was staked). */
  actualReturn: number | null;
  /** 1 − edge, for any target and any cash-out point. */
  theoreticalReturn: number;
}

export function crashCheck(s: Session): CrashCheck | null {
  const r: CrashCheck = {
    rounds: 0, auto: 0, manual: 0, none: 0, targets: [], manualAt: [], chosen: [], bins: [],
    wagered: 0, paid: 0, actualReturn: null, theoreticalReturn: 1 - CRASH.edge,
  };
  for (const e of s.events) {
    if (e.game !== "crash" || isFlush(e)) continue;
    r.rounds++;
    r.wagered += e.bet; r.paid += e.payout;
    const tgt = crashTarget(e), tap = manualCashoutAt(e);
    if (tgt !== null) r.targets.push(tgt);
    if (tap !== null) { r.manual++; r.manualAt.push(tap); r.chosen.push(tap); }
    else if (tgt !== null) { r.auto++; r.chosen.push(tgt); }
    else r.none++;
  }
  if (r.rounds === 0) return null;
  for (let k = 0; k < CRASH_BINS.length - 1; k++) {
    const lo = CRASH_BINS[k], hi = CRASH_BINS[k + 1];
    r.bins.push({ lo, hi, n: r.chosen.filter((x) => x >= lo && x < hi).length });
  }
  r.actualReturn = r.wagered > 0 ? r.paid / r.wagered : null;
  return r;
}

// =========================================================================================== all

export interface StrategyCheck {
  blackjack: BlackjackCheck | null;
  roulette: RouletteCheck | null;
  crash: CrashCheck | null;
  /** Games played where no choice changes the expected return (slot, ocean). */
  noStrategy: GameId[];
}

export function strategyCheck(s: Session): StrategyCheck {
  const played = new Set<GameId>();
  for (const e of s.events) if (!isFlush(e)) played.add(e.game);
  return {
    blackjack: blackjackCheck(s),
    roulette: rouletteCheck(s),
    crash: crashCheck(s),
    noStrategy: (["slot", "ocean"] as const).filter((g) => played.has(g)),
  };
}
