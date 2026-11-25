/**
 * SKYROCKET on the headless harness (ARCHITECTURE §11.1): ManualClock, real wallet/session/RoundApi, no DOM.
 * Rounds are driven through the core; manual taps happen at scripted virtual times via `core.onTick`.
 *
 * fx note: `createHeadlessFx` hands the fx director the game's own ManualClock, whose `wait()` advances time at
 * once, so a build-up (`antic`) started in mid-flight would jump the game clock. Time-dependent games therefore
 * give fx a clock that follows game time (`followClock`): jobs finish when the game clock reaches them, exactly
 * as in the browser. (See the report: run.ts / ctx.ts should offer this.)
 */
import { describe, expect, it } from "vitest";
import { createRng } from "../../shared/rng";
import { CRASH, crashPoint, multAt, settleCrash, timeOf } from "../../shared/rules/crash";
import type { Ev } from "../../shared/schema";
import { createFx, createNullFx, nullBackend } from "../fx/index";
import type { Fx } from "../fx/types";
import {
  affordableBet, createCrashCore, headlessUi, HIST_LEN, makeCrowd, normBet, normTarget, pushHistory, STORE_HIST,
  type CrashCore, type CrashUi, type CrowdPlayer,
} from "../games/crash/core";
import { type ManualClock } from "../src/clock";
import type { Clock } from "../src/types";
import { createHeadlessCtx, type HeadlessCtx } from "./ctx";

/** Clock for fx that follows the game's ManualClock (resolved lazily): waits complete when game time reaches them. */
function followClock(get: () => ManualClock): Clock {
  const waiters = new Set<{ at: number; res: () => void }>();
  let hooked: ManualClock | null = null;
  const hook = (): ManualClock => {
    const base = get();
    if (hooked !== base) {
      hooked = base;
      base.frame(() => { for (const w of [...waiters]) if (base.now() >= w.at) { waiters.delete(w); w.res(); } });
    }
    return base;
  };
  return {
    now: () => get().now(),
    wait: (ms) => new Promise<void>((res) => { const base = hook(); if (!(ms > 0)) res(); else waiters.add({ at: base.now() + ms, res }); }),
    frame: (cb) => hook().frame(cb),
    pause: () => undefined,
    resume: () => undefined,
  };
}

/** Headless ctx whose fx follows the game clock. */
function rebuild(seed: string, fx: "on" | "off", startCredits: number): HeadlessCtx {
  let h: HeadlessCtx | null = null;
  const fxImpl: Fx = fx === "on"
    ? createFx({ backend: nullBackend, clock: followClock(() => h!.clock), pre: createRng(seed, "pre:fx") })
    : createNullFx();
  h = createHeadlessCtx({ seed, fx, startCredits, fxImpl, game: "crash" });
  return h;
}

export interface Step {
  bet: number;
  /** Auto cash-out target (null = off). */
  target: number | null;
  /** Manual tap this many ms into the climb (resolved from the clock at that tick). */
  tapAtMs?: number;
}

/** Plays one scripted round on `core`; resolves with the settled Ev. */
async function playStep(core: CrashCore, st: Step): Promise<Ev> {
  core.setBet(st.bet);
  if (st.target === null) core.setAuto(false);
  else { core.setTarget(st.target); core.setAuto(true); }
  const off = core.onTick((ms) => { if (st.tapAtMs !== undefined && ms >= st.tapAtMs) core.cashout(); });
  const ev = await core.start();
  off();
  if (!ev) throw new Error("no round");
  return ev;
}

async function drain(h: HeadlessCtx): Promise<void> {
  let idle = false;
  void h.fx.idle().then(() => { idle = true; });
  for (let i = 0; i < 600 && !idle; i++) {
    h.clock.advance(100);
    for (let k = 0; k < 4; k++) await Promise.resolve();
  }
  await h.rt.whenSettled();
}

