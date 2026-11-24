import { describe, expect, it } from "vitest";
import { createRng, createStreams } from "../rng";
import * as slotModule from "./slot";
import {
  SLOT_A, SLOT_B, SLOTS, drawStops, evaluate, gridOf, slotExact, slotFormula, slotPresentation, spin,
} from "./slot";
import type { LineWin, SlotConfig, SlotResult, Sym } from "./slot";

const CYCLE = 32 ** 5;
const ORDER = ["7", "B", "R", "C", "H", "s", "h", "c", "d", "W"] as const;
const countsOf = (strip: string) => ORDER.map((x) => [...strip].filter((c) => c === x).length);

/** Plain string-based reference evaluator, written independently of the typed-array path. */
function naive(cfg: SlotConfig, stops: readonly number[]): { wins: LineWin[]; mult: number; top5: boolean } {
  const g = cfg.strips.map((s, r) => [0, 1, 2].map((k) => s[(stops[r] + k) % s.length]));
  const wins: LineWin[] = [];
  let mult = 0, top5 = false;
  cfg.lines.forEach((line, li) => {
    const x = g[0][line[0]];
    if (x === "W") return;
    let n = 1;
    while (n < 5 && (g[n][line[n]] === x || g[n][line[n]] === "W")) n++;
    if (n < 3) return;
    const pay = cfg.pay[x as Exclude<Sym, "W">][n - 3];
    mult += pay;
    if (n === 5 && x === "7") top5 = true;
    wins.push({ line: li, sym: x as Sym, count: n as 3 | 4 | 5, pay });
  });
  return { wins, mult, top5 };
}

/** Config whose stop 0 shows exactly `grid` (grid[reel] = rows 0..2). */
function fromGrid(grid: string[], base: SlotConfig = SLOT_A): SlotConfig {
  return { ...base, id: "t", strips: grid };
}

const EXPECT = {
  a: { sum: 31_537_860, hit: 13_636_608, sigma: 2.712, oneIn: [11.2, 24.6, 182, 3771], wild: 2 },
  b: { sum: 31_540_800, hit: 10_065_920, sigma: 3.130, oneIn: [10.6, 21.7, 151, 1387], wild: 1 },
} as const;

describe("configs", () => {
  it("SLOTS maps variants; no bare SLOT export", () => {
    expect(SLOTS.a).toBe(SLOT_A);
    expect(SLOTS.b).toBe(SLOT_B);
    expect(SLOT_A.id).toBe("a");
    expect(SLOT_B.id).toBe("b");
    expect("SLOT" in slotModule).toBe(false);
    expect(SLOT_B.lines).toBe(SLOT_A.lines);
    expect(SLOT_A.lines).toHaveLength(20);
    for (const l of SLOT_A.lines) { expect(l).toHaveLength(5); for (const r of l) expect([0, 1, 2]).toContain(r); }
    expect(new Set(SLOT_A.lines.map((l) => l.join(""))).size).toBe(20);
  });

  for (const v of ["a", "b"] as const) {
    it(`variant ${v}: strips are 32 long, one 7 per reel, W only on reels 2-4`, () => {
      const cfg = SLOTS[v];
      expect(cfg.strips).toHaveLength(5);
      cfg.strips.forEach((s, r) => {
        expect(s).toHaveLength(32);
        expect([...s].every((c) => (ORDER as readonly string[]).includes(c))).toBe(true);
        const n = countsOf(s);
        expect(n[0]).toBe(1);
        expect(n[9]).toBe(r >= 1 && r <= 3 ? EXPECT[v].wild : 0);
      });
    });
  }

  it("variant b per-reel symbol counts match ARCHITECTURE 7.1", () => {
    const want = [
      [1, 2, 3, 4, 4, 5, 5, 4, 4, 0],
      [1, 2, 3, 4, 4, 4, 4, 5, 4, 1],
      [1, 3, 3, 4, 4, 4, 4, 4, 4, 1],
      [1, 2, 3, 4, 4, 4, 4, 4, 5, 1],
      [1, 3, 3, 4, 5, 4, 4, 4, 4, 0],
    ];
    SLOT_B.strips.forEach((s, r) => expect(countsOf(s)).toEqual(want[r]));
  });

  it("variant a R3 repeats d across the circular seam (intended)", () => {
    const s = SLOT_A.strips[2];
    expect(s[31]).toBe("d");
    expect(s[0]).toBe("d");
  });

  it("pay tables", () => {
    expect(SLOT_A.pay["7"]).toEqual([150, 750, 3000]);
    expect(SLOT_A.pay.c).toEqual([10, 25, 100]);
    expect(SLOT_B.pay.B).toEqual([100, 400, 2000]);
    expect(SLOT_B.pay.h).toEqual([15, 50, 200]);
  });
});

