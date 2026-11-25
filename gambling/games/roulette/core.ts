/**
 * RUBY ROULETTE round logic (ARCHITECTURE §6.1, §9.1). No DOM, no wall clock, no Math.random: time is `ctx.clock`,
 * randomness is `Round.res` (the number) and `Round.pre` (wheel/ball motion) only.
 *
 * Order inside a round: begin (the whole layout is debited here, not when chips are placed) → number from `res`
 * (`spinWheel`) → settlement from the rules engine (`settle`) → wheel motion from `pre` → the ball comes to rest →
 * settle (credit, Ev) → celebration by payout / total bet. A loss makes no sound and no effect.
 * Nothing the player does after the spin button and nothing fx does can change the number.
 *
 * The screen is a `RouletteUi` port: the DOM view implements it, `headlessUi()` is the no-op used by the harness.
 */
import { CHIPS, MIN_BET, MIN_BET_GLOBAL, tierOf, type Tier } from "../../../shared/config";
import {
  isValid, RED, settle as settleLayout, spinWheel, type Placed, type RouletteBet, type Settlement,
} from "../../../shared/rules/roulette";
import type { Ev } from "../../../shared/schema";
import { planCelebration } from "../../fx/tiers";
import type { FxRun } from "../../fx/types";
import type { GameCtx, Round } from "../../src/types";
import { DROP_END, type AnimSeed } from "./wheel";

export const CHIP_VALUES: readonly number[] = CHIPS.roulette;
export const TABLE_MAX = 10_000;
export const TABLE_MIN = MIN_BET.roulette;
export const HISTORY_LEN = 20;
/** Wheel animation: 6 s, turbo 2.5 s; without the presentation layer the number is shown after 150 ms (§6.5). */
export const SPIN_MS = 6000;
export const TURBO_MS = 2500;
export const QUICK_MS = 150;
/** Pause between the ball coming to rest and the payout. */
export const SETTLE_MS = 420;
/** A tap that skipped a celebration does not also start a spin when it lands within this window. */
export const SWALLOW_MS = 450;

export const STORE_CHIP = "roulette.chip";
export const STORE_TURBO = "roulette.turbo";
export const STORE_LAST = "roulette.last";
export const STORE_HIST = "roulette.hist";

export type Phase = "idle" | "spin";
export type Reject = "invalid" | "limit" | "table" | "funds" | "busy" | "empty";
export type Color = "green" | "red" | "black";

export const colorOf = (n: number): Color => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

// ------------------------------------------------------------------------------------------- pure parts

/** Per-bet limit (ARCHITECTURE §9.1). */
export function limitOf(b: RouletteBet): number {
  switch (b.kind) {
    case "straight": return 500;
    case "split": return 1000;
    case "dozen": case "column": return 2000;
    default: return 5000;
  }
}

/** Identity of a bet: the same key means the same spot on the table. */
export function betKey(b: RouletteBet): string {
  switch (b.kind) {
    case "straight": return `s${b.n}`;
    case "split": return `p${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`;
    case "dozen": case "column": return `${b.kind[0]}${b.i}`;
    default: return b.kind;
  }
}

export function normBet(b: RouletteBet): RouletteBet {
  if (b.kind === "split") return { kind: "split", a: Math.min(b.a, b.b), b: Math.max(b.a, b.b) };
  return { ...b } as RouletteBet;
}

export type LayoutCheck = { ok: true; total: number } | { ok: false; reason: Reject };

/** Is the layout one the table accepts (valid bets, per-bet limits, total ≤ TABLE_MAX)? */
export function checkLayout(placed: readonly Placed[]): LayoutCheck {
  const by = new Map<string, { b: RouletteBet; amt: number }>();
  let total = 0;
  for (const p of placed) {
    if (!p || !p.bet || !isValid(p.bet) || !Number.isInteger(p.amt) || p.amt <= 0) return { ok: false, reason: "invalid" };
    const k = betKey(p.bet);
    const cur = by.get(k) ?? { b: p.bet, amt: 0 };
    cur.amt += p.amt;
    by.set(k, cur);
    total += p.amt;
  }
  for (const { b, amt } of by.values()) if (amt > limitOf(b)) return { ok: false, reason: "limit" };
  if (total > TABLE_MAX) return { ok: false, reason: "table" };
  if (total <= 0) return { ok: false, reason: "empty" };
  return { ok: true, total };
}

