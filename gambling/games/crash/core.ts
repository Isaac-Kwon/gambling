/**
 * SKYROCKET round logic (ARCHITECTURE §6.1, §9.3). No DOM, no wall clock, no Math.random:
 * time is `ctx.clock`, randomness is `Round.res` (the crash point) and `Round.pre` (the crowd) only.
 *
 * Order inside a round: countdown (3 s, nothing is debited yet) -> begin (debit) -> crash point from `res`
 * BEFORE the climb -> presentation from `pre` (decided after the outcome) -> the multiplier climbs on the
 * clock -> a manual tap / the auto target settles the round on the spot (resolved from the tap's clock time)
 * or the crash settles it with payout 0 -> the graph still runs to the crash point (a tap skips ahead).
 * Nothing the player does after the round is drawn and nothing fx does can change the outcome: the result is
 * a function of (crash, target, tap time) only (`resolveCrashCashout`).
 *
 * The screen is a `CrashUi` port: the DOM view implements it, `headlessUi()` is the no-op used by the harness.
 */
import { MIN_BET_GLOBAL, tierOf } from "../../../shared/config";
import type { Rng } from "../../../shared/rng";
import {
  CRASH, crashPoint, isValidCrashBet, isValidCrashTarget, multAt, resolveCrashCashout, settleCrash, timeOf,
} from "../../../shared/rules/crash";
import type { Ev } from "../../../shared/schema";
import type { FxRun } from "../../fx/types";
import type { GameCtx, Round } from "../../src/types";

export const BET_STEP = 100;
export const BET_MIN = 100;
export const BET_MAX = 100_000;
export const DEFAULT_TARGET = 2;
/** Flight bookkeeping granularity (fx build-up refresh, tick hooks). The screen animates on its own frames. */
export const STEP_MS = 100;
/** Build-up lifetime refreshed on every step (fx `rise` extends one record). */
export const RISE_MS = 400;
/** A press that lands this soon after the crash is used up by the player's own CASH OUT mashing. */
export const SWALLOW_MS = 350;
export const HIST_LEN = 20;
export const CROWD_MIN = 12;
export const CROWD_MAX = 18;
const EPS = 1e-6;

export const STORE_BET = "crash.bet";
export const STORE_TARGET = "crash.target";
export const STORE_AUTO = "crash.auto";
export const STORE_HIST = "crash.hist";

export type Phase = "idle" | "countdown" | "flight";

export interface CrowdPlayer {
  name: string;
  bet: number;
  /** Multiplier at which this player gets out (shown once the climb passes it); null = rides it into the crash. */
  cashAt: number | null;
}

export interface FlightPlan {
  n: number;
  bet: number;
  /** Effective auto cash-out multiplier (null = none). */
  target: number | null;
  crash: number;
  /** Climb length (ms) until the crash. */
  crashMs: number;
  /** When the auto target is reached (ms into the climb); null if there is none or it lies beyond the crash. */
  targetMs: number | null;
  crowd: CrowdPlayer[];
}

export interface CrashState {
  phase: Phase;
  bet: number;
  /** Target value shown in the input (always valid). */
  target: number;
  /** Whether the auto cash-out is armed. */
  auto: boolean;
  /** This round has been cashed out (settled with a win). */
  cashed: boolean;
  /** Multiplier the round was cashed out at. */
  cashedAt: number | null;
}

export interface CashInfo { cashoutAt: number; payout: number; manual: boolean }

