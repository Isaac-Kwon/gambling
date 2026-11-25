import { describe, expect, it } from "vitest";
import {
  anticReels, bonusFlush, bonusRelease, bonusTrigger, chaseIndices, crashTarget, crowdShown, fakeOfAux, fxCategory,
  fxChannel, isBigWin, isCelebratedPush, isFlush, isLdw, isNearMiss, isNetWin, isPartialReturn, isZeroPayout,
  manualCashoutAt, nearMissCells, omenOf, omenShown, roundsOf, stakeOf, tierOfEv,
} from "./mapping";
import { ev, flushEv, mk, SESSION_ON } from "./__fixtures__/helpers";

describe("round filtering", () => {
  it("flush Ev is not a round", () => {
    const s = mk([{ game: "ocean", bet: 20, payout: 0 }, flushEv(300), { game: "slot", bet: 20, payout: 0 }]);
    expect(isFlush(s.events[1])).toBe(true);
    expect(roundsOf(s).map((r) => r.i)).toEqual([0, 2]);
  });
  it("flush Ev is never a celebration, near-miss, antic, omen or big win", () => {
    const f = ev({ ...flushEv(5000), disp: { celebrate: true, dispVar: { cells: [[0, "a"]] }, antic: 2, omen: "whale", tier: 4 }, out: { omen: "whale" } });
    expect(isLdw(f) || isCelebratedPush(f) || isNearMiss(f) || isBigWin(f)).toBe(false);
    expect(nearMissCells(f)).toBe(0);
    expect(anticReels(f)).toBe(0);
    expect(omenOf(f)).toBeNull();
    expect(isNetWin(f)).toBe(false);
    expect(isZeroPayout(f)).toBe(false);
    expect(isPartialReturn(f)).toBe(false);
  });
  it("fixture: roundsOf excludes exactly the flush", () => {
    expect(roundsOf(SESSION_ON)).toHaveLength(SESSION_ON.events.length - 1);
  });
});

describe("LDW / push", () => {
  it("celebrate && 0<payout<bet is LDW", () => {
    expect(isLdw(ev({ game: "slot", bet: 100, payout: 40, disp: { celebrate: true } }))).toBe(true);
  });
  it("not LDW: no celebration, zero payout, payout == bet, payout > bet", () => {
    expect(isLdw(ev({ game: "slot", bet: 100, payout: 40 }))).toBe(false);
    expect(isLdw(ev({ game: "slot", bet: 100, payout: 0, disp: { celebrate: true } }))).toBe(false);
    expect(isLdw(ev({ game: "slot", bet: 100, payout: 100, disp: { celebrate: true } }))).toBe(false);
    expect(isLdw(ev({ game: "slot", bet: 100, payout: 150, disp: { celebrate: true } }))).toBe(false);
  });
  it("celebrated push", () => {
    expect(isCelebratedPush(ev({ game: "blackjack", bet: 20, payout: 20, disp: { celebrate: true, tier: 0 } }))).toBe(true);
    expect(isCelebratedPush(ev({ game: "blackjack", bet: 20, payout: 20 }))).toBe(false);
    expect(isCelebratedPush(ev({ game: "blackjack", bet: 20, payout: 40, disp: { celebrate: true } }))).toBe(false);
  });
  it("loss classification", () => {
    expect(isZeroPayout(ev({ game: "slot", bet: 20, payout: 0 }))).toBe(true);
    expect(isPartialReturn(ev({ game: "slot", bet: 20, payout: 10 }))).toBe(true);
    expect(isNetWin(ev({ game: "slot", bet: 20, payout: 30 }))).toBe(true);
  });
});

describe("near miss", () => {
  it("only from dispVar cells", () => {
    const cells = { dispVar: { cells: [[3, "a"], [7, "b"]] } };
    expect(isNearMiss(ev({ game: "slot", bet: 20, payout: 0, disp: cells }))).toBe(true);
    expect(nearMissCells(ev({ game: "slot", bet: 20, payout: 0, disp: cells }))).toBe(2);
    expect(isNearMiss(ev({ game: "slot", bet: 20, payout: 0, disp: { dispVar: { cells: [] } } }))).toBe(false);
    expect(isNearMiss(ev({ game: "slot", bet: 20, payout: 0, disp: { antic: 2, board: [7, 7, 1] } }))).toBe(false);
    expect(isNearMiss(ev({ game: "slot", bet: 20, payout: 0, out: { stops: [1, 2, 3, 4, 5] } }))).toBe(false);
    expect(isNearMiss(ev({ game: "slot", bet: 20, payout: 0 }))).toBe(false);
  });
});