export const layoutTotal = (placed: readonly Placed[]): number => placed.reduce((s, p) => s + p.amt, 0);

/** Same-colour streaks in a history (oldest first): runs of ≥ `min` reds or blacks. Zero ends a run. */
export function streaks(hist: readonly number[], min = 3): { from: number; to: number; color: "red" | "black"; len: number }[] {
  const out: { from: number; to: number; color: "red" | "black"; len: number }[] = [];
  let i = 0;
  while (i < hist.length) {
    const c = colorOf(hist[i]);
    let j = i;
    while (j + 1 < hist.length && colorOf(hist[j + 1]) === c) j++;
    if (c !== "green" && j - i + 1 >= min) out.push({ from: i, to: j, color: c, len: j - i + 1 });
    i = j + 1;
  }
  return out;
}

/** Hit zones of a number cell: where on the cell (fractions 0..1) a tap becomes a split with a neighbour. */
export const SPLIT_EDGE_X = 0.24;
export const SPLIT_EDGE_Y = 0.2;

/**
 * Tap on number cell `n` (1..36) at fraction (fx, fy) of the cell: a split with the neighbour when the tap is near a
 * shared edge, otherwise the number itself. The corner goes to the nearer edge.
 */
export function resolveNumberTap(n: number, fx: number, fy: number): RouletteBet {
  const col = (n - 1) % 3, row = Math.ceil(n / 3);
  const dx = fx < 0.5 ? fx : 1 - fx, dy = fy < 0.5 ? fy : 1 - fy;
  const nearX = dx < SPLIT_EDGE_X && (fx < 0.5 ? col > 0 : col < 2);
  const nearY = dy < SPLIT_EDGE_Y && (fy < 0.5 ? row >= 1 : row < 12);
  if (!nearX && !nearY) return { kind: "straight", n };
  const useX = nearX && (!nearY || dx / SPLIT_EDGE_X <= dy / SPLIT_EDGE_Y);
  if (useX) return normBet({ kind: "split", a: n, b: fx < 0.5 ? n - 1 : n + 1 });
  if (fy < 0.5) return row === 1 ? normBet({ kind: "split", a: 0, b: n }) : normBet({ kind: "split", a: n - 3, b: n });
  return normBet({ kind: "split", a: n, b: n + 3 });
}

/** Tap on the zero cell at horizontal fraction fx, vertical fy: the lower edge splits with 1, 2 or 3. */
export function resolveZeroTap(fx: number, fy: number): RouletteBet {
  if (fy > 1 - SPLIT_EDGE_Y * 1.25) return { kind: "split", a: 0, b: Math.min(3, Math.max(1, Math.floor(fx * 3) + 1)) };
  return { kind: "straight", n: 0 };
}

/** The chip to draw on a stack of `amt` credits: the largest chip value not above it. */
export function stackChip(amt: number): number {
  let v: number = CHIP_VALUES[0];
  for (const c of CHIP_VALUES) if (c <= amt) v = c;
  return v;
}

// ------------------------------------------------------------------------------------------- ports

export interface SpinPlan {
  n: number;
  /** Total stake of the layout. */
  bet: number;
  placed: Placed[];
  settlement: Settlement;
  payout: number;
  tier: Tier;
  durationMs: number;
  turbo: boolean;
  /** No wheel animation (presentation layer off). */
  quick: boolean;
  seed: AnimSeed;
  /** History after this round (oldest first, at most HISTORY_LEN). */
  board: number[];
}

export interface RouletteState {
  phase: Phase;
  chip: number;
  placed: Placed[];
  total: number;
  turbo: boolean;
  /** A layout from an earlier round that REBET can put back. */
  canRebet: boolean;
  canUndo: boolean;
  history: number[];
  /** Balance minus the chips on the table (what can still be placed). */
  free: number;
}

