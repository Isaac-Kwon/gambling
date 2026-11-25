import { describe, expect, it } from "vitest";
import { CRASH } from "@shared/rules/crash";
import {
  blackjackCheck, bjDecisions, colourOf, crashCheck, CRASH_BINS, rouletteCheck, strategyCheck,
} from "./strategy";
import { ev, flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

const bjEv = (o: { dealer: string[]; hands: { cards: string[]; bet: number }[]; steps: { hand: number; action: string; optimal: string }[]; bet: number; payout?: number }) =>
  ev({ game: "blackjack", bet: o.bet, payout: o.payout ?? 0, out: { dealer: o.dealer, hands: o.hands }, dec: { steps: o.steps } });

describe("blackjack", () => {
  it("fixture: decisions are all resolved and EV loss is non-negative", () => {
    for (const s of [SESSION_ON, SESSION_OFF]) {
      const c = blackjackCheck(s)!;
      expect(c.unresolved).toBe(0);
      expect(c.decisions).toBe(c.all.length);
      expect(c.matches + c.deviations.length).toBe(c.decisions);
      expect(c.matchRate).toBeCloseTo(c.matches / c.decisions, 12);
      expect(c.evLossCredits).toBeGreaterThanOrEqual(0);
      for (const d of c.all) if (d.match) expect(d.evLoss).toBe(0);
      for (const d of c.deviations) expect(d.action).not.toBe(d.optimal);
    }
  });
  it("fixture: logged 'H' vs optimal 'S' on 3+K+7 (hit on 20) is a deviation with positive EV loss", () => {
    const c = blackjackCheck(SESSION_ON)!;
    const d = c.deviations.find((x) => x.action === "H" && x.optimal === "S");
    expect(d).toBeDefined();
    expect(d!.evLoss).toBeGreaterThan(0);
  });
  it("no blackjack: null", () => {
    expect(blackjackCheck(SESSION_SVB)).toBeNull();
  });
  it("split: pair rebuilt, hands follow their own cards, stake is the initial one", () => {
    const e = bjEv({
      dealer: ["6c", "Kd"],
      hands: [{ cards: ["8s", "3d", "Kh"], bet: 20 }, { cards: ["8h", "Tc"], bet: 20 }],
      steps: [
        { hand: 0, action: "P", optimal: "P" },
        { hand: 0, action: "H", optimal: "D" }, // 8+3 = 11 vs 6: should double
        { hand: 1, action: "S", optimal: "S" },
      ],
      bet: 40,
    });
    const { list, unresolved } = bjDecisions(e, 7);
    expect(unresolved).toBe(0);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ i: 7, hand: 0, cards: ["8s", "8h"], total: 16, action: "P", match: true });
    expect(list[1]).toMatchObject({ hand: 0, cards: ["8s", "3d"], total: 11, action: "H", optimal: "D", match: false });
    expect(list[1].evLoss).toBeGreaterThan(0);
    expect(list[1].evLossCredits).toBeCloseTo(list[1].evLoss! * 20, 9);
    expect(list[2]).toMatchObject({ hand: 1, cards: ["8h", "Tc"], total: 18, match: true });
  });
  it("hit then stand uses the growing hand", () => {
    const e = bjEv({
      dealer: ["Tc", "7d"], bet: 20,
      hands: [{ cards: ["5s", "4h", "Kh"], bet: 20 }],
      steps: [{ hand: 0, action: "H", optimal: "H" }, { hand: 0, action: "S", optimal: "S" }],
    });
    const { list } = bjDecisions(e, 0);
    expect(list.map((d) => d.cards.length)).toEqual([2, 3]);
    expect(list.map((d) => d.total)).toEqual([9, 19]);
  });
  it("garbage cards: steps are counted as unresolved, no throw", () => {
    const e = bjEv({ dealer: ["??"], hands: [{ cards: ["zz", "yy"], bet: 20 }], steps: [{ hand: 0, action: "S", optimal: "S" }], bet: 20 });
    expect(bjDecisions(e, 0)).toEqual({ list: [], unresolved: 1 });
  });
  it("edgeAdded = EV given up / Σ initial stakes", () => {
    const e = bjEv({
      dealer: ["6c", "Kd"], bet: 20,
      hands: [{ cards: ["5s", "6d", "Kh"], bet: 20 }],
      steps: [{ hand: 0, action: "H", optimal: "D" }, { hand: 0, action: "S", optimal: "S" }],
    });
    const c = blackjackCheck(mk([{ ...e }]))!;
    expect(c.rounds).toBe(1);
    expect(c.edgeAdded).toBeCloseTo(c.evLossCredits / 20, 12);
    expect(c.evLossCredits).toBeGreaterThan(0);
  });
});

