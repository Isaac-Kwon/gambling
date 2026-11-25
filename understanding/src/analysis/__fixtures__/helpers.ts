// Test helpers: fixture loaders and minimal-session builders (not part of the shipped bundle).
import type { Ev, Session } from "@shared/schema";
import on from "./session-on.json";
import off from "./session-off.json";
import svb from "./session-svb.json";

export const SESSION_ON = on as unknown as Session;
export const SESSION_OFF = off as unknown as Session;
export const SESSION_SVB = svb as unknown as Session;

type P = Partial<Ev> & Pick<Ev, "game" | "bet" | "payout">;

export function ev(p: P): Ev {
  return { t: 0, round: 1, net: p.payout - p.bet, balance: 0, ...p } as Ev;
}

/** Builds a session whose events get running balances (so sums reconcile like a real log). */
export function mk(events: P[], extra: Partial<Session> = {}): Session {
  const start = extra.startCredits ?? 1000;
  let bal = start, t = 0;
  const evs = events.map((p, k) => {
    const net = p.net ?? p.payout - p.bet;
    bal += net;
    t += 1000;
    return { t, te: t + 500, round: k + 1, ...p, net, balance: bal } as Ev;
  });
  return {
    v: 1, seed: "x", mode: "free", fx: "on", display: "browser", installed: false,
    device: { w: 1, h: 1, dpr: 1, touch: true, orient: "portrait" },
    startedAt: 0, startCredits: start, events: evs, nav: [], ...extra,
  };
}

export const flushEv = (amount: number): P =>
  ({ game: "ocean", bet: 0, payout: amount, dec: { bonusSeqId: 1, flush: true }, fx: [] });
