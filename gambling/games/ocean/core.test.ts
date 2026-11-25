import { describe, expect, it } from "vitest";
import { createStreams } from "../../../shared/rng";
import { OCEAN, oceanInit, oceanSpin, type OceanResult } from "../../../shared/rules/ocean";
import type { Ev } from "../../../shared/schema";
import { createNullFx } from "../../fx/null";
import type { Fx, Sfx } from "../../fx/types";
import { createHeadlessCtx } from "../../harness/ctx";
import { stopSchedule } from "../slot/core";
import { SYMBOLS, symbolCss, symbolSvg } from "./art";
import {
  affordableIndex, createOceanCore, decOf, headlessUi, lampOf, OMEN_GRADE, OMEN_MS, OMEN_TAIL_MS, oceanSchedule,
  stateFor, STEPS, STORE_BET, type OceanUi,
} from "./core";

const result = (o: Partial<OceanResult>): OceanResult =>
  ({ stops: [0, 0, 0, 0, 0], wins: [], mult: 0, payout: 0, top5: false, basePay: 0, seqPay: 0, ...o }) as OceanResult;

describe("pure parts", () => {
  it("schedule: the reels land after the creature has gone; no creature = the slot's schedule", () => {
    expect(oceanSchedule({ turbo: false, quick: false, omenMs: 0 })).toEqual(stopSchedule({ turbo: false, quick: false }));
    for (const k of ["clam", "shark", "whale"] as const) {
      for (const turbo of [false, true]) {
        const s = oceanSchedule({ turbo, quick: false, omenMs: OMEN_MS[k] });
        expect(s[0]).toBe(OMEN_MS[k] + OMEN_TAIL_MS);
        const base = stopSchedule({ turbo, quick: false });
        for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBe(base[i] - base[i - 1]);
      }
    }
    expect(OMEN_GRADE).toEqual({ clam: 1, shark: 2, whale: 3 });
  });

  it("dec: trigger, release, both in one round", () => {
    const seq = { id: 4, round: 9, bet: 40, mult: 10, total: 400, omen: "clam" as const, delay: 2, chunks: [100, 300], next: 0, wait: 2 };
    expect(decOf(result({}))).toBeUndefined();
    expect(decOf(result({ triggered: seq }))).toEqual({ bonusSeqId: 4, queued: 400 });
    expect(decOf(result({ released: { seqId: 2, amount: 50, remaining: 70 } }))).toEqual({ bonusSeqId: 2, releasedFromSeq: true, queued: 70 });
    expect(decOf(result({ released: { seqId: 2, amount: 50, remaining: 0 }, triggered: seq })))
      .toEqual({ bonusSeqId: 2, releasedFromSeq: true, queued: 0, trig: { bonusSeqId: 4, queued: 400 } });
  });

  it("stored state is re-labelled to the session's round; lamp only once the head's omen came", () => {
    expect(stateFor(undefined, 1)).toEqual(oceanInit());
    const st = { round: 3, nextId: 2, queue: [] };
    expect(stateFor(st, 4)).toBe(st);
    expect(stateFor(st, 7).round).toBe(6);
    const seq = { id: 1, round: 1, bet: 20, mult: 5, total: 100, omen: "clam" as const, delay: 1, chunks: [30, 70], next: 0, wait: 1 };
    expect(lampOf({ round: 1, nextId: 2, queue: [seq] })).toBe(false);
    expect(lampOf({ round: 2, nextId: 2, queue: [{ ...seq, wait: -1 }] })).toBe(true);
    expect(lampOf(undefined)).toBe(false);
  });

  it("affordable bet step", () => {
    expect(STEPS).toEqual([20, 40, 100, 200]);
    expect(affordableIndex(1000, 3)).toBe(3);
    expect(affordableIndex(199, 3)).toBe(2);
    expect(affordableIndex(19, 3)).toBe(-1);
  });

  it("symbol art: ten standalone SVG documents scoped under .ocean", () => {
    expect(SYMBOLS).toHaveLength(10);
    for (const s of SYMBOLS) {
      const svg = symbolSvg(s);
      expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
      expect(svg).not.toMatch(/undefined|NaN/);
      expect(symbolSvg(s, true)).toContain("feGaussianBlur");
    }
    const css = symbolCss();
    expect(css.split("\n")).toHaveLength(10);
    expect(css).not.toMatch(/(^|})\.slot /);
  });
});

function recUi(): OceanUi & { log: string[] } {
  const log: string[] = [];
  return {
    ...headlessUi(), log,
    spinStart: (p) => log.push(`start:${p.n}`),
    reelStop: (i) => log.push(`stop:${i}`),
    omen: (k, ms) => log.push(`omen:${k}:${ms}`),
    result: (p) => log.push(`result:${p.n}:${p.chain}`),
    ticket: (i, _s, instant) => log.push(`ticket:${i}:${instant}`),
    clearTickets: () => log.push("clear"),
    short: (k) => log.push(`short:${k}`),
  };
}

