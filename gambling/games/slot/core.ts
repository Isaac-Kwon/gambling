/**
 * ORO SEVENS round logic (ARCHITECTURE §6.1, §7). No DOM, no wall clock, no Math.random:
 * time is `ctx.clock`, randomness is `Round.res` (outcome) and `Round.pre` (presentation) only.
 *
 * Order inside a round: begin (debit) → outcome from `res` (rules engine) → presentation from `pre`
 * (decided after the outcome) → reels stop on the schedule → settle (credit, Ev) → celebration.
 * Nothing the player does (STOP, turbo, swipe, auto) and nothing fx does can change an outcome.
 *
 * The screen is a `SlotUi` port: the DOM view implements it, `headlessUi()` is the no-op used by the
 * harness. fx calls (sounds, build-up, celebration) are made here so that the headless run records the
 * same stimuli as the browser.
 */
import { BET_STEPS, MIN_BET, MIN_BET_GLOBAL, tierOf, type Tier } from "../../../shared/config";
import type { Rng } from "../../../shared/rng";
import { SLOTS, slotPresentation, spin as drawSpin, type LineWin, type SlotConfig, type Sym } from "../../../shared/rules/slot";
import type { Ev } from "../../../shared/schema";
import { ANTIC_REEL_EXTRA_MS } from "../../fx/anticipation";
import { planCelebration } from "../../fx/tiers";
import type { FxRun } from "../../fx/types";
import type { GameCtx, Round } from "../../src/types";

export const REELS = 5;
export const LINES = 20;
export const STEPS: readonly number[] = BET_STEPS.slot;
/** Rest time of each reel after the spin starts (§7.5). */
export const STOP_MS: readonly number[] = [1000, 1300, 1600, 1900, 2200];
/** Turbo: every reel at rest within 0.9 s. */
export const TURBO_MS: readonly number[] = [520, 615, 710, 805, 900];
/** Without the presentation layer the result is shown after 150 ms, no spin (§6.5). */
export const QUICK_MS = 150;
/** STOP: remaining reels rest at 80 ms intervals, the first one now (but never sooner than this after the start). */
export const HURRY_GAP_MS = 80;
export const HURRY_MIN_MS = 180;
/** Pause between the last reel at rest and the payout (the reel's bounce settles). */
export const SETTLE_MS = 160;
export const AUTO_COUNTS: readonly number[] = [10, 25, 50, 100];
export const AUTO_GAP_MS = 320;
export const AUTO_GAP_TURBO_MS = 140;
/** A tap that skipped a celebration does not also start a spin when it lands within this window. */
export const SWALLOW_MS = 450;
/** Symbols passing by while a reel turns come from a 7-rich display band (presentation stream). */
export const TAPE_LEN = 24;

export const STORE_BET = "slot.bet";
export const STORE_TURBO = "slot.turbo";
export const STORE_LAST = "slot.last";

export type Phase = "idle" | "spin";

export interface SpinPlan {
  n: number;
  bet: number;
  lineBet: number;
  stops: number[];
  /** [reel][0..4] = peek above, rows 0..2, peek below. Rows 0..2 are always the real result; display variation only touches peeks. */
  cells: Sym[][];
  /** [reel][TAPE_LEN] symbols shown while turning. */
  tape: Sym[][];
  wins: LineWin[];
  payout: number;
  tier: Tier;
  /** Reels slowed by the build-up (0 = none). The first slowed reel is REELS - antic. */
  antic: number;
  turbo: boolean;
  /** No spin animation (presentation layer off). */
  quick: boolean;
}

export interface SlotState {
  phase: Phase;
  betIndex: number;
  bet: number;
  turbo: boolean;
  /** Auto spins left (0 = auto off). */
  auto: number;
  /** STOP was pressed in this spin. */
  hurried: boolean;
}

