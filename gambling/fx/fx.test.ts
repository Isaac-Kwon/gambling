import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../../shared/rng";
import { createFx, clipPattern, type FxClock } from "./index";
import { createNullFx } from "./null";
import { nullBackend, type FxBackend } from "./backend";
import type { FxRecord, Haptics, Sfx } from "./types";

/** Virtual clock: `wait` resolves when `advance` passes its time (timers run in time order). */
function manualClock() {
  let t = 0;
  const timers: { at: number; seq: number; r: () => void }[] = [];
  let seq = 0;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  const clock: FxClock & { advance(ms: number): Promise<void> } = {
    now: () => t,
    wait(ms) {
      return new Promise<void>((r) => timers.push({ at: t + Math.max(0, ms), seq: seq++, r }));
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const nx = timers[0];
        if (!nx || nx.at > end) break;
        timers.shift();
        t = nx.at;
        nx.r();
      }
      t = end;
      await flush();
    },
  };
  return clock;
}

/** Harness-style clock: `wait` moves virtual time forward immediately. */
function instantClock(): FxClock {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += Math.max(0, ms); } };
}

const el = () => ({ textContent: "" }) as unknown as HTMLElement;

/** Counts presentation-stream draws. */
function countingRng(seed: string): Rng & { draws: number } {
  const r = createRng(seed, "pre:fx");
  const c = {
    draws: 0,
    u32: () => { c.draws++; return r.u32(); },
    float: () => { c.draws++; return r.float(); },
    int: (n: number) => { c.draws++; return r.int(n); },
    weighted: (w: readonly number[]) => { c.draws++; return r.weighted(w); },
    shuffle: <T,>(a: T[]) => { c.draws++; return r.shuffle(a); },
  };
  return c;
}

function recSfx(): Sfx & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    unlock: async () => {},
    play: (n) => { calls.push("play:" + n); },
    loop: (n, on, o) => { calls.push(`loop:${n}:${on}${o?.pitch !== undefined ? ":" + o.pitch : ""}`); },
    setMuted: () => {},
  };
}

const types = (r: FxRecord[]) => r.map((x) => x.type);
const byType = (r: FxRecord[], t: string) => r.filter((x) => x.type === t);

