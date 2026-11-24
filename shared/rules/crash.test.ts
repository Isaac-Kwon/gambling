import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import {
  CRASH, crashFromU, crashPoint, isValidCrashBet, isValidCrashTarget, multAt,
  resolveCrashCashout, settleCrash, settleCrashRound, timeOf,
} from "./crash";

describe("crashFromU", () => {
  it("matches spec points", () => {
    expect(crashFromU(1)).toBe(1);
    expect(crashFromU(0.99)).toBe(1);
    expect(crashFromU(0.5)).toBe(1.98);
    expect(crashFromU(0.495)).toBe(2);
    expect(crashFromU(1e-12)).toBe(CRASH.cap);
  });
  it("rejects u outside (0, 1]", () => {
    expect(() => crashFromU(0)).toThrow();
    expect(() => crashFromU(1.0001)).toThrow();
    expect(() => crashFromU(NaN)).toThrow();
  });
  it("grid integration gives RTP 0.99 +- 0.0005 at each target", () => {
    const N = 1e7;
    const targets = [1.01, 1.5, 2, 10, 100];
    const hits = targets.map(() => 0);
    for (let i = 0; i < N; i++) {
      const c = crashFromU((i + 0.5) / N);
      for (let j = 0; j < targets.length; j++) if (c >= targets[j]) hits[j]++;
    }
    targets.forEach((x, j) => expect(Math.abs((x * hits[j]) / N - 0.99)).toBeLessThanOrEqual(0.0005));
  });
});

describe("crashPoint", () => {
  it("is deterministic and always >= 1 on the 0.01 grid", () => {
    const a = createRng("s", "crash"), b = createRng("s", "crash");
    for (let i = 0; i < 2000; i++) {
      const x = crashPoint(a);
      expect(x).toBe(crashPoint(b));
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(CRASH.cap);
      expect(Math.abs(x * 100 - Math.round(x * 100))).toBeLessThan(1e-6);
    }
  });
  it("maps u32 extremes to u in (0,1]", () => {
    expect(crashPoint({ u32: () => 0 } as never)).toBe(CRASH.cap);
    expect(crashPoint({ u32: () => 4294967295 } as never)).toBe(1);
  });
});

describe("growth curve", () => {
  it("multAt basics", () => {
    expect(multAt(0)).toBe(1);
    expect(multAt(-1)).toBe(1);
    expect(multAt(5.8)).toBe(2);             // spec's "2x at 5.8s" is a rounded figure
    expect(timeOf(2)).toBeCloseTo(5.776, 3);
    expect(timeOf(10)).toBeCloseTo(19.188, 3);
    expect(timeOf(100)).toBeCloseTo(38.376, 3);
  });
  it("timeOf inverts multAt on the 0.01 grid", () => {
    for (let c = 101; c <= 100000; c += 7) {
      const m = c / 100;
      expect(multAt(timeOf(m))).toBe(m);
      // just before the time, the multiplier is strictly lower
      expect(multAt(timeOf(m) - 1e-6)).toBeLessThan(m);
    }
    expect(timeOf(1)).toBe(0);
    expect(() => timeOf(0.5)).toThrow();
  });
  it("is monotone", () => {
    let prev = 0;
    for (let t = 0; t < 60; t += 0.01) { const m = multAt(t); expect(m).toBeGreaterThanOrEqual(prev); prev = m; }
  });
});

describe("settleCrash", () => {
  it("cashoutAt === crash succeeds; above fails; null fails", () => {
    expect(settleCrash(100, 2, 2)).toBe(200);
    expect(settleCrash(100, 2, 2.01)).toBe(0);
    expect(settleCrash(100, 2, 1.99)).toBe(199);
    expect(settleCrash(100, 1, 1.01)).toBe(0);
    expect(settleCrash(100, 5, null)).toBe(0);
  });
  it("payouts are exact integers for bets in multiples of 100", () => {
    for (const bet of [100, 200, 500, 1000, 2000]) {
      for (let c = 101; c <= 100000; c += 13) {
        const m = c / 100;
        const p = settleCrash(bet, m, m);
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBe((bet / 100) * c);
      }
    }
    expect(settleCrash(100, 10, 1.01)).toBe(101);
    expect(settleCrash(100, 1000, 1.15)).toBe(115);
  });
});

describe("resolveCrashCashout", () => {
  const crash = 2; // timeOf ~ 5.776s
  it("auto target reached before crash", () => {
    expect(resolveCrashCashout(crash, 1.5, null)).toBe(1.5);
    expect(resolveCrashCashout(crash, 2, null)).toBe(2); // target === crash succeeds
    expect(resolveCrashCashout(crash, 2.01, null)).toBeNull();
  });
  it("manual tap succeeds only strictly before the crash time", () => {
    expect(resolveCrashCashout(crash, null, 3)).toBe(multAt(3));
    expect(resolveCrashCashout(crash, null, timeOf(crash))).toBeNull();
    expect(resolveCrashCashout(crash, null, timeOf(crash) + 1)).toBeNull();
    expect(resolveCrashCashout(crash, null, timeOf(crash) - 1e-6)).toBe(1.99);
    expect(resolveCrashCashout(crash, null, 0)).toBe(1);
  });
  it("cashoutAt never exceeds crash", () => {
    for (let t = 0; t < timeOf(crash); t += 0.05) {
      expect(resolveCrashCashout(crash, null, t)!).toBeLessThanOrEqual(crash);
    }
  });
  it("target and tap: earlier wins; late tap cannot beat a hit target", () => {
    expect(resolveCrashCashout(crash, 1.5, 1)).toBe(multAt(1));
    expect(resolveCrashCashout(crash, 1.5, timeOf(1.5))).toBe(1.5);
    expect(resolveCrashCashout(crash, 1.5, 5)).toBe(1.5);
    expect(resolveCrashCashout(crash, 1.5, 100)).toBe(1.5);
  });
  it("target above crash still lets an early tap win", () => {
    expect(resolveCrashCashout(crash, 5, 2)).toBe(multAt(2));
    expect(resolveCrashCashout(crash, 5, 10)).toBeNull();
    expect(resolveCrashCashout(crash, null, null)).toBeNull();
  });
  it("settleCrashRound combines both", () => {
    expect(settleCrashRound(500, 2, 1.5, null)).toEqual({ cashoutAt: 1.5, payout: 750 });
    expect(settleCrashRound(500, 1, 1.5, null)).toEqual({ cashoutAt: null, payout: 0 });
  });
});

describe("validators", () => {
  it("bets and targets", () => {
    expect(isValidCrashBet(100)).toBe(true);
    expect(isValidCrashBet(2000)).toBe(true);
    expect(isValidCrashBet(150)).toBe(false);
    expect(isValidCrashBet(0)).toBe(false);
    expect(isValidCrashTarget(1.01)).toBe(true);
    expect(isValidCrashTarget(1000)).toBe(true);
    expect(isValidCrashTarget(1)).toBe(false);
    expect(isValidCrashTarget(1000.01)).toBe(false);
    expect(isValidCrashTarget(1.505)).toBe(false);
  });
});
