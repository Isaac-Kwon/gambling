import { describe, expect, it } from "vitest";
import type { Ev, Session } from "@shared/schema";
import { cardFromStr, simulateBj, type HandView } from "@shared/rules/blackjack";
import { SLOTS, slotExact } from "@shared/rules/slot";
import { oceanExact, OCEAN } from "@shared/rules/ocean";
import { createRng } from "@shared/rng";
import { BET_SYSTEMS, simPlayers, type BankrollParams } from "./bankroll";
import { buildModel, bjCategory } from "./model";
import {
  ALL_BETS, bjShoeRng, crashExactReturn, crashModelPicker, crashTargetsJob, modelPolicy, randomTarget, simStrategy,
} from "./strategy";
import { runSync } from "./scheduler";
import { slotDist } from "./slotDist";
import { summarize } from "./stats";

const EDGE = 1 / 37;
const base: BankrollParams = { edge: EDGE, rounds: 200, system: "flat", bankroll: 1000, baseBet: 10, players: 2000, seed: "t1" };
const near = (x: number, target: number, se: number, k = 4.5) => Math.abs(x - target) <= k * se + 1e-12;

describe("simPlayers", () => {
  it("is deterministic by seed", () => {
    for (const system of BET_SYSTEMS) {
      const a = simPlayers({ ...base, system }), b = simPlayers({ ...base, system });
      expect(Array.from(a.finals)).toEqual(Array.from(b.finals));
      expect(Array.from(a.paths.y)).toEqual(Array.from(b.paths.y));
      const c = simPlayers({ ...base, system, seed: "t2" });
      expect(Array.from(c.finals)).not.toEqual(Array.from(a.finals));
    }
  });

  it("player i does not depend on how many players run", () => {
    const a = simPlayers({ ...base, players: 50 }), b = simPlayers({ ...base, players: 500 });
    expect(Array.from(a.finals)).toEqual(Array.from(b.finals.subarray(0, 50)));
  });

  it("martingale vs flat: same loss per credit wagered, more ruin, more players ahead", () => {
    const p = { ...base, rounds: 100, bankroll: 1000, baseBet: 1, players: 10000 };
    const flat = simPlayers({ ...p, system: "flat" });
    const mart = simPlayers({ ...p, system: "martingale" });
    for (const r of [flat, mart]) expect(near(r.perWagered.mean, -EDGE, r.perWagered.se)).toBe(true);
    expect(mart.ruinRate).toBeGreaterThan(flat.ruinRate + 0.03);
    expect(mart.ahead.rate).toBeGreaterThan(flat.ahead.rate + 0.2);
    // martingale wagers far more, so the expected loss in credits is larger even though the rate is the same
    expect(mart.wageredMean).toBeGreaterThan(flat.wageredMean);
    expect(mart.bankroll - mart.mean).toBeGreaterThan(0);
  });

  it("every system loses ≈ edge per credit wagered", () => {
    for (const system of BET_SYSTEMS) {
      const r = simPlayers({ ...base, system, rounds: 300, players: 5000 });
      expect(near(r.perWagered.mean, -EDGE, r.perWagered.se), `${system} ${r.perWagered.mean} ± ${r.perWagered.se}`).toBe(true);
    }
  });

  it("edge 0 → mean ≈ 0", () => {
    const r = simPlayers({ ...base, edge: 0, players: 10000 });
    expect(near(r.perWagered.mean, 0, r.perWagered.se)).toBe(true);
    expect(near(r.mean, r.bankroll, r.sd / Math.sqrt(r.players))).toBe(true);
    expect(r.edge).toBe(0);
  });

  it("result shape: histogram, quantiles, ruin curve, paths, survivor stats", () => {
    const r = simPlayers({ ...base, system: "martingale", paths: 5, points: 21 });
    expect(r.hist.counts.reduce((a, b) => a + b, 0)).toBe(r.players);
    expect(r.hist.edges.length).toBe(41);
    expect(r.q).toHaveLength(9);
    for (let i = 1; i < r.q.length; i++) expect(r.q[i]).toBeGreaterThanOrEqual(r.q[i - 1]);
    expect(r.paths.x[0]).toBe(0);
    expect(r.paths.x[r.paths.x.length - 1]).toBe(r.rounds);
    expect(r.paths.y.length).toBe(5 * r.paths.x.length);
    for (let p = 0; p < 5; p++) {
      expect(r.paths.y[p * r.paths.x.length]).toBe(r.bankroll);
      expect(r.paths.y[(p + 1) * r.paths.x.length - 1]).toBe(r.finals[p]);
    }
    const rc = r.ruinCurve.ruined;
    expect(rc[0]).toBe(0);
    expect(rc[rc.length - 1]).toBeCloseTo(r.ruinRate, 12);
    for (let i = 1; i < rc.length; i++) expect(rc[i]).toBeGreaterThanOrEqual(rc[i - 1]);
    expect(r.top1.mean).toBeGreaterThanOrEqual(r.top1.threshold);
    expect(r.top1.threshold).toBeGreaterThan(r.q[4]);
    expect(r.survivors.n).toBe(Math.round(r.players * (1 - r.ruinRate)));
    expect(r.ahead.mean).toBeGreaterThan(r.bankroll);
  });

  it("straight-up payoff: same edge, more variance", () => {
    const even = simPlayers({ ...base, players: 4000 });
    const str = simPlayers({ ...base, players: 4000, payoff: { kind: "straight" } });
    expect(str.edge).toBeCloseTo(EDGE, 12);
    expect(near(str.perWagered.mean, -EDGE, str.perWagered.se)).toBe(true);
    expect(str.sd).toBeGreaterThan(even.sd * 3);
  });

  it("slot payoff uses the variant's exact distribution", () => {
    const r = simPlayers({ ...base, edge: 0.5, players: 3000, rounds: 300, bankroll: 2000, baseBet: 20, payoff: { kind: "slot", sv: "b" } });
    expect(r.edge).toBeCloseTo(1 - slotDist(SLOTS.b).ret, 12);
    expect(near(r.perWagered.mean, -r.edge, r.perWagered.se)).toBe(true);
  });

  it("rejects bad parameters", () => {
    expect(() => simPlayers({ ...base, rounds: 0 })).toThrow();
    expect(() => simPlayers({ ...base, bankroll: 5 })).toThrow();
    expect(() => simPlayers({ ...base, system: "labouchere" as never })).toThrow();
  });
});