export interface RouletteUi {
  readonly winEl: HTMLElement;
  readonly wheelEl: HTMLElement;
  render(s: RouletteState): void;
  /** Wheel starts; the ball must be at rest on `plan.n` when `plan.durationMs` have passed on the clock. */
  spinStart(plan: SpinPlan, t0: number): void;
  /** The ball is at rest: show the number. */
  result(plan: SpinPlan): void;
  /** A chip could not be placed. */
  reject(why: Reject, bet?: RouletteBet): void;
  /** Not enough credits for the layout ("lowered" = the layout was reduced; "sheet" = not even the table minimum). */
  short(kind: "lowered" | "sheet"): void;
}

export interface RouletteCore {
  readonly state: RouletteState;
  place(bet: RouletteBet, amt?: number): { ok: true } | { ok: false; reason: Reject };
  /** Takes all chips of that spot back. */
  remove(bet: RouletteBet): boolean;
  undo(): boolean;
  clear(): boolean;
  rebet(): boolean;
  setChip(v: number): void;
  setTurbo(on: boolean): void;
  /** Starts the spin. Resolves with the settled Ev after the celebration (null when no round started). */
  spin(o?: { gesture?: "tap" | "swipe" }): Promise<Ev | null>;
  /** Leave intent (router): true when no round is in flight. */
  canLeave(): boolean;
  suspend(): void;
  /** Unmount: a round still in flight is settled with its (already fixed) outcome, no celebration. */
  dispose(): void;
  onSettle(cb: (ev: Ev) => void): () => void;
}

const noop = (): void => undefined;
const fakeEl = (): HTMLElement => ({ textContent: "" }) as unknown as HTMLElement;

/** No-op screen for node (harness, tests). */
export function headlessUi(): RouletteUi {
  return { winEl: fakeEl(), wheelEl: fakeEl(), render: noop, spinStart: noop, result: noop, reject: noop, short: noop };
}

// ------------------------------------------------------------------------------------------- the core