/** Seed whose first crash point lies in [lo, hi]. */
function seedWith(lo: number, hi: number): string {
  for (let i = 0; i < 5000; i++) {
    const seed = `sky-${i}`;
    const c = crashPoint(createHeadlessCtx({ seed, fx: "off" }).ctx.rng.res("crash").at(1));
    if (c >= lo && c <= hi) return seed;
  }
  throw new Error("no seed");
}
const crashOf = (h: HeadlessCtx, n = 1): number => crashPoint(h.ctx.rng.res("crash").at(n));

describe("pure parts", () => {
  it("bets are multiples of 100, targets 1.01..1000 on the 0.01 grid", () => {
    expect(normBet(0)).toBe(100);
    expect(normBet(149)).toBe(100);
    expect(normBet(150)).toBe(200);
    expect(normBet(1e9)).toBe(100_000);
    expect(normBet(NaN)).toBe(100);
    expect(normTarget(1)).toBe(1.01);
    expect(normTarget(2.005)).toBeCloseTo(2.01, 2);
    expect(normTarget(5000)).toBe(1000);
    expect(affordableBet(1234)).toBe(1200);
    expect(affordableBet(99)).toBe(0);
  });

  it("history is newest first and holds 20", () => {
    let h: number[] = [];
    for (let i = 1; i <= 25; i++) h = pushHistory(h, i);
    expect(h).toHaveLength(HIST_LEN);
    expect(h[0]).toBe(25);
    expect(h[19]).toBe(6);
  });

  it("crowd: 12..18 people, deterministic, exits only at or below the crash point", () => {
    const a = makeCrowd(createRng("c", "pre:crash"), 3.5);
    const b = makeCrowd(createRng("c", "pre:crash"), 3.5);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a.length).toBeLessThanOrEqual(18);
    expect(new Set(a.map((p) => p.name)).size).toBeGreaterThan(a.length - 3);
    for (const p of a) {
      expect(p.bet % 100).toBe(0);
      if (p.cashAt !== null) { expect(p.cashAt).toBeLessThanOrEqual(3.5); expect(p.cashAt).toBeGreaterThanOrEqual(1.08); }
    }
    expect(makeCrowd(createRng("c", "pre:crash"), 1).every((p) => p.cashAt === null)).toBe(true);
    let outs = 0, all = 0;
    for (let i = 0; i < 40; i++) for (const p of makeCrowd(createRng("c" + i, "pre:crash"), 20)) { all++; if (p.cashAt !== null) outs++; }
    expect(outs / all).toBeGreaterThan(0.6);
  });
});

