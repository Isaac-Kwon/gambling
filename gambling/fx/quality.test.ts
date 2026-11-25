import { describe, expect, it } from "vitest";
import {
  DOWN_FRAMES, particleCap, QUALITY, qualityInit, qualityStep, SETTLE_FRAMES, type QualityLevel, type QualityState,
} from "./quality";

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
    // the next level is judged on its own frames: settle, then 30 slow frames again
    expect(r.at[1] - r.at[0]).toBe(SETTLE_FRAMES + DOWN_FRAMES);
  });

  it("the EMA does not carry the old level's slowness: a step down that fixed it holds", () => {
    let s = qualityInit(2);
    s = feed(s, 1000 / 60, 10).s;
    while (s.q === 2) s = qualityStep(s, 40);   // 2 → 1 at a very slow level 2
    expect(s.q).toBe(1);
    const r = feed(s, 1000 / 60, 60);           // level 1 is smooth at once
    expect(r.changes).toEqual([]);
  });

  it("one long frame (a celebration's first frame, a GC) does not step down; a hitch every eight frames does", () => {
    const one = (n: number, every: number) => {
      let s = qualityInit(2);
      const changes: QualityLevel[] = [];
      for (let i = 1; i <= n; i++) {
        const next = qualityStep(s, i % every === 0 ? 200 : 1000 / 60);
        if (next.changed !== undefined) changes.push(next.changed);
        s = next;
      }
      return changes;
    };
    expect(one(600, 40)).toEqual([]);           // 200 ms hitch every 40 frames: average 21.2 ms
    expect(one(600, 8)[0]).toBe(1);             // every 8 frames: average 40 ms, really slow
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

  it("on a 60 Hz display (frames never below 16.7 ms) a smooth layer still climbs back up", () => {
    const r = feed(qualityInit(0), 1000 / 60, 1500);   // 25 s
    expect(r.changes).toEqual([1, 2]);
    expect((r.at[0] * 1000) / 60).toBeGreaterThanOrEqual(10_000);
  });

  it("a 60 Hz layer that is only just keeping up (20 ms average) does not climb", () => {
    let s = qualityInit(1);
    s = feed(s, 1000 / 60, 10).s;           // learns the refresh interval
    const r = feed(s, 20, 3000);            // 60 s
    expect(r.changes).toEqual([]);
  });

  it("the first walk down is not penalised: back up after the plain 10 s", () => {
    let s = qualityInit(2);
    s = feed(s, 1000 / 60, 10).s;
    while (s.q === 2) s = qualityStep(s, 30);   // 2 → 1
    expect(s.q).toBe(1);
    const r = feed(s, 1000 / 60, Math.ceil(10_500 / (1000 / 60)));
    expect(r.changes).toEqual([2]);
  });

  it("each bounce (a step down undoing a step up) doubles the time needed for the next step up", () => {
    let s = qualityInit(2);
    s = feed(s, 1000 / 60, 10).s;
    while (s.q === 2) s = qualityStep(s, 30);   // 2 → 1 (not a bounce)
    while (s.q === 1) s = qualityStep(s, 1000 / 60);   // 1 → 2 after 10 s
    while (s.q === 2) s = qualityStep(s, 30);   // 2 → 1: bounce
    expect(s.q).toBe(1);
    let r = feed(s, 1000 / 60, Math.ceil(15_000 / (1000 / 60)));
    expect(r.changes).toEqual([]);           // 15 s is not enough after a bounce
    r = feed(r.s, 1000 / 60, Math.ceil(6_000 / (1000 / 60)));
    expect(r.changes).toEqual([2]);          // ~20 s
  });

  it("an 'ok' stretch (between fast and slow) pauses the climb instead of restarting it", () => {
    let s = qualityInit(1);
    s = feed(s, 1000 / 60, 300).s;           // 5 s fast
    s = feed(s, 20.5, 60).s;                 // ema settles in the 19.2..22 band: neither fast nor slow
    const r = feed(s, 1000 / 60, 330);       // ~5.5 s fast again → 10 s in total
    expect(r.changes).toEqual([2]);
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
