import { describe, expect, it } from "vitest";
import { createRng } from "../../shared/rng";
import { createParticleSim, envelope, ENVELOPE_MIN_RAMP_MS, MAX_PARTICLES, type EmitKind } from "./particles";
import { QUALITY } from "./quality";
import { clampShake, shakeFrames, SHAKE_MAX_PX } from "./shake";
import { dimLevel, DIM_RAMP_MS } from "./anticipation";

const KINDS: EmitKind[] = ["coins", "confetti", "bubbles", "tickets", "sparks", "exhaust"];

describe("particle simulation", () => {
  it("never holds more than the cap of each quality level (600 / 250 / 100)", () => {
    for (const q of [2, 1, 0] as const) {
      const cap = QUALITY[q].cap;
      const sim = createParticleSim(cap);
      const rng = createRng("cap", "t");
      let total = 0;
      for (let i = 0; i < 40; i++) {
        total += sim.spawn(KINDS[i % KINDS.length], 90, i % 2 ? null : { x: 100, y: 300, w: 120, h: 60 }, 3000, () => rng.float());
        expect(sim.count).toBeLessThanOrEqual(cap);
        sim.step(16);
      }
      expect(total).toBeGreaterThanOrEqual(cap);
    }
    expect(createParticleSim(10_000).cap).toBe(MAX_PARTICLES);
  });

  it("spawn returns the count actually added", () => {
    const sim = createParticleSim(100);
    const rnd = () => 0.5;
    expect(sim.spawn("coins", 70, null, 2000, rnd)).toBe(70);
    expect(sim.spawn("coins", 70, null, 2000, rnd)).toBe(30);
    expect(sim.spawn("coins", 70, null, 2000, rnd)).toBe(0);
    expect(sim.spawn("coins", 5, null, 0, rnd)).toBe(0);
  });

  it("all particles are gone once their lifetime is over", () => {
    const sim = createParticleSim(600);
    const rng = createRng("life", "t");
    for (const k of KINDS) sim.spawn(k, 80, { x: 50, y: 400, w: 200, h: 100 }, 2500, () => rng.float());
    expect(sim.count).toBeGreaterThan(0);
    // Lifetime counts from birth; staggered births add at most half the lifetime.
    for (let t = 0; t < 1.5 * 2500 + 50; t += 16) sim.step(16);
    expect(sim.count).toBe(0);
  });

  it("same presentation seed → same trajectories", () => {
    const run = (seed: string) => {
      const sim = createParticleSim(600, 390, 844);
      const rng = createRng(seed, "pre:fx");
      sim.spawn("coins", 120, { x: 40, y: 300, w: 300, h: 200 }, 2300, () => rng.float());
      sim.spawn("confetti", 80, null, 3600, () => rng.float());
      const snaps: number[] = [];
      for (let i = 0; i < 60; i++) {
        sim.step(16.7);
        snaps.push(sim.count, sim.f.x[0], sim.f.y[0], sim.f.x[sim.count >> 1], sim.f.y[sim.count - 1]);
      }
      return snaps;
    };
    expect(run("s1")).toEqual(run("s1"));
    expect(run("s1")).not.toEqual(run("s2"));
  });

  it("coins rise against gravity then fall; alpha is 0 before birth and in [0, 1]", () => {
    const sim = createParticleSim(600, 390, 844);
    sim.spawn("coins", 1, null, 3000, () => 0);   // delay 0
    expect(sim.f.vy[0]).toBeLessThan(0);
    const y0 = sim.f.y[0];
    for (let i = 0; i < 10; i++) sim.step(16);
    expect(sim.f.y[0]).toBeLessThan(y0);
    for (let i = 0; i < 40; i++) sim.step(16);
    expect(sim.count).toBe(1);
    expect(sim.f.vy[0]).toBeGreaterThan(0);
    const s2 = createParticleSim();
    s2.spawn("coins", 1, null, 3000, () => 0.99);  // long delay
    expect(s2.alpha(0)).toBe(0);
    for (let i = 0; i < 200 && s2.count; i++) {
      const a = s2.alpha(0);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      s2.step(16);
    }
  });

  it("fade shortens every life, setCap trims", () => {
    const sim = createParticleSim(600);
    const rng = createRng("fade", "t");
    sim.spawn("confetti", 200, null, 5000, () => rng.float());
    for (let i = 0; i < 20; i++) sim.step(16);
    sim.fade(250);
    for (let i = 0; i < 17; i++) sim.step(16);
    expect(sim.count).toBe(0);
    sim.spawn("bubbles", 300, null, 5000, () => rng.float());
    sim.setCap(100);
    expect(sim.count).toBe(100);
    expect(sim.cap).toBe(100);
  });
});