describe("slotDist", () => {
  it.each(["a", "b"] as const)("variant %s matches slotExact and gives the under-the-bet rate", (sv) => {
    const cfg = SLOTS[sv];
    const d = slotDist(cfg), e = slotExact(cfg);
    expect(d.cycle).toBe(e.cycle);
    expect(d.sumLinePay).toBe(e.sumLinePay);
    expect(d.hit).toBe(e.hit);
    expect(d.tierFreq).toEqual(e.tierFreq);
    expect(d.ret).toBeCloseTo(e.ret, 12);
    expect(d.sigma).toBeCloseTo(e.sigma, 9);
    expect(d.count.reduce((a, b) => a + b, 0)).toBe(d.cycle);
    expect(d.under).toBeGreaterThan(0);
    expect(d.under).toBeLessThan(d.hit);
    expect(d.underRate).toBeCloseTo(d.under / d.cycle, 15);
  });
  it("variant b hits less often than a at the same return", () => {
    const a = slotDist(SLOTS.a), b = slotDist(SLOTS.b);
    expect(b.hitRate).toBeLessThan(a.hitRate);
    expect(Math.abs(a.ret - b.ret)).toBeLessThan(0.001);
  });
});

describe("simStrategy", () => {
  it("is deterministic by seed", () => {
    for (const g of ["blackjack", "roulette", "crash", "slot", "ocean"] as const) {
      const a = simStrategy(g, null, 6000, "s"), b = simStrategy(g, null, 6000, "s");
      expect(a.arms.map((x) => x.dist.mean)).toEqual(b.arms.map((x) => x.dist.mean));
    }
  });

  it("blackjack optimal arm = simulateBj with the same shoes; edge in a plausible range", () => {
    const n = 100000;
    const r = simStrategy("blackjack", null, n, "bj");
    const opt = r.arms.find((a) => a.arm === "optimal")!;
    const ref = simulateBj({ rounds: n, shoeRng: bjShoeRng("bj") });
    expect(opt.dist.mean).toBeCloseTo(ref.mean, 12);
    expect(opt.dist.mean).toBeGreaterThan(-0.02);
    expect(opt.dist.mean).toBeLessThan(0.01);
    const rnd = r.arms.find((a) => a.arm === "random")!;
    expect(rnd.dist.mean).toBeLessThan(-0.2);
    expect(r.arms.map((a) => a.arm)).toEqual(["random", "optimal"]);   // no model → no "yours"
    // net per initial bet is bounded by ±4 (split + double on both hands) and blackjack pays 1.5
    expect(opt.dist.min).toBeGreaterThanOrEqual(-4);
    expect(opt.dist.max).toBeLessThanOrEqual(4);
    expect(Array.from(opt.dist.atoms!.x)).toContain(1.5);
  });

  it("roulette: every arm returns −1/37 per unit", () => {
    expect(ALL_BETS).toHaveLength(109);
    const r = simStrategy("roulette", null, 100000, "rl");
    for (const a of r.arms) expect(near(a.dist.mean, -EDGE, a.dist.se), `${a.arm} ${a.dist.mean}`).toBe(true);
    const opt = r.arms.find((a) => a.arm === "optimal")!;
    expect(Array.from(opt.dist.atoms!.x)).toEqual([-1, 1]);
  });

  it("crash: every arm ≈ −1% (any target returns 99%)", () => {
    const r = simStrategy("crash", null, 100000, "cr");
    for (const a of r.arms) expect(near(a.dist.mean, -0.01, a.dist.se), `${a.arm} ${a.dist.mean}`).toBe(true);
    const rng = createRng("x", "y");
    for (let i = 0; i < 1000; i++) { const t = randomTarget(rng); expect(t).toBeGreaterThanOrEqual(1.01); expect(t).toBeLessThanOrEqual(1000); expect(Math.round(t * 100)).toBeCloseTo(t * 100, 6); }
  });

  it("slot / ocean: machine arm only, mean = exact return − 1", () => {
    const s = simStrategy("slot", null, 100000, "sl", { sv: "b" });
    expect(s.arms.map((a) => a.arm)).toEqual(["machine"]);
    expect(near(s.arms[0].dist.mean, slotDist(SLOTS.b).ret - 1, s.arms[0].dist.se)).toBe(true);
    const o = simStrategy("ocean", null, 100000, "oc");
    expect(near(o.arms[0].dist.mean, oceanExact(OCEAN).total - 1, o.arms[0].dist.se)).toBe(true);
  });

  it("block sums summarize sessions of the player's length", () => {
    const r = simStrategy("roulette", null, 10000, "blk", { block: 100 });
    const b = r.arms[0].blocks!;
    expect(b.n).toBe(100);
    expect(b.hist.counts.reduce((x, y) => x + y, 0)).toBe(100);
  });
});

