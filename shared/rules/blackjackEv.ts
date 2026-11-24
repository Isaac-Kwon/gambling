// Per-action expected values for blackjack, infinite-deck approximation (every draw: A, 2..9 each 1/13, ten-value 4/13).
// For understanding and scripts only; the gambling page does not import this file.
// Values are in units of the hand's bet before the action (a double therefore ranges over ±2, a split over ±4).
// Decisions happen after the peek, so the dealer's distribution is conditioned on "dealer has no natural".

import { BJ, cardValue, chartAction, type Action, type Card, type HandView } from "./blackjack";

/** Draw probability by value 1..10 (index 0 unused). */
const PV: readonly number[] = [0, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 4 / 13];

const best = (hard: number, ace: boolean): number => (ace && hard + 10 <= 21 ? hard + 10 : hard);
const key = (hard: number, ace: boolean): number => hard * 2 + (ace ? 1 : 0);

// --- dealer ---------------------------------------------------------------

/** Final dealer distribution from (hard, ace): [P17, P18, P19, P20, P21, Pbust]. S17. */
const dealerMemo = new Map<number, number[]>();
function dealerFrom(hard: number, ace: boolean): number[] {
  const b = best(hard, ace);
  if (b > 21) return [0, 0, 0, 0, 0, 1];
  if (b >= 17) { const r = [0, 0, 0, 0, 0, 0]; r[b - 17] = 1; return r; }
  const k = key(hard, ace);
  const m = dealerMemo.get(k);
  if (m) return m;
  const r = [0, 0, 0, 0, 0, 0];
  for (let v = 1; v <= 10; v++) {
    const d = dealerFrom(hard + v, ace || v === 1);
    for (let i = 0; i < 6; i++) r[i] += PV[v] * d[i];
  }
  dealerMemo.set(k, r);
  return r;
}

/** Probability that the dealer has a natural, given the up card value (1 = A). */
export function dealerNaturalProb(upValue: number): number {
  return upValue === 1 ? PV[10] : upValue === 10 ? PV[1] : 0;
}

/**
 * Dealer final totals for an up card value (1 = A), conditioned on no dealer natural:
 * [P(17), P(18), P(19), P(20), P(21), P(bust)].
 */
export function dealerDist(upValue: number): readonly number[] {
  const r = [0, 0, 0, 0, 0, 0];
  let w = 0;
  for (let v = 1; v <= 10; v++) {
    if ((upValue === 1 && v === 10) || (upValue === 10 && v === 1)) continue;
    const d = dealerFrom(upValue + v, upValue === 1 || v === 1);
    for (let i = 0; i < 6; i++) r[i] += PV[v] * d[i];
    w += PV[v];
  }
  return r.map((x) => x / w);
}

// --- player, per dealer up value --------------------------------------------

interface Tab { up: number; d: readonly number[]; opt: Map<number, number>; chart: Map<number, number> }
const tabs: (Tab | undefined)[] = [];
function tab(up: number): Tab {
  let t = tabs[up];
  if (!t) { t = { up, d: dealerDist(up), opt: new Map(), chart: new Map() }; tabs[up] = t; }
  return t;
}

function standEv(total: number, d: readonly number[]): number {
  if (total > 21) return -1;
  let ev = d[5];
  for (let i = 0; i < 5; i++) {
    const f = 17 + i;
    if (total > f) ev += d[i];
    else if (total < f) ev -= d[i];
  }
  return ev;
}

/** Best of hit/stand from here on (no double, no split). */
function optHS(t: Tab, hard: number, ace: boolean): number {
  const b = best(hard, ace);
  if (b > 21) return -1;
  const k = key(hard, ace);
  const m = t.opt.get(k);
  if (m !== undefined) return m;
  const r = Math.max(standEv(b, t.d), hitEv(t, hard, ace));
  t.opt.set(k, r);
  return r;
}
function hitEv(t: Tab, hard: number, ace: boolean): number {
  let e = 0;
  for (let v = 1; v <= 10; v++) e += PV[v] * optHS(t, hard + v, ace || v === 1);
  return e;
}
function doubleEv(t: Tab, hard: number, ace: boolean): number {
  let e = 0;
  for (let v = 1; v <= 10; v++) e += PV[v] * standEv(best(hard + v, ace || v === 1), t.d);
  return 2 * e;
}

/** Hit/stand from here on following the chart (no double, no split available). */
function chartHS(t: Tab, hard: number, ace: boolean): number {
  const b = best(hard, ace);
  if (b > 21) return -1;
  const k = key(hard, ace);
  const m = t.chart.get(k);
  if (m !== undefined) return m;
  let r: number;
  if (chartAction(b, b !== hard, 0, t.up, false) === "S") r = standEv(b, t.d);
  else { r = 0; for (let v = 1; v <= 10; v++) r += PV[v] * chartHS(t, hard + v, ace || v === 1); }
  t.chart.set(k, r);
  return r;
}

type Mode = "best" | "chart";

