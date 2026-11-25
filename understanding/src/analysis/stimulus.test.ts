import { describe, expect, it } from "vitest";
import { bigWinMoments, fakeElements, fxSplit, stimulusSeries } from "./stimulus";
import { flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

describe("stimulusSeries", () => {
  it("one row per round, flush excluded", () => {
    for (const s of [SESSION_ON, SESSION_OFF, SESSION_SVB]) {
      const rows = stimulusSeries(s);
      expect(rows).toHaveLength(s.events.length - 1);
      expect(rows.every((r) => s.events[r.i].bet > 0 || r.game !== "ocean")).toBe(true);
      for (const r of rows) {
        const cat = Object.values(r.byCategory).reduce((a, b) => a + b, 0);
        expect(cat).toBe(r.ms);
        expect(r.stimMs).toBe(r.ms - r.byCategory.process);
        expect(r.spanMs).toBeLessThanOrEqual(r.stimMs);
        expect(r.channels).toBeGreaterThanOrEqual(0);
        expect(r.channels).toBeLessThanOrEqual(5);
      }
    }
  });
  it("fx on: celebrated / LDW rows exist and LDW implies celebrated and net<0", () => {
    const rows = stimulusSeries(SESSION_ON);
    expect(rows.some((r) => r.celebrated)).toBe(true);
    for (const r of rows) if (r.ldw) { expect(r.celebrated).toBe(true); expect(r.net).toBeLessThan(0); }
  });
  it("fx off: no celebration, no anticipation/omen/reward time, but tiers still recorded", () => {
    const off = stimulusSeries(SESSION_OFF);
    expect(off.filter((r) => r.celebrated || r.ldw)).toHaveLength(0);
    expect(off.reduce((a, r) => a + r.byCategory.anticipation + r.byCategory.omen + r.byCategory.reward, 0)).toBe(0);
    expect(off.reduce((a, r) => a + r.stimMs, 0)).toBe(0);
  });
  it("fx off: tier is still recorded for every round", () => {
    const rows = stimulusSeries(SESSION_OFF);
    expect(rows).toHaveLength(SESSION_OFF.events.length - 1);
    expect(rows.some((r) => r.tier > 0)).toBe(SESSION_OFF.events.some((e) => (e.disp as { tier?: number } | undefined)?.tier));
  });
  it("ignores non-finite / negative ms", () => {
    const s = mk([{ game: "slot", bet: 20, payout: 0, fx: [{ type: "tier", ms: Number.NaN, k: 1 }, { type: "flash", ms: -5, k: 1 }, { type: "shake", ms: 100, k: 1 }] }]);
    const [r] = stimulusSeries(s);
    expect(r.ms).toBe(100);
    expect(r.records).toBe(3);
    expect(r.channels).toBe(2); // visual (tier, flash) + motion (shake)
  });
});

describe("fxSplit", () => {
  it("fixture: rounds partition and seconds reconcile", () => {
    const rows = stimulusSeries(SESSION_ON);
    const f = fxSplit(rows);
    expect(f.winRounds + f.lossRounds).toBe(rows.length);
    expect(f.winRounds).toBe(rows.filter((r) => r.net > 0).length);
    expect(f.lossSecBy.ldw + f.lossSecBy.anticipation + f.lossSecBy.omen + f.lossSecBy.other).toBeCloseTo(f.lossSec, 9);
    expect(f.winSecAll).toBeCloseTo(rows.filter((r) => r.net > 0).reduce((a, r) => a + r.ms, 0) / 1000, 9);
    expect(f.lossSecAll).toBeGreaterThanOrEqual(f.lossSec);
    expect(f.lossRoundFrac).toBeCloseTo(f.lossRounds / rows.length, 12);
  });
  it("fx off: every round is silent of stimuli", () => {
    const f = fxSplit(stimulusSeries(SESSION_OFF));
    expect(f.winSec + f.lossSec).toBe(0);
  });
  it("empty", () => {
    const f = fxSplit([]);
    expect(f.lossRoundFrac).toBe(0);
    expect(f.winRounds + f.lossRounds + f.silentRounds).toBe(0);
  });
  it("LDW celebration seconds go to the ldw bucket of losing rounds", () => {
    const s = mk([
      { game: "slot", bet: 100, payout: 40, disp: { celebrate: true }, fx: [{ type: "countup", ms: 2000, k: 1 }, { type: "sfx:spin", ms: 1000, k: 1 }] },
      { game: "slot", bet: 100, payout: 0, fx: [{ type: "antic:reel", ms: 1500, k: 1 }, { type: "particles:bubbles", ms: 500, k: 1 }] },
      { game: "slot", bet: 100, payout: 500, fx: [{ type: "countup", ms: 3000, k: 1 }] },
    ]);
    const f = fxSplit(stimulusSeries(s));
    expect(f.lossRounds).toBe(2);
    expect(f.winRounds).toBe(1);
    expect(f.lossSecBy).toEqual({ ldw: 2, anticipation: 1.5, omen: 0.5, other: 0 });
    expect(f.lossSec).toBe(4);
    expect(f.lossSecAll).toBe(5);
    expect(f.winSec).toBe(3);
  });
});

describe("bigWinMoments", () => {
  it("fixture: cumNet = balance - start; flush never included", () => {
    for (const m of bigWinMoments(SESSION_ON)) {
      expect(m.tier).toBeGreaterThanOrEqual(2);
      expect(m.cumNet).toBe(SESSION_ON.events[m.i].balance - SESSION_ON.startCredits);
    }
  });
  it("flush with a huge payout is not a big win", () => {
    const s = mk([flushEv(5000), { game: "slot", bet: 20, payout: 200, disp: { tier: 3 } }]);
    const m = bigWinMoments(s);
    expect(m).toHaveLength(1);
    expect(m[0].i).toBe(1);
  });
});

describe("fakeElements", () => {
  it("fixture on: crowds from aux, none are invented otherwise", () => {
    const f = fakeElements(SESSION_ON);
    const aux = SESSION_ON.aux!;
    expect(f.crowds).toHaveLength(aux.filter((a) => a.kind === "crowd").length);
    expect(f.crowdTotal).toBe(f.crowds.reduce((a, c) => a + c.n, 0));
    expect(f.tickers).toHaveLength(aux.filter((a) => a.kind === "ticker").length);
    expect(f.hot).toHaveLength(aux.filter((a) => a.kind === "hot").length);
  });
  it("fx off: no fake elements", () => {
    const f = fakeElements(SESSION_OFF);
    expect(f.tickers.length + f.hot.length + f.crowds.length).toBe(0);
    expect(f.tickerTotal + f.crowdTotal).toBe(0);
  });
  it("falls back to Ev.disp.crowd when aux has no crowd record", () => {
    const s = mk([{ game: "crash", bet: 100, payout: 0, disp: { crowd: 9 } }]);
    const f = fakeElements(s);
    expect(f.crowds).toHaveLength(1);
    expect(f.crowdTotal).toBe(9);
  });
  it("aux crowd wins over the disp fallback; ticker totals add up", () => {
    const s = mk([{ game: "crash", bet: 100, payout: 0, disp: { crowd: 9 } }], {
      aux: [
        { t: 1, kind: "crowd", d: { n: 5, round: 1, game: "crash" } },
        { t: 2, kind: "ticker", d: { name: "A", game: "slot", amt: 100 } },
        { t: 3, kind: "ticker", d: { name: "B", game: "crash", amt: 250 } },
        { t: 4, kind: "hot", d: { games: ["slot"] } },
        { t: 5, kind: "bg" },
      ],
    });
    const f = fakeElements(s);
    expect(f.crowdTotal).toBe(5);
    expect(f.tickerTotal).toBe(350);
    expect(f.hot).toHaveLength(1);
  });
});
