/**
 * Key numbers of the debrief cards (BASE_PROMPT §6.2). Counts are over rounds; the ocean flush is never a round
 * (it still moves the balance, so it is in peak/end/net). Celebrated losing rounds are split by what came back:
 * nothing celebrates a zero payout, so every celebrated loss is a partial return (0 < payout < bet) — the debrief
 * should say "celebrated N times, M of them paid back less than the bet", and separately show the plain
 * zero-payout rounds, rather than a single "lost" figure.
 */
import type { GameId } from "@shared/config";
import type { Session } from "@shared/schema";
import { returnTable, type ReturnTable } from "./edges";
import {
  chaseIndices, isCelebratedPush, isCelebrated, isFlush, isLdw, isNearMiss, isNetWin, isPartialReturn, isZeroPayout,
  stopPressed, swiped, manualCashoutAt, timeOf,
} from "./mapping";
import { feltVsActual, moneyView, type FeltAnswers, type FeltVsActual, type MoneyView } from "./money";
import { timeline, type Timeline } from "./timeline";

export interface GameCounts {
  rounds: number; wagered: number; paid: number; net: number;
  nearMiss: number; celebrations: number; celebratedNetLoss: number; stop: number;
}

export interface Debrief {
  /** Rounds played (flush excluded). */
  rounds: number;
  /** Games in the order first played. */
  games: GameId[];
  byGame: Partial<Record<GameId, GameCounts>>;
  durMs: number;
  wagered: number;
  /** Everything paid back by rounds (flush excluded; see flush). */
  paid: number;
  /** Ocean lump sum at session end, 0 when none. */
  flush: number;
  /** final − start (flush included: it is real money). */
  net: number;
  /** −Σ stake × edge. */
  expectedNet: number;
  /** Near-miss displays (rounds with a 7 drawn in a peek cell). */
  nearMiss: number;
  celebrations: {
    total: number;
    /** Celebrated rounds that won money (net > 0). */
    netWin: number;
    /** Celebrated although net < 0 (0 < payout < bet): losses disguised as wins. */
    netLoss: number;
    /** Celebrated at net 0 (blackjack push). */
    push: number;
  };
  /** How the losing rounds lost. */
  losses: {
    /** net < 0 */
    total: number;
    /** Nothing came back (never celebrated). */
    zeroPayout: number;
    /** Something came back but less than the stake (celebrated with fx on). */
    partialReturn: number;
  };
  /** STOP presses (effect on results: 0). */
  stop: { n: number; effect: 0 };
  /** Swipe spins (effect: 0). */
  swipe: { n: number; effect: 0 };
  /** Crash manual cash-out taps. */
  manualCashout: number;
  /** Stake raised right after a losing round of the same game. */
  chase: number;
  /** Largest round net (flush excluded). 0 when no round won. */
  maxWin: number;
  wins: number;
  peak: Timeline["peak"];
  end: Timeline["end"];
  start: number;
  afterPeak: Timeline["afterPeak"];
  money: MoneyView;
  felt: FeltVsActual;
}

export function debrief(s: Session, felt?: FeltAnswers | null, returns: ReturnTable = returnTable(s.sv ?? "a")): Debrief {
  const tl = timeline(s, returns);
  const byGame: Debrief["byGame"] = {};
  const games: GameId[] = [];
  let paid = 0, flush = 0, nearMiss = 0, stop = 0, swipe = 0, manual = 0, maxWin = 0, wins = 0;
  const cel = { total: 0, netWin: 0, netLoss: 0, push: 0 };
  const losses = { total: 0, zeroPayout: 0, partialReturn: 0 };
  let lastT = 0;
  for (const e of s.events) {
    lastT = Math.max(lastT, timeOf(e));
    if (isFlush(e)) { flush += e.payout; continue; }
    let g = byGame[e.game];
    if (!g) { g = byGame[e.game] = { rounds: 0, wagered: 0, paid: 0, net: 0, nearMiss: 0, celebrations: 0, celebratedNetLoss: 0, stop: 0 }; games.push(e.game); }
    g.rounds++; g.wagered += e.bet; g.paid += e.payout; g.net += e.net;
    paid += e.payout;
    if (isNearMiss(e)) { nearMiss++; g.nearMiss++; }
    if (isCelebrated(e)) {
      cel.total++; g.celebrations++;
      if (isLdw(e)) { cel.netLoss++; g.celebratedNetLoss++; }
      else if (isCelebratedPush(e)) cel.push++;
      else if (isNetWin(e)) cel.netWin++;
    }
    if (e.net < 0) {
      losses.total++;
      if (isZeroPayout(e)) losses.zeroPayout++;
      else if (isPartialReturn(e)) losses.partialReturn++;
    }
    if (stopPressed(e)) { stop++; g.stop++; }
    if (swiped(e)) swipe++;
    if (manualCashoutAt(e) !== null) manual++;
    if (e.net > 0) { wins++; if (e.net > maxWin) maxWin = e.net; }
  }
  const durMs = s.endedAt !== undefined ? Math.max(0, s.endedAt - s.startedAt) : lastT;
  return {
    rounds: tl.rounds, games, byGame, durMs, wagered: tl.wagered, paid, flush,
    net: tl.actualNet, expectedNet: tl.expectedNet,
    nearMiss, celebrations: cel, losses,
    stop: { n: stop, effect: 0 }, swipe: { n: swipe, effect: 0 }, manualCashout: manual,
    chase: chaseIndices(s).length, maxWin, wins,
    peak: tl.peak, end: tl.end, start: s.startCredits, afterPeak: tl.afterPeak,
    money: moneyView(tl.actualNet, tl.wagered),
    felt: feltVsActual({ durMs, net: tl.actualNet }, felt),
  };
}
