import { describe, expect, it } from "vitest";
import { debrief } from "./debrief";
import { returnTable } from "./edges";
import { timeline } from "./timeline";
import { flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

const isFlush = (e: { dec?: unknown }) => (e.dec as { flush?: boolean } | undefined)?.flush === true;

describe("debrief: fixture invariants", () => {
  for (const [name, s] of [["on", SESSION_ON], ["off", SESSION_OFF], ["svb", SESSION_SVB]] as const) {
    it(`${name}: net = final - start, including the flush payout`, () => {
      const d = debrief(s);
      const last = s.events.at(-1)!;
      expect(d.net).toBe(last.balance - s.startCredits);
      expect(d.flush).toBe(400);
      expect(d.flush).toBe(s.unreleased);
      const roundNet = s.events.filter((e) => !isFlush(e)).reduce((a, e) => a + e.net, 0);
      expect(d.net).toBe(roundNet + d.flush);
      expect(d.paid - d.wagered + d.flush).toBe(d.net);
    });
    it(`${name}: rounds exclude the flush; per-game counts sum to totals`, () => {
      const d = debrief(s);
      expect(d.rounds).toBe(s.events.length - 1);
      const gs = Object.values(d.byGame);
      expect(gs.reduce((a, g) => a + g!.rounds, 0)).toBe(d.rounds);
      expect(gs.reduce((a, g) => a + g!.wagered, 0)).toBe(d.wagered);
      expect(gs.reduce((a, g) => a + g!.paid, 0)).toBe(d.paid);
      expect(gs.reduce((a, g) => a + g!.net, 0)).toBe(d.net - d.flush);
      expect(gs.reduce((a, g) => a + g!.nearMiss, 0)).toBe(d.nearMiss);
      expect(gs.reduce((a, g) => a + g!.celebrations, 0)).toBe(d.celebrations.total);
      expect(d.games).toEqual(Object.keys(d.byGame));
    });
    it(`${name}: celebration and loss splits are partitions`, () => {
      const d = debrief(s);
      expect(d.celebrations.netWin + d.celebrations.netLoss + d.celebrations.push).toBe(d.celebrations.total);
      expect(d.losses.zeroPayout + d.losses.partialReturn).toBe(d.losses.total);
      expect(d.losses.total).toBe(s.events.filter((e) => !isFlush(e) && e.net < 0).length);
      expect(d.celebrations.netLoss).toBeLessThanOrEqual(d.losses.partialReturn);
    });
    it(`${name}: agrees with timeline`, () => {
      const d = debrief(s);
      const tl = timeline(s);
      expect(d.wagered).toBe(tl.wagered);
      expect(d.expectedNet).toBe(tl.expectedNet);
      expect(d.peak).toEqual(tl.peak);
      expect(d.end).toEqual(tl.end);
      expect(d.durMs).toBe(s.endedAt! - s.startedAt);
      expect(d.money.netCredits).toBe(d.net);
      expect(d.money.wageredKrw).toBe(d.wagered * 10);
      expect(d.stop.effect).toBe(0);
      expect(d.swipe.effect).toBe(0);
    });
    it(`${name}: maxWin is the best round net, never the flush`, () => {
      const d = debrief(s);
      const best = Math.max(0, ...s.events.filter((e) => !isFlush(e)).map((e) => e.net));
      expect(d.maxWin).toBe(best);
      expect(d.maxWin).toBeLessThan(400 + 1_000_000);
    });
  }

  it("fx off: zero celebrations and near-misses; same rounds and losses structure", () => {
    const d = debrief(SESSION_OFF);
    expect(d.celebrations).toEqual({ total: 0, netWin: 0, netLoss: 0, push: 0 });
    expect(d.nearMiss).toBe(0);
    expect(d.losses.partialReturn + d.losses.zeroPayout).toBe(d.losses.total);
  });
  it("fx on: celebrates losses disguised as wins when the fixture has them", () => {
    const d = debrief(SESSION_ON);
    expect(d.celebrations.total).toBeGreaterThan(0);
  });
  it("svb is judged with variant b return", () => {
    const b = debrief(SESSION_SVB);
    const a = debrief(SESSION_SVB, null, returnTable("a"));
    expect(b.expectedNet).not.toBe(a.expectedNet);
    expect(debrief({ ...SESSION_SVB, sv: undefined }).expectedNet).toBe(a.expectedNet);
  });
  it("felt answers are passed through", () => {
    const d = debrief(SESSION_ON, { minutes: 5, net: 1000 });
    expect(d.felt.feltMinutes).toBe(5);
    expect(d.felt.actualNet).toBe(d.net);
    expect(d.felt.netDiff).toBe(1000 - d.net);
  });
});

describe("debrief: edge cases", () => {
  it("empty session", () => {
    const d = debrief(mk([], { endedAt: 5000 }));
    expect(d.rounds).toBe(0);
    expect(d.games).toEqual([]);
    expect(d.net).toBe(0);
    expect(d.wins).toBe(0);
    expect(d.maxWin).toBe(0);
    expect(d.durMs).toBe(5000);
  });
  it("only flush Ev: no rounds, flush moves the balance", () => {
    const d = debrief(mk([flushEv(300)]));
    expect(d.rounds).toBe(0);
    expect(d.byGame).toEqual({});
    expect(d.flush).toBe(300);
    expect(d.net).toBe(300);
    expect(d.maxWin).toBe(0);
    expect(d.wins).toBe(0);
    expect(d.celebrations.total).toBe(0);
    expect(d.chase).toBe(0);
  });
  it("duration falls back to the last event time when the session is open", () => {
    const s = mk([{ game: "slot", bet: 20, payout: 0 }]);
    expect(debrief(s).durMs).toBe(s.events[0].te);
  });
  it("LDW, push, zero payout, controls, manual cash-out and chase are counted", () => {
    const s = mk([
      { game: "slot", bet: 100, payout: 40, disp: { celebrate: true, dispVar: { cells: [[0, "a"]] } }, ctl: { stopPressed: true, gesture: "swipe" } },
      { game: "slot", bet: 200, payout: 0 }, // chase
      { game: "blackjack", bet: 20, payout: 20, disp: { celebrate: true, tier: 0 } },
      { game: "crash", bet: 100, payout: 150, disp: { celebrate: true }, dec: { manualCashoutAt: 1.5 } },
    ]);
    const d = debrief(s);
    expect(d.celebrations).toEqual({ total: 3, netWin: 1, netLoss: 1, push: 1 });
    expect(d.losses).toEqual({ total: 2, zeroPayout: 1, partialReturn: 1 });
    expect(d.nearMiss).toBe(1);
    expect(d.stop.n).toBe(1);
    expect(d.swipe.n).toBe(1);
    expect(d.manualCashout).toBe(1);
    expect(d.chase).toBe(1);
    expect(d.wins).toBe(1);
    expect(d.maxWin).toBe(50);
    expect(d.byGame.slot).toMatchObject({ rounds: 2, celebratedNetLoss: 1, stop: 1 });
  });
});