describe("roulette", () => {
  const spin = (n: number, bets: { kind: string; amt: number }[]) => {
    const bet = bets.reduce((a, b) => a + b.amt, 0);
    return { game: "roulette" as const, bet, payout: 0, out: { n }, dec: { bets: bets.map((b) => ({ bet: { kind: b.kind }, amt: b.amt })) } };
  };
  it("colourOf", () => {
    expect(colourOf(0)).toBe("green");
    expect(colourOf(1)).toBe("red");
    expect(colourOf(2)).toBe("black");
  });
  it("no roulette: null", () => {
    expect(rouletteCheck(SESSION_SVB)).toBeNull();
  });
  it("martingale: doubling after each loss is detected, one run", () => {
    const s = mk([spin(1, [{ kind: "black", amt: 10 }]), spin(3, [{ kind: "black", amt: 20 }]), spin(5, [{ kind: "black", amt: 40 }]), { ...spin(2, [{ kind: "black", amt: 80 }]), payout: 160 }]);
    const r = rouletteCheck(s)!;
    expect(r.martingale.doublings).toBe(3);
    expect(r.martingale.detected).toBe(true);
    expect(r.martingale.runs).toEqual([{ from: 0, to: 3, len: 3, maxStake: 80 }]);
    expect(r.martingale.maxStake).toBe(80);
    expect(r.mix).toEqual({ black: 150 });
  });
  it("martingale: a win resets, constant bets are not doublings, one doubling is not 'detected'", () => {
    const s = mk([
      spin(1, [{ kind: "red", amt: 10 }]),
      spin(1, [{ kind: "red", amt: 10 }]),
      { ...spin(1, [{ kind: "red", amt: 20 }]), payout: 40 }, // previous lost 10 -> doubled to 20 (1 doubling)
      spin(1, [{ kind: "red", amt: 40 }]), // previous won: not a doubling
    ]);
    const r = rouletteCheck(s)!;
    expect(r.martingale.doublings).toBe(1);
    expect(r.martingale.detected).toBe(false);
  });
  it("two separate chains make two runs", () => {
    const s = mk([
      spin(1, [{ kind: "red", amt: 10 }]), spin(1, [{ kind: "red", amt: 20 }]), spin(1, [{ kind: "red", amt: 40 }]),
      { ...spin(1, [{ kind: "red", amt: 10 }]), payout: 20 }, // not a doubling (40 -> 10); a win
      spin(1, [{ kind: "red", amt: 10 }]), spin(1, [{ kind: "red", amt: 20 }]),
    ]);
    const r = rouletteCheck(s)!;
    expect(r.martingale.runs.map((x) => x.len)).toEqual([2, 1]);
  });
  it("streak: betting against a 3-run vs following it", () => {
    const s = mk([
      spin(1, [{ kind: "red", amt: 10 }]), spin(3, [{ kind: "red", amt: 10 }]), spin(5, [{ kind: "red", amt: 10 }]), // red red red
      spin(7, [{ kind: "black", amt: 30 }]), // against (streak was red x3); result 7 = red -> streak red x4
      spin(9, [{ kind: "red", amt: 20 }]), // with (red x4)
    ]);
    const r = rouletteCheck(s)!;
    expect(r.streak.opportunities).toBe(2);
    expect(r.streak.against).toBe(1);
    expect(r.streak.with).toBe(1);
    expect(r.streak.cases[0]).toMatchObject({ streakColour: "red", streakLen: 3, bet: "against", amt: 30 });
    expect(r.streak.cases[1]).toMatchObject({ streakLen: 4, bet: "with", amt: 20 });
  });
  it("zero ends a streak; non-colour bets are an opportunity but no case", () => {
    const s = mk([
      spin(1, [{ kind: "red", amt: 10 }]), spin(3, [{ kind: "red", amt: 10 }]), spin(0, [{ kind: "red", amt: 10 }]),
      spin(5, [{ kind: "black", amt: 10 }]), // streak broken by 0: no opportunity
      spin(7, [{ kind: "red", amt: 10 }]), spin(9, [{ kind: "red", amt: 10 }]), // red, red (len 2 after 5? 5 red,7 red,9 red)
      spin(11, [{ kind: "odd", amt: 10 }]), // streak red x3 before: opportunity, no colour bet
    ]);
    const r = rouletteCheck(s)!;
    expect(r.streak.opportunities).toBe(1);
    expect(r.streak.cases).toHaveLength(0);
    expect(r.mix.odd).toBe(10);
  });
  it("ignores flush Evs and other games", () => {
    const s = mk([flushEv(10), { game: "slot", bet: 20, payout: 0 }, spin(1, [{ kind: "red", amt: 10 }])]);
    expect(rouletteCheck(s)!.rounds).toBe(1);
  });
  it("fixture on: roulette stats are internally consistent", () => {
    const r = rouletteCheck(SESSION_ON)!;
    expect(r.rounds).toBe(8);
    expect(r.streak.against + r.streak.with).toBe(r.streak.cases.length);
    expect(Object.values(r.mix).reduce((a, b) => a + b, 0)).toBe(SESSION_ON.events.filter((e) => e.game === "roulette").reduce((a, e) => a + e.bet, 0));
  });
});

