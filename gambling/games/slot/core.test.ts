import { describe, expect, it } from "vitest";
import { createRng } from "../../../shared/rng";
import { gridOf, SLOT_A, SLOT_B, spin } from "../../../shared/rules/slot";
import type { Ev } from "../../../shared/schema";
import { createNullFx } from "../../fx/null";
import type { Fx, FxRun } from "../../fx/types";
import { createHeadlessCtx } from "../../harness/ctx";
import {
  affordableIndex, anticSchedule, createSlotCore, headlessUi, hurrySchedule, makeTape, QUICK_MS, REELS,
  STOP_MS, stopSchedule, STORE_BET, TAPE_LEN, TURBO_MS, windowCells, type SlotUi,
} from "./core";

describe("schedules", () => {
  it("normal, turbo and quick rest times", () => {
    expect(stopSchedule({ turbo: false, quick: false })).toEqual([1000, 1300, 1600, 1900, 2200]);
    const t = stopSchedule({ turbo: true, quick: false });
    expect(Math.max(...t)).toBeLessThanOrEqual(900);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(stopSchedule({ turbo: true, quick: true })).toEqual([QUICK_MS, QUICK_MS, QUICK_MS, QUICK_MS, QUICK_MS]);
    expect(TURBO_MS).toHaveLength(REELS);
  });

  it("build-up: every reel after the trigger rests 1.2 s later than planned, one by one", () => {
    const at = STOP_MS.map((m) => 100 + m);
    const out = anticSchedule(at, STOP_MS, 1, 1400);
    expect(out.slice(0, 2)).toEqual([1100, 1400]);
    expect(out[2]).toBe(1400 + 300 + 1200);
    expect(out[4]).toBe(1400 + 3 * 1500);
  });

  it("STOP: remaining reels at 80 ms intervals from now, never later than planned, not before the minimum", () => {
    const at = STOP_MS.map((m) => m);
    expect(hurrySchedule(at, 1, 500, 0)).toEqual([1000, 500, 580, 660, 740]);
    expect(hurrySchedule(at, 0, 20, 0)).toEqual([180, 260, 340, 420, 500]);
    expect(hurrySchedule([0, 0, 0, 2000, 2100], 3, 2050, 0)).toEqual([0, 0, 0, 2000, 2100]);
  });
});

describe("window and display band", () => {
  it("rows 0..2 are the real grid; display variation only puts 7 into peeks", () => {
    const rng = createRng("w", "t");
    for (let k = 0; k < 200; k++) {
      const r = spin(SLOT_A, rng, 1);
      const grid = gridOf(SLOT_A, r.stops);
      const w = windowCells(SLOT_A, r.stops, { cells: [[0, "a"], [3, "b"]] });
      for (let reel = 0; reel < REELS; reel++) expect(w[reel].slice(1, 4)).toEqual(grid[reel]);
      expect(w[0][0]).toBe("7");
      expect(w[3][4]).toBe("7");
      const plain = windowCells(SLOT_A, r.stops);
      const s = SLOT_A.strips[1], i = r.stops[1];
      expect(plain[1][0]).toBe(s[(i + 31) % 32]);
      expect(plain[1][4]).toBe(s[(i + 3) % 32]);
    }
  });

  it("display band: TAPE_LEN symbols per reel, 7-rich, wilds only on reels 2..4", () => {
    const tape = makeTape(SLOT_B, createRng("t", "pre"));
    expect(tape).toHaveLength(REELS);
    for (const [r, t] of tape.entries()) {
      expect(t).toHaveLength(TAPE_LEN);
      if (r === 0 || r === 4) expect(t).not.toContain("W");
    }
    const all = makeTape(SLOT_A, createRng("t2", "pre")).flat().concat(...Array.from({ length: 40 }, (_, k) => makeTape(SLOT_A, createRng("t" + k, "pre")).flat()));
    const sevens = all.filter((x) => x === "7").length / all.length;
    expect(sevens).toBeGreaterThan(0.12);
  });

  it("affordable bet step", () => {
    expect(affordableIndex(1000, 5)).toBe(5);
    expect(affordableIndex(999, 5)).toBe(4);
    expect(affordableIndex(150, 3)).toBe(2);
    expect(affordableIndex(19, 5)).toBe(-1);
  });
});

function recUi(): SlotUi & { log: string[] } {
  const base = headlessUi();
  const log: string[] = [];
  return {
    ...base, log,
    spinStart: (p) => log.push(`start:${p.n}`),
    retime: (_a, snap) => log.push(`retime:${snap}`),
    reelStop: (i) => log.push(`stop:${i}`),
    antic: (i) => log.push(`antic:${i}`),
    result: (p) => log.push(`result:${p.n}`),
    short: (k) => log.push(`short:${k}`),
  };
}