/** Screen port. Element handles go to fx only (fakes in headless). Every method must be cheap and must not throw. */
export interface CrashUi {
  /** Anchor at the rocket's tail: fx draws the exhaust here and tunes the rising tone. */
  readonly rocketEl: HTMLElement;
  /** Target of the win celebration. */
  readonly winEl: HTMLElement;
  render(s: CrashState): void;
  /** Countdown runs from clock time `from` to `to`. */
  countdown(from: number, to: number): void;
  /** Countdown cancelled. */
  countdownStop(): void;
  /** The climb starts at clock time `t0`. */
  flightStart(plan: FlightPlan, t0: number): void;
  cashed(info: CashInfo): void;
  /** The climb is over: show the crash point (`skipped` = the player tapped through the rest of the climb). */
  crashed(crash: number, skipped: boolean): void;
  history(list: readonly number[]): void;
  /** Not enough credits: "lowered" = the bet was stepped down; "sheet" = not even the minimum bet. */
  short(kind: "lowered" | "sheet"): void;
}

export interface CrashCore {
  readonly state: CrashState;
  /** Starts a round: countdown, climb, settlement. Resolves with the settled Ev after the climb (null when no round ran). */
  start(o?: { gesture?: "tap" }): Promise<Ev | null>;
  /** Manual cash-out, resolved from this call's clock time. Returns true when it paid. */
  cashout(): boolean;
  /** Tap through the rest of the climb of an already settled round. */
  skip(): boolean;
  /** Primary button: bet when idle, cancel in the countdown, cash out in flight, skip once cashed out. */
  press(): void;
  setBet(bet: number): void;
  setTarget(target: number): void;
  setAuto(on: boolean): void;
  canLeave(): boolean;
  suspend(): void;
  dispose(): void;
  /** Test hook: called on every flight step with the ms elapsed since the climb began. */
  onTick(cb: (elapsedMs: number) => void): () => void;
  /** Test hook: called after each settlement. */
  onSettle(cb: (ev: Ev) => void): () => void;
}

// ------------------------------------------------------------------------------------------- pure parts

/** Highest multiple of 100 the balance covers (0 = none). */
export function affordableBet(balance: number, upTo = BET_MAX): number {
  return Math.max(0, Math.min(Math.floor(balance / BET_STEP) * BET_STEP, upTo));
}

export function normBet(v: number): number {
  const n = Math.round((Number.isFinite(v) ? v : BET_MIN) / BET_STEP) * BET_STEP;
  return Math.max(BET_MIN, Math.min(BET_MAX, n));
}

export function normTarget(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_TARGET;
  const n = Math.round(Math.max(CRASH.minTarget, Math.min(CRASH.maxTarget, v)) * 100) / 100;
  return isValidCrashTarget(n) ? n : DEFAULT_TARGET;
}

/** Step of the target input at value `v` (0.10 below 10, 1 below 100, 10 above). */
export function targetStep(v: number): number {
  return v < 10 ? 0.1 : v < 100 ? 1 : 10;
}

const NICK_A = ["Neo", "Luna", "Kai", "Mimi", "Jett", "Sora", "Pico", "Zed", "Rina", "Bolt", "Hana", "Max", "Yuki", "Nova", "Dex", "Vivi", "Remy", "Coco", "Ace", "Milo", "Juno", "Riko", "Taro", "Pip"];
const NICK_B = ["_k", "99", "x", "_77", "42", "_jp", "star", "_01", "jr", "88", "_z", "07", "fly", "_g", "21", "pro"];
const CROWD_BETS = [100, 100, 200, 200, 300, 500, 500, 1000, 1000, 2000, 5000] as const;

/**
 * The people on the board (presentation stream). Decided after the crash point is known: whoever's own exit
 * lies at or below it gets out as the climb passes it, the rest ride it into the crash.
 */
export function makeCrowd(pre: Rng, crash: number): CrowdPlayer[] {
  const n = CROWD_MIN + pre.int(CROWD_MAX - CROWD_MIN + 1);
  const used = new Set<string>();
  const out: CrowdPlayer[] = [];
  for (let i = 0; i < n; i++) {
    let name = "";
    for (let tries = 0; tries < 8; tries++) {
      name = NICK_A[pre.int(NICK_A.length)] + NICK_B[pre.int(NICK_B.length)];
      if (!used.has(name)) break;
    }
    used.add(name);
    const bet = CROWD_BETS[pre.int(CROWD_BETS.length)];
    // Intended exit: mostly early, a long tail; 2-decimal.
    const u = pre.float();
    const plan = Math.min(80, Math.round((1.08 + -Math.log(1 - u * 0.999) * 1.15) * 100) / 100);
    out.push({ name, bet, cashAt: plan <= crash ? plan : null });
  }
  out.sort((a, b) => b.bet - a.bet);
  return out;
}