/** Screen port. Element handles go to fx only (fakes in headless). Every method must be cheap and must not throw. */
export interface SlotUi {
  readonly winEl: HTMLElement;
  readonly reelsEl: HTMLElement;
  render(s: SlotState): void;
  /** Reels start; `at[i]` = clock time (ctx.clock.now()) at which reel i must be at rest. */
  spinStart(plan: SpinPlan, at: readonly number[]): void;
  /** New rest times for reels not yet at rest (`snap` = STOP: land as fast as possible). */
  retime(at: readonly number[], snap: boolean): void;
  /** Reel i's rest time has come: it must show its final symbols now. */
  reelStop(reel: number): void;
  /** Build-up: reels from `fromReel` on turn slower and glow. */
  antic(fromReel: number): void;
  /** Spin over: highlight win lines (if any). */
  result(plan: SpinPlan): void;
  /** Bet not affordable: "lowered" = the bet was stepped down; "sheet" = not even the minimum bet. */
  short(kind: "lowered" | "sheet"): void;
}

export interface SlotCore {
  readonly state: SlotState;
  readonly cfg: SlotConfig;
  /** Starts a spin. Resolves with the settled Ev after the celebration (null when no round started). */
  spin(o?: { gesture?: "tap" | "swipe" }): Promise<Ev | null>;
  /** STOP: only shortens the stop animation. Returns true when it applied to a running spin. */
  stop(): boolean;
  /** Primary button: spin when idle, STOP while turning, cancel while auto runs. */
  press(gesture?: "tap" | "swipe"): void;
  setBet(index: number): void;
  setTurbo(on: boolean): void;
  /** Runs `n` auto spins; resolves when auto ends (count used up, cancelled, or not enough credits). */
  startAuto(n: number): Promise<void>;
  cancelAuto(): void;
  /** Leave intent (router): cancels auto; true when no round is in flight. */
  canLeave(): boolean;
  /** Background: auto never survives it. */
  suspend(): void;
  /** Unmount: cancels everything; a round still in flight is settled with its (already fixed) outcome. */
  dispose(): void;
  /** Test hook: called after each settlement. */
  onSettle(cb: (ev: Ev) => void): () => void;
}

// ------------------------------------------------------------------------------------------- pure parts

/** Planned rest times (ms after the start). */
export function stopSchedule(o: { turbo: boolean; quick: boolean }): number[] {
  if (o.quick) return STOP_MS.map(() => QUICK_MS);
  return [...(o.turbo ? TURBO_MS : STOP_MS)];
}

/**
 * Build-up extension: reel `trigger` came to rest at `now`; every later reel rests ANTIC_REEL_EXTRA_MS
 * later than it would have, one after another.
 */
export function anticSchedule(at: readonly number[], base: readonly number[], trigger: number, now: number): number[] {
  const out = [...at];
  out[trigger] = now;
  for (let j = trigger + 1; j < out.length; j++) out[j] = out[j - 1] + (base[j] - base[j - 1]) + ANTIC_REEL_EXTRA_MS;
  return out;
}

/** STOP: reels from `from` on rest at 80 ms intervals starting at max(now, t0 + HURRY_MIN_MS) (never later than planned). */
export function hurrySchedule(at: readonly number[], from: number, now: number, t0: number): number[] {
  const out = [...at];
  const first = Math.max(now, t0 + HURRY_MIN_MS);
  for (let j = from, k = 0; j < out.length; j++, k++) out[j] = Math.min(out[j], first + HURRY_GAP_MS * k);
  return out;
}

/** Final window per reel: peek above, the three real rows, peek below; display variation draws `7` in chosen peeks. */
export function windowCells(cfg: SlotConfig, stops: readonly number[], dispVar?: { cells: [number, "a" | "b"][] }): Sym[][] {
  const out = cfg.strips.map((s, r) => {
    const n = s.length, i = stops[r];
    return [-1, 0, 1, 2, 3].map((d) => s[(((i + d) % n) + n) % n] as Sym);
  });
  for (const [reel, where] of dispVar?.cells ?? []) out[reel][where === "a" ? 0 : 4] = cfg.top;
  return out;
}