describe("rounds", () => {
  it("auto target: pays bet x target at the target's time, logs dec", async () => {
    const seed = seedWith(4, 30);
    const h = rebuild(seed, "on", 100_000);
    const core = createCrashCore(h.ctx, headlessUi());
    const crash = crashOf(h);
    const t0 = h.clock.now();
    const ev = await playStep(core, { bet: 1000, target: 2, tapAtMs: undefined });
    expect(ev.game).toBe("crash");
    expect(ev.payout).toBe(2000);
    expect(ev.net).toBe(1000);
    expect(ev.out).toEqual({ crash, cashoutAt: 2 });
    expect(ev.dec).toEqual({ target: 2, manualCashoutAt: null });
    expect(h.rt.wallet.balance).toBe(101_000);
    // the climb ran on to the crash point: countdown 3 s + timeOf(crash)
    expect(h.clock.now() - t0).toBeCloseTo(CRASH.countdownMs + timeOf(crash) * 1000, 0);
    await drain(h);
  });

  it("auto target exactly at the crash point is a success", async () => {
    const seed = seedWith(1.5, 8);
    const h = rebuild(seed, "off", 100_000);
    const crash = crashOf(h);
    const ev = await playStep(createCrashCore(h.ctx, headlessUi()), { bet: 300, target: crash, tapAtMs: undefined });
    expect(ev.payout).toBe(settleCrash(300, crash, crash));
    expect(ev.payout).toBeGreaterThan(0);
  });

  it("manual cash-out is resolved from the tap's clock time", async () => {
    const seed = seedWith(8, 100);
    for (const fx of ["on", "off"] as const) {
      const h = rebuild(seed, fx, 100_000);
      const core = createCrashCore(h.ctx, headlessUi());
      const ev = await playStep(core, { bet: 1000, target: null, tapAtMs: 5000 });
      const m = multAt(5);
      expect(m).toBe(1.82);
      expect(ev.payout).toBe(1820);
      expect(ev.out).toEqual({ crash: crashOf(h), cashoutAt: m });
      expect(ev.dec).toEqual({ target: null, manualCashoutAt: m });
      expect(ev.ctl).toEqual({ gesture: "tap" });
      await drain(h);
    }
  });

  it("taps at different times pay different multipliers", async () => {
    const seed = seedWith(30, 500);
    const out: number[] = [];
    for (const at of [1000, 3000, 9000, 20_000]) {
      const h = rebuild(seed, "off", 100_000);
      const ev = await playStep(createCrashCore(h.ctx, headlessUi()), { bet: 100, target: null, tapAtMs: at });
      out.push(ev.payout);
      expect((ev.dec as { manualCashoutAt: number }).manualCashoutAt).toBe(multAt(at / 1000));
    }
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(new Set(out).size).toBe(4);
  });

  it("a tap before the target wins, a target earlier than the tap pays the target", async () => {
    const seed = seedWith(30, 500);
    const h1 = rebuild(seed, "off", 100_000);
    const e1 = await playStep(createCrashCore(h1.ctx, headlessUi()), { bet: 1000, target: 3, tapAtMs: 4000 });   // 3x at ~9.2 s
    expect(e1.dec).toEqual({ target: 3, manualCashoutAt: multAt(4) });
    expect(e1.payout).toBe(Math.floor(1000 * multAt(4)));
    const h2 = rebuild(seed, "off", 100_000);
    const e2 = await playStep(createCrashCore(h2.ctx, headlessUi()), { bet: 1000, target: 1.5, tapAtMs: 8000 });   // 1.5x at ~3.4 s
    expect(e2.dec).toEqual({ target: 1.5, manualCashoutAt: null });
    expect(e2.payout).toBe(1500);
  });

  it("crash before the target: payout 0, quiet, dec still logged", async () => {
    const seed = seedWith(1.1, 1.9);
    for (const fx of ["on", "off"] as const) {
      const h = rebuild(seed, fx, 100_000);
      const crash = crashOf(h);
      const ev = await playStep(createCrashCore(h.ctx, headlessUi()), { bet: 500, target: 3 });
      expect(ev.payout).toBe(0);
      expect(ev.net).toBe(-500);
      expect(ev.out).toEqual({ crash, cashoutAt: null });
      expect(ev.dec).toEqual({ target: 3, manualCashoutAt: null });
      expect(h.rt.wallet.balance).toBe(99_500);
      await drain(h);
      const types = (h.rt.logger.session.events[0].fx ?? []).map((r) => r.type);
      expect(types).not.toContain("tier");
      expect(types.some((x) => x.startsWith("particles"))).toBe(false);
    }
  });

  it("a tap that arrives after the crash does not pay", async () => {
    const seed = seedWith(1.2, 1.8);
    const h = rebuild(seed, "off", 100_000);
    const crash = crashOf(h);
    const late = Math.ceil(timeOf(crash) * 1000 / 100) * 100 + 500;
    const core = createCrashCore(h.ctx, headlessUi());
    let paid: boolean | null = null;
    core.onTick((ms) => { if (ms >= timeOf(crash) * 1000 - 1e-6) paid = core.cashout(); });   // exactly at the crash instant
    const ev = await core.start();
    expect(late).toBeGreaterThan(0);
    expect(paid).toBe(false);
    expect(ev!.payout).toBe(0);
    expect(ev!.dec).toEqual({ target: null, manualCashoutAt: null });
  });

  it("the outcome is drawn before the climb and does not depend on what the player does", async () => {
    const seed = seedWith(5, 50);
    const outs: unknown[] = [];
    for (const st of [{ target: null, tapAtMs: undefined }, { target: 2, tapAtMs: undefined }, { target: null, tapAtMs: 2000 }]) {
      const h = rebuild(seed, "on", 100_000);
      const ev = await playStep(createCrashCore(h.ctx, headlessUi()), { bet: 200, ...st });
      outs.push((ev.out as { crash: number }).crash);
    }
    expect(new Set(outs).size).toBe(1);
  });

  it("countdown costs nothing: cancelling it starts no round", async () => {
    const h = rebuild("cd", "on", 5000);
    const core = createCrashCore(h.ctx, headlessUi());
    const p = core.start();
    expect(core.state.phase).toBe("countdown");
    expect(h.rt.wallet.balance).toBe(5000);
    core.press();   // CANCEL
    expect(await p).toBeNull();
    expect(core.state.phase).toBe("idle");
    expect(h.rt.wallet.balance).toBe(5000);
    expect(h.ctx.rounds.count()).toBe(0);
  });

  it("controls lock once the round starts; canLeave follows the bet", async () => {
    const seed = seedWith(10, 80);
    const h = rebuild(seed, "off", 100_000);
    const core = createCrashCore(h.ctx, headlessUi());
    const seen: { leave: boolean; phase: string; bet: number }[] = [];
    core.onTick((ms) => {
      if (ms === 0) { core.setBet(5000); core.setTarget(9); seen.push({ leave: core.canLeave(), phase: core.state.phase, bet: core.state.bet }); }
      if (ms === 2000) { core.cashout(); seen.push({ leave: core.canLeave(), phase: core.state.phase, bet: core.state.bet }); }
    });
    core.setBet(300);
    await core.start();
    expect(seen).toEqual([{ leave: false, phase: "flight", bet: 300 }, { leave: true, phase: "flight", bet: 300 }]);
    expect(core.canLeave()).toBe(true);
    expect(core.state.target).toBe(2);
  });

  it("tapping through the rest of a cashed-out climb changes nothing", async () => {
    const seed = seedWith(40, 400);
    const run = async (skip: boolean) => {
      const h = rebuild(seed, "on", 100_000);
      const log: string[] = [];
      const ui: CrashUi = { ...headlessUi(), crashed: (c, s) => log.push(`crashed:${c}:${s}`), cashed: (i) => log.push(`cashed:${i.cashoutAt}`) };
      const core = createCrashCore(h.ctx, ui);
      core.onTick((ms) => { if (ms === 3000) core.cashout(); if (skip && ms === 3500) expect(core.skip()).toBe(true); });
      const t = h.clock.now();
      const ev = await core.start();
      await drain(h);
      return { ev, log, took: h.clock.now() - t, bal: h.rt.wallet.balance };
    };
    const a = await run(false), b = await run(true);
    expect(b.ev!.payout).toBe(a.ev!.payout);
    expect(b.log[0]).toBe(a.log[0]);
    expect(a.log[1]).toMatch(/:false$/);
    expect(b.log[1]).toMatch(/:true$/);
    expect(b.took).toBeLessThan(a.took);
    expect(b.bal).toBe(a.bal);
  });

  it("unmounting mid-flight settles with the already fixed outcome (no tap, auto target if reachable)", async () => {
    const seed = seedWith(10, 80);
    const h = rebuild(seed, "off", 100_000);
    const core = createCrashCore(h.ctx, headlessUi());
    core.setAuto(true); core.setTarget(1.5);
    core.onTick((ms) => { if (ms === 1000) core.dispose(); });
    await core.start();
    const evs = h.rt.logger.session.events;
    expect(evs).toHaveLength(1);
    expect(evs[0].payout).toBe(150);
    expect(evs[0].dec).toEqual({ target: 1.5, manualCashoutAt: null });
  });

  it("not enough credits: the bet is stepped down, or the sheet is asked for", async () => {
    const h = rebuild("short", "off", 450);
    const shorts: string[] = [];
    const core = createCrashCore(h.ctx, { ...headlessUi(), short: (k) => shorts.push(k) });
    core.setBet(1000);
    expect(await core.start()).toBeNull();
    expect(shorts).toEqual(["lowered"]);
    expect(core.state.bet).toBe(400);
    const h2 = rebuild("short2", "off", 60);
    const s2: string[] = [];
    const c2 = createCrashCore(h2.ctx, { ...headlessUi(), short: (k) => s2.push(k) });
    expect(await c2.start()).toBeNull();
    expect(s2).toEqual(["sheet"]);
  });
});

