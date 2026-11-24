import { describe, expect, it } from "vitest";
import { createRng, createRoundRng, createStreams, cyrb128, randomSeed, xoshiro128ss } from "./rng";

const take = (r: { u32(): number }, n: number) => Array.from({ length: n }, () => r.u32());

describe("known-answer vectors (independent BigInt reference implementation)", () => {
  it("xoshiro128** state [1,2,3,4]", () => {
    expect(take(xoshiro128ss([1, 2, 3, 4]), 8)).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849]);
  });
  it("xoshiro128** state [deadbeef,12345678,9abcdef0,0badf00d]", () => {
    expect(take(xoshiro128ss([0xdeadbeef, 0x12345678, 0x9abcdef0, 0x0badf00d]), 8)).toEqual(
      [2576977301, 1162350735, 2932269098, 1922732073, 1941404828, 824293559, 1143964036, 208983317]);
  });
  it("cyrb128", () => {
    expect(cyrb128("")).toEqual([41608494, 3485963809, 1435736333, 1262568316]);
    expect(cyrb128("abc")).toEqual([1181011423, 830437656, 3964173471, 1611500297]);
  });
  it("at(n) = xoshiro128** over cyrb128(seed|label|n)", () => {
    expect(take(createRoundRng("seed", "res:slot").at(1), 8)).toEqual(
      [1305193255, 3021042418, 1656560432, 3292957505, 3336015490, 292983237, 2942578568, 3938552268]);
  });
  it("all-zero state becomes s[0] = 1", () => {
    expect(take(xoshiro128ss([0, 0, 0, 0]), 4)).toEqual(take(xoshiro128ss([1, 0, 0, 0]), 4));
  });
  it("does not mutate the state array", () => {
    const s: [number, number, number, number] = [1, 2, 3, 4];
    take(xoshiro128ss(s), 5);
    expect(s).toEqual([1, 2, 3, 4]);
  });
});

describe("distribution", () => {
  it("int(n) is uniform (chi-square, p ~ 0.001)", () => {
    const rng = createRng("chi", "t");
    for (const [n, crit] of [[6, 20.52], [37, 69.0], [52, 86.66]] as const) {
      const N = 200_000, c = new Array<number>(n).fill(0);
      for (let i = 0; i < N; i++) c[rng.int(n)]++;
      const e = N / n;
      const chi = c.reduce((a, o) => a + (o - e) ** 2 / e, 0);
      expect(chi).toBeLessThan(crit);
    }
  });
  it("int bounds and errors", () => {
    const rng = createRng("b", "t");
    for (let i = 0; i < 1000; i++) expect(rng.int(1)).toBe(0);
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(1.5)).toThrow();
  });
  it("float is in [0, 1)", () => {
    const rng = createRng("f", "t");
    let min = 1, max = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = rng.float();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      min = Math.min(min, x); max = Math.max(max, x);
    }
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });
  it("weighted follows weights", () => {
    const rng = createRng("w", "t");
    const c = [0, 0, 0];
    for (let i = 0; i < 100_000; i++) c[rng.weighted([1, 0, 3])]++;
    expect(c[1]).toBe(0);
    expect(c[2] / c[0]).toBeGreaterThan(2.8);
    expect(c[2] / c[0]).toBeLessThan(3.2);
  });
  it("shuffle is an in-place permutation", () => {
    const id = Array.from({ length: 52 }, (_, i) => i);
    const a = [...id];
    const r = createRng("s", "t").shuffle(a);
    expect(r).toBe(a);
    expect([...a].sort((x, y) => x - y)).toEqual(id);
    expect(a).not.toEqual(id);
  });
});

describe("streams", () => {
  it("different labels give different streams", () => {
    const s = createStreams("seed");
    expect(take(s.res("slot").at(1), 4)).not.toEqual(take(s.pre("slot").at(1), 4));
    expect(take(s.res("slot").at(1), 4)).not.toEqual(take(s.res("ocean").at(1), 4));
    expect(take(createRng("seed", "a"), 4)).not.toEqual(take(createRng("seed", "b"), 4));
    expect(take(createRng("s1", "a"), 4)).not.toEqual(take(createRng("s2", "a"), 4));
  });
  it("at(n) is independent of call order and of how many numbers other rounds used", () => {
    const a = createRoundRng("seed", "res:slot");
    const b = createRoundRng("seed", "res:slot");
    const fwd = [1, 2, 3, 4, 5].map((n) => take(a.at(n), 6));
    const rev = [5, 4, 3, 2, 1].map((n) => { take(b.at(n), n * 3); return take(b.at(n), 6); }).reverse();
    expect(rev).toEqual(fwd);
    expect(fwd[0]).not.toEqual(fwd[1]);
  });
  it("same (seed, label, n) repeats", () => {
    expect(take(createStreams("x").res("crash").at(7), 5)).toEqual(take(createStreams("x").res("crash").at(7), 5));
  });
});

describe("randomSeed", () => {
  it("is 10 alphanumerics and varies", () => {
    const s = new Set<string>();
    for (let i = 0; i < 50; i++) { const x = randomSeed(); expect(x).toMatch(/^[a-z0-9]{10}$/); s.add(x); }
    expect(s.size).toBeGreaterThan(45);
  });
});