describe("crash", () => {
  const crash = (bet: number, payout: number, dec: Record<string, unknown>) => ({ game: "crash" as const, bet, payout, dec });
  it("manual cash-out, auto target and neither", () => {
    const s = mk([
      crash(100, 150, { target: null, manualCashoutAt: 1.5 }),
      crash(100, 0, { target: 2, manualCashoutAt: null }),
      crash(100, 0, { target: null, manualCashoutAt: null }),
      crash(100, 300, { target: 3, manualCashoutAt: 2.5 }), // tap wins over target
    ]);
    const c = crashCheck(s)!;
    expect(c.rounds).toBe(4);
    expect(c.manual).toBe(2);
    expect(c.auto).toBe(1);
    expect(c.none).toBe(1);
    expect(c.manualAt).toEqual([1.5, 2.5]);
    expect(c.targets).toEqual([2, 3]);
    expect(c.chosen).toEqual([1.5, 2, 2.5]);
    expect(c.bins).toHaveLength(CRASH_BINS.length - 1);
    expect(c.bins.reduce((a, b) => a + b.n, 0)).toBe(c.chosen.length);
    expect(c.bins.find((b) => b.lo === 1.5)!.n).toBe(1);
    expect(c.bins.find((b) => b.lo === 2)!.n).toBe(2);
    expect(c.wagered).toBe(400);
    expect(c.paid).toBe(450);
    expect(c.actualReturn).toBeCloseTo(450 / 400, 12);
    expect(c.theoreticalReturn).toBe(1 - CRASH.edge);
  });
  it("no crash: null; non-crash events ignored", () => {
    expect(crashCheck(SESSION_SVB)).toBeNull();
    expect(crashCheck(mk([{ game: "slot", bet: 20, payout: 0, dec: { target: 2 } }]))).toBeNull();
  });
  it("fixture on", () => {
    const c = crashCheck(SESSION_ON)!;
    expect(c.rounds).toBe(5);
    expect(c.manual).toBe(2);
    expect(c.auto).toBe(3);
    expect(c.none).toBe(0);
  });
});

describe("strategyCheck", () => {
  it("aggregates and lists no-strategy games", () => {
    const c = strategyCheck(SESSION_ON);
    expect(c.blackjack).not.toBeNull();
    expect(c.roulette).not.toBeNull();
    expect(c.crash).not.toBeNull();
    expect(c.noStrategy.sort()).toEqual(["ocean", "slot"]);
    expect(strategyCheck(SESSION_SVB)).toMatchObject({ blackjack: null, roulette: null, crash: null });
    expect(strategyCheck(SESSION_OFF).noStrategy.sort()).toEqual(["ocean", "slot"]);
  });
  it("a session with only a flush has no played games", () => {
    expect(strategyCheck(mk([flushEv(10)])).noStrategy).toEqual([]);
  });
  it("empty session", () => {
    expect(strategyCheck(mk([]))).toEqual({ blackjack: null, roulette: null, crash: null, noStrategy: [] });
  });
});
