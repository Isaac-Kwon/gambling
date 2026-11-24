import { describe, expect, it } from "vitest";
import { Acc, exactVerdict, formatRows, mcVerdict, rangeVerdict, statOf, zScore } from "./rtp-lib";

describe("rtp-lib", () => {
  it("computes mean, sd and se", () => {
    const a = new Acc();
    [1, 2, 3, 4, 5].forEach((x) => a.add(x));
    const s = a.stat();
    expect(s.mean).toBe(3);
    expect(s.sd).toBeCloseTo(Math.sqrt(2.5), 12);
    expect(s.se).toBeCloseTo(Math.sqrt(2.5 / 5), 12);
    expect(statOf(0, 0, 0).se).toBe(0);
    expect(statOf(1, 5, 25).sd).toBe(0);
  });
  it("z score and verdicts", () => {
    expect(zScore(0.5, 0.5, 0)).toBe(0);
    expect(zScore(0.6, 0.5, 0)).toBe(Infinity);
    expect(zScore(0.52, 0.5, 0.01)).toBeCloseTo(2, 12);
    expect(mcVerdict(0.75, 0.5, 0.0625)).toBe(true); // exactly 4 SE
    expect(mcVerdict(0.7501, 0.5, 0.0625)).toBe(false);
    expect(mcVerdict(0.46, 0.5, 0.01)).toBe(true);
    expect(exactVerdict(0.9904, 0.99, 0.0005)).toBe(true);
    expect(exactVerdict(0.9906, 0.99, 0.0005)).toBe(false);
    expect(rangeVerdict(0.0035, 0.0035, 0.0075)).toBe(true);
    expect(rangeVerdict(0.003, 0.0035, 0.0075)).toBe(false);
    expect(rangeVerdict(0.003, 0.0035, 0.0075, 0.001)).toBe(true);
  });
  it("formats a table", () => {
    const t = formatRows([{ check: "x", exact: 0.5, sample: 0.51, se: 0.01, z: 1, pass: false }]);
    expect(t).toContain("FAIL");
    expect(t.split("\n")).toHaveLength(3);
  });
});
