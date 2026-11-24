import { describe, expect, it } from "vitest";
import { cardFromStr, optimalAction, type Action, type HandView } from "./blackjack";
import { actionEv, actionEvs, bestAction, dealerDist, dealerNaturalProb, evLoss, roundEv } from "./blackjackEv";

const C = cardFromStr;
const view = (s: string, o: { double?: boolean; split?: boolean; fromSplit?: boolean } = {}): HandView =>
  ({ cards: s.split(" ").map(C), fromSplit: o.fromSplit ?? false, can: { double: o.double ?? true, split: o.split ?? true } });
const UP = ["2c", "3c", "4c", "5c", "6c", "7c", "8c", "9c", "Tc", "Ac"];

describe("dealer distribution (infinite deck, S17, conditioned on no dealer natural)", () => {
  it("sums to 1 and matches published infinite-deck bust rates", () => {
    for (let u = 1; u <= 10; u++) expect(dealerDist(u).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(dealerDist(2)[5]).toBeCloseTo(0.3536, 4);
    expect(dealerDist(6)[5]).toBeCloseTo(0.4232, 4);
    expect(dealerDist(6)[0]).toBeCloseTo(0.1654, 4);
    expect(dealerNaturalProb(1)).toBeCloseTo(4 / 13, 12);
    expect(dealerNaturalProb(10)).toBeCloseTo(1 / 13, 12);
    expect(dealerNaturalProb(7)).toBe(0);
  });
});

describe("actionEv", () => {
  it("classic values: 16 vs T hit edges out stand", () => {
    const h = view("Ts 6d");
    expect(actionEv(h, C("Tc"), "S")).toBeCloseTo(-0.5404, 4);
    expect(actionEv(h, C("Tc"), "H")).toBeCloseTo(-0.5398, 4);
  });
  it("double is scaled to the original bet; split counts both hands", () => {
    const e = actionEvs(view("6s 5d"), C("6c"));
    expect(e.D).toBeGreaterThan(e.H);
    expect(e.D).toBeGreaterThan(0.6);
    expect(e.D).toBeLessThan(2);
    expect(actionEv(view("As Ad"), C("6c"), "P")).toBeGreaterThan(actionEv(view("As Ad"), C("6c"), "H"));
    expect(actionEv(view("8s 8d"), C("Tc"), "P")).toBeGreaterThan(actionEv(view("8s 8d"), C("Tc"), "H"));
  });
  it("unavailable actions are NaN; DAS allows doubling a split hand; naturals stand for 3:2", () => {
    expect(actionEv(view("2s 3d 6h"), C("6c"), "D")).toBeNaN();
    expect(actionEv(view("6s 5d", { double: false }), C("6c"), "D")).toBeNaN();
    expect(actionEv(view("6s 5d"), C("6c"), "P")).toBeNaN();
    expect(actionEv(view("8s 8d", { fromSplit: true }), C("6c"), "P")).toBeNaN();
    expect(actionEv(view("8s 8d", { split: false }), C("6c"), "P")).toBeNaN();
    expect(actionEv(view("8s 3d", { fromSplit: true }), C("6c"), "D")).toBeGreaterThan(0);
    expect(actionEv(view("As Kd"), C("6c"), "S")).toBe(1.5);
    expect(actionEv(view("Ts 6d 9h"), C("6c"), "S")).toBe(-1);
  });
  it("evLoss is 0 for the best action and positive otherwise", () => {
    expect(evLoss(view("Ts 6d"), C("Tc"), "H")).toBe(0);
    expect(evLoss(view("Ts 6d"), C("Tc"), "S")).toBeCloseTo(0.0006, 4);
    expect(evLoss(view("Ts 6d"), C("6c"), "H")).toBeGreaterThan(0.2);
    expect(evLoss(view("Ts 6d"), C("6c"), "P")).toBeNaN();
  });
});

/** Every cell of the chart: hard 5–20 (two-card, never a pair), soft 13–20, the 10 pairs; × 10 dealer cards. */
function chartCells(): { name: string; hand: HandView }[] {
  const out: { name: string; hand: HandView }[] = [];
  const r = (v: number) => (v === 10 ? "T" : v === 1 ? "A" : String(v));
  for (let t = 5; t <= 20; t++) {
    const a = t <= 11 ? 2 : 10, b = t - a;
    out.push({ name: `hard ${t}`, hand: view(`${r(a)}s ${r(b)}d`, { split: false }) });
  }
  for (let t = 13; t <= 20; t++) out.push({ name: `soft ${t}`, hand: view(`As ${r(t - 11)}d`) });
  for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 1]) out.push({ name: `${r(v)},${r(v)}`, hand: view(`${r(v)}s ${r(v)}d`) });
  return out;
}

describe("EV argmax vs the chart", () => {
  // Infinite deck has no card-removal effects. Two multi-deck doubles are near-indifferent and flip to hit
  // once the player's own small cards are not removed from the shoe:
  //   soft 13 (A,2) vs 5: chart D, infinite-deck H (EV gap 0.0074)
  //   soft 15 (A,4) vs 4: chart D, infinite-deck H (EV gap 0.0009)
  const KNOWN = ["soft 13 vs 5", "soft 15 vs 4"];

  it("argmax matches every chart cell except the listed infinite-deck differences", () => {
    const diffs: string[] = [];
    let n = 0;
    for (const { name, hand } of chartCells()) {
      for (const u of UP) {
        n++;
        const chart = optimalAction(hand, C(u));
        if (chart === bestAction(hand, C(u)).action) continue;
        diffs.push(`${name} vs ${u[0]}`);
        expect(evLoss(hand, C(u), chart)).toBeLessThan(0.01);
      }
    }
    expect(n).toBe(34 * 10);
    expect(diffs).toEqual(KNOWN);
  });

  it("also for hands that cannot double or split (fallback rows)", () => {
    const acts: Action[] = [];
    for (const s of ["2s 3d 4h", "2s 3d 6h", "As 2d 5h", "As 2d 2h", "8s 8d"]) {
      const h = view(s, { split: false, double: s.split(" ").length === 2 ? false : true });
      for (const u of UP) {
        const chart = optimalAction(h, C(u)), best = bestAction(h, C(u)).action;
        if (chart !== best) acts.push(chart);
      }
    }
    expect(acts).toEqual([]);
  });
});

describe("whole-round value (infinite deck)", () => {
  it("chart play loses ≈ 0.57% per initial bet; EV-optimal play differs by < 0.01%p", () => {
    const chart = roundEv("chart"), best = roundEv("best");
    expect(chart).toBeLessThan(-0.004);
    expect(chart).toBeGreaterThan(-0.007);
    expect(best).toBeGreaterThanOrEqual(chart);
    expect(best - chart).toBeLessThan(0.0001);
  });
});