/** Display band (presentation stream): reel symbols with extra 7s (and wilds on reels 2..4). */
export function makeTape(cfg: SlotConfig, pre: Rng): Sym[][] {
  return cfg.strips.map((s, r) => {
    const out: Sym[] = [];
    for (let k = 0; k < TAPE_LEN; k++) {
      const u = pre.float();
      if (u < 0.17) out.push(cfg.top);
      else if (u < 0.24 && r >= 1 && r <= 3) out.push("W");
      else {
        let c = s[pre.int(s.length)] as Sym;
        if (c === "W" && (r === 0 || r === 4)) c = "B";
        out.push(c);
      }
    }
    return out;
  });
}

/** Highest bet step index the balance covers (-1: none). */
export function affordableIndex(balance: number, upTo: number): number {
  for (let i = Math.min(upTo, STEPS.length - 1); i >= 0; i--) if (STEPS[i] <= balance) return i;
  return -1;
}

const noop = (): void => undefined;
const fakeEl = (): HTMLElement => ({ textContent: "" }) as unknown as HTMLElement;

/** No-op screen for node (harness, tests). */
export function headlessUi(): SlotUi {
  return {
    winEl: fakeEl(), reelsEl: fakeEl(),
    render: noop, spinStart: noop, retime: noop, reelStop: noop, antic: noop, result: noop, short: noop,
  };
}

// ------------------------------------------------------------------------------------------- the core

