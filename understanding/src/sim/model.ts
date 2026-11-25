// "Your strategy" models extracted from a session log (ARCHITECTURE §10.3). Plain JSON so they can be posted to
// the worker. Malformed events are skipped, never thrown on: logs come from localStorage.
//
// - blackjack: action counts per (hand category, dealer up value), rebuilt from `out.hands`/`out.dealer` and
//   `dec.steps`. Situations never seen are played with the basic-strategy chart at simulation time.
// - roulette: the actual layouts (`dec.bets`), resampled with replacement.
// - crash: the cashout multipliers the player actually aimed for. A round with an auto target counts its target;
//   a manual cashout counts the multiplier it got. A round with neither (it crashed before the player acted) only
//   says "more than the crash point": it is kept as a censored value and resampled at simulation time.

import type { Ev, Session } from "@shared/schema";
import type { SlotVariant } from "@shared/config";
import { cardFromStr, cardValue, handValue, type Action, type Card } from "@shared/rules/blackjack";
import { isValid, type Placed } from "@shared/rules/roulette";

export const BJ_ACTIONS: readonly Action[] = ["H", "S", "D", "P"];

/** Hand category: "P<v>" a pair that may still be split (v = card value, 1 = A), "S<t>" soft total, "H<t>" hard total. */
export function bjCategory(cards: readonly Card[], canSplit: boolean): string {
  if (canSplit && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) return "P" + cardValue(cards[0]);
  const { total, soft } = handValue(cards);
  return (soft ? "S" : "H") + total;
}
/** Model key: category + ":" + dealer up value (1 = A … 10). */
export const bjKey = (cat: string, upValue: number): string => cat + ":" + upValue;

export interface BjModel {
  rounds: number;
  decisions: number;
  /** key → counts of [H, S, D, P]. */
  cells: Record<string, [number, number, number, number]>;
  /** Decisions where the action matched the logged basic-strategy action. */
  matched: number;
}
export interface RouletteModel { rounds: number; layouts: { bets: Placed[]; total: number }[] }
export interface CrashModel {
  rounds: number;
  /** Intended cashout multipliers (auto target, or the manual cashout multiplier). */
  observed: number[];
  /** Crash points of rounds where the player had no target and never cashed out (intent > crash point). */
  censored: number[];
}
export interface StrategyModel {
  blackjack: BjModel | null;
  roulette: RouletteModel | null;
  crash: CrashModel | null;
  slot: { sv: SlotVariant; rounds: number };
  ocean: { rounds: number };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isAction = (x: unknown): x is Action => x === "H" || x === "S" || x === "D" || x === "P";

/** Rounds of one game, skipping the ocean lump-sum flush Ev (not a round, §5.3). */
function roundsOf(s: Session, game: Ev["game"]): Ev[] {
  const evs = Array.isArray(s.events) ? s.events : [];
  return evs.filter((e) => isObj(e) && e.game === game && !(isObj(e.dec) && e.dec.flush === true));
}

function parseCards(x: unknown): Card[] | null {
  if (!Array.isArray(x)) return null;
  try { return x.map((c) => cardFromStr(String(c))); } catch { return null; }
}

/** Decision views of one blackjack round: [cards at the decision, can split, action, optimal]. Null if inconsistent. */
export function bjDecisions(ev: Ev): { up: Card; list: { cards: Card[]; canSplit: boolean; action: Action; optimal: Action | null }[] } | null {
  const out = ev.out, dec = ev.dec;
  if (!isObj(out) || !isObj(dec) || !Array.isArray(out.hands) || !Array.isArray(out.dealer)) return null;
  const dealer = parseCards(out.dealer);
  if (!dealer || dealer.length < 1) return null;
  const hands: Card[][] = [];
  for (const h of out.hands) {
    const c = isObj(h) ? parseCards(h.cards) : null;
    if (!c) return null;
    hands.push(c);
  }
  const steps = Array.isArray(dec.steps) ? dec.steps : [];
  if (hands.length < 1 || hands.length > 2) return null;
  const list: { cards: Card[]; canSplit: boolean; action: Action; optimal: Action | null }[] = [];
  const used = [2, 2];
  let split = false;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (!isObj(st) || !isAction(st.action)) return null;
    const optimal = isAction(st.optimal) ? st.optimal : null;
    if (st.action === "P") {
      // a split can only be the first decision of the round (one split max, needs exactly two cards)
      if (i !== 0 || hands.length !== 2 || hands[0].length < 1 || hands[1].length < 1) return null;
      const pair = [hands[0][0], hands[1][0]];
      if (cardValue(pair[0]) !== cardValue(pair[1])) return null;
      list.push({ cards: pair, canSplit: true, action: "P", optimal });
      split = true;
      continue;
    }
    const h = split ? (isNum(st.hand) ? st.hand : -1) : 0;
    if (h !== 0 && h !== 1) return null;
    if (!split && hands.length !== 1) return null;
    const cards = hands[h].slice(0, used[h]);
    if (cards.length !== used[h]) return null;
    list.push({ cards, canSplit: !split && i === 0 && cards.length === 2, action: st.action, optimal });
    if (st.action === "H" || st.action === "D") used[h]++;
  }
  return { up: dealer[0], list };
}

