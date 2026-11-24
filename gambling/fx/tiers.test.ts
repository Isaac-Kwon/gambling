import { describe, expect, it } from "vitest";
import { planCelebration, TIER_STYLE } from "./tiers";
import { clampCountupMs, countupMs, countValue } from "./countup";

describe("tiers", () => {
  it("maps payout / bet multiples to tiers (>=2 NICE, >=5 BIG, >=15 MEGA, >=50 EPIC)", () => {
    const tier = (amount: number, bet = 100) => planCelebration(amount, bet)?.tier;
    expect(tier(0)).toBeUndefined();
    expect(tier(10)).toBe(0);      // payout < bet still celebrates at tier 0
    expect(tier(100)).toBe(0);
    expect(tier(199)).toBe(0);
    expect(tier(200)).toBe(1);
    expect(tier(499)).toBe(1);
    expect(tier(500)).toBe(2);
    expect(tier(1500)).toBe(3);
    expect(tier(4999)).toBe(3);
    expect(tier(5000)).toBe(4);
    expect(tier(1_000_000)).toBe(4);
  });

  it("loss is silent: payout 0 (or invalid) plans nothing", () => {
    expect(planCelebration(0, 100)).toBeNull();
    expect(planCelebration(-5, 100)).toBeNull();
    expect(planCelebration(NaN, 100)).toBeNull();
  });

  it("tier record k is 0.5 below 2x, else the tier; banners within 1.2 / 2.5 / 4 / 6 s", () => {
    expect(planCelebration(50, 100)!.k).toBe(0.5);
    expect(planCelebration(300, 100)!.k).toBe(1);
    expect([1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].bannerMs)).toEqual([1200, 2500, 4000, 6000]);
  });

  it("bundles grow with the tier: coins, confetti, rays, shake only at BIG+, flashes only at MEGA+", () => {
    expect(TIER_STYLE[0].coins).toBe(0);
    expect([1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].coins)).toEqual([20, 60, 120, 200]);
    expect([0, 1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].confetti)).toEqual([0, 0, 0, 80, 150]);
    expect([0, 1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].rays)).toEqual([false, false, true, true, true]);
    expect([0, 1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].shakePx)).toEqual([0, 0, 4, 6, 8]);
    expect([0, 1, 2, 3, 4].map((t) => TIER_STYLE[t as 1].flashAt.length)).toEqual([0, 0, 0, 2, 3]);
    // EPIC's 3 flashes are spread over ~2 s.
    expect(TIER_STYLE[4].flashAt[2]).toBeLessThanOrEqual(2000);
    for (const t of [0, 1, 2, 3, 4] as const) {
      expect(TIER_STYLE[t].shakePx).toBeLessThanOrEqual(8);
      expect(TIER_STYLE[t].shakeMs).toBeLessThanOrEqual(1000);
      const h = TIER_STYLE[t].haptic;
      expect(h.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600);
    }
  });

  it("reduced motion zeroes the shake only", () => {
    const p = planCelebration(6000, 100, { reducedMotion: true })!;
    expect(p.shakePx).toBe(0);
    expect(p.style.coins).toBe(200);
    expect(p.style.flashAt.length).toBe(3);
  });
});

describe("countup", () => {
  it("duration is clamp(600 + 450 × multiple, 600, 8000)", () => {
    expect(countupMs(0)).toBe(600);
    expect(countupMs(0.5)).toBe(825);
    expect(countupMs(2)).toBe(1500);
    expect(countupMs(10)).toBe(5100);
    expect(countupMs(16)).toBe(7800);
    expect(countupMs(50)).toBe(8000);
    expect(countupMs(1250)).toBe(8000);
    expect(countupMs(NaN)).toBe(600);
  });

  it("is monotone in the multiple and proportional below the cap", () => {
    let prev = 0;
    for (let m = 0; m <= 30; m += 0.25) {
      const ms = countupMs(m);
      expect(ms).toBeGreaterThanOrEqual(prev);
      prev = ms;
    }
    expect(countupMs(4) - countupMs(2)).toBe(countupMs(6) - countupMs(4));
  });

  it("values run from `from` to `to` without overshoot and land exactly on `to`", () => {
    const ms = 3000;
    let prev = -1;
    for (let t = 0; t <= ms + 100; t += 16) {
      const v = countValue(0, 12345, t, ms);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(12345);
      prev = v;
    }
    expect(countValue(0, 12345, ms, ms)).toBe(12345);
    expect(countValue(500, 100, 1500, 3000)).toBeLessThanOrEqual(500);
    expect(countValue(0, 77, 10, 0)).toBe(77);
  });

  it("caller durations are capped at 8 s", () => {
    expect(clampCountupMs(20_000)).toBe(8000);
    expect(clampCountupMs(0)).toBe(0);
    expect(clampCountupMs(1200)).toBe(1200);
  });
});
