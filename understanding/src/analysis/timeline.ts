/**
 * Balance timeline with the expected-value line and event markers (debrief chart, BASE_PROMPT §6.2).
 * One point per Ev, in log order. The ocean flush is a point (it moves the balance) but not a round:
 * it adds nothing to the stake sums and carries no round markers.
 */
import type { GameId } from "@shared/config";
import type { Session } from "@shared/schema";
import { returnTable, type ReturnTable } from "./edges";
import {
  anticReels, chaseIndices, isBigWin, isFlush, isLdw, omenOf, stakeOf, tierOfEv, timeOf,
} from "./mapping";

export interface TimelinePoint {
  /** Index in session.events. */
  i: number;
  /** Settlement time, ms since start. */
  t: number;
  game: GameId;
  round: number;
  bet: number;
  payout: number;
  net: number;
  balance: number;
  /** Credits staked so far (Ev.bet, so blackjack doubles/splits included). */
  cumBet: number;
  /** balance − startCredits. */
  cumNet: number;
  /** Expected cumulative net: −Σ stake × house edge of that game (blackjack: per initial stake). */
  expNet: number;
  /** startCredits + expNet: the expected-value line drawn over the balance. */
  expBalance: number;
  flush: boolean;
}

export type MarkerKind = "antic" | "ldw" | "bigWin" | "chase" | "omen" | "flush";
export interface Marker { i: number; t: number; kind: MarkerKind; game: GameId; tier?: number }

export interface Timeline {
  startCredits: number;
  points: TimelinePoint[];
  markers: Marker[];
  /** Highest balance reached (start counts; ties → the earliest). i = -1 means "at the start". */
  peak: { balance: number; t: number; i: number };
  end: { balance: number; t: number };
  /** What happened after the peak: rounds played and credits staked from then on, and balance given back. */
  afterPeak: { rounds: number; wagered: number; drop: number };
  wagered: number;
  expectedNet: number;
  actualNet: number;
  /** Rounds (flush excluded). */
  rounds: number;
}

export function timeline(s: Session, returns: ReturnTable = returnTable(s.sv ?? "a")): Timeline {
  const start = s.startCredits;
  const chase = new Set(chaseIndices(s));
  const points: TimelinePoint[] = [];
  const markers: Marker[] = [];
  let cumBet = 0, expNet = 0, rounds = 0;
  let peak = { balance: start, t: 0, i: -1 };
  s.events.forEach((e, i) => {
    const flush = isFlush(e);
    const t = timeOf(e);
    if (!flush) {
      rounds++;
      cumBet += e.bet;
      expNet -= stakeOf(e) * (1 - (returns[e.game] ?? 1));
    }
    points.push({
      i, t, game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance,
      cumBet, cumNet: e.balance - start, expNet, expBalance: start + expNet, flush,
    });
    if (e.balance > peak.balance) peak = { balance: e.balance, t, i };
    if (flush) { markers.push({ i, t, kind: "flush", game: e.game }); return; }
    if (anticReels(e) > 0) markers.push({ i, t, kind: "antic", game: e.game });
    if (isLdw(e)) markers.push({ i, t, kind: "ldw", game: e.game });
    if (isBigWin(e)) markers.push({ i, t, kind: "bigWin", game: e.game, tier: tierOfEv(e) });
    if (chase.has(i)) markers.push({ i, t, kind: "chase", game: e.game });
    if (omenOf(e)) markers.push({ i, t, kind: "omen", game: e.game });
  });
  const last = points.at(-1);
  const endT = s.endedAt !== undefined ? Math.max(0, s.endedAt - s.startedAt) : last?.t ?? 0;
  const end = { balance: last?.balance ?? start, t: endT };
  let apRounds = 0, apBet = 0;
  for (const p of points) if (p.i > peak.i && !p.flush) { apRounds++; apBet += p.bet; }
  return {
    startCredits: start, points, markers, peak, end,
    afterPeak: { rounds: apRounds, wagered: apBet, drop: peak.balance - end.balance },
    wagered: cumBet, expectedNet: expNet, actualNet: end.balance - start, rounds,
  };
}