export function createRouletteCore(ctx: GameCtx, ui: RouletteUi): RouletteCore {
  const { clock, fx, wallet } = ctx;
  // The one place the core looks at the fx mode: the wheel animation and the celebration are presentation and are
  // neither shown nor recorded without the presentation layer (§5.3, §6.5). Outcomes never read this.
  const vivid = fx.enabled;

  const storedChip = ctx.store.get<number>(STORE_CHIP);
  let chip = typeof storedChip === "number" && CHIP_VALUES.includes(storedChip) ? storedChip : CHIP_VALUES[0];
  let turbo = ctx.store.get<boolean>(STORE_TURBO) === true;
  const storedHist = ctx.store.get<number[]>(STORE_HIST);
  let history: number[] = Array.isArray(storedHist) ? storedHist.filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).slice(-HISTORY_LEN) : [];
  const storedLast = ctx.store.get<Placed[]>(STORE_LAST);
  let last: Placed[] = Array.isArray(storedLast) && checkLayout(storedLast).ok ? storedLast.map(copy) : [];

  let phase: Phase = "idle";
  let placed: Placed[] = [];
  /** Chip placements in order (for UNDO): one entry per tap. */
  let moves: { key: string; amt: number }[] = [];
  let disposed = false;
  let round: Round | null = null;
  let live: { plan: SpinPlan } | null = null;
  let cel: { run: FxRun; tier: Tier; t0: number; planned: number; endedAt: number; natural: boolean; ended: boolean } | null = null;
  const settleSubs = new Set<(ev: Ev) => void>();

  function copy(p: Placed): Placed { return { bet: normBet(p.bet), amt: p.amt }; }
  const total = (): number => layoutTotal(placed);
  const state = (): RouletteState => ({
    phase, chip, placed: placed.map(copy), total: total(), turbo, canRebet: last.length > 0 && placed.length === 0,
    canUndo: moves.length > 0, history: [...history], free: wallet.balance - total(),
  });
  const emit = (): void => { try { ui.render(state()); } catch { /* the screen must never break a round */ } };
  const sfx = (name: "chip" | "tap", k = 0.6): void => { try { fx.sfx.play(name, { k }); } catch { /* ignore */ } };

  const swallowTap = (): boolean => {
    if (!cel || cel.tier < 1) return false;
    if (!cel.ended) { cel.run.skip(); cel = null; return true; }
    const recent = !cel.natural && clock.now() - cel.endedAt < SWALLOW_MS;
    cel = null;
    return recent;
  };

  function amountOn(key: string): number {
    let a = 0;
    for (const p of placed) if (betKey(p.bet) === key) a += p.amt;
    return a;
  }

  function place(bet: RouletteBet, amt: number = chip): { ok: true } | { ok: false; reason: Reject } {
    const fail = (reason: Reject): { ok: false; reason: Reject } => { try { ui.reject(reason, bet); } catch { /* ignore */ } return { ok: false, reason }; };
    if (disposed || phase !== "idle") return fail("busy");
    // A tap on the table after a celebration only skips the celebration, it does not drop a chip.
    if (swallowTap()) return { ok: false, reason: "busy" };
    if (cel && !cel.ended) cel.run.skip();
    cel = null;
    const b = normBet(bet);
    if (!isValid(b) || !Number.isInteger(amt) || amt <= 0) return fail("invalid");
    const key = betKey(b);
    if (amountOn(key) + amt > limitOf(b)) return fail("limit");
    if (total() + amt > TABLE_MAX) return fail("table");
    if (total() + amt > wallet.balance) return fail("funds");
    const at = placed.find((p) => betKey(p.bet) === key);
    if (at) at.amt += amt; else placed.push({ bet: b, amt });
    moves.push({ key, amt });
    sfx("chip");
    emit();
    return { ok: true };
  }

  function drop(key: string, amt: number): void {
    const i = placed.findIndex((p) => betKey(p.bet) === key);
    if (i < 0) return;
    placed[i].amt -= amt;
    if (placed[i].amt <= 0) placed.splice(i, 1);
  }

  /** Reduce the layout to what the balance covers: the latest chips go first. */
  function trimToBalance(): boolean {
    let cut = false;
    while (total() > wallet.balance && moves.length > 0) {
      const m = moves.pop()!;
      drop(m.key, m.amt);
      cut = true;
    }
    if (total() > wallet.balance) { placed = []; moves = []; cut = true; }
    return cut;
  }

  async function run(o: { gesture?: "tap" | "swipe" }): Promise<Ev | null> {
    if (disposed || phase !== "idle") return null;
    if (swallowTap()) return null;
    if (cel && !cel.ended) cel.run.skip();
    cel = null;
    if (placed.length === 0) { try { ui.reject("empty"); } catch { /* ignore */ } return null; }
    const chk = checkLayout(placed);
    if (!chk.ok) { try { ui.reject(chk.reason); } catch { /* ignore */ } return null; }
    const bet = chk.total;
    if (bet < TABLE_MIN) { try { ui.reject("empty"); } catch { /* ignore */ } return null; }
    if (!wallet.canBet(bet)) {
      if (trimToBalance()) ui.short("lowered");
      if (wallet.balance >= MIN_BET_GLOBAL && wallet.balance < TABLE_MIN) ui.short("sheet");
      emit();
      return null;
    }

    const layout = placed.map(copy);
    const ctl: NonNullable<Ev["ctl"]> = { gesture: o.gesture ?? "tap" };
    if (turbo) ctl.turbo = true;
    let r: Round;
    try { r = ctx.rounds.begin({ bet, ctl }); } catch { return null; }
    round = r;
    phase = "spin";

    // ---- outcome (result stream), then the motion of the wheel (presentation stream, decided after the outcome)
    const n = spinWheel(r.res);
    const settlement = settleLayout(layout, n);
    const seed: AnimSeed = { wheelTurn: 150 + r.pre.float() * 120, ballStart: r.pre.float() * 360, revs: 5 + r.pre.int(3) };
    const board = [...history, n].slice(-HISTORY_LEN);
    const plan: SpinPlan = {
      n, bet, placed: layout, settlement, payout: settlement.payout, tier: tierOf(settlement.payout, bet),
      durationMs: !vivid ? QUICK_MS : turbo ? TURBO_MS : SPIN_MS, turbo, quick: !vivid, seed, board,
    };
    live = { plan };
    last = layout.map(copy);
    ctx.store.set(STORE_LAST, last);
    emit();
    const t0 = clock.now();
    try { ui.spinStart(plan, t0); } catch { /* ignore */ }
    fx.sfx.loop("spin", true, { pitch: turbo ? 1.25 : 0.9 });
    // the ball settles into its pocket a little before the wheel is fully at rest
    const land = Math.round(plan.durationMs * DROP_END);
    await clock.wait(land);
    fx.sfx.loop("spin", false);
    if (!plan.quick) fx.sfx.play("stop", { k: 0.5, pitch: 0.9 });
    await clock.wait(plan.durationMs - land);
    if (!disposed && !plan.quick) {
      try { ui.result(plan); } catch { /* ignore */ }
      await clock.wait(SETTLE_MS);
    }
    return finish(r, plan);
  }

  async function finish(r: Round, plan: SpinPlan): Promise<Ev | null> {
    if (round !== r) return null;   // already settled by dispose
    const disp: Record<string, unknown> = { tier: plan.tier, board: plan.board };
    if (vivid && plan.payout > 0) disp.celebrate = true;
    const ev = r.settle({ payout: plan.payout, out: { n: plan.n }, dec: { bets: plan.placed.map((p) => ({ bet: p.bet, amt: p.amt })) }, disp });
    round = null;
    live = null;
    phase = "idle";
    history = plan.board;
    ctx.store.set(STORE_HIST, history);
    const cut = trimToBalance();
    if (!disposed) {
      if (plan.quick) { try { ui.result(plan); } catch { /* ignore */ } }
      emit();
      if (cut) { try { ui.short("lowered"); } catch { /* ignore */ } }
    }
    for (const cb of [...settleSubs]) cb(ev);
    if (disposed || plan.payout <= 0) return ev;

    const t0 = clock.now();   // before the call: a virtual clock may already advance inside it
    const run = fx.celebrate({ amount: plan.payout, bet: plan.bet, target: ui.winEl, anchor: ui.wheelEl });
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

  const core: RouletteCore = {
    get state() { return state(); },
    place,
    remove(bet) {
      if (disposed || phase !== "idle") return false;
      const key = betKey(normBet(bet));
      if (amountOn(key) === 0) return false;
      placed = placed.filter((p) => betKey(p.bet) !== key);
      moves = moves.filter((m) => m.key !== key);
      sfx("chip", 0.45);
      emit();
      return true;
    },
    undo() {
      if (disposed || phase !== "idle") return false;
      const m = moves.pop();
      if (!m) return false;
      drop(m.key, m.amt);
      sfx("chip", 0.4);
      emit();
      return true;
    },
    clear() {
      if (disposed || phase !== "idle" || placed.length === 0) return false;
      placed = [];
      moves = [];
      sfx("tap", 0.5);
      emit();
      return true;
    },
    rebet() {
      if (disposed || phase !== "idle" || placed.length > 0 || last.length === 0) return false;
      let cut = false;
      for (const p of last) {
        const room = wallet.balance - total();
        const amt = Math.min(p.amt, room);
        if (amt < p.amt) cut = true;
        if (amt <= 0) continue;
        placed.push({ bet: normBet(p.bet), amt });
        moves.push({ key: betKey(p.bet), amt });
      }
      sfx("chip", 0.7);
      emit();
      if (cut) ui.short("lowered");
      return placed.length > 0;
    },
    setChip(v) {
      if (!CHIP_VALUES.includes(v) || v === chip) return;
      chip = v;
      ctx.store.set(STORE_CHIP, v);
      emit();
    },
    setTurbo(on) {
      if (turbo === on) return;
      turbo = on;
      ctx.store.set(STORE_TURBO, on);
      emit();
    },
    spin: (o = {}) => run({ gesture: o.gesture }),
    canLeave() { return phase === "idle"; },
    suspend() { /* nothing to cancel: the clock is paused with the page */ },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (cel && !cel.ended) cel.run.skip();
      fx.sfx.loop("spin", false);
      // A round in flight already has its outcome: settle it as is (no celebration), so the session never keeps a dangling round.
      const r = round, l = live;
      if (r && l) {
        const p = l.plan;
        const ev = r.settle({ payout: p.payout, out: { n: p.n }, dec: { bets: p.placed.map((x) => ({ bet: x.bet, amt: x.amt })) }, disp: { tier: p.tier, board: p.board } });
        round = null;
        live = null;
        phase = "idle";
        history = p.board;
        ctx.store.set(STORE_HIST, history);
        for (const cb of [...settleSubs]) cb(ev);
      }
    },
    onSettle(cb) { settleSubs.add(cb); return () => { settleSubs.delete(cb); }; },
  };
  emit();
  return core;
}