describe("evaluate", () => {
  it("7 + wilds on every line is the top result", () => {
    const e = evaluate(fromGrid(["777", "WWW", "777", "WWW", "777"]), [0, 0, 0, 0, 0]);
    expect(e.wins).toHaveLength(20);
    expect(e.wins.every((w) => w.sym === "7" && w.count === 5 && w.pay === 3000)).toBe(true);
    expect(e.mult).toBe(60000);
    expect(e.top5).toBe(true);
  });
  it("wild substitutes, count stops at the first mismatch", () => {
    const e = evaluate(fromGrid(["HHH", "WWW", "HHH", "sss", "HHH"]), [0, 0, 0, 0, 0]);
    expect(e.wins.every((w) => w.sym === "H" && w.count === 3 && w.pay === 20)).toBe(true);
    expect(e.mult).toBe(400);
    expect(e.top5).toBe(false);
    const f = evaluate(fromGrid(["BBB", "BBB", "BBB", "WWW", "ccc"]), [0, 0, 0, 0, 0]);
    expect(f.mult).toBe(20 * 250);
  });
  it("left to right only: a gap on reel 2 kills the line", () => {
    expect(evaluate(fromGrid(["BBB", "sss", "BBB", "BBB", "BBB"]), [0, 0, 0, 0, 0]).mult).toBe(0);
  });
  it("four 7/W in a row pays 4 of a kind and is not top5", () => {
    const e = evaluate(fromGrid(["777", "WWW", "WWW", "WWW", "sss"]), [0, 0, 0, 0, 0]);
    expect(e.top5).toBe(false);
    expect(e.mult).toBe(20 * 750);
  });
  it("mixed rows follow the line shapes", () => {
    const cfg = fromGrid(["s7c", "hWd", "c7s", "Whh", "7dc"]);
    const e = evaluate(cfg, [0, 0, 0, 0, 0]);
    expect(e).toEqual(naive(cfg, [0, 0, 0, 0, 0]));
    expect(e.wins.find((w) => w.line === 0)).toEqual({ line: 0, sym: "7", count: 3, pay: 150 });
    expect(e.wins.find((w) => w.line === 3)).toEqual({ line: 3, sym: "s", count: 3, pay: 12 });
  });
  it("agrees with an independent reference on 200k random stops (both variants)", () => {
    for (const cfg of [SLOT_A, SLOT_B]) {
      const rng = createRng("eval", cfg.id);
      for (let i = 0; i < 100_000; i++) {
        const st = drawStops(cfg, rng);
        const a = evaluate(cfg, st), b = naive(cfg, st);
        if (a.mult !== b.mult || a.top5 !== b.top5 || a.wins.length !== b.wins.length) expect(a).toEqual(b);
      }
    }
  });
  it("gridOf wraps around the strip", () => {
    const g = gridOf(SLOT_A, [31, 30, 0, 0, 0]);
    expect(g[0]).toEqual(["d", "s", "h"]);
    expect(g[1]).toEqual([SLOT_A.strips[1][30], SLOT_A.strips[1][31], SLOT_A.strips[1][0]]);
    expect(g[2]).toEqual(["d", "H", "s"]);
  });
  it("spin pays mult x lineBet", () => {
    const rng = createRng("spin", "x");
    for (let i = 0; i < 2000; i++) {
      const r = spin(SLOT_A, rng, 5);
      expect(r.payout).toBe(r.mult * 5);
      expect(r.mult).toBe(r.wins.reduce((t, w) => t + w.pay, 0));
    }
  });
});

describe("drawStops", () => {
  it("is uniform over 32 stops per reel (chi-square)", () => {
    const rng = createRng("uniform", "slot");
    const N = 320_000;
    const bins = Array.from({ length: 5 }, () => new Array(32).fill(0));
    for (let i = 0; i < N; i++) drawStops(SLOT_A, rng).forEach((s, r) => bins[r][s]++);
    const e = N / 32;
    for (const b of bins) {
      const chi = b.reduce((t, o) => t + (o - e) ** 2 / e, 0);
      expect(chi).toBeLessThan(61.1); // df 31, p = 0.001
    }
  });
});