/** First seed whose round `n` (flat bet 20) shows the omen of `kind`. */
function omenSeed(kind: "clam" | "shark" | "whale", maxRound = 4): { seed: string; round: number } {
  for (let k = 0; k < 20000; k++) {
    const seed = `om-${kind}-${k}`;
    const res = createStreams(seed).res("ocean");
    let st = oceanInit();
    for (let n = 1; n <= maxRound; n++) {
      const o = oceanSpin(OCEAN, st, res.at(n), 20);
      if (o.result.omen === kind) return { seed, round: n };
      st = o.state;
    }
  }
  throw new Error("no seed");
}

describe("core", () => {
  it("each creature crosses with its grade (omen sound pitch 1/2/3) before the reels land", async () => {
    for (const kind of ["clam", "shark", "whale"] as const) {
      const { seed, round } = omenSeed(kind);
      const played: { name: string; pitch?: number }[] = [];
      const h = createHeadlessCtx({ seed, fx: "on", game: "ocean" });
      const sfx: Sfx = { ...h.fx.sfx, play: (name, o) => { played.push({ name, pitch: o?.pitch }); h.fx.sfx.play(name, o); } };
      const fx: Fx = { ...h.fx, sfx };
      const ui = recUi();
      const core = createOceanCore({ ...h.ctx, fx }, ui);
      let ev: Ev | null = null;
      for (let n = 1; n <= round; n++) ev = await core.spin();
      const i = ui.log.indexOf(`omen:${kind}:${OMEN_MS[kind]}`);
      expect(i).toBeGreaterThan(0);
      expect(ui.log.slice(i + 1, i + 6)).toEqual(["stop:0", "stop:1", "stop:2", "stop:3", "stop:4"]);
      expect(played.find((p) => p.name === "omen")?.pitch).toBe(OMEN_GRADE[kind]);
      expect((ev!.disp as { omen?: string }).omen).toBe(kind);
    }
  });

  it("fx off: no creature, no tickets, same outcome", async () => {
    const { seed, round } = omenSeed("shark");
    const outs: unknown[] = [];
    for (const fx of ["on", "off"] as const) {
      const h = createHeadlessCtx({ seed, fx, game: "ocean" });
      const ui = recUi();
      const core = createOceanCore(h.ctx, ui);
      for (let n = 1; n <= round; n++) await core.spin();
      expect(ui.log.some((l) => l.startsWith("omen:"))).toBe(fx === "on");
      outs.push(h.rt.logger.session.events.map((e) => [e.payout, e.out, e.dec]));
    }
    expect(outs[0]).toEqual(outs[1]);
  });

  it("STOP during the crossing does not cut the creature short; the round still settles with the same outcome", async () => {
    const { seed, round } = omenSeed("whale");
    const a = createHeadlessCtx({ seed, fx: "on", game: "ocean" });
    const ca = createOceanCore(a.ctx, headlessUi());
    for (let n = 1; n < round; n++) await ca.spin();
    const t0 = a.clock.now();
    const p = ca.spin();
    expect(ca.stop()).toBe(true);
    const ev = (await p)!;
    expect(a.clock.now() - t0).toBeGreaterThanOrEqual(OMEN_MS.whale);
    expect(ev.ctl?.stopPressed).toBe(true);
    const b = createHeadlessCtx({ seed, fx: "on", game: "ocean" });
    const cb = createOceanCore(b.ctx, headlessUi());
    let evb: Ev | null = null;
    for (let n = 1; n <= round; n++) evb = await cb.spin();
    expect(ev.out).toEqual(evb!.out);
    expect(ev.payout).toBe(evb!.payout);
  });

  it("an unaffordable bet steps down without a round; below the minimum bet the sheet is asked for", async () => {
    const h = createHeadlessCtx({ seed: "short", fx: "on", game: "ocean", startCredits: 150 });
    h.rt.store.set(STORE_BET, 3);
    const ui = recUi();
    const core = createOceanCore(h.ctx, ui);
    expect(core.state.bet).toBe(200);
    expect(await core.spin()).toBeNull();
    expect(core.state.bet).toBe(100);
    expect(ui.log).toEqual(["short:lowered"]);
    const h2 = createHeadlessCtx({ seed: "short", fx: "on", game: "ocean", startCredits: 15 });
    const ui2 = recUi();
    expect(await createOceanCore(h2.ctx, ui2).spin()).toBeNull();
    expect(ui2.log).toEqual(["short:sheet"]);
  });

  it("BET cycles through the steps and is locked while the reels turn", async () => {
    const h = createHeadlessCtx({ seed: "bet", fx: "off", game: "ocean", fxImpl: createNullFx() });
    const core = createOceanCore(h.ctx, headlessUi());
    const seen = [core.state.bet];
    for (let i = 0; i < 4; i++) { core.cycleBet(); seen.push(core.state.bet); }
    expect(seen).toEqual([20, 40, 100, 200, 20]);
    const p = core.spin();
    core.cycleBet();
    expect(core.state.bet).toBe(20);
    await p;
  });
});
