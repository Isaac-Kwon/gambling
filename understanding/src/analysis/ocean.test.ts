import { describe, expect, it } from "vitest";
import { oceanReturn } from "./edges";
import { hasOcean, oceanAnalysis } from "./ocean";
import { flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

describe("oceanAnalysis: fixtures", () => {
  for (const [name, s] of [["on", SESSION_ON], ["off", SESSION_OFF], ["svb", SESSION_SVB]] as const) {
    it(`${name}: counts exclude the flush; flush is reported`, () => {
      const o = oceanAnalysis(s)!;
      const rounds = s.events.filter((e) => e.game === "ocean" && !(e.dec as { flush?: boolean } | undefined)?.flush);
      expect(o.rounds).toBe(rounds.length);
      expect(o.wagered).toBe(rounds.reduce((a, e) => a + e.bet, 0));
      expect(o.flush).not.toBeNull();
      expect(o.flush!.amount).toBe(400);
      expect(o.flush!.amount).toBe(s.unreleased);
      expect(o.edge).toBeCloseTo(1 - oceanReturn(), 12);
    });
    it(`${name}: every fixed amount is paid exactly once (spins + flush)`, () => {
      const o = oceanAnalysis(s)!;
      expect(o.seqs.length).toBeGreaterThan(0);
      for (const q of o.seqs) {
        expect(q.paidBySpins + q.paidByFlush).toBe(q.total);
        expect(q.doneI).not.toBeNull();
      }
    });
    it(`${name}: stretches partition the ocean rounds`, () => {
      const o = oceanAnalysis(s)!;
      expect(o.afterOmen.rounds + o.otherRounds.rounds).toBe(o.rounds);
      expect(o.afterOmen.bet + o.otherRounds.bet).toBe(o.wagered);
      expect(o.afterOmen.expectedLoss).toBeCloseTo(o.afterOmen.bet * o.edge, 9);
      expect(o.controls.rounds).toBe(o.afterOmen.rounds);
      expect(o.controls.effect).toBe(0);
      expect(o.controls.total).toBe(o.controls.stop + o.controls.turbo + o.controls.auto + o.controls.betChanges);
    });
  }
  it("fixture on: omen shown; fixed before it appeared", () => {
    const o = oceanAnalysis(SESSION_ON)!;
    expect(o.omens.length).toBeGreaterThan(0);
    expect(o.omens.every((m) => m.shown)).toBe(true);
    for (const m of o.omens) if (m.seqId !== null) expect(m.fixedAtRound).toBeLessThan(m.round + 1);
    expect(o.fixedAtOmens).toBe(o.omens.reduce((a, m) => a + m.fixedTotal, 0));
    expect(o.seqs[0]).toMatchObject({ seqId: 1, triggerRound: 3, total: 200, omen: "clam" });
  });
  it("fixture off: omen is in the honest outcome but not shown", () => {
    const o = oceanAnalysis(SESSION_OFF)!;
    expect(o.omens.length).toBeGreaterThan(0);
    expect(o.omens.every((m) => !m.shown)).toBe(true);
  });
  it("hasOcean", () => {
    expect(hasOcean(SESSION_ON)).toBe(true);
    expect(hasOcean(mk([{ game: "slot", bet: 20, payout: 0 }]))).toBe(false);
    expect(hasOcean(mk([flushEv(5)]))).toBe(false);
    expect(hasOcean(mk([], { unreleased: 5 }))).toBe(true);
  });
});

describe("oceanAnalysis: edge cases", () => {
  it("no ocean at all: null", () => {
    expect(oceanAnalysis(mk([{ game: "slot", bet: 20, payout: 0 }]))).toBeNull();
    expect(oceanAnalysis(mk([]))).toBeNull();
  });
  it("only a flush Ev: no rounds, flush reported", () => {
    const o = oceanAnalysis(mk([flushEv(300)]))!;
    expect(o.rounds).toBe(0);
    expect(o.wagered).toBe(0);
    expect(o.flush).toMatchObject({ amount: 300 });
    expect(o.omens).toEqual([]);
    expect(o.afterOmen.avgBet).toBeNull();
  });
  it("hand-built: trigger, omen, releases, rounds after omen, controls", () => {
    const s = mk([
      { game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 1, queued: 100 } }, // 0 trigger
      { game: "ocean", bet: 20, payout: 0, out: { omen: "shark" }, disp: { omen: "shark" } }, // 1 omen
      { game: "ocean", bet: 40, payout: 60, ctl: { stopPressed: true }, out: { seqPay: 60, basePay: 0 }, dec: { bonusSeqId: 1, releasedFromSeq: true, queued: 40 } }, // 2
      { game: "ocean", bet: 40, payout: 40, ctl: { turbo: true }, out: { seqPay: 40, basePay: 0 }, dec: { bonusSeqId: 1, releasedFromSeq: true, queued: 0 } }, // 3 closes
      { game: "ocean", bet: 20, payout: 0 }, // 4 after the window
      flushEv(0),
    ]);
    const o = oceanAnalysis(s)!;
    expect(o.rounds).toBe(5);
    expect(o.seqs).toHaveLength(1);
    expect(o.seqs[0]).toMatchObject({ total: 100, paidBySpins: 100, paidByFlush: 0, omenI: 1, doneI: 3 });
    expect(o.omens[0]).toMatchObject({ creature: "shark", seqId: 1, fixedTotal: 100, roundsAfter: 2, betAfter: 80 });
    expect(o.afterOmen).toMatchObject({ rounds: 2, bet: 80, avgBet: 40 });
    expect(o.otherRounds).toMatchObject({ rounds: 3, bet: 60 });
    expect(o.afterFirstOmen).toEqual({ rounds: 3, bet: 100 });
    expect(o.controls).toMatchObject({ rounds: 2, stop: 1, turbo: 1, auto: 0, betChanges: 1, total: 3 });
  });
  it("hand-built: bonus left in the queue is closed by the flush", () => {
    const s = mk([
      { game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 1, queued: 500 } },
      { game: "ocean", bet: 20, payout: 0, out: { omen: "whale" } },
      { game: "ocean", bet: 20, payout: 0 },
      flushEv(500),
    ]);
    const o = oceanAnalysis(s)!;
    expect(o.seqs[0]).toMatchObject({ paidBySpins: 0, paidByFlush: 500, doneI: 3 });
    expect(o.flush).toMatchObject({ i: 3, amount: 500 });
    expect(o.omens[0].roundsAfter).toBe(1);
    expect(o.omens[0].shown).toBe(false);
  });
  it("multi-sequence flush attributes amounts per sequence", () => {
    const s = mk([
      { game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 1, queued: 100 } },
      { game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 2, queued: 50 } },
      { game: "ocean", bet: 0, payout: 150, dec: { bonusSeqId: 2, flush: true, seqs: [{ id: 1, amount: 100 }, { id: 2, amount: 50 }] }, fx: [] },
    ]);
    const o = oceanAnalysis(s)!;
    expect(o.seqs.map((q) => q.paidByFlush)).toEqual([100, 50]);
    expect(o.flush!.seqs).toHaveLength(2);
  });
  it("unreleased without a flush Ev still reports the amount", () => {
    const o = oceanAnalysis(mk([{ game: "ocean", bet: 20, payout: 0 }], { unreleased: 70 }))!;
    expect(o.flush).toEqual({ i: null, t: null, amount: 70, seqs: [] });
  });
  it("bet changes are counted inside the after-omen window only", () => {
    const s = mk([
      { game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 1, queued: 100 } },
      { game: "ocean", bet: 40, payout: 0, out: { omen: "clam" } }, // change before window (not in it)
      { game: "ocean", bet: 100, payout: 0 }, // in window: change 40 -> 100
      { game: "ocean", bet: 100, payout: 0 },
    ]);
    const o = oceanAnalysis(s)!;
    expect(o.controls.betChanges).toBe(1);
  });
});