describe("core", () => {
  it("press: spins when idle, STOP while turning (logged, outcome unchanged), cancels auto", async () => {
    const a = createHeadlessCtx({ seed: "press", fx: "on" });
    const b = createHeadlessCtx({ seed: "press", fx: "on" });
    const ca = createSlotCore(a.ctx, headlessUi());
    const cb = createSlotCore(b.ctx, headlessUi());
    const pa = ca.spin();
    expect(ca.state.phase).toBe("spin");
    ca.press();   // STOP
    const ea = await pa;
    const eb = await cb.spin();
    expect(ea!.ctl).toEqual({ gesture: "tap", stopPressed: true });
    expect(eb!.ctl).toEqual({ gesture: "tap" });
    expect(ea!.out).toEqual(eb!.out);
    expect(ea!.payout).toBe(eb!.payout);
    const auto = ca.startAuto(10);
    expect(ca.state.auto).toBe(9);
    ca.press();   // cancels auto, the running spin finishes
    await auto;
    expect(ca.state.auto).toBe(0);
    expect(a.rt.logger.session.events).toHaveLength(2);
  });

  it("reels rest in order; with fx off there is no build-up and no presentation record", async () => {
    const h = createHeadlessCtx({ seed: "order", fx: "off" });
    const ui = recUi();
    const core = createSlotCore(h.ctx, ui);
    const ev = await core.spin({ gesture: "swipe" });
    expect(ui.log).toEqual(["start:1", "stop:0", "stop:1", "stop:2", "stop:3", "stop:4", "result:1"]);
    expect(ev!.ctl).toEqual({ gesture: "swipe" });
    expect(ev!.disp).toEqual({ tier: 0 });
  });

  it("build-up runs when two 7s show before the last reels (fx on)", async () => {
    // find a seed whose first round has a build-up
    for (let k = 0; k < 400; k++) {
      const h = createHeadlessCtx({ seed: "ant" + k, fx: "on" });
      const ui = recUi();
      const core = createSlotCore(h.ctx, ui);
      const ev = (await core.spin())!;
      const d = ev.disp as { antic?: number };
      if (!d.antic) continue;
      expect(ui.log).toContain(`antic:${REELS - d.antic}`);
      expect(ev.fx!.some((r) => r.type === "antic:reel" && r.k === d.antic)).toBe(true);
      expect(ev.fx!.some((r) => r.type === "sfx:heartbeat")).toBe(true);
      return;
    }
    throw new Error("no build-up found");
  });

  it("an unaffordable bet steps down without a round; below the minimum bet the sheet is asked for", async () => {
    const h = createHeadlessCtx({ seed: "short", fx: "on", startCredits: 150 });
    const ui = recUi();
    h.rt.store.set(STORE_BET, 5);
    const core = createSlotCore(h.ctx, ui);
    expect(core.state.bet).toBe(1000);
    expect(await core.spin()).toBeNull();
    expect(core.state.bet).toBe(100);
    expect(ui.log).toEqual(["short:lowered"]);
    expect(h.rt.logger.session.events).toHaveLength(0);

    const h2 = createHeadlessCtx({ seed: "short", fx: "on", startCredits: 15 });
    const ui2 = recUi();
    const c2 = createSlotCore(h2.ctx, ui2);
    expect(await c2.spin()).toBeNull();
    expect(ui2.log).toEqual(["short:sheet"]);
  });

  it("dispose during a spin settles the round with its fixed outcome; the session is free again", async () => {
    const ref = createHeadlessCtx({ seed: "disp", fx: "on" });
    const refEv = (await createSlotCore(ref.ctx, headlessUi()).spin())!;

    const h = createHeadlessCtx({ seed: "disp", fx: "on" });
    // a clock whose waits never resolve keeps the spin in flight
    const ctx = { ...h.ctx, clock: { ...h.ctx.clock, wait: () => new Promise<void>(() => undefined) } };
    const core = createSlotCore(ctx, headlessUi());
    void core.spin();
    expect(core.canLeave()).toBe(false);
    core.dispose();
    const evs = h.rt.logger.session.events;
    expect(evs).toHaveLength(1);
    expect(evs[0].out).toEqual(refEv.out);
    expect(evs[0].payout).toBe(refEv.payout);
    expect(h.rt.wallet.balance).toBe(refEv.balance);
    expect(h.ctx.rounds.active).toBeNull();
  });

  it("a tap during a NICE+ celebration skips it instead of spinning; the next tap spins", async () => {
    const runs: { skip: () => void }[] = [];
    const base = createNullFx();
    const fake: Fx = {
      ...base, enabled: true,
      celebrate: (o) => {
        if (!(o.amount > 0)) return { done: Promise.resolve(), skip() {} };
        let end!: () => void;
        const done = new Promise<void>((r) => { end = r; });
        const run: FxRun = { done, skip: () => end() };
        runs.push(run);
        return run;
      },
    };
    for (let k = 0; k < 300; k++) {
      const h = createHeadlessCtx({ seed: "cel" + k, fx: "on", fxImpl: fake });
      const core = createSlotCore(h.ctx, headlessUi());
      let settled: Ev | null = null;
      core.onSettle((e) => { settled = e; });
      const p = core.spin();
      await new Promise((r) => setTimeout(r, 0));
      const ev = settled as Ev | null;
      if (!ev || (ev.disp as { tier: number }).tier < 1) { runs.at(-1)?.skip(); await p; continue; }
      expect(await core.spin()).toBeNull();          // skipped, no round
      await p;
      expect(h.rt.logger.session.events).toHaveLength(1);
      const next = core.spin();
      expect(core.state.phase).toBe("spin");
      runs.at(-1)?.skip();
      await next;
      expect(h.rt.logger.session.events).toHaveLength(2);
      return;
    }
    throw new Error("no NICE+ round found");
  });
});