describe("slotExact (full 32^5 enumeration)", () => {
  for (const v of ["a", "b"] as const) {
    it(`variant ${v}: constants, closed form, sigma, tiers`, () => {
      const cfg = SLOTS[v];
      const t0 = Date.now();
      const e = slotExact(cfg);
      const ms = Date.now() - t0;
      expect(ms).toBeLessThan(3000);
      expect(e.cycle).toBe(CYCLE);
      expect(e.sumLinePay).toBe(EXPECT[v].sum);
      expect(e.hit).toBe(EXPECT[v].hit);
      expect(Math.abs(e.ret - 0.94)).toBeLessThanOrEqual(0.0005);
      expect(e.sigma).toBeCloseTo(EXPECT[v].sigma, 3);
      expect(e.tierFreq.reduce((a, b) => a + b, 0)).toBe(CYCLE);
      e.tierFreq.slice(1).forEach((f, i) => {
        const oneIn = CYCLE / f, want = EXPECT[v].oneIn[i];
        expect(Math.abs(oneIn - want) / want).toBeLessThan(0.005);
      });
      const f = slotFormula(cfg);
      expect(f.sumLinePay).toBe(e.sumLinePay);
      expect(f.ret).toBe(e.ret);
    });
  }

  it("variant b hit rate is 0.28..0.32", () => {
    const e = slotExact(SLOT_B);
    expect(e.hit / e.cycle).toBeGreaterThanOrEqual(0.28);
    expect(e.hit / e.cycle).toBeLessThanOrEqual(0.32);
  });

  it("fast path equals brute force over evaluate on a small config", () => {
    const cfg: SlotConfig = { ...SLOT_A, id: "small", strips: ["s7cHB", "hWd7", "c7sR", "WhhCd", "7dcs"] };
    let sum = 0, sq = 0, hit = 0;
    const tiers = [0, 0, 0, 0, 0];
    let n = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let d = 0; d < 5; d++) for (let e = 0; e < 4; e++) {
      const m = evaluate(cfg, [a, b, c, d, e]).mult;
      n++; sum += m; sq += m * m; if (m > 0) hit++;
      const x = m / 20;
      tiers[x >= 50 ? 4 : x >= 15 ? 3 : x >= 5 ? 2 : x >= 2 ? 1 : 0]++;
    }
    const ex = slotExact(cfg);
    expect(ex.cycle).toBe(n);
    expect(ex.sumLinePay).toBe(sum / 20);
    expect(ex.hit).toBe(hit);
    expect(ex.tierFreq).toEqual(tiers);
    const mean = sum / 20 / n;
    expect(ex.sigma).toBeCloseTo(Math.sqrt(sq / 400 / n - mean * mean), 10);
    expect(slotFormula(cfg).sumLinePay).toBe(sum / 20);
  });
});

describe("slotPresentation", () => {
  const visible7 = (cfg: SlotConfig, r: SlotResult, reel: number) => gridOf(cfg, r.stops)[reel].includes("7");

  it("calling it or not does not change spin results (variants a and b)", () => {
    for (const cfg of [SLOT_A, SLOT_B]) {
      const s1 = createStreams("same-seed"), s2 = createStreams("same-seed");
      for (let n = 1; n <= 3000; n++) {
        const a = spin(cfg, s1.res("slot").at(n), 1);
        const b = spin(cfg, s2.res("slot").at(n), 1);
        const pre = s2.pre("slot").at(n);
        slotPresentation(cfg, b, pre);
        pre.float(); pre.int(7); // further presentation draws (spinning symbols, turbo, STOP)
        expect(b).toEqual(a);
      }
    }
  });

  it("dispVar only touches peek cells of reels without a 7, never on top5; deterministic in pre", () => {
    for (const cfg of [SLOT_A, SLOT_B]) {
      const st = createStreams("disp-" + cfg.id);
      let shown = 0;
      const N = 20_000;
      for (let n = 1; n <= N; n++) {
        const r = spin(cfg, st.res("slot").at(n), 1);
        const p = slotPresentation(cfg, r, st.pre("slot").at(n));
        expect(slotPresentation(cfg, r, st.pre("slot").at(n))).toEqual(p);
        if (!p.dispVar) continue;
        shown++;
        expect(r.top5).toBe(false);
        const cells = p.dispVar.cells;
        expect(cells.length === 1 || cells.length === 2).toBe(true);
        expect(new Set(cells.map((c) => c[0])).size).toBe(cells.length);
        for (const [reel, side] of cells) {
          const s = cfg.strips[reel], i = r.stops[reel];
          expect(visible7(cfg, r, reel)).toBe(false);
          expect(s[(i + 31) % 32]).not.toBe("7");
          expect(s[(i + 3) % 32]).not.toBe("7");
          expect(["a", "b"]).toContain(side);
        }
      }
      // 0.28 times the chance that at least one reel qualifies (almost always)
      expect(shown / N).toBeGreaterThan(0.26);
      expect(shown / N).toBeLessThan(0.30);
    }
  });

  it("antic counts reels slowed after two visible 7s, from the real screen only", () => {
    const pre = createRng("antic", "x");
    const cfg = fromGrid(["s7c", "7sh", "chs", "hcs", "dsh"]);
    const r: SlotResult = { stops: [0, 0, 0, 0, 0], wins: [], mult: 0, payout: 0, top5: false };
    expect(slotPresentation(cfg, r, pre).antic).toBe(3);
    const cfg2 = fromGrid(["s7c", "shc", "chs", "h7s", "dsh"]);
    expect(slotPresentation(cfg2, r, pre).antic).toBe(1);
    const cfg3 = fromGrid(["s7c", "shc", "chs", "hcs", "7sh"]);
    expect(slotPresentation(cfg3, r, pre).antic).toBeUndefined();
  });
});