describe("createFx recording", () => {
  it("loss (payout 0) does nothing: no records, no sound, no randomness", async () => {
    const clock = manualClock(), pre = countingRng("s"), sfx = recSfx();
    const fx = createFx({ backend: nullBackend, clock, pre, sfx });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const target = el();
    const run = fx.celebrate({ amount: 0, bet: 100, target });
    await run.done;
    expect(recs).toEqual([]);
    expect(sfx.calls).toEqual([]);
    expect(pre.draws).toBe(0);
    expect(target.textContent).toBe("");
  });

  it("a win smaller than the bet still celebrates at tier 0 (k 0.5): win line, jingle, count-up, no particles", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), sfx: recSfx() });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const target = el();
    const run = fx.celebrate({ amount: 10, bet: 20, target });
    await clock.advance(10_000);
    await run.done;
    expect(byType(recs, "tier")).toEqual([{ type: "tier", ms: 825, k: 0.5 }]);
    expect(byType(recs, "countup")).toEqual([{ type: "countup", ms: 825, k: 0.5 }]);
    expect(types(recs)).toContain("sfx:win0");
    expect(recs.some((r) => r.type.startsWith("particles:"))).toBe(false);
    expect(recs.some((r) => r.type === "shake" || r.type === "flash")).toBe(false);
    expect(target.textContent).toBe("10");
  });

  it("EPIC: banner, count-up 8 s, coins 200 + confetti 150 + rays, shake 8 px, 3 flashes, haptics", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), sfx: recSfx(), haptics: { pulse() {} } });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const target = el();
    const run = fx.celebrate({ amount: 123_400, bet: 1000, target });
    await clock.advance(20_000);
    await run.done;
    expect(byType(recs, "tier")).toEqual([{ type: "tier", ms: 6000, k: 4 }]);
    expect(byType(recs, "countup")).toEqual([{ type: "countup", ms: 8000, k: 123.4 }]);
    expect(byType(recs, "particles:coins")[0].k).toBe(200);
    expect(byType(recs, "particles:confetti")[0].k).toBe(150);
    expect(byType(recs, "particles:rays")[0].k).toBe(12);
    expect(byType(recs, "shake")).toEqual([{ type: "shake", ms: 850, k: 8 }]);
    expect(byType(recs, "flash").length).toBe(3);
    expect(byType(recs, "haptic")[0].k).toBeLessThanOrEqual(600);
    expect(byType(recs, "sfx:win4").length).toBe(1);
    expect(target.textContent).toBe("123,400");
  });

  it("tap-to-skip: count-up jumps to the final value and records hold the actual ms", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx") });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const target = el();
    const run = fx.celebrate({ amount: 2000, bet: 100, target });   // 20x MEGA, count-up 8000 ms
    expect(byType(recs, "countup")[0].ms).toBe(8000);               // planned at start
    await clock.advance(1000);
    run.skip();
    run.skip();                                                     // idempotent
    await run.done;
    expect(target.textContent).toBe("2,000");
    expect(byType(recs, "countup")[0].ms).toBe(1000);
    expect(byType(recs, "tier")[0].ms).toBe(1000);
    expect(byType(recs, "particles:coins")[0].ms).toBe(1000);
    expect(byType(recs, "shake")[0].ms).toBe(650);                  // shake had already finished
    expect(byType(recs, "flash").length).toBe(2);                   // at 0 and 650
    // Nothing more happens after the skip.
    const n = recs.length;
    await clock.advance(10_000);
    expect(recs.length).toBe(n);
    await fx.idle();
  });

  it("emit returning 0 (no layer) → no particles record; partial emits record the real count", async () => {
    const none: FxBackend = { ...nullBackend, emit: () => 0, cap: () => 0 };
    const half: FxBackend = { ...nullBackend, emit: (_k, n) => Math.floor(n / 2) };
    for (const [backend, coins] of [[none, undefined], [half, 30]] as const) {
      const clock = manualClock();
      const fx = createFx({ backend, clock, pre: createRng("s", "pre:fx") });
      const recs: FxRecord[] = [];
      fx.collect(recs);
      const target = el();
      fx.celebrate({ amount: 600, bet: 100, target });   // BIG: 60 coins + rays
      const solo = fx.particles("coins", { k: 40 });
      await clock.advance(10_000);
      await solo.done;
      expect(byType(recs, "particles:coins")[0]?.k).toBe(coins);
      if (coins === undefined) {
        expect(recs.some((r) => r.type.startsWith("particles:"))).toBe(false);
        expect(byType(recs, "tier").length).toBe(1);     // banner, count-up, sound still happen
        expect(target.textContent).toBe("600");
      } else {
        expect(byType(recs, "particles:coins").map((r) => r.k)).toEqual([30, 20]);
      }
    }
  });

  it("the concurrent particle cap of the quality level limits a request", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), quality: () => 0 });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    fx.particles("confetti", { k: 999 });
    fx.particles("rays", { k: 12 });          // no rays at quality 0
    await clock.advance(10_000);
    expect(recs).toEqual([{ type: "particles:confetti", ms: 3600, k: 100 }]);
  });

  it("dropped particles (context lost) keep only the visible time and end standalone runs", async () => {
    let drop: () => void = () => {};
    const backend: FxBackend = { ...nullBackend, onDrop: (cb) => { drop = cb; return () => {}; } };
    const clock = manualClock();
    const fx = createFx({ backend, clock, pre: createRng("s", "pre:fx") });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const run = fx.particles("coins", { k: 50, ms: 3000 });
    await clock.advance(700);
    drop();
    await run.done;
    expect(recs).toEqual([{ type: "particles:coins", ms: 700, k: 50 }]);
  });

  it("flash: refused flashes leave no record; large red is always refused", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx") });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const e = el();
    fx.flash({ el: e, color: "#E0183C", ms: 120, area: 1 });
    fx.flash({ el: e, color: "red", ms: 120, area: 0.5 });
    expect(recs).toEqual([]);
    for (let i = 0; i < 6; i++) fx.flash({ el: e, color: "#FFF6E0", ms: 120, area: 1 });
    expect(byType(recs, "flash").length).toBe(3);
    await clock.advance(1000);
    fx.flash({ el: e, color: "#E0183C", ms: 120, area: 0.1 });   // small red is fine
    expect(byType(recs, "flash").length).toBe(4);
  });

  it("reduced motion: no shake at all, flashes at most 1 per second, everything else unchanged", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), reducedMotion: true });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    fx.celebrate({ amount: 60_000, bet: 1000, target: el() });
    fx.shake({ el: el(), k: 8, ms: 500 });
    await clock.advance(20_000);
    expect(byType(recs, "shake")).toEqual([]);
    expect(byType(recs, "flash").length).toBe(2);         // 0 and 1900 ms; 950 ms refused
    expect(byType(recs, "particles:coins")[0].k).toBe(200);
    expect(byType(recs, "tier")[0].k).toBe(4);
  });

  it("standalone count-up: capped at 8 s, k from the caller, final value set", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx") });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const e = el();
    const run = fx.countup({ el: e, from: 100, to: 25_000, ms: 30_000, k: 3 });
    await clock.advance(9000);
    await run.done;
    expect(recs).toEqual([{ type: "countup", ms: 8000, k: 3 }]);
    expect(e.textContent).toBe("25,000");
  });

  it("antic rise: one record per climb (k = max multiplier), rise loop pitch = multiplier, skip stops the loop", async () => {
    const clock = manualClock(), sfx = recSfx();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), sfx });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const rocket = el();
    const r1 = fx.antic({ el: rocket, kind: "rise", k: 1.2, ms: 1000 });
    await clock.advance(800);
    const r2 = fx.antic({ el: rocket, kind: "rise", k: 2.5, ms: 1000 });
    expect(r2).toBe(r1);
    await clock.advance(500);
    r1.skip();
    await r1.done;
    expect(byType(recs, "antic:rise")).toEqual([{ type: "antic:rise", ms: 1300, k: 2.5 }]);
    expect(sfx.calls).toEqual(["loop:rise:true:1.2", "loop:rise:true:2.5", "loop:rise:false"]);
    fx.antic({ el: el(), kind: "reel", k: 2, ms: 2400 });
    await clock.advance(3000);
    expect(byType(recs, "antic:reel")).toEqual([{ type: "antic:reel", ms: 2400, k: 2 }]);
    expect(sfx.calls.slice(-2)).toEqual(["loop:heartbeat:true", "loop:heartbeat:false"]);
  });

  it("records land in the array that was collecting when the effect started", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx") });
    const a: FxRecord[] = [], b: FxRecord[] = [];
    fx.collect(a);
    const run = fx.celebrate({ amount: 1500, bet: 100, target: el() });
    fx.collect(b);                     // next round begins while the celebration runs
    await clock.advance(10_000);
    await run.done;
    expect(byType(a, "particles:confetti").length).toBe(1);   // emitted at 250 ms, still round a's
    expect(b).toEqual([]);
    fx.collect(null);
    fx.particles("coins", { k: 5 });
    await clock.advance(5000);
    expect(b).toEqual([]);
  });

  it("sfx and haptics wrappers record (tap/tick excluded, muted excluded, unsupported haptics excluded)", () => {
    const clock = manualClock();
    const haptics: Haptics & { supported: boolean } = { supported: true, pulse() {} };
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx"), sfx: recSfx(), haptics });
    const recs: FxRecord[] = [];
    fx.collect(recs);
    fx.sfx.play("tap");
    fx.sfx.play("tick");
    fx.sfx.play("stop", { k: 0.4 });
    fx.haptics.pulse([400, 100, 400]);
    haptics.supported = false;
    fx.haptics.pulse(50);
    fx.sfx.setMuted(true);
    fx.sfx.play("coin");
    expect(recs).toEqual([
      { type: "sfx:stop", ms: 180, k: 0.4 },
      { type: "haptic", ms: 600, k: 500 },
    ]);
    expect(clipPattern([700])).toEqual({ pattern: [600], vib: 600, total: 600 });
  });

  it("idle() resolves when every running effect is over", async () => {
    const clock = manualClock();
    const fx = createFx({ backend: nullBackend, clock, pre: createRng("s", "pre:fx") });
    await fx.idle();
    fx.celebrate({ amount: 700, bet: 100, target: el() });
    fx.shake({ el: el(), k: 3, ms: 300 });
    let idle = false;
    void fx.idle().then(() => { idle = true; });
    await clock.advance(1000);
    expect(idle).toBe(false);
    await clock.advance(10_000);
    expect(idle).toBe(true);
  });
});

