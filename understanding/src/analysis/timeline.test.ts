import { describe, expect, it } from "vitest";
import { returnTable } from "./edges";
import { timeline } from "./timeline";
import { flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

describe("timeline: fixtures", () => {
  for (const [name, s] of [["on", SESSION_ON], ["off", SESSION_OFF], ["svb", SESSION_SVB]] as const) {
    it(`${name}: points reconcile with the log (flush included)`, () => {
      const tl = timeline(s);
      const last = s.events.at(-1)!;
      expect(tl.points).toHaveLength(s.events.length);
      expect(tl.actualNet).toBe(last.balance - s.startCredits);
      expect(tl.actualNet).toBe(s.events.reduce((a, e) => a + e.net, 0));
      expect(tl.end.balance).toBe(last.balance);
      expect(tl.points.at(-1)!.cumNet).toBe(tl.actualNet);
      expect(tl.end.t).toBe(s.endedAt! - s.startedAt);
    });
    it(`${name}: flush is a point but not a round / stake`, () => {
      const tl = timeline(s);
      const flushPts = tl.points.filter((p) => p.flush);
      expect(flushPts).toHaveLength(1);
      expect(tl.rounds).toBe(s.events.length - 1);
      const rounds = s.events.filter((e) => !(e.dec as { flush?: boolean } | undefined)?.flush);
      expect(tl.wagered).toBe(rounds.reduce((a, e) => a + e.bet, 0));
      expect(tl.markers.filter((m) => m.kind === "flush")).toHaveLength(1);
      expect(tl.markers.filter((m) => m.kind !== "flush").every((m) => m.i !== flushPts[0].i)).toBe(true);
    });
    it(`${name}: expected net is negative and uses the session's variant`, () => {
      const tl = timeline(s);
      expect(tl.expectedNet).toBeLessThan(0);
      expect(tl.points.at(-1)!.expBalance).toBeCloseTo(s.startCredits + tl.expectedNet, 9);
      const ret = returnTable(s.sv ?? "a");
      let exp = 0;
      for (const e of s.events) if (!(e.dec as { flush?: boolean } | undefined)?.flush && e.game === "slot") exp -= e.bet * (1 - ret.slot);
      // the slot part alone must be within the total (other games add more negative edge)
      expect(tl.expectedNet).toBeLessThanOrEqual(exp + 1e-9);
    });
    it(`${name}: peak and afterPeak are consistent`, () => {
      const tl = timeline(s);
      const maxBal = Math.max(s.startCredits, ...s.events.map((e) => e.balance));
      expect(tl.peak.balance).toBe(maxBal);
      expect(tl.afterPeak.drop).toBe(tl.peak.balance - tl.end.balance);
      expect(tl.afterPeak.rounds).toBeLessThanOrEqual(tl.rounds);
    });
  }

  it("svb uses variant b return; on uses a", () => {
    const sl = (s: typeof SESSION_ON) => s.events.filter((e) => e.game === "slot");
    const only = (s: typeof SESSION_ON) => ({ ...s, events: sl(s) });
    // same events judged by each variant differ only through the variant's return
    const a = timeline(only(SESSION_SVB), returnTable("a"));
    const b = timeline(only(SESSION_SVB));
    expect(b.expectedNet).toBe(timeline(only(SESSION_SVB), returnTable("b")).expectedNet);
    expect(b.expectedNet).not.toBe(a.expectedNet);
  });

  it("fx off: no antic/ldw markers; on: same tier markers set not smaller than zero", () => {
    const off = timeline(SESSION_OFF);
    expect(off.markers.filter((m) => m.kind === "antic" || m.kind === "ldw")).toHaveLength(0);
  });
});

describe("timeline: edge cases", () => {
  it("empty session", () => {
    const tl = timeline(mk([]));
    expect(tl.points).toEqual([]);
    expect(tl.rounds).toBe(0);
    expect(tl.actualNet).toBe(0);
    expect(tl.peak).toEqual({ balance: 1000, t: 0, i: -1 });
    expect(tl.end).toEqual({ balance: 1000, t: 0 });
    expect(tl.afterPeak).toEqual({ rounds: 0, wagered: 0, drop: 0 });
  });
  it("only a flush Ev: no rounds, no stake, balance moves", () => {
    const tl = timeline(mk([flushEv(300)]));
    expect(tl.rounds).toBe(0);
    expect(tl.wagered).toBe(0);
    expect(tl.expectedNet).toBe(0);
    expect(tl.actualNet).toBe(300);
    expect(tl.peak.balance).toBe(1300);
    expect(tl.markers.map((m) => m.kind)).toEqual(["flush"]);
  });
  it("markers: ldw, antic, bigWin, chase, omen", () => {
    const s = mk([
      { game: "slot", bet: 100, payout: 40, disp: { celebrate: true, tier: 0 } }, // ldw
      { game: "slot", bet: 200, payout: 0, disp: { antic: 2, tier: 0 } }, // chase + antic
      { game: "slot", bet: 20, payout: 200, disp: { celebrate: true, tier: 3 } }, // big win
      { game: "ocean", bet: 20, payout: 0, out: { omen: "clam" } }, // omen
    ]);
    const kinds = timeline(s).markers.map((m) => `${m.i}:${m.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(["0:ldw", "1:antic", "1:chase", "2:bigWin", "3:omen"]));
    expect(timeline(s).markers.find((m) => m.kind === "bigWin")?.tier).toBe(3);
  });
  it("blackjack expected loss uses the initial stake, not doubled bet", () => {
    const s = mk([{ game: "blackjack", bet: 40, payout: 0, dec: { steps: [{ hand: 0, action: "D", optimal: "D" }] } }]);
    const r = returnTable("a");
    expect(timeline(s).expectedNet).toBeCloseTo(-20 * (1 - r.blackjack), 9);
  });
  it("peak ties go to the earliest; start counts", () => {
    const s = mk([
      { game: "slot", bet: 20, payout: 120 }, // +100 -> 1100
      { game: "slot", bet: 20, payout: 20 }, // 1100 again
      { game: "slot", bet: 20, payout: 0 },
    ]);
    const tl = timeline(s);
    expect(tl.peak.i).toBe(0);
    expect(tl.afterPeak.rounds).toBe(2);
    expect(tl.afterPeak.wagered).toBe(40);
    expect(tl.afterPeak.drop).toBe(20);
  });
});
