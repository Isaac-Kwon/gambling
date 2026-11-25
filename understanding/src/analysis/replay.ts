/** The same session as a plain table, no effects (replayPlain section, BASE_PROMPT §6.4). */
import type { GameId } from "@shared/config";
import type { Session } from "@shared/schema";
import { isFlush, timeOf } from "./mapping";

export interface ReplayRow {
  /** 1-based running number over rounds (the flush row repeats the last one). */
  n: number;
  /** Index in session.events. */
  i: number;
  t: number;
  game: GameId;
  /** The game's own round number. */
  round: number;
  bet: number;
  payout: number;
  net: number;
  balance: number;
  /** Ocean end-of-session lump sum: not a round, no spin. */
  flush: boolean;
}

export function replayRows(s: Session): ReplayRow[] {
  let n = 0;
  return s.events.map((e, i) => {
    const flush = isFlush(e);
    if (!flush) n++;
    return { n, i, t: timeOf(e), game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, flush };
  });
}
