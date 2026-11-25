/**
 * ABYSS LEGEND round logic (ARCHITECTURE §3, §6.1, §8). No DOM, no wall clock, no Math.random: time is
 * `ctx.clock`, randomness is `Round.res` (outcome) and `Round.pre` (presentation) only.
 *
 * Order inside a round: begin (debit) → the queue state is read from the store (a session flush may have
 * emptied it since the last round) → outcome from `res` (`oceanSpin`: reels, queue head, trigger) →
 * presentation from `pre` (decided after the outcome) → creature crossing (if the queue head reaches its omen)
 * → reels stop → state stored, settle (credit, Ev) → celebration and ticket printing.
 * Nothing the player does (STOP, turbo, swipe, bet changes, leaving) and nothing fx does can change an outcome:
 * every bonus amount is fixed in credits when it is triggered and lives in the session store.
 *
 * The reels reuse the slot's pure helpers (schedules, window, display band) with `OCEAN.slot`.
 * The screen is an `OceanUi` port: the DOM view implements it, `headlessUi()` is the no-op of the harness.
 */
import { BET_STEPS, MIN_BET, MIN_BET_GLOBAL, tierOf, type Tier } from "../../../shared/config";
import { OCEAN, oceanInit, oceanPresentation, oceanSpin, type Omen, type OceanResult, type OceanState } from "../../../shared/rules/ocean";
import { slotPresentation, type Sym } from "../../../shared/rules/slot";
import type { Ev } from "../../../shared/schema";
import { planCelebration } from "../../fx/tiers";
import type { FxRun } from "../../fx/types";
import { OCEAN_STATE_KEY } from "../../src/session";
import type { GameCtx, Round } from "../../src/types";
import { anticSchedule, hurrySchedule, makeTape, stopSchedule, windowCells, type SpinPlan } from "../slot/core";

export const REELS = 5;
export const LINES = 20;
export const STEPS: readonly number[] = BET_STEPS.ocean;
export const SETTLE_MS = 160;
export const SWALLOW_MS = 450;

/** The session's queue state (ARCHITECTURE §6.2); the runtime flushes the same key at cash-out / bust. */
export const STORE_STATE = OCEAN_STATE_KEY;
export const STORE_BET = "ocean.bet";
export const STORE_TURBO = "ocean.turbo";
export const STORE_LAST = "ocean.last";

/** Creature crossing per grade (ARCHITECTURE §3): length, dim depth, sound grade. */
export const OMEN_MS: Readonly<Record<Omen, number>> = { clam: 1800, shark: 2400, whale: 4000 };
export const OMEN_DIM: Readonly<Record<Omen, number>> = { clam: 0.3, shark: 0.55, whale: 0.75 };
export const OMEN_GRADE: Readonly<Record<Omen, 1 | 2 | 3>> = { clam: 1, shark: 2, whale: 3 };
/** Bubbles the decoration layer releases behind the creature. */
export const OMEN_BUBBLES: Readonly<Record<Omen, number>> = { clam: 40, shark: 70, whale: 140 };
export const OMEN_HAPTIC: Readonly<Record<Omen, readonly number[]>> = { clam: [40], shark: [70, 110, 70], whale: [260, 120, 180] };
/** The first reel comes to rest this long after the creature has left the screen. */
export const OMEN_TAIL_MS = 260;
/** One ticket coming out of the printer. */
export const TICKET_MS = 380;

export type Phase = "idle" | "spin";

export interface OceanPlan extends SpinPlan {
  basePay: number;
  seqPay: number;
  /** Creature shown this round (presentation layer on only). */
  omen?: Omen;
  /** 1-based chunk number of a released sequence (0 = nothing released this round). */
  chain: number;
  /** Tickets to print (0 = none; presentation layer on only). */
  tickets: number;
  /** First ticket serial (0..999999). */
  serial: number;
}

