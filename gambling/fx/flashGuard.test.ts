import { describe, expect, it } from "vitest";
import { createRng } from "../../shared/rng";
import { createFlashGuard, isRedColor } from "./flashGuard";

/** Max number of timestamps inside any half-open window (t - w, t]. */
function maxInWindow(ts: number[], w = 1000): number {
  let best = 0, lo = 0;
  for (let hi = 0; hi < ts.length; hi++) {
    while (ts[lo] <= ts[hi] - w) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

function hammer(seed: string, reducedMotion: boolean) {
  const rng = createRng(seed, "flash-test");
  const g = createFlashGuard({ reducedMotion });
  const granted: number[] = [];
  let t = 0, asked = 0;
  while (t < 60_000) {
    // High frequency with bursts: gaps of 0..80 ms, sometimes many requests in the same millisecond.
    t += rng.int(5) === 0 ? 0 : rng.int(80);
    asked++;
    if (g.request(t, { area: rng.float(), red: false })) granted.push(t);
  }
  return { granted, asked };
}

describe("flashGuard", () => {
  it("never grants more than 3 flashes in any 1 s window over 60 s of random high-frequency requests", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const { granted, asked } = hammer(seed, false);
      expect(asked).toBeGreaterThan(1000);
      expect(maxInWindow(granted)).toBeLessThanOrEqual(3);
      // It does grant: roughly 3 per second.
      expect(granted.length).toBeGreaterThan(150);
    }
  });

  it("reduced motion: at most 1 per second", () => {
    for (const seed of ["a", "b", "c"]) {
      const { granted } = hammer(seed, true);
      expect(maxInWindow(granted)).toBeLessThanOrEqual(1);
      expect(granted.length).toBeGreaterThan(50);
    }
  });

  it("the window is (now - 1000, now]: a 4th flash exactly 1000 ms after the 1st is allowed, 999 ms is not", () => {
    const g = createFlashGuard();
    expect(g.request(0)).toBe(true);
    expect(g.request(10)).toBe(true);
    expect(g.request(20)).toBe(true);
    expect(g.request(999)).toBe(false);
    expect(g.request(1000)).toBe(true);
  });

  it("large red flashes are always refused, small red ones go through the rate limit", () => {
    const g = createFlashGuard();
    for (let t = 0; t < 20_000; t += 700) {
      expect(g.request(t, { area: 0.26, red: true })).toBe(false);
      expect(g.request(t, { area: 1, red: true })).toBe(false);
      expect(g.request(t, { red: true })).toBe(false);   // missing area counts as full screen
    }
    expect(g.request(30_000, { area: 0.2, red: true })).toBe(true);
  });

  it("a clock running backwards does not reopen the window", () => {
    const g = createFlashGuard();
    expect([g.request(5000), g.request(5001), g.request(5002)]).toEqual([true, true, true]);
    expect(g.request(100)).toBe(false);
  });

  it("classifies colors", () => {
    for (const c of ["#E0183C", "#FF2D55", "red", "crimson", "rgb(255,0,0)", "hsl(350, 90%, 50%)", "var(--red)", "var(--crimson)", "something-odd"]) {
      expect(isRedColor(c), c).toBe(true);
    }
    for (const c of ["#FFF6E0", "#F5C542", "#ffffff", "gold", "#29E6FF", "var(--gold-2)", "#7A3CFF", "#3DFF8A", "rgb(255,165,0)", "#000"]) {
      expect(isRedColor(c), c).toBe(false);
    }
  });
});
