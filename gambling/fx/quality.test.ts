import { describe, expect, it } from "vitest";
import { particleCap, QUALITY, qualityInit, qualityStep, type QualityLevel, type QualityState } from "./quality";

function feed(s: QualityState, ms: number, n: number): { s: QualityState; changes: QualityLevel[]; at: number[] } {
  const changes: QualityLevel[] = [], at: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = qualityStep(s, ms);
    if (next.changed !== undefined) { changes.push(next.changed); at.push(i + 1); }
    s = next;
  }
  return { s, changes, at };
}

describe("quality state machine", () => {
  it("table: scale 2 / 1.5 / 1, caps 600 / 250 / 100 / 0, rays off at 0", () => {
    expect([QUALITY[2].scale, QUALITY[1].scale, QUALITY[0].scale]).toEqual([2, 1.5, 1]);
    expect([particleCap(2), particleCap(1), particleCap(0), particleCap("off")]).toEqual([600, 250, 100, 0]);
    expect([QUALITY[2].rays, QUALITY[1].rays, QUALITY[0].rays]).toEqual([true, true, false]);
    expect(QUALITY[1].glow).toBe(QUALITY[2].glow / 2);
  });

  it("steady 60 fps never changes anything", () => {
    const r = feed(qualityInit(2), 16.7, 10_000);
    expect(r.changes).toEqual([]);
    expect(r.s.q).toBe(2);
  });

  it("drops one level after the EMA stays above 22 ms for 30 frames", () => {
    const r = feed(qualityInit(2), 30, 200);
    expect(r.changes.slice(0, 2)).toEqual([1, 0]);
    // EMA crosses 22 ms after a few frames, then needs 30 consecutive slow frames.
    expect(r.at[0]).toBeGreaterThanOrEqual(30);
    expect(r.at[0]).toBeLessThan(45);
    expect(r.at[1] - r.at[0]).toBe(30);
  });

  it("a fast frame resets the slow count", () => {
    let s = qualityInit(2);
    for (let k = 0; k < 20; k++) {
      s = feed(s, 30, 25).s;     // not yet 30 slow frames
      s = feed(s, 8, 40).s;      // ema back below 22
    }
    expect(s.q).toBe(2);
  });

  it("goes up one level after 10 s below 14 ms", () => {
    const r = feed(qualityInit(0), 10, 2500);   // 25 s of 100 fps
    expect(r.changes).toEqual([1, 2]);
    const frames = r.at[1] - r.at[0];
    expect(frames * 10).toBeGreaterThanOrEqual(10_000);
    expect(r.s.q).toBe(2);
  });

  it("at level 0, EMA above 40 ms for 5 s turns the layer off; nothing after that", () => {
    const r = feed(qualityInit(0), 50, 200);
    expect(r.changes).toEqual(["off"]);
    expect(r.at[0] * 50).toBeGreaterThanOrEqual(5000);
    expect(r.at[0] * 50).toBeLessThan(6000);   // + the frames the EMA needs to climb past 40 ms
    expect(feed(r.s, 5, 5000).changes).toEqual([]);
  });

  it("a slow device walks all the way down to off", () => {
    const r = feed(qualityInit(2), 60, 400);
    expect(r.changes).toEqual([1, 0, "off"]);
  });

  it("pauses (frames > 250 ms) are ignored", () => {
    const r = feed(qualityInit(2), 1000, 100);
    expect(r.changes).toEqual([]);
    expect(r.s.ema).toBeCloseTo(1000 / 60);
  });
});