/** One split hand: the pair card plus one draw. No resplit; double after split per rules; split aces get one card. */
function splitEv(t: Tab, pv: number, mode: Mode): number {
  let e = 0;
  for (let v = 1; v <= 10; v++) {
    const hard = pv + v, ace = pv === 1 || v === 1, b = best(hard, ace);
    let h: number;
    if (pv === 1) h = standEv(b, t.d);
    else if (mode === "best") {
      h = Math.max(standEv(b, t.d), hitEv(t, hard, ace), BJ.das ? doubleEv(t, hard, ace) : -Infinity);
    } else {
      const a = b >= 21 ? "S" : chartAction(b, b !== hard, 0, t.up, BJ.das);
      h = actionValue(t, hard, ace, a, "chart");
    }
    e += PV[v] * h;
  }
  return 2 * e;
}

function actionValue(t: Tab, hard: number, ace: boolean, a: Action, mode: Mode, pairValue = 0): number {
  switch (a) {
    case "S": return standEv(best(hard, ace), t.d);
    case "H": return mode === "best" ? hitEv(t, hard, ace) : (() => {
      let e = 0;
      for (let v = 1; v <= 10; v++) e += PV[v] * chartHS(t, hard + v, ace || v === 1);
      return e;
    })();
    case "D": return doubleEv(t, hard, ace);
    case "P": return splitEv(t, pairValue, mode);
  }
}

// --- public -----------------------------------------------------------------

function facts(hand: HandView) {
  let hard = 0, ace = false;
  for (const c of hand.cards) { const v = cardValue(c); hard += v; if (v === 1) ace = true; }
  const two = hand.cards.length === 2;
  const pair = two && cardValue(hand.cards[0]) === cardValue(hand.cards[1]);
  return {
    hard, ace, total: best(hard, ace),
    natural: two && !hand.fromSplit && best(hard, ace) === 21,
    canDouble: two && hand.can.double && (!hand.fromSplit || BJ.das),
    canSplit: pair && hand.can.split && (!hand.fromSplit || BJ.resplit),
    pairValue: pair ? cardValue(hand.cards[0]) : 0,
  };
}

/**
 * Expected value of taking `a` now and then playing hit/stand optimally (infinite deck), in units of the hand's
 * current bet. NaN when `a` is not available (D/P per `hand.can` and the rules). A busted hand is −1.
 */
export function actionEv(hand: HandView, dealerUp: Card, a: Action): number {
  const f = facts(hand);
  if ((a === "D" && !f.canDouble) || (a === "P" && !f.canSplit)) return NaN;
  if (f.total > 21) return -1;
  if (a === "S" && f.natural) return BJ.bjPays;
  return actionValue(tab(cardValue(dealerUp)), f.hard, f.ace, a, "best", f.pairValue);
}

/** actionEv for all four actions (NaN = not available). */
export function actionEvs(hand: HandView, dealerUp: Card): Record<Action, number> {
  return { H: actionEv(hand, dealerUp, "H"), S: actionEv(hand, dealerUp, "S"), D: actionEv(hand, dealerUp, "D"), P: actionEv(hand, dealerUp, "P") };
}

/** The available action with the highest actionEv (ties: S, H, D, P order). */
export function bestAction(hand: HandView, dealerUp: Card): { action: Action; ev: number } {
  const evs = actionEvs(hand, dealerUp);
  let action: Action = "S", ev = -Infinity;
  for (const a of ["S", "H", "D", "P"] as const) if (evs[a] > ev) { ev = evs[a]; action = a; }
  return { action, ev };
}

/** EV given up by choosing `a` instead of the best available action (≥ 0; NaN if `a` was not available). */
export function evLoss(hand: HandView, dealerUp: Card, a: Action): number {
  return bestAction(hand, dealerUp).ev - actionEv(hand, dealerUp, a);
}

/**
 * Expected net per initial bet of a whole round under these rules, infinite deck.
 * "chart" plays optimalAction's chart throughout; "best" plays the EV-maximising action at every decision.
 */
export function roundEv(mode: Mode = "chart"): number {
  let total = 0;
  for (let u = 1; u <= 10; u++) {
    const t = tab(u), pNat = dealerNaturalProb(u);
    for (let v1 = 1; v1 <= 10; v1++) for (let v2 = 1; v2 <= 10; v2++) {
      const p = PV[u] * PV[v1] * PV[v2];
      const hard = v1 + v2, ace = v1 === 1 || v2 === 1, b = best(hard, ace);
      let ev: number;
      if (b === 21) ev = (1 - pNat) * BJ.bjPays;
      else {
        const pv = v1 === v2 ? v1 : 0;
        let e: number;
        if (mode === "best") {
          e = Math.max(standEv(b, t.d), hitEv(t, hard, ace), doubleEv(t, hard, ace), pv ? splitEv(t, pv, "best") : -Infinity);
        } else {
          e = actionValue(t, hard, ace, chartAction(b, b !== hard, pv, u, true), "chart", pv);
        }
        ev = -pNat + (1 - pNat) * e;
      }
      total += p * ev;
    }
  }
  return total;
}