describe("crashTargets", () => {
  it("all targets give ≈ 99%", () => {
    const r = runSync(crashTargetsJob({ n: 300000, seed: "ct" }));
    for (let k = 0; k < r.targets.length; k++) {
      expect(near(r.rtp[k], 0.99, r.se[k]), `target ${r.targets[k]}: ${r.rtp[k]} ± ${r.se[k]}`).toBe(true);
      expect(Math.abs(r.exact[k] - 0.99)).toBeLessThan(1e-6);
    }
    expect(crashExactReturn(2)).toBeCloseTo(0.99, 8);
  });
});

// ---------------------------------------------------------------------------
// buildModel on a synthetic session

const c = (s: string[]) => s;
function bjEv(round: number, dealer: string[], hands: string[][], steps: { hand: number; action: string; optimal: string }[]): Ev {
  return {
    t: round * 1000, game: "blackjack", round, bet: 20, payout: 0, net: -20, balance: 0,
    out: { shoe: 1, pos: 0, dealer: c(dealer), hands: hands.map((cards) => ({ cards, bet: 20, res: "lose" })) },
    dec: { trueCountApprox: 0, steps: steps.map((x) => ({ ...x, trueCountApprox: 0 })) },
  };
}
function ev(game: Ev["game"], round: number, dec: Record<string, unknown>, out: Record<string, unknown> = {}): Ev {
  return { t: round, game, round, bet: 100, payout: 0, net: -100, balance: 0, dec, out };
}