export function createSlotCore(ctx: GameCtx, ui: SlotUi): SlotCore {
  const { clock, fx, wallet } = ctx;
  const cfg = SLOTS[ctx.settings.sv] ?? SLOTS.a;
  // The one place the core looks at the fx mode: display variation, build-up and celebration are
  // presentation and are neither shown nor recorded without the presentation layer (§5.3, §6.5).
  // Outcomes never read this.
  const vivid = fx.enabled;

  const storedBet = ctx.store.get<number>(STORE_BET);
  let betIndex = typeof storedBet === "number" && storedBet >= 0 && storedBet < STEPS.length ? storedBet : 0;
  let turbo = ctx.store.get<boolean>(STORE_TURBO) === true;
  let phase: Phase = "idle";
  let auto = 0;
  let autoToken = 0;
  let disposed = false;
  let hurried = false;

  // live spin
  let round: Round | null = null;
  let live: { plan: SpinPlan; t0: number; at: number[]; base: number[]; landed: number; wake: (() => void) | null; anticRun: FxRun | null; anticShown: boolean } | null = null;
  // last celebration (tap-to-skip handling)
  let cel: { run: FxRun; tier: Tier; t0: number; planned: number; endedAt: number; natural: boolean; ended: boolean } | null = null;
  const settleSubs = new Set<(ev: Ev) => void>();

  const state = (): SlotState => ({ phase, betIndex, bet: STEPS[betIndex], turbo, auto, hurried });
  const emit = (): void => { try { ui.render(state()); } catch { /* the screen must never break a round */ } };

  /** Waits until clock time `t`; returns early when the schedule changes (wake). */
  const waitUntil = async (get: () => number): Promise<void> => {
    for (;;) {
      if (!live || disposed) return;
      const d = get() - clock.now();
      if (d <= 0) return;
      const l = live;
      await Promise.race([clock.wait(d), new Promise<void>((r) => { l.wake = r; })]);
      l.wake = null;
    }
  };
  const wakeUp = (): void => { const w = live?.wake; if (w) { live!.wake = null; w(); } };

  /** A tap that just skipped (or now skips) a running tier ≥ 1 celebration is used up by that. */
  const swallowTap = (): boolean => {
    if (!cel || cel.tier < 1) return false;
    if (!cel.ended) { cel.run.skip(); cel = null; return true; }
    const recent = !cel.natural && clock.now() - cel.endedAt < SWALLOW_MS;
    cel = null;
    return recent;
  };

  const short = (): void => {
    const lower = affordableIndex(wallet.balance, betIndex - 1);
    if (lower >= 0 && lower < betIndex) {
      betIndex = lower;
      ctx.store.set(STORE_BET, betIndex);
      ui.short("lowered");
    } else if (wallet.balance >= MIN_BET_GLOBAL && wallet.balance < MIN_BET.slot) {
      ui.short("sheet");
    }
    emit();
  };

  async function run(o: { gesture?: "tap" | "swipe"; auto?: boolean }): Promise<Ev | null> {
    if (disposed || phase !== "idle") return null;
    if (!o.auto && swallowTap()) return null;
    if (cel && !cel.ended) cel.run.skip();
    cel = null;
    const bet = STEPS[betIndex];
    if (!wallet.canBet(bet)) { cancelAuto(); short(); return null; }

    const ctl: NonNullable<Ev["ctl"]> = {};
    if (o.auto) ctl.auto = true; else ctl.gesture = o.gesture ?? "tap";
    if (turbo) ctl.turbo = true;
    let r: Round;
    try { r = ctx.rounds.begin({ bet, ctl }); } catch { return null; }
    round = r;
    phase = "spin";
    hurried = false;

    // ---- outcome (result stream), then presentation (presentation stream, decided after the outcome)
    const lineBet = bet / LINES;
    const res = drawSpin(cfg, r.res, lineBet);
    const pres = vivid ? slotPresentation(cfg, res, r.pre) : {};
    const tape = makeTape(cfg, r.pre);
    const tier = tierOf(res.payout, bet);
    const plan: SpinPlan = {
      n: r.n, bet, lineBet, stops: res.stops, cells: windowCells(cfg, res.stops, pres.dispVar), tape,
      wins: res.wins, payout: res.payout, tier, antic: pres.antic ?? 0, turbo, quick: !vivid,
    };
    const t0 = clock.now();
    const base = stopSchedule({ turbo, quick: !vivid });
    const at = base.map((ms) => t0 + ms);
    live = { plan, t0, at, base, landed: 0, wake: null, anticRun: null, anticShown: false };
    const l = live;
    emit();
    try { ui.spinStart(plan, at); } catch { /* ignore */ }
    const pitch0 = turbo ? 1.3 : 1;
    fx.sfx.loop("spin", true, { pitch: pitch0 });

    // ---- reels come to rest one by one
    for (let i = 0; i < REELS; i++) {
      await waitUntil(() => l.at[i]);
      if (disposed) break;
      l.landed = i + 1;
      try { ui.reelStop(i); } catch { /* ignore */ }
      fx.sfx.play("stop", { k: 0.55, pitch: 1 + 0.04 * i });
      const trigger = REELS - 1 - plan.antic;
      if (plan.antic > 0 && i === trigger && !hurried) {
        const now = clock.now();
        l.at = anticSchedule(l.at, base, i, now);
        try { ui.retime(l.at, false); ui.antic(i + 1); } catch { /* ignore */ }
        l.anticRun = fx.antic({ el: ui.reelsEl, kind: "reel", k: plan.antic, ms: l.at[REELS - 1] - now });
        l.anticShown = true;
      }
      if (i < REELS - 1) {
        const spinning = REELS - l.landed;
        const slow = l.anticShown && !hurried ? 0.62 : 1;
        fx.sfx.loop("spin", true, { pitch: pitch0 * slow * (0.72 + 0.28 * (spinning / REELS)) });
      }
    }
    fx.sfx.loop("spin", false);
    if (!disposed && !plan.quick) await clock.wait(SETTLE_MS);
    return finish(r, plan, res.mult, pres.dispVar);
  }

  async function finish(r: Round, plan: SpinPlan, mult: number, dispVar: { cells: [number, "a" | "b"][] } | undefined): Promise<Ev | null> {
    if (round !== r) return null;   // already settled by dispose
    const l = live;
    const disp: Record<string, unknown> = { tier: plan.tier };
    if (vivid && plan.payout > 0) disp.celebrate = true;
    if (dispVar) disp.dispVar = dispVar;
    if (l?.anticShown) disp.antic = plan.antic;
    const ev = r.settle({ payout: plan.payout, out: { stops: plan.stops, mult }, dec: { lineBet: plan.lineBet }, disp });
    round = null;
    live = null;
    phase = "idle";
    hurried = false;
    ctx.store.set(STORE_LAST, plan.stops);
    if (!disposed) {
      try { ui.result(plan); } catch { /* ignore */ }
      emit();
    }
    for (const cb of [...settleSubs]) cb(ev);
    if (disposed || plan.payout <= 0) return ev;

    const t0 = clock.now();   // before the call: a virtual clock may already advance inside it
    const run = fx.celebrate({ amount: plan.payout, bet: plan.bet, target: ui.winEl, anchor: ui.reelsEl });
    const planned = planCelebration(plan.payout, plan.bet)?.totalMs ?? 0;
    const c = { run, tier: plan.tier, t0, planned, endedAt: 0, natural: false, ended: false };
    cel = c;
    await run.done;
    c.ended = true;
    c.endedAt = clock.now();
    c.natural = c.endedAt - c.t0 >= planned - 1;
    if (!vivid && cel === c) cel = null;   // nothing ran: nothing for a tap to skip
    return ev;
  }

  const stop = (): boolean => {
    if (phase !== "spin" || !round || !live) return false;
    round.ctl({ stopPressed: true });
    if (hurried) return true;
    hurried = true;
    const l = live;
    l.at = hurrySchedule(l.at, l.landed, clock.now(), l.t0);
    l.anticRun?.skip();
    try { ui.retime(l.at, true); } catch { /* ignore */ }
    emit();
    wakeUp();
    return true;
  };

  function cancelAuto(): void {
    if (auto === 0) return;
    autoToken++;
    auto = 0;
    emit();
  }

  async function startAuto(n: number): Promise<void> {
    if (disposed || auto > 0 || phase !== "idle" || !(n > 0)) return;
    const my = ++autoToken;
    auto = Math.floor(n);
    emit();
    while (my === autoToken && auto > 0 && !disposed) {
      if (!wallet.canBet(STEPS[betIndex])) { cancelAuto(); short(); break; }
      auto--;
      emit();
      const ev = await run({ auto: true });
      if (!ev) { if (my === autoToken) cancelAuto(); break; }
      if (my !== autoToken || disposed) break;
      await fx.idle();
      if (my !== autoToken || disposed || auto === 0) break;
      await clock.wait(turbo ? AUTO_GAP_TURBO_MS : AUTO_GAP_MS);
    }
    if (my === autoToken && auto !== 0) { auto = 0; emit(); }
  }

  const core: SlotCore = {
    get state() { return state(); },
    cfg,
    spin: (o = {}) => run({ gesture: o.gesture }),
    stop,
    press(gesture = "tap") {
      if (auto > 0) { cancelAuto(); return; }
      if (phase === "spin") { stop(); return; }
      void run({ gesture });
    },
    setBet(i) {
      if (phase !== "idle" || auto > 0) return;
      const n = Math.max(0, Math.min(STEPS.length - 1, Math.floor(i)));
      if (n === betIndex) return;
      betIndex = n;
      ctx.store.set(STORE_BET, n);
      emit();
    },
    setTurbo(on) {
      if (turbo === on) return;
      turbo = on;
      ctx.store.set(STORE_TURBO, on);
      emit();
    },
    startAuto,
    cancelAuto,
    canLeave() {
      cancelAuto();
      return phase === "idle";
    },
    suspend() { cancelAuto(); },
    dispose() {
      if (disposed) return;
      cancelAuto();
      disposed = true;
      if (cel && !cel.ended) cel.run.skip();
      live?.anticRun?.skip();
      fx.sfx.loop("spin", false);
      // A round in flight already has its outcome: settle it as is (no celebration), so the session never keeps a dangling round.
      const r = round, l = live;
      if (r && l) {
        wakeUp();
        const disp: Record<string, unknown> = { tier: l.plan.tier };
        const ev = r.settle({ payout: l.plan.payout, out: { stops: l.plan.stops, mult: l.plan.payout / l.plan.lineBet }, dec: { lineBet: l.plan.lineBet }, disp });
        round = null;
        live = null;
        phase = "idle";
        for (const cb of [...settleSubs]) cb(ev);
      }
    },
    onSettle(cb) { settleSubs.add(cb); return () => { settleSubs.delete(cb); }; },
  };
  emit();
  return core;
}