export interface OceanViewState {
  phase: Phase;
  betIndex: number;
  bet: number;
  turbo: boolean;
  /** STOP was pressed in this spin. */
  hurried: boolean;
  /** Bonus lamp: the queue head is paying out (its creature has been shown). Presentation layer on only. */
  lamp: boolean;
}

/** Screen port. Element handles go to fx only (fakes in headless). Every method must be cheap and must not throw. */
export interface OceanUi {
  readonly winEl: HTMLElement;
  readonly reelsEl: HTMLElement;
  readonly screenEl: HTMLElement;
  readonly outletEl: HTMLElement;
  render(s: OceanViewState): void;
  /** Reels start; `at[i]` = clock time at which reel i must be at rest. */
  spinStart(plan: OceanPlan, at: readonly number[]): void;
  retime(at: readonly number[], snap: boolean): void;
  reelStop(reel: number): void;
  antic(fromReel: number): void;
  /** The screen darkens and the creature crosses for `ms`. */
  omen(kind: Omen, ms: number): void;
  /** Spin over: win lines, BONUS overlay of a released chunk. */
  result(plan: OceanPlan): void;
  /** Ticket `i` (0-based) of the round comes out of the printer; `instant` = no feed animation (skipped). */
  ticket(i: number, serial: number, instant: boolean): void;
  /** Tickets of the last round are torn off (next spin). */
  clearTickets(): void;
  short(kind: "lowered" | "sheet"): void;
}

export interface OceanCore {
  readonly state: OceanViewState;
  spin(o?: { gesture?: "tap" | "swipe" }): Promise<Ev | null>;
  stop(): boolean;
  /** START: spin when idle, STOP while turning. */
  press(gesture?: "tap" | "swipe"): void;
  setBet(index: number): void;
  /** BET button: next step (wraps around). */
  cycleBet(): void;
  setTurbo(on: boolean): void;
  canLeave(): boolean;
  suspend(): void;
  dispose(): void;
  onSettle(cb: (ev: Ev) => void): () => void;
}

// ------------------------------------------------------------------------------------------- pure parts

/** Queue state for round `n` (1-based): the stored state, or a fresh one. The round label follows the session. */
export function stateFor(stored: OceanState | undefined, n: number): OceanState {
  const st = stored && Array.isArray(stored.queue) ? stored : oceanInit();
  return st.round === n - 1 ? st : { ...st, round: n - 1 };
}

/** Rest times for a round: the normal schedule, pushed back so the reels land after the creature has gone. */
export function oceanSchedule(o: { turbo: boolean; quick: boolean; omenMs: number }): number[] {
  const base = stopSchedule({ turbo: o.turbo, quick: o.quick });
  if (!(o.omenMs > 0)) return base;
  const shift = Math.max(0, o.omenMs + OMEN_TAIL_MS - base[0]);
  return base.map((ms) => ms + shift);
}

/**
 * Player-side record of the round (ARCHITECTURE §8.3): a release → `{bonusSeqId, releasedFromSeq, queued: left in
 * that sequence}`; a trigger → `{bonusSeqId, queued: total}`. When one round does both, the trigger goes to `trig`.
 */
export function decOf(r: OceanResult): Record<string, unknown> | undefined {
  const dec: Record<string, unknown> = {};
  if (r.released) Object.assign(dec, { bonusSeqId: r.released.seqId, releasedFromSeq: true, queued: r.released.remaining });
  if (r.triggered) {
    const t = { bonusSeqId: r.triggered.id, queued: r.triggered.total };
    if (r.released) dec.trig = t; else Object.assign(dec, t);
  }
  return Object.keys(dec).length ? dec : undefined;
}

/** Outcome facts of the round (`Ev.out`). */
export function outOf(r: OceanResult): Record<string, unknown> {
  const out: Record<string, unknown> = { stops: r.stops, mult: r.mult, basePay: r.basePay, seqPay: r.seqPay };
  if (r.omen) out.omen = r.omen;
  return out;
}