function bjModel(s: Session): BjModel | null {
  const evs = roundsOf(s, "blackjack");
  if (evs.length === 0) return null;
  const cells: BjModel["cells"] = {};
  let rounds = 0, decisions = 0, matched = 0;
  for (const ev of evs) {
    const d = bjDecisions(ev);
    if (!d) continue;
    rounds++;
    const up = cardValue(d.up);
    for (const x of d.list) {
      const key = bjKey(bjCategory(x.cards, x.canSplit), up);
      const c = cells[key] ?? (cells[key] = [0, 0, 0, 0]);
      c[BJ_ACTIONS.indexOf(x.action)]++;
      decisions++;
      if (x.optimal === x.action) matched++;
    }
  }
  return rounds > 0 ? { rounds, decisions, cells, matched } : null;
}

function rouletteModel(s: Session): RouletteModel | null {
  const layouts: RouletteModel["layouts"] = [];
  for (const ev of roundsOf(s, "roulette")) {
    const bets = isObj(ev.dec) && Array.isArray(ev.dec.bets) ? ev.dec.bets : null;
    if (!bets) continue;
    const ok: Placed[] = [];
    let total = 0;
    for (const b of bets) {
      if (!isObj(b) || !isObj(b.bet) || !isNum(b.amt) || b.amt <= 0) continue;
      const bet = b.bet as Placed["bet"];
      try { if (!isValid(bet)) continue; } catch { continue; }
      ok.push({ bet, amt: b.amt });
      total += b.amt;
    }
    if (ok.length > 0) layouts.push({ bets: ok, total });
  }
  return layouts.length > 0 ? { rounds: layouts.length, layouts } : null;
}

function crashModel(s: Session): CrashModel | null {
  const observed: number[] = [], censored: number[] = [];
  let rounds = 0;
  for (const ev of roundsOf(s, "crash")) {
    if (!isObj(ev.dec)) continue;
    const target = ev.dec.target, manual = ev.dec.manualCashoutAt;
    const crash = isObj(ev.out) ? ev.out.crash : undefined;
    if (isNum(manual) && manual >= 1) { observed.push(manual); rounds++; }
    else if (isNum(target) && target >= 1) { observed.push(target); rounds++; }
    else if (isNum(crash) && crash >= 1) { censored.push(crash); rounds++; }
  }
  return rounds > 0 ? { rounds, observed, censored } : null;
}

export function buildModel(s: Session): StrategyModel {
  const sv: SlotVariant = s.sv === "b" ? "b" : "a";
  return {
    blackjack: bjModel(s),
    roulette: rouletteModel(s),
    crash: crashModel(s),
    slot: { sv, rounds: roundsOf(s, "slot").length },
    ocean: { rounds: roundsOf(s, "ocean").length },
  };
}
