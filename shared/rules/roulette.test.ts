import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import {
  BLACK, RED, WHEEL_ORDER, betReturn, isValid, multOf, returnOf, rouletteExact, settle, spinWheel, wins,
  type Placed, type RouletteBet,
} from "./roulette";

const allBets = (): RouletteBet[] => {
  const out: RouletteBet[] = [];
  for (let n = 0; n <= 36; n++) out.push({ kind: "straight", n });
  for (let a = 0; a <= 36; a++) for (let b = a + 1; b <= 36; b++) if (isValid({ kind: "split", a, b })) out.push({ kind: "split", a, b });
  for (const kind of ["red", "black", "odd", "even", "low", "high"] as const) out.push({ kind });
  for (const kind of ["dozen", "column"] as const) for (const i of [1, 2, 3] as const) out.push({ kind, i });
  return out;
};

describe("wheel and colours", () => {
  it("wheel order is a permutation of 0..36 starting at 0", () => {
    expect(WHEEL_ORDER).toHaveLength(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(WHEEL_ORDER[0]).toBe(0);
    expect(WHEEL_ORDER.slice(0, 4)).toEqual([0, 32, 15, 19]);
  });
  it("red and black partition 1..36, 18 each", () => {
    expect(RED.size).toBe(18);
    expect(BLACK.size).toBe(18);
    for (let n = 1; n <= 36; n++) expect(RED.has(n) !== BLACK.has(n)).toBe(true);
    expect(RED.has(0) || BLACK.has(0)).toBe(false);
  });
  it("wheel colours alternate (except around 0)", () => {
    for (let i = 1; i < 36; i++) expect(RED.has(WHEEL_ORDER[i])).not.toBe(RED.has(WHEEL_ORDER[i + 1]));
  });
});

describe("isValid", () => {
  it("straight range", () => {
    expect(isValid({ kind: "straight", n: 0 })).toBe(true);
    expect(isValid({ kind: "straight", n: 36 })).toBe(true);
    expect(isValid({ kind: "straight", n: 37 })).toBe(false);
    expect(isValid({ kind: "straight", n: -1 })).toBe(false);
    expect(isValid({ kind: "straight", n: 1.5 })).toBe(false);
  });
  it("split adjacency", () => {
    const s = (a: number, b: number) => isValid({ kind: "split", a, b });
    expect(s(0, 1) && s(0, 2) && s(0, 3)).toBe(true);
    expect(s(0, 4)).toBe(false);
    expect(s(1, 2) && s(2, 1) && s(2, 3)).toBe(true);
    expect(s(3, 4)).toBe(false);          // row wrap
    expect(s(1, 4) && s(33, 36)).toBe(true);
    expect(s(1, 5)).toBe(false);          // diagonal
    expect(s(5, 5)).toBe(false);
    expect(s(36, 37)).toBe(false);
    expect(s(-1, 0)).toBe(false);
  });
  it("split count is 60 (24 horizontal + 33 vertical + 3 zero)", () => {
    let c = 0;
    for (let a = 0; a <= 36; a++) for (let b = a + 1; b <= 36; b++) if (isValid({ kind: "split", a, b })) c++;
    expect(c).toBe(60);
  });
  it("dozen / column index", () => {
    expect(isValid({ kind: "dozen", i: 2 })).toBe(true);
    expect(isValid({ kind: "column", i: 4 as 1 })).toBe(false);
  });
});

describe("outcomes", () => {
  it("outside bets lose on zero", () => {
    for (const b of allBets()) if (!["straight", "split"].includes(b.kind)) expect(wins(b, 0)).toBe(false);
  });
  it("sets have the right size", () => {
    const count = (b: RouletteBet) => Array.from({ length: 37 }, (_, n) => n).filter((n) => wins(b, n)).length;
    for (const k of ["red", "black", "odd", "even", "low", "high"] as const) expect(count({ kind: k })).toBe(18);
    for (const k of ["dozen", "column"] as const) for (const i of [1, 2, 3] as const) expect(count({ kind: k, i })).toBe(12);
    expect(count({ kind: "split", a: 14, b: 17 })).toBe(2);
  });
  it("column / dozen membership", () => {
    expect(wins({ kind: "column", i: 1 }, 34)).toBe(true);
    expect(wins({ kind: "column", i: 3 }, 36)).toBe(true);
    expect(wins({ kind: "column", i: 2 }, 35)).toBe(true);
    expect(wins({ kind: "dozen", i: 1 }, 12)).toBe(true);
    expect(wins({ kind: "dozen", i: 2 }, 13)).toBe(true);
    expect(wins({ kind: "dozen", i: 3 }, 36)).toBe(true);
    expect(wins({ kind: "low" }, 18) && wins({ kind: "high" }, 19)).toBe(true);
  });
});

describe("exactness", () => {
  it("every bet returns exactly 36/37 over the 37 outcomes", () => {
    for (const b of allBets()) {
      let sum = 0;
      for (let n = 0; n <= 36; n++) sum += returnOf([{ bet: b, amt: 1 }], n);
      expect(sum).toBe(36);
      expect(rouletteExact(b)).toBe(36 / 37);
    }
  });
  it("layout total over 37 outcomes is 36 x total stake", () => {
    const placed: Placed[] = [
      { bet: { kind: "straight", n: 7 }, amt: 10 }, { bet: { kind: "red" }, amt: 50 }, { bet: { kind: "column", i: 2 }, amt: 100 },
    ];
    let sum = 0;
    for (let n = 0; n <= 36; n++) sum += returnOf(placed, n);
    expect(sum).toBe(36 * 160);
  });
});

describe("payout examples", () => {
  it("multipliers", () => {
    expect(multOf({ kind: "straight", n: 1 })).toBe(36);
    expect(multOf({ kind: "split", a: 1, b: 2 })).toBe(18);
    expect(multOf({ kind: "dozen", i: 1 })).toBe(3);
    expect(multOf({ kind: "column", i: 1 })).toBe(3);
    expect(multOf({ kind: "red" })).toBe(2);
  });
  it("straight 10 on 17 returns 360", () => {
    expect(returnOf([{ bet: { kind: "straight", n: 17 }, amt: 10 }], 17)).toBe(360);
    expect(returnOf([{ bet: { kind: "straight", n: 17 }, amt: 10 }], 18)).toBe(0);
  });
  it("split 100 returns 1800 on either cell", () => {
    const p: Placed[] = [{ bet: { kind: "split", a: 8, b: 9 }, amt: 100 }];
    expect(returnOf(p, 8)).toBe(1800);
    expect(returnOf(p, 9)).toBe(1800);
    expect(returnOf(p, 7)).toBe(0);
  });
  it("outside bets", () => {
    expect(betReturn({ bet: { kind: "red" }, amt: 500 }, 1)).toBe(1000);
    expect(betReturn({ bet: { kind: "red" }, amt: 500 }, 2)).toBe(0);
    expect(betReturn({ bet: { kind: "dozen", i: 3 }, amt: 50 }, 30)).toBe(150);
  });
  it("invalid bet never wins", () => {
    expect(returnOf([{ bet: { kind: "split", a: 1, b: 5 }, amt: 10 }], 1)).toBe(0);
  });
  it("settles a multi-bet layout", () => {
    const placed: Placed[] = [
      { bet: { kind: "straight", n: 17 }, amt: 10 },
      { bet: { kind: "split", a: 17, b: 18 }, amt: 50 },
      { bet: { kind: "black" }, amt: 100 },
      { bet: { kind: "odd" }, amt: 100 },
      { bet: { kind: "dozen", i: 2 }, amt: 100 },
    ];
    const s = settle(placed, 17);
    expect(s.totalBet).toBe(360);
    expect(s.payout).toBe(360 + 900 + 200 + 200 + 300);
    expect(s.net).toBe(s.payout - 360);
    expect(s.lines.map((l) => l.won)).toEqual([true, true, true, true, true]);
    const z = settle(placed, 0);
    expect(z.payout).toBe(0);
    expect(z.net).toBe(-360);
    const m = settle(placed, 20);          // black, even, dozen 2
    expect(m.payout).toBe(200 + 300);
    expect(m.lines.map((l) => l.won)).toEqual([false, false, true, false, true]);
  });
});

describe("spinWheel", () => {
  it("is deterministic and in range", () => {
    const a = createRng("s", "r"), b = createRng("s", "r");
    for (let i = 0; i < 500; i++) {
      const n = spinWheel(a);
      expect(n).toBe(spinWheel(b));
      expect(Number.isInteger(n) && n >= 0 && n <= 36).toBe(true);
    }
  });
});