describe("tier / big win", () => {
  it("uses disp.tier, else recomputes from payout/bet", () => {
    expect(tierOfEv(ev({ game: "slot", bet: 20, payout: 400, disp: { tier: 1 } }))).toBe(1);
    expect(tierOfEv(ev({ game: "slot", bet: 20, payout: 100 }))).toBe(2);
    expect(isBigWin(ev({ game: "slot", bet: 20, payout: 100 }))).toBe(true);
    expect(isBigWin(ev({ game: "slot", bet: 20, payout: 40 }))).toBe(false);
  });
});

describe("stake and chase", () => {
  const bj = (bet: number, net: number, actions: string[]) =>
    ev({ game: "blackjack", bet, payout: bet + net, net, dec: { steps: actions.map((a) => ({ hand: 0, action: a, optimal: a })) } });

  it("stakeOf: blackjack double and split add one stake each", () => {
    expect(stakeOf(bj(40, 0, ["D"]))).toBe(20);
    expect(stakeOf(bj(40, 0, ["P", "S", "S"]))).toBe(20);
    expect(stakeOf(bj(60, 0, ["P", "D", "S"]))).toBe(20);
    expect(stakeOf(bj(20, 0, ["H", "S"]))).toBe(20);
    expect(stakeOf(ev({ game: "slot", bet: 100, payout: 0 }))).toBe(100);
  });
  it("chase: raise right after a loss of the same game", () => {
    const s = mk([
      { game: "slot", bet: 20, payout: 0 },
      { game: "slot", bet: 40, payout: 0 }, // chase
      { game: "slot", bet: 40, payout: 0 }, // same stake
      { game: "slot", bet: 20, payout: 0 }, // lower
      { game: "slot", bet: 100, payout: 500 }, // chase
      { game: "slot", bet: 200, payout: 0 }, // after a win
    ]);
    expect(chaseIndices(s)).toEqual([1, 4]);
  });
  it("chase is per game and skips flush", () => {
    const s = mk([
      { game: "slot", bet: 20, payout: 0 },
      { game: "crash", bet: 100, payout: 0 }, // different game
      { game: "ocean", bet: 20, payout: 0 },
      flushEv(100),
      { game: "ocean", bet: 40, payout: 0 }, // chase across the flush
    ]);
    expect(chaseIndices(s)).toEqual([4]);
  });
  it("chase: blackjack compares initial stakes, not the doubled bet", () => {
    const s = mk([
      bj(40, -40, ["D"]), // stake 20, lost
      bj(20, -20, ["H"]), // stake 20: not a raise
      bj(100, 0, ["S"]), // raised after a loss
    ]);
    expect(chaseIndices(s)).toEqual([2]);
  });
});

describe("ocean meanings", () => {
  it("omen from out (honest) or disp; shown only with disp", () => {
    const honest = ev({ game: "ocean", bet: 20, payout: 0, out: { omen: "shark" } });
    expect(omenOf(honest)).toBe("shark");
    expect(omenShown(honest)).toBe(false);
    const shown = ev({ game: "ocean", bet: 20, payout: 0, out: { omen: "whale" }, disp: { omen: "whale" } });
    expect(omenShown(shown)).toBe(true);
    expect(omenOf(ev({ game: "ocean", bet: 20, payout: 0, out: { omen: "dragon" } }))).toBeNull();
    expect(omenOf(ev({ game: "slot", bet: 20, payout: 0, out: { omen: "shark" } }))).toBeNull();
  });
  it("trigger, release, flush", () => {
    const trig = ev({ game: "ocean", bet: 20, payout: 0, dec: { bonusSeqId: 2, queued: 300 } });
    expect(bonusTrigger(trig)).toEqual({ seqId: 2, total: 300 });
    expect(bonusRelease(trig)).toBeNull();
    const trig2 = ev({ game: "ocean", bet: 20, payout: 0, dec: { trig: { bonusSeqId: 3, queued: 90 } } });
    expect(bonusTrigger(trig2)).toEqual({ seqId: 3, total: 90 });
    const rel = ev({ game: "ocean", bet: 20, payout: 120, out: { seqPay: 100, basePay: 20 }, dec: { bonusSeqId: 2, releasedFromSeq: true, queued: 200 } });
    expect(bonusRelease(rel)).toEqual({ seqId: 2, amount: 100, left: 200 });
    expect(bonusTrigger(rel)).toBeNull();
    const relNoSeqPay = ev({ game: "ocean", bet: 20, payout: 120, out: { basePay: 20 }, dec: { bonusSeqId: 2, releasedFromSeq: true, queued: 0 } });
    expect(bonusRelease(relNoSeqPay)?.amount).toBe(100);
    const fl = ev(flushEv(250));
    expect(bonusFlush(fl)).toEqual({ amount: 250, seqs: [{ id: 1, amount: 250 }] });
    expect(bonusFlush(trig)).toBeNull();
    expect(bonusTrigger(fl)).toBeNull();
  });
});