/** Highest bet step index the balance covers (-1: none). */
export function affordableIndex(balance: number, upTo: number): number {
  for (let i = Math.min(upTo, STEPS.length - 1); i >= 0; i--) if (STEPS[i] <= balance) return i;
  return -1;
}

/** Lamp: the head sequence is paying out (its omen came). */
export const lampOf = (st: OceanState | undefined): boolean => !!st && st.queue.length > 0 && st.queue[0].wait === -1;

const noop = (): void => undefined;
const fakeEl = (): HTMLElement => ({ textContent: "" }) as unknown as HTMLElement;

export function headlessUi(): OceanUi {
  return {
    winEl: fakeEl(), reelsEl: fakeEl(), screenEl: fakeEl(), outletEl: fakeEl(),
    render: noop, spinStart: noop, retime: noop, reelStop: noop, antic: noop, omen: noop, result: noop,
    ticket: noop, clearTickets: noop, short: noop,
  };
}

// ------------------------------------------------------------------------------------------- the core

export function createOceanCore(ctx: GameCtx, ui: OceanUi): OceanCore {
  const { clock, fx, wallet, store } = ctx;
  const cfg = OCEAN.slot;
  // The one place the core looks at the fx mode: creature, tickets, bonus lamp, display variation, build-up
  // and celebration are presentation and are neither shown nor recorded without the presentation layer.
  // Outcomes never read this.
  const vivid = fx.enabled;

  const storedBet = store.get<number>(STORE_BET);
  let betIndex = typeof storedBet === "number" && storedBet >= 0 && storedBet < STEPS.length ? storedBet : 0;
  let turbo = store.get<boolean>(STORE_TURBO) === true;
  let phase: Phase = "idle";
  let disposed = false;
  let hurried = false;

  let round: Round | null = null;
  let live: {
    plan: OceanPlan; res: OceanResult; next: OceanState; t0: number; at: number[]; base: number[]; omenEnd: number;
    landed: number; wake: (() => void) | null; anticRun: FxRun | null; anticShown: boolean;
    dispVar?: { cells: [number, "a" | "b"][] };
  } | null = null;
  let cel: { run: FxRun | null; tier: Tier; t0: number; planned: number; endedAt: number; natural: boolean; ended: boolean; skipTickets: () => void } | null = null;
  const settleSubs = new Set<(ev: Ev) => void>();

  const lamp = (): boolean => vivid && lampOf(store.get<OceanState>(STORE_STATE));
  const state = (): OceanViewState => ({ phase, betIndex, bet: STEPS[betIndex], turbo, hurried, lamp: lamp() });
  const emit = (): void => { try { ui.render(state()); } catch { /* the screen must never break a round */ } };

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

  /**
   * A tap that just skipped (or now skips) a NICE+ celebration is used up by that (tickets only come with BIG+).
   * A small win's celebration is simply cut short by the next spin.
   */
  const swallowTap = (): boolean => {
    if (!cel) return false;
    const c = cel;
    cel = null;
    if (!c.ended) {
      c.run?.skip();
      c.skipTickets();
      return c.tier >= 1;
    }
    return c.tier >= 1 && !c.natural && clock.now() - c.endedAt < SWALLOW_MS;
  };

  const short = (): void => {
    const lower = affordableIndex(wallet.balance, betIndex - 1);
    if (lower >= 0 && lower < betIndex) {
      betIndex = lower;
      store.set(STORE_BET, betIndex);
      ui.short("lowered");
    } else if (wallet.balance >= MIN_BET_GLOBAL && wallet.balance < MIN_BET.ocean) {
      ui.short("sheet");
    }
    emit();
  };

  async function run(o: { gesture?: "tap" | "swipe" }): Promise<Ev | null> {
    if (disposed || phase !== "idle") return null;
    if (swallowTap()) return null;
    cel = null;
    const bet = STEPS[betIndex];
    if (!wallet.canBet(bet)) { short(); return null; }

    const ctl: NonNullable<Ev["ctl"]> = { gesture: o.gesture ?? "tap" };
    if (turbo) ctl.turbo = true;
    let r: Round;
    try { r = ctx.rounds.begin({ bet, ctl }); } catch { return null; }
    round = r;
    phase = "spin";
    hurried = false;
    try { ui.clearTickets(); } catch { /* ignore */ }

    // ---- outcome (result stream): the queue is re-read every round (a session flush may have emptied it)
    const st0 = stateFor(store.get<OceanState>(STORE_STATE), r.n);
    const { state: next, result: res } = oceanSpin(OCEAN, st0, r.res, bet);
    // ---- presentation (presentation stream, decided after the outcome)
    const sp = vivid ? slotPresentation(cfg, res, r.pre) : {};
    const op = vivid ? oceanPresentation(res, bet, r.pre) : {};
    const tape = makeTape(cfg, r.pre);
    const head = st0.queue[0];
    const plan: OceanPlan = {
      n: r.n, bet, lineBet: bet / LINES, stops: res.stops, cells: windowCells(cfg, res.stops, sp.dispVar) as Sym[][], tape,
      wins: res.wins, payout: res.payout, tier: tierOf(res.payout, bet), antic: sp.antic ?? 0, turbo, quick: !vivid,
      basePay: res.basePay, seqPay: res.seqPay, chain: res.released && head ? head.next + 1 : 0,
      tickets: op.ticket ?? 0, serial: op.serial ?? 0,
      ...(op.omen ? { omen: op.omen } : {}),
    };

    const omenMs = plan.omen ? OMEN_MS[plan.omen] : 0;
    const t0 = clock.now();
    const base = oceanSchedule({ turbo, quick: !vivid, omenMs });
    const at = base.map((ms) => t0 + ms);
    live = { plan, res, next, t0, at, base, omenEnd: t0 + omenMs, landed: 0, wake: null, anticRun: null, anticShown: false, dispVar: sp.dispVar };
    const l = live;
    emit();
    try { ui.spinStart(plan, at); } catch { /* ignore */ }
    const pitch0 = turbo ? 1.3 : 1;
    if (plan.omen) {
      const kind = plan.omen;
      try { ui.omen(kind, omenMs); } catch { /* ignore */ }
      fx.sfx.play("omen", { k: 0.95, pitch: OMEN_GRADE[kind] });
      fx.haptics.pulse([...OMEN_HAPTIC[kind]]);
      void fx.particles("bubbles", { k: OMEN_BUBBLES[kind], at: ui.screenEl, ms: omenMs });
      fx.sfx.loop("spin", true, { pitch: pitch0 * 0.55 });
    } else fx.sfx.loop("spin", true, { pitch: pitch0 });

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
    if (!disposed && l.omenEnd > clock.now()) await waitUntil(() => l.omenEnd);
    if (!disposed && !plan.quick) await clock.wait(SETTLE_MS);
    return finish(r);
  }

  /** Stores the queue and settles the round (also used by dispose: the outcome is already fixed). */
  function settle(r: Round, l: NonNullable<typeof live>, shown: boolean): Ev {
    const { plan, res } = l;
    const disp: Record<string, unknown> = { tier: plan.tier };
    if (shown) {
      if (vivid && plan.payout > 0) disp.celebrate = true;
      if (l.dispVar) disp.dispVar = l.dispVar;
      if (l.anticShown) disp.antic = plan.antic;
      if (plan.tickets > 0) disp.ticket = plan.tickets;
    }
    if (plan.omen) disp.omen = plan.omen;   // the creature crossed at the start of the spin
    // The queue goes to the store before settle, so the runtime's snapshot of this settlement includes it.
    store.set(STORE_STATE, l.next);
    store.set(STORE_LAST, plan.stops);
    const dec = decOf(res);
    const ev = r.settle({ payout: plan.payout, out: outOf(res), ...(dec ? { dec } : {}), disp });
    round = null;
    live = null;
    phase = "idle";
    hurried = false;
    return ev;
  }

  async function finish(r: Round): Promise<Ev | null> {
    if (round !== r || !live) return null;   // already settled by dispose
    const l = live;
    const plan = l.plan;
    const ev = settle(r, l, true);
    if (!disposed) {
      try { ui.result(plan); } catch { /* ignore */ }
      emit();
    }
    for (const cb of [...settleSubs]) cb(ev);
    if (disposed || plan.payout <= 0) return ev;

    const t0 = clock.now();
    const runCel = fx.celebrate({ amount: plan.payout, bet: plan.bet, target: ui.winEl, anchor: ui.reelsEl });
    const planned = planCelebration(plan.payout, plan.bet)?.totalMs ?? 0;
    // Tickets come out of the printer one by one while the celebration runs; a tap prints the rest at once.
    let fast = false;
    const c = {
      run: vivid ? runCel : null, tier: plan.tier, t0, planned, endedAt: 0, natural: false, ended: false,
      skipTickets: () => { fast = true; },
    };
    cel = c;
    const printing = (async () => {
      if (plan.tickets <= 0) return;
      void fx.particles("tickets", { k: plan.tickets * 4, at: ui.outletEl, ms: plan.tickets * TICKET_MS + 1200 });
      for (let i = 0; i < plan.tickets; i++) {
        if (disposed) return;
        try { ui.ticket(i, (plan.serial + i) % 1_000_000, fast); } catch { /* ignore */ }
        if (fast) continue;
        fx.sfx.play("ticket", { k: 0.6, pitch: 1 + 0.03 * (i % 4) });
        await clock.wait(TICKET_MS);
      }
    })();
    await Promise.all([runCel.done, printing]);
    c.ended = true;
    c.endedAt = clock.now();
    c.natural = !fast && c.endedAt - c.t0 >= planned - 1;
    if (!vivid && cel === c) cel = null;
    return ev;
  }

  const stop = (): boolean => {
    if (phase !== "spin" || !round || !live) return false;
    round.ctl({ stopPressed: true });
    if (hurried) return true;
    hurried = true;
    const l = live;
    // STOP shortens the reels' landing; the creature (already decided and under way) finishes its crossing.
    l.at = hurrySchedule(l.at, l.landed, Math.max(clock.now(), l.omenEnd), l.t0);
    l.anticRun?.skip();
    try { ui.retime(l.at, true); } catch { /* ignore */ }
    emit();
    wakeUp();
    return true;
  };

  const setBet = (i: number): void => {
    if (phase !== "idle") return;
    const n = Math.max(0, Math.min(STEPS.length - 1, Math.floor(i)));
    if (n === betIndex) return;
    betIndex = n;
    store.set(STORE_BET, n);
    emit();
  };

  // A session flush (bust check) can empty the queue between rounds: keep the lamp honest.
  const offWallet = wallet.onChange(() => { if (phase === "idle" && !disposed) emit(); });

  const core: OceanCore = {
    get state() { return state(); },
    spin: (o = {}) => run({ gesture: o.gesture }),
    stop,
    press(gesture = "tap") {
      if (phase === "spin") { stop(); return; }
      void run({ gesture });
    },
    setBet,
    cycleBet() { setBet((betIndex + 1) % STEPS.length); },
    setTurbo(on) {
      if (turbo === on) return;
      turbo = on;
      store.set(STORE_TURBO, on);
      emit();
    },
    canLeave: () => phase === "idle",
    suspend() { /* no auto play to cancel; the clock pauses the round */ },
    dispose() {
      if (disposed) return;
      disposed = true;
      offWallet();
      if (cel && !cel.ended) { cel.run?.skip(); cel.skipTickets(); }
      live?.anticRun?.skip();
      fx.sfx.loop("spin", false);
      const r = round, l = live;
      if (r && l) {
        wakeUp();
        const ev = settle(r, l, false);
        for (const cb of [...settleSubs]) cb(ev);
      }
    },
    onSettle(cb) { settleSubs.add(cb); return () => { settleSubs.delete(cb); }; },
  };
  emit();
  return core;
}