describe("presentation: crowd and history", () => {
  it("with fx on the crowd is generated, logged in disp and aux; with fx off nothing", async () => {
    const seed = seedWith(3, 20);
    const on = rebuild(seed, "on", 100_000), off = rebuild(seed, "off", 100_000);
    const plans: { n: number; crowd: CrowdPlayer[] }[] = [];
    const cOn = createCrashCore(on.ctx, { ...headlessUi(), flightStart: (p) => plans.push(p) });
    const cOff = createCrashCore(off.ctx, { ...headlessUi(), flightStart: (p) => plans.push(p) });
    const eOn = await playStep(cOn, { bet: 100, target: 2 });
    const eOff = await playStep(cOff, { bet: 100, target: 2 });
    await drain(on); await drain(off);
    expect(plans[0].crowd.length).toBeGreaterThanOrEqual(12);
    expect(plans[1].crowd).toEqual([]);
    expect((eOn.disp as { crowd: number }).crowd).toBe(plans[0].crowd.length);
    expect(eOn.disp).toMatchObject({ celebrate: true, tier: expect.any(Number) });
    expect(eOff.disp).toEqual({ tier: expect.any(Number) });
    const auxOn = on.rt.logger.session.aux ?? [], auxOff = off.rt.logger.session.aux ?? [];
    expect(auxOn.filter((a) => a.kind === "crowd")).toEqual([expect.objectContaining({ kind: "crowd", d: { n: plans[0].crowd.length, round: 1, game: "crash" } })]);
    expect(auxOff.filter((a) => a.kind === "crowd")).toHaveLength(0);
    // the crowd comes from the presentation stream only
    expect(plans[0].crowd).toEqual(makeCrowd(on.ctx.rng.pre("crash").at(1), crashOf(on)));
    // fx records: a rising tone for the climb, a celebration for the win
    const types = (on.rt.logger.session.events[0].fx ?? []).map((r) => r.type);
    expect(types).toContain("antic:rise");
    expect(types.filter((x) => x === "antic:rise")).toHaveLength(1);
    expect(types).toContain("tier");
    expect(off.rt.logger.session.events[0].fx).toEqual([]);
  });

  it("the recent crash points are real values, newest first, kept in the store", async () => {
    const h = rebuild("hist", "off", 10_000_000);
    const lists: (readonly number[])[] = [];
    const core = createCrashCore(h.ctx, { ...headlessUi(), history: (l) => lists.push(l) });
    const crashes: number[] = [];
    for (let i = 0; i < 25; i++) {
      await playStep(core, { bet: 100, target: 1.5 });
      h.clock.advance(1000);
      crashes.unshift(crashOf(h, i + 1));
    }
    const hist = h.ctx.store.get<number[]>(STORE_HIST)!;
    expect(hist).toEqual(crashes.slice(0, 20));
    expect(lists.at(-1)).toEqual(hist);
    // a new core (re-entering the game) starts from the stored list
    const seen: (readonly number[])[] = [];
    createCrashCore(h.ctx, { ...headlessUi(), history: (l) => seen.push(l) });
    expect(seen[0]).toEqual(hist);
  });
});