describe("determinism and the null fx", () => {
  const script = async (fx: ReturnType<typeof createFx>, advance: (ms: number) => Promise<void>) => {
    const recs: FxRecord[][] = [];
    const amounts = [0, 15, 40, 120, 600, 2000, 0, 7000, 33, 0, 260];
    for (const amount of amounts) {
      const r: FxRecord[] = [];
      recs.push(r);
      fx.collect(r);
      fx.celebrate({ amount, bet: 100, target: el() });
      fx.particles("bubbles", { k: 30 });
      fx.shake({ el: el(), k: 5, ms: 400 });
      await advance(10_000);
      await fx.idle();
    }
    return recs;
  };

  it("createFx + nullBackend consumes presentation randomness deterministically", async () => {
    const run = async () => {
      const pre = countingRng("seed-1");
      const clock = manualClock();
      const recs = await script(createFx({ backend: nullBackend, clock, pre }), (ms) => clock.advance(ms));
      return { recs, draws: pre.draws, next: pre.u32() };
    };
    const a = await run(), b = await run();
    expect(a.recs).toEqual(b.recs);
    expect(a.draws).toBe(b.draws);
    expect(a.draws).toBeGreaterThan(0);
    expect(a.next).toBe(b.next);
    expect(a.recs.flat().length).toBeGreaterThan(20);
    // Losses record nothing.
    expect(a.recs[0].filter((r) => r.type === "tier")).toEqual([]);
  });

  it("with a harness-style clock (wait advances time at once) natural ends record the planned ms", async () => {
    const pre = createRng("seed-1", "pre:fx");
    const fx = createFx({ backend: nullBackend, clock: instantClock(), pre });
    const r: FxRecord[] = [];
    fx.collect(r);
    await fx.celebrate({ amount: 2000, bet: 100, target: el() }).done;
    await fx.idle();
    expect(byType(r, "countup")[0].ms).toBe(8000);
    expect(byType(r, "tier")[0].ms).toBe(4000);
    expect(byType(r, "shake")[0].ms).toBe(650);
  });

  it("createNullFx: disabled, records nothing, no randomness parameter at all, count-up writes the final value", async () => {
    const fx = createNullFx();
    expect(fx.enabled).toBe(false);
    const recs: FxRecord[] = [];
    fx.collect(recs);
    const e = el();
    await fx.celebrate({ amount: 5000, bet: 100, target: e }).done;
    expect(e.textContent).toBe("");
    await fx.countup({ el: e, from: 0, to: 12_345, ms: 3000, tick: true }).done;
    expect(e.textContent).toBe("12,345");
    await fx.particles("coins", { k: 100 }).done;
    await fx.shake({ el: e, k: 8, ms: 500 }).done;
    await fx.antic({ el: e, kind: "reel", k: 2, ms: 2400 }).done;
    await fx.flash({ el: e, color: "#fff", ms: 100, area: 1 }).done;
    fx.sfx.play("win4");
    fx.sfx.loop("spin", true);
    fx.haptics.pulse(100);
    fx.suspend();
    fx.resume();
    await fx.idle();
    expect(recs).toEqual([]);
    expect(createNullFx.length).toBeLessThanOrEqual(1);
  });
});