/** Pushes `crash` onto the recent-crash list (newest first, at most HIST_LEN). */
export function pushHistory(list: readonly number[], crash: number): number[] {
  return [crash, ...list].slice(0, HIST_LEN);
}

const noop = (): void => undefined;
const fakeEl = (): HTMLElement => ({ textContent: "" }) as unknown as HTMLElement;

/** No-op screen for node (harness, tests). */
export function headlessUi(): CrashUi {
  return {
    rocketEl: fakeEl(), winEl: fakeEl(),
    render: noop, countdown: noop, countdownStop: noop, flightStart: noop, cashed: noop, crashed: noop, history: noop, short: noop,
  };
}

// ------------------------------------------------------------------------------------------- the core

export function createCrashCore(ctx: GameCtx, ui: CrashUi): CrashCore {
  const { clock, fx, wallet } = ctx;
  // The one place the core looks at the fx mode: the crowd and the celebration are presentation and are
  // neither shown nor recorded without the presentation layer (§5.3, §6.5). Outcomes never read this.
  const vivid = fx.enabled;

  const storedBet = ctx.store.get<number>(STORE_BET);
  const storedTarget = ctx.store.get<number>(STORE_TARGET);
  let bet = typeof storedBet === "number" && isValidCrashBet(storedBet) && storedBet <= BET_MAX ? storedBet : BET_MIN;
  let target = typeof storedTarget === "number" && isValidCrashTarget(storedTarget) ? storedTarget : DEFAULT_TARGET;
  let auto = ctx.store.get<boolean>(STORE_AUTO) === true;
  let hist = (ctx.store.get<number[]>(STORE_HIST) ?? []).filter((x) => typeof x === "number").slice(0, HIST_LEN);

  let phase: Phase = "idle";
  let disposed = false;
  let cancelled = false;
  let wake: (() => void) | null = null;
  let endedAt = -Infinity;

  // live round
  let round: Round | null = null;
  let live: {
    plan: FlightPlan; t0: number; settled: boolean; cashedAt: number | null; skipped: boolean;
    ev: Ev | null; rise: FxRun | null; cel: FxRun | null; tapSec: number | null; histDone: boolean;
  } | null = null;
  const settleSubs = new Set<(ev: Ev) => void>();
  const tickSubs = new Set<(ms: number) => void>();

  const state = (): CrashState => ({ phase, bet, target, auto, cashed: phase === "flight" && !!live?.cashedAt, cashedAt: live?.cashedAt ?? null });
  const emit = (): void => { try { ui.render(state()); } catch { /* the screen must never break a round */ } };
  const safe = (f: () => void): void => { try { f(); } catch { /* ignore */ } };

  /** Waits until clock time `at`; returns early on wake (cancel, skip, dispose). */
  const waitTo = async (at: number): Promise<void> => {
    const d = at - clock.now();
    if (d <= EPS) return;
    await Promise.race([clock.wait(d), new Promise<void>((r) => { wake = r; })]);
    wake = null;
  };
  const wakeUp = (): void => { const w = wake; if (w) { wake = null; w(); } };

  const short = (): void => {
    const lower = affordableBet(wallet.balance, bet);
    if (lower >= BET_MIN && lower < bet) {
      bet = lower;
      ctx.store.set(STORE_BET, bet);
      safe(() => ui.short("lowered"));
    } else if (wallet.balance >= MIN_BET_GLOBAL && wallet.balance < BET_MIN) {
      safe(() => ui.short("sheet"));
    }
    emit();
  };

  /** Settles the live round (once). `cashoutAt` null = it crashed. */
  function settleRound(cashoutAt: number | null, manualAt: number | null): Ev | null {
    const r = round, l = live;
    if (!r || !l || l.settled) return l?.ev ?? null;
    l.settled = true;
    const p = l.plan;
    const payout = settleCrash(p.bet, p.crash, cashoutAt);
    const disp: Record<string, unknown> = { tier: tierOf(payout, p.bet) };
    if (vivid) disp.crowd = p.crowd.length;
    if (vivid && payout > 0) disp.celebrate = true;
    const ev = r.settle({
      payout,
      out: { crash: p.crash, cashoutAt },
      dec: { target: p.target, manualCashoutAt: manualAt },
      disp,
    });
    l.ev = ev;
    l.cashedAt = payout > 0 ? cashoutAt : null;
    if (payout > 0) {
      l.cashedAt = cashoutAt;
      emit();
      if (!disposed) {
        safe(() => ui.cashed({ cashoutAt: cashoutAt!, payout, manual: manualAt !== null }));
        l.cel = fx.celebrate({ amount: payout, bet: p.bet, target: ui.winEl, anchor: ui.rocketEl });
      }
    }
    for (const cb of [...settleSubs]) cb(ev);
    return ev;
  }

  async function run(o: { gesture?: "tap" }): Promise<Ev | null> {
    if (disposed || phase !== "idle") return null;
    if (live?.cel) live.cel.skip();
    live = null;
    if (!wallet.canBet(bet)) { short(); return null; }

    // ---- countdown (nothing is debited; leaving or cancelling costs nothing)
    phase = "countdown";
    cancelled = false;
    const from = clock.now();
    const end = from + CRASH.countdownMs;
    emit();
    safe(() => ui.countdown(from, end));
    for (let s = Math.ceil(CRASH.countdownMs / 1000); s >= 1 && !cancelled && !disposed; s--) {
      fx.sfx.play("tick", { k: 0.35, pitch: 1 + 0.12 * (3 - s) });
      await waitTo(end - (s - 1) * 1000);
    }
    if (cancelled || disposed) {
      phase = "idle";
      if (!disposed) { safe(() => ui.countdownStop()); emit(); }
      return null;
    }
    if (!wallet.canBet(bet)) { phase = "idle"; safe(() => ui.countdownStop()); short(); return null; }

    // ---- outcome (result stream) BEFORE the climb, then presentation (decided after the outcome)
    const eff = auto ? target : null;
    let r: Round;
    try { r = ctx.rounds.begin({ bet, ctl: { gesture: o.gesture ?? "tap" } }); } catch { phase = "idle"; safe(() => ui.countdownStop()); emit(); return null; }
    round = r;
    const crash = crashPoint(r.res);
    const crashMs = timeOf(crash) * 1000;
    const targetMs = eff !== null && eff <= crash ? timeOf(eff) * 1000 : null;
    const crowd = vivid ? makeCrowd(r.pre, crash) : [];
    const plan: FlightPlan = { n: r.n, bet, target: eff, crash, crashMs, targetMs, crowd };
    const t0 = clock.now();
    live = { plan, t0, settled: false, cashedAt: null, skipped: false, ev: null, rise: null, cel: null, tapSec: null, histDone: false };
    const l = live;
    phase = "flight";
    if (vivid) ctx.log.aux("crowd", { n: crowd.length, round: r.n, game: "crash" });
    emit();
    safe(() => ui.flightStart(plan, t0));

    // ---- the climb
    for (;;) {
      const el = clock.now() - t0;
      for (const cb of [...tickSubs]) cb(el);
      if (disposed) break;
      if (l.skipped && l.settled) break;
      if (!l.settled && targetMs !== null && el >= targetMs - EPS) settleRound(eff, null);
      if (el >= crashMs - EPS) break;
      l.rise = fx.antic({ el: ui.rocketEl, kind: "rise", k: Math.max(1, multAt(el / 1000)), ms: RISE_MS });
      const next = Math.min(el + STEP_MS, crashMs, !l.settled && targetMs !== null ? targetMs : Infinity);
      await waitTo(t0 + next);
    }
    l.rise?.skip();

    // ---- crash: a round nobody got out of ends here, quietly
    if (!l.settled && !disposed) settleRound(null, null);
    if (!l.histDone) { l.histDone = true; hist = pushHistory(hist, crash); ctx.store.set(STORE_HIST, hist); }
    const ev = l.ev;
    round = null;
    phase = "idle";
    endedAt = clock.now();
    if (!disposed) {
      safe(() => ui.history(hist));
      safe(() => ui.crashed(crash, l.skipped));
      emit();
    }
    // The celebration (if any) keeps running on its own: the next round skips it, `fx.idle()` covers it.
    return ev;
  }

  function cashout(): boolean {
    const l = live, r = round;
    if (phase !== "flight" || !l || !r || l.settled || disposed) return false;
    const tapSec = (clock.now() - l.t0) / 1000;
    const p = l.plan;
    const at = resolveCrashCashout(p.crash, p.target, tapSec);
    if (at === null) return false;   // the crash came first: the screen is about to show it
    // The tap counts as the player's own exit unless the auto target had already been reached.
    const manual = p.target === null || tapSec < timeOf(p.target) ? multAt(tapSec) : null;
    l.tapSec = tapSec;
    r.ctl({ gesture: "tap" });
    settleRound(at, manual);
    return true;
  }

  const core: CrashCore = {
    get state() { return state(); },
    start: (o = {}) => run(o),
    cashout,
    skip() {
      const l = live;
      if (phase !== "flight" || !l || !l.settled || l.skipped) return false;
      l.skipped = true;
      wakeUp();
      return true;
    },
    press() {
      if (phase === "idle") {
        if (clock.now() - endedAt >= SWALLOW_MS) void run({ gesture: "tap" });
        return;
      }
      if (phase === "countdown") { cancelled = true; wakeUp(); return; }
      if (live?.settled) core.skip(); else cashout();
    },
    setBet(v) {
      if (phase !== "idle") return;
      const n = normBet(v);
      if (n === bet) return;
      bet = n;
      ctx.store.set(STORE_BET, n);
      emit();
    },
    setTarget(v) {
      if (phase !== "idle") return;
      const n = normTarget(v);
      if (n === target) return;
      target = n;
      ctx.store.set(STORE_TARGET, n);
      emit();
    },
    setAuto(on) {
      if (phase !== "idle" || auto === on) return;
      auto = on;
      ctx.store.set(STORE_AUTO, on);
      emit();
    },
    /** Leaving is fine in the countdown (nothing debited, it is cancelled) and once the round is settled. */
    canLeave() {
      if (phase === "countdown") { cancelled = true; wakeUp(); return true; }
      return !(phase === "flight" && live && !live.settled);
    },
    suspend() { /* the clock is paused by the runtime: the climb simply stands still */ },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelled = true;
      live?.rise?.skip();
      if (live?.cel) live.cel.skip();
      // A round in flight already has its outcome: settle it as if no further tap came (auto target or crash).
      const l = live;
      if (round && l && !l.settled) {
        const p = l.plan;
        settleRound(resolveCrashCashout(p.crash, p.target, null), null);
      }
      if (l && !l.histDone && phase === "flight") { l.histDone = true; hist = pushHistory(hist, l.plan.crash); ctx.store.set(STORE_HIST, hist); }
      round = null;
      phase = "idle";
      wakeUp();
    },
    onTick(cb) { tickSubs.add(cb); return () => { tickSubs.delete(cb); }; },
    onSettle(cb) { settleSubs.add(cb); return () => { settleSubs.delete(cb); }; },
  };
  safe(() => ui.history(hist));
  emit();
  return core;
}