const session: Session = {
  v: 1, seed: "syn", mode: "free", fx: "on", display: "browser", installed: false,
  device: { w: 390, h: 844, dpr: 3, touch: true, orient: "portrait" },
  startedAt: 0, startCredits: 10000, nav: [], sv: "b",
  events: [
    // hard 16 vs 9: hit (→ 18), stand
    bjEv(1, ["9c", "7s"], [["Ts", "6h", "2d"]], [{ hand: 0, action: "H", optimal: "H" }, { hand: 0, action: "S", optimal: "S" }]),
    // 8,8 vs T: split; hand 0 = 8,3 doubles (→ K); hand 1 = 8,T stands
    bjEv(2, ["Tc", "8d", "9h"], [["8s", "3h", "Kd"], ["8h", "Td"]], [
      { hand: 0, action: "P", optimal: "P" }, { hand: 0, action: "D", optimal: "D" }, { hand: 1, action: "S", optimal: "S" }]),
    // 5,5 vs 6 not split: double
    bjEv(3, ["6c", "Th", "4s"], [["5s", "5h", "9d"]], [{ hand: 0, action: "D", optimal: "D" }]),
    // malformed: a split that is not the first decision
    bjEv(4, ["6c", "Th"], [["5s", "5h"], ["5d"]], [{ hand: 0, action: "H", optimal: "D" }, { hand: 0, action: "P", optimal: "P" }]),
    // a natural: no decisions, still a round
    bjEv(5, ["9c", "7s"], [["As", "Kh"]], []),
    ev("roulette", 1, { bets: [{ bet: { kind: "red" }, amt: 50 }, { bet: { kind: "straight", n: 17 }, amt: 10 }, { bet: { kind: "split", a: 1, b: 5 }, amt: 10 }] }, { n: 3 }),
    ev("roulette", 2, { bets: [{ bet: { kind: "split", a: 1, b: 5 }, amt: 10 }] }, { n: 3 }),   // only invalid bets → skipped
    ev("crash", 1, { target: 2, manualCashoutAt: null }, { crash: 1.5, cashoutAt: null }),
    ev("crash", 2, { target: null, manualCashoutAt: 1.37 }, { crash: 4, cashoutAt: 1.37 }),
    ev("crash", 3, { target: 3, manualCashoutAt: 1.8 }, { crash: 5, cashoutAt: 1.8 }),
    ev("crash", 4, { target: null, manualCashoutAt: null }, { crash: 1.2, cashoutAt: null }),
    ev("slot", 1, { lineBet: 1 }), ev("slot", 2, { lineBet: 1 }),
    ev("ocean", 1, {}), { ...ev("ocean", 1, { bonusSeqId: 1, flush: true }), bet: 0 },
  ],
};