describe("controls and crash", () => {
  it("manual cash-out and target only for crash", () => {
    const c = ev({ game: "crash", bet: 100, payout: 150, dec: { target: 3, manualCashoutAt: 1.5 } });
    expect(manualCashoutAt(c)).toBe(1.5);
    expect(crashTarget(c)).toBe(3);
    expect(manualCashoutAt(ev({ game: "crash", bet: 100, payout: 0, dec: { manualCashoutAt: null } }))).toBeNull();
    expect(manualCashoutAt(ev({ game: "slot", bet: 100, payout: 0, dec: { manualCashoutAt: 2 } }))).toBeNull();
    expect(crowdShown(ev({ game: "crash", bet: 1, payout: 0, disp: { crowd: 12 } }))).toBe(12);
    expect(crowdShown(ev({ game: "crash", bet: 1, payout: 0 }))).toBeNull();
  });
});

describe("fakeOfAux", () => {
  it("extracts ticker / hot / crowd", () => {
    expect(fakeOfAux({ t: 5, kind: "ticker", d: { name: "Ann", game: "slot", amt: 900 } })).toEqual({ kind: "ticker", t: 5, name: "Ann", game: "slot", amt: 900 });
    expect(fakeOfAux({ t: 6, kind: "hot", d: { games: ["slot", "crash"] } })).toEqual({ kind: "hot", t: 6, games: ["slot", "crash"] });
    expect(fakeOfAux({ t: 7, kind: "crowd", d: { n: 14 } })).toEqual({ kind: "crowd", t: 7, n: 14, game: "crash", round: null });
  });
  it("ignores other aux and tolerates missing data", () => {
    expect(fakeOfAux({ t: 1, kind: "bg" })).toBeNull();
    expect(fakeOfAux({ t: 1, kind: "level", d: { n: 2 } })).toBeNull();
    expect(fakeOfAux({ t: 1, kind: "ticker" })).toEqual({ kind: "ticker", t: 1, name: "", game: "", amt: 0 });
    expect(fakeOfAux({ t: 1, kind: "hot", d: { games: "x" } })).toEqual({ kind: "hot", t: 1, games: [] });
  });
});

describe("fx classification", () => {
  it("categories", () => {
    for (const t of ["antic:reel", "antic:rise", "sfx:rise", "sfx:heartbeat"]) expect(fxCategory(t)).toBe("anticipation");
    for (const t of ["omen", "sfx:omen", "particles:bubbles"]) expect(fxCategory(t)).toBe("omen");
    for (const t of ["sfx:spin", "sfx:stop", "sfx:card", "sfx:chip"]) expect(fxCategory(t)).toBe("process");
    for (const t of ["tier", "countup", "shake", "flash", "haptic", "ticket", "sfx:win1", "sfx:coin", "particles:coins"]) expect(fxCategory(t)).toBe("reward");
    expect(fxCategory("mystery")).toBe("other");
  });
  it("channels", () => {
    expect(fxChannel("sfx:win1")).toBe("sound");
    expect(fxChannel("particles:coins")).toBe("particles");
    expect(fxChannel("shake")).toBe("motion");
    expect(fxChannel("haptic")).toBe("haptic");
    expect(fxChannel("flash")).toBe("visual");
    expect(fxChannel("antic:reel")).toBe("visual");
  });
  it("every fx type in the fixture is classified (no stray 'other')", () => {
    const types = new Set<string>();
    for (const e of SESSION_ON.events) for (const f of e.fx ?? []) types.add(f.type);
    expect([...types].filter((t) => fxCategory(t) === "other")).toEqual([]);
  });
});