describe("envelope (rays / glow alpha) never flashes", () => {
  it("rise and fall each take at least 200 ms", () => {
    for (const ms of [0, 50, 100, 300, 400, 650, 1200, 2500, 4000, 6000]) {
      const total = Math.max(ms, 400);
      // Below peak during the first 200 ms, and during the last 200 ms.
      for (let t = 0; t < ENVELOPE_MIN_RAMP_MS; t += 5) expect(envelope(t, ms)).toBeLessThan(1);
      for (let t = total - ENVELOPE_MIN_RAMP_MS + 1; t <= total; t += 5) expect(envelope(t, ms)).toBeLessThan(1);
      expect(envelope(0, ms)).toBe(0);
      expect(envelope(total, ms)).toBe(0);
      expect(envelope(total / 2, ms)).toBeCloseTo(1, 5);
    }
  });

  it("no 100 ms window changes alpha by more than 0.75", () => {
    for (const ms of [0, 200, 400, 900, 2500, 6000]) {
      for (let t = -100; t < Math.max(ms, 400) + 100; t += 2) {
        expect(Math.abs(envelope(t + 100, ms) - envelope(t, ms))).toBeLessThanOrEqual(0.75 + 1e-9);
      }
    }
  });

  it("dim ramps take >= 600 ms (darkening is not a flash)", () => {
    expect(dimLevel(0, 2000, 0.75)).toBe(0);
    expect(dimLevel(300, 2000, 0.75)).toBeCloseTo(0.375);
    expect(dimLevel(DIM_RAMP_MS, 2000, 0.75)).toBeCloseTo(0.75);
    expect(dimLevel(1000, 400, 0.5)).toBeCloseTo(0.5 * (200 / 600));   // short dims are stretched
    for (let t = 0; t < 2000; t += 10) expect(Math.abs(dimLevel(t + 100, 2000, 0.9) - dimLevel(t, 2000, 0.9))).toBeLessThanOrEqual(0.9 / 6 + 1e-9);
  });
});

describe("shake", () => {
  it("caps amplitude at 8 px and 1 s, zero under reduced motion", () => {
    expect(clampShake(20, 5000, false)).toEqual({ px: 8, ms: 1000 });
    expect(clampShake(4, 450, false)).toEqual({ px: 4, ms: 450 });
    expect(clampShake(8, 800, true)).toEqual({ px: 0, ms: 0 });
    expect(clampShake(0, 800, false)).toEqual({ px: 0, ms: 0 });
  });

  it("frames stay within the amplitude, start and end at rest, and are deterministic per seed", () => {
    const f = shakeFrames(8, 850, 1234);
    expect(f[0]).toEqual({ x: 0, y: 0, r: 0 });
    expect(f[f.length - 1]).toEqual({ x: 0, y: 0, r: 0 });
    for (const p of f) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(SHAKE_MAX_PX + 0.1);
    expect(shakeFrames(8, 850, 1234)).toEqual(f);
    expect(shakeFrames(8, 850, 99)).not.toEqual(f);
  });
});