describe("buildModel", () => {
  const m = buildModel(session);

  it("blackjack: action counts per (category, dealer up value)", () => {
    const bj = m.blackjack!;
    expect(bj.rounds).toBe(4);   // the malformed round is dropped, the natural counts
    expect(bj.decisions).toBe(6);
    expect(bj.matched).toBe(6);
    expect(bj.cells).toEqual({
      "H16:9": [1, 0, 0, 0], "H18:9": [0, 1, 0, 0],
      "P8:10": [0, 0, 0, 1], "H11:10": [0, 0, 1, 0], "H18:10": [0, 1, 0, 0],
      "P5:6": [0, 0, 1, 0],
    });
  });

  it("roulette: valid layouts with their totals", () => {
    expect(m.roulette).toEqual({ rounds: 1, layouts: [{ bets: [{ bet: { kind: "red" }, amt: 50 }, { bet: { kind: "straight", n: 17 }, amt: 10 }], total: 60 }] });
  });

  it("crash: manual beats target, no action → censored at the crash point", () => {
    expect(m.crash).toEqual({ rounds: 4, observed: [2, 1.37, 1.8], censored: [1.2] });
  });

  it("slot variant and round counts (ocean flush is not a round)", () => {
    expect(m.slot).toEqual({ sv: "b", rounds: 2 });
    expect(m.ocean).toEqual({ rounds: 1 });
    expect(buildModel({ ...session, sv: undefined, events: [] })).toEqual({
      blackjack: null, roulette: null, crash: null, slot: { sv: "a", rounds: 0 }, ocean: { rounds: 0 },
    });
  });

  it("survives junk events", () => {
    const junk = { ...session, events: [null, 3, { game: "blackjack", out: "x" }, { game: "crash", dec: { target: "2" } }] as unknown as Ev[] };
    expect(() => buildModel(junk)).not.toThrow();
  });

  it("model policy: samples the logged action, falls back to the chart", () => {
    const pol = modelPolicy(m.blackjack!, createRng("p", "q"));
    const v = (cards: string[], split = false): HandView => ({ cards: cards.map(cardFromStr), fromSplit: false, can: { double: cards.length === 2, split } });
    const up9 = cardFromStr("9h"), upT = cardFromStr("Kh");
    expect(pol(v(["Ts", "6h"]), up9, null as never)).toBe("H");
    expect(pol(v(["Ts", "6h", "2c"]), up9, null as never)).toBe("S");
    expect(pol(v(["8s", "8c"], true), upT, null as never)).toBe("P");
    // H11 vs T was a double; with three cards a double is impossible → counted as hit
    expect(pol(v(["4s", "2h", "5c"]), upT, null as never)).toBe("H");
    // unseen: hard 12 vs 4 → chart says stand
    expect(pol(v(["Ts", "2h"]), cardFromStr("4d"), null as never)).toBe("S");
    expect(bjCategory([cardFromStr("As"), cardFromStr("7d")], false)).toBe("S18");
  });

  it("crash picker: censored rounds resample above the crash point, or lose", () => {
    const pick = crashModelPicker({ rounds: 3, observed: [1.5, 3], censored: [2] });
    const rng = createRng("c", "p");
    const seen = new Set<number | null>();
    for (let i = 0; i < 2000; i++) seen.add(pick(rng));
    expect([...seen].sort()).toEqual([1.5, 3]);
    const none = crashModelPicker({ rounds: 1, observed: [], censored: [2] });
    expect(none(rng)).toBeNull();
  });

  it("strategy with the model adds a 'yours' arm", () => {
    for (const g of ["blackjack", "roulette", "crash"] as const) {
      const r = simStrategy(g, m, 20000, "y");
      expect(r.arms.map((a) => a.arm)).toEqual(["yours", "random", "optimal"]);
    }
    const rl = simStrategy("roulette", m, 100000, "y2").arms[0];
    expect(near(rl.dist.mean, -EDGE, rl.dist.se)).toBe(true);
    const cr = simStrategy("crash", m, 100000, "y3").arms[0];
    expect(near(cr.dist.mean, -0.01, cr.dist.se)).toBe(true);
    expect(simStrategy("slot", m, 10, "y").arms[0].arm).toBe("machine");
  });
});

describe("summarize", () => {
  it("atoms, quantiles and histogram", () => {
    const s = summarize([-1, -1, 0, 1, 1.5]);
    expect(Array.from(s.atoms!.x)).toEqual([-1, 0, 1, 1.5]);
    expect(Array.from(s.atoms!.p)).toEqual([0.4, 0.2, 0.2, 0.2]);
    expect(s.q[4]).toBe(0);
    expect(s.pPos).toBeCloseTo(0.4);
    expect(s.hist.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(summarize(Array.from({ length: 100 }, (_, i) => i)).atoms).toBeNull();
  });
});