describe("fx on/off parity", () => {
  const BETS = [100, 200, 500, 1000, 300];
  const TARGETS: (number | null)[] = [null, 1.5, 2, 3.3, 10, 1.01, 25];
  const script = (n: number): Step[] =>
    Array.from({ length: n }, (_, i) => ({
      bet: BETS[i % BETS.length],
      target: i % 3 === 0 ? null : TARGETS[(i * 5) % TARGETS.length],
      tapAtMs: i % 4 === 1 || i % 3 === 0 ? 800 + ((i * 370) % 9000 - ((i * 370) % 9000) % 100) : undefined,
    }));

  const outcomes = (evs: readonly Ev[]) =>
    evs.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec, ctl: e.ctl }));

  async function play(seed: string, fx: "on" | "off", n: number) {
    const h = rebuild(seed, fx, 10_000_000);
    const core = createCrashCore(h.ctx, headlessUi());
    for (const st of script(n)) await playStep(core, st);
    await drain(h);
    return h;
  }

  it("100 rounds with scripted targets and tap times: identical outcomes, only the presentation differs", async () => {
    const on = await play("crash-parity", "on", 100);
    const off = await play("crash-parity", "off", 100);
    const evOn = on.rt.logger.session.events, evOff = off.rt.logger.session.events;
    expect(evOn).toHaveLength(100);
    expect(outcomes(evOn)).toEqual(outcomes(evOff));
    expect(on.rt.wallet.balance).toBe(off.rt.wallet.balance);
    // every payout is what the rules say for (crash, cashoutAt)
    for (const e of evOn) {
      const o = e.out as { crash: number; cashoutAt: number | null };
      expect(e.payout).toBe(settleCrash(e.bet, o.crash, o.cashoutAt));
      expect(o.cashoutAt === null).toBe(e.payout === 0);
    }
    // both kinds of exit and busts occurred
    const decs = evOn.map((e) => e.dec as { target: number | null; manualCashoutAt: number | null });
    expect(decs.some((d) => d.manualCashoutAt !== null)).toBe(true);
    expect(evOn.some((e, i) => decs[i].manualCashoutAt === null && e.payout > 0)).toBe(true);
    expect(evOn.some((e) => e.payout === 0)).toBe(true);
    // off records and shows nothing extra; on records the climb tone, crowd and celebrations
    expect(evOff.every((e) => (e.fx ?? []).length === 0)).toBe(true);
    expect(evOff.every((e) => Object.keys(e.disp ?? {}).join() === "tier")).toBe(true);
    expect(evOn.every((e) => (e.fx ?? []).some((r) => r.type === "antic:rise") || (e.out as { crash: number }).crash === 1)).toBe(true);
    for (const e of evOn) if (e.payout > 0) expect((e.fx ?? []).some((r) => r.type === "tier")).toBe(true);
    for (const e of evOn) if (e.payout === 0) expect((e.fx ?? []).some((r) => r.type === "tier" || r.type.startsWith("particles"))).toBe(false);
    expect(evOn.every((e) => ((e.disp as { crowd?: number }).crowd ?? 0) >= 12)).toBe(true);
    expect((on.rt.logger.session.aux ?? []).filter((a) => a.kind === "crowd")).toHaveLength(100);
    expect((off.rt.logger.session.aux ?? []).filter((a) => a.kind === "crowd")).toHaveLength(0);
  }, 60_000);

  it("a different seed draws different crash points (the stream is the seed's)", async () => {
    const a = await play("seed-a", "off", 20);
    const b = await play("seed-b", "off", 20);
    const ca = a.rt.logger.session.events.map((e) => (e.out as { crash: number }).crash);
    const cb = b.rt.logger.session.events.map((e) => (e.out as { crash: number }).crash);
    expect(ca).not.toEqual(cb);
  });
});
