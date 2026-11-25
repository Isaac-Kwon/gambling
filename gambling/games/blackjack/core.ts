/**
 * BLACKJACK 21 round logic (ARCHITECTURE §6.1, §9.2). No DOM, no wall clock, no Math.random: time is `ctx.clock`,
 * randomness is the shoe order of `ctx.rng.res("blackjack").at(shoeNo)` only (a shoe's order never depends on what
 * the player does). The rules engine is `shared/rules/blackjack.ts`; this file only sequences it.
 *
 * Round: bet (chips) → [sweep, shuffle at the cut] → begin (debit) → deal → player decisions (each logged in
 * `dec.steps` with the basic-strategy action, which is never shown) → dealer → settle (credit, Ev) → celebration.
 * Nothing fx does (animation timing, sounds, celebration) can change an outcome; `vivid` only decides whether the
 * presentation (animation lengths, the celebration and its record) happens.
 *
 * The screen is a `BjUi` port: the DOM view implements it, `headlessUi()` is the no-op used by the harness.
 */
import { CHIPS, MIN_BET, MIN_BET_GLOBAL, tierOf } from "../../../shared/config";
import type { Rng } from "../../../shared/rng";
import {
  BJ, CUT_POS, SHOE_CARDS, bjAct, bjDeal, bjLegal, bjOut, bjSettle, bjView, handValue, needsShuffle, newShoe, optimalAction,
  restoreShoe, trueCount,
  type Action, type BjRes, type BjState, type Card, type HandView, type Shoe,
} from "../../../shared/rules/blackjack";
import type { Ev } from "../../../shared/schema";
import type { FxRun } from "../../fx/types";
import type { GameCtx, Round } from "../../src/types";

export const CHIP_VALUES: readonly number[] = CHIPS.blackjack;
export const MAX_BET = 2000;
export const BET_UNIT = 20;

/** Animation lengths (ms). Without the presentation layer cards simply appear (`ms: 0`) after a short beat. */
export const CARD_MS = 300;
export const CARD_GAP_MS = 360;
export const FLIP_MS = 460;
export const SPLIT_MS = 340;
export const SWEEP_MS = 360;
export const SHUFFLE_MS = 1700;
export const PEEK_MS = 700;
export const BEAT_MS = 280;
export const QUICK_GAP_MS = 60;

export const STORE_BET = "blackjack.bet";
export const STORE_SHOE = "blackjack.shoe";

export type Phase = "bet" | "deal" | "player" | "act";

export interface ShoeInfo { no: number; pos: number; total: number; cut: number }

/** What the table shows right now (cards are tracked by the core so the screen only has to draw). */
export interface Shown { dealer: number[]; holeUp: boolean; hands: number[][] }

/** `card` is -1 for the face-down hole card (its value reaches the screen with the flip). */
export type Move =
  | { k: "sweep"; ms: number }
  | { k: "card"; to: "dealer" | "hand"; hand: number; card: number; up: boolean; dbl: boolean; ms: number }
  | { k: "flip"; card: number; ms: number }
  | { k: "split"; ms: number };
type MoveSpec = Move extends infer M ? (M extends { ms: number } ? Omit<M, "ms"> : never) : never;

export interface HandVm { cards: number; total: number; soft: boolean; bet: number; active: boolean; doubled: boolean }
export interface TableVm { dealerTotal: number; dealerSoft: boolean; dealerCards: number; hands: HandVm[] }
export interface ResultVm {
  hands: { res: BjRes; bet: number; pay: number }[];
  payout: number;
  totalBet: number;
  net: number;
  natural: boolean;
}

export interface BjState4Ui {
  phase: Phase;
  /** Chips on the spot while betting; the table bet while a round runs. */
  bet: number;
  lastBet: number;
  legal: readonly Action[];
  turn: number;
  balance: number;
  canDeal: boolean;
  canRebet: boolean;
  canClear: boolean;
  /** Per chip value: tapping adds it. */
  chipOk: Record<number, boolean>;
  shoe: ShoeInfo;
}

export interface BjUi {
  readonly winEl: HTMLElement;
  readonly tableEl: HTMLElement;
  render(s: BjState4Ui): void;
  /** Reshuffle visual (the shoe is a new one: `info.pos` = 0). `ms` 0 = no animation. */
  shuffle(info: ShoeInfo, ms: number): void;
  move(m: Move): void;
  /** Totals, bets, whose turn it is. Called after every move and at round start/end. */
  table(vm: TableVm): void;
  result(r: ResultVm): void;
  /** Extra flourish for a natural (3:2). */
  flourish(): void;
  /** "funds": chip tap beyond the balance; "max": beyond the table limit; "sheet": not even the minimum bet. */
  short(kind: "funds" | "max" | "sheet"): void;
}

export interface Decision { hand: HandView; up: Card; shoe: Shoe; legal: Action[] }

export interface BjCore {
  readonly state: BjState4Ui;
  /** Adds a chip to the spot; false when it did not fit. */
  addChip(value: number): boolean;
  clearBet(): void;
  /** Puts the previous bet (as far as the balance covers it) on the spot. */
  rebet(): boolean;
  /** Test/harness: sets the spot to an exact amount (a multiple of 20 inside the limits). */
  setBet(amount: number): boolean;
  /** Deals. Resolves when the player has to decide (null) or, if the round ended at once (naturals), with its Ev. */
  deal(): Promise<Ev | null>;
  /** Plays a decision. Resolves with the Ev when this action ended the round (after the celebration), else null. */
  act(a: Action): Promise<Ev | null>;
  decision(): Decision | null;
  canLeave(): boolean;
  suspend(): void;
  dispose(): void;
  onSettle(cb: (ev: Ev) => void): () => void;
}

// ------------------------------------------------------------------------------------------- pure parts

/** Returned to the wallet for one hand (stake included). Mirrors bjSettle. */
export function handPay(res: BjRes, bet: number): number {
  switch (res) {
    case "bj": return bet + bet * BJ.bjPays;
    case "win": return 2 * bet;
    case "push": return bet;
    default: return 0;
  }
}

export const emptyShown = (): Shown => ({ dealer: [], holeUp: false, hands: [[]] });

/**
 * Moves that turn what is on the table (`shown`) into the cards of `st`, in dealing order:
 * split → player cards hand by hand → hole flip → dealer draws. `doubled` = hand index that just doubled.
 */
export function movesFor(shown: Shown, st: BjState, doubled = -1): MoveSpec[] {
  const out: MoveSpec[] = [];
  const have = shown.hands.map((h) => h.slice());
  if (st.hands.length > have.length) {
    out.push({ k: "split" });
    const second = have[0].pop() as number;
    have.push([second]);
  }
  st.hands.forEach((h, i) => {
    for (let j = have[i].length; j < h.cards.length; j++) {
      out.push({ k: "card", to: "hand", hand: i, card: h.cards[j], up: true, dbl: doubled === i && j === 2 });
    }
  });
  if (st.holeShown && !shown.holeUp) out.push({ k: "flip", card: st.dealer[1] });
  if (st.holeShown) {
    for (let j = Math.max(2, shown.dealer.length); j < st.dealer.length; j++) {
      out.push({ k: "card", to: "dealer", hand: 0, card: st.dealer[j], up: true, dbl: false });
    }
  }
  return out;
}

/** The first four cards: player, dealer up, player, dealer hole (face down). */
export function initialMoves(st: BjState): MoveSpec[] {
  const h = st.hands[0].cards;
  return [
    { k: "card", to: "hand", hand: 0, card: h[0], up: true, dbl: false },
    { k: "card", to: "dealer", hand: 0, card: st.dealer[0], up: true, dbl: false },
    { k: "card", to: "hand", hand: 0, card: h[1], up: true, dbl: false },
    { k: "card", to: "dealer", hand: 0, card: -1, up: false, dbl: false },
  ];
}

/** Largest bet on the spot the balance covers (multiple of the unit, within the limits); 0 when none. */
export function affordableBet(balance: number, want: number): number {
  const cap = Math.min(MAX_BET, Math.floor(balance / BET_UNIT) * BET_UNIT, want);
  return Math.max(0, Math.floor(cap / BET_UNIT) * BET_UNIT);
}

const noop = (): void => undefined;
const fakeEl = (): HTMLElement => ({ textContent: "" }) as unknown as HTMLElement;

/** No-op screen for node (harness, tests). */
export function headlessUi(): BjUi {
  return { winEl: fakeEl(), tableEl: fakeEl(), render: noop, shuffle: noop, move: noop, table: noop, result: noop, flourish: noop, short: noop };
}

const shoeInfo = (s: Shoe): ShoeInfo => ({ no: s.no, pos: s.pos, total: SHOE_CARDS, cut: CUT_POS });

interface StoredShoe { no: number; pos: number; rc: number }

// ------------------------------------------------------------------------------------------- the core

export function createBjCore(ctx: GameCtx, ui: BjUi): BjCore {
  const { clock, fx, wallet } = ctx;
  // The one place the core looks at the fx mode: animation lengths and the celebration are presentation and are
  // neither shown nor recorded without the presentation layer (§5.3, §6.5). Outcomes never read this.
  const vivid = fx.enabled;
  const shoeRng = (no: number): Rng => ctx.rng.res("blackjack").at(no);

  // The shoe lives in the session store (and so survives leaving the table and a resume): same shoe, same position.
  const stored = ctx.store.get<StoredShoe>(STORE_SHOE);
  let shoe: Shoe = stored && Number.isInteger(stored.no) && stored.no >= 1 && Number.isInteger(stored.pos) && stored.pos >= 0 && stored.pos <= SHOE_CARDS
    ? restoreShoe(stored.no, shoeRng(stored.no), stored.pos)
    : newShoe(1, shoeRng(1));
  const storedBet = ctx.store.get<number>(STORE_BET);
  let lastBet = typeof storedBet === "number" && storedBet >= MIN_BET.blackjack && storedBet <= MAX_BET ? storedBet : 0;

  let phase: Phase = "bet";
  let pending = 0;
  let disposed = false;
  let round: Round | null = null;
  let st: BjState | null = null;
  let shown: Shown = emptyShown();
  let steps: { hand: number; action: Action; optimal: Action; trueCountApprox: number }[] = [];
  let tcBet = 0;
  let cel: { run: FxRun; ended: boolean } | null = null;
  const settleSubs = new Set<(ev: Ev) => void>();

  const afford = (extra: number): boolean => wallet.canBet(extra);

  const state = (): BjState4Ui => {
    const playing = phase !== "bet";
    const legal = phase === "player" && st ? bjLegal(st, afford) : [];
    const chipOk: Record<number, boolean> = {};
    for (const v of CHIP_VALUES) chipOk[v] = phase === "bet" && pending + v <= MAX_BET && wallet.canBet(pending + v);
    const tableBet = st ? st.hands.reduce((a, h) => a + h.bet, 0) : 0;
    return {
      phase, bet: playing ? tableBet : pending, lastBet, legal, turn: st?.turn ?? 0, balance: wallet.balance,
      canDeal: phase === "bet" && pending >= MIN_BET.blackjack && wallet.canBet(pending),
      canRebet: phase === "bet" && affordableBet(wallet.balance, lastBet) >= MIN_BET.blackjack && pending !== affordableBet(wallet.balance, lastBet),
      canClear: phase === "bet" && pending > 0,
      chipOk, shoe: shoeInfo(shoe),
    };
  };
  const emit = (): void => { try { ui.render(state()); } catch { /* the screen must never break a round */ } };

  const vm = (): TableVm => {
    const d = shown.dealer.filter((c) => c >= 0);
    const dv = d.length ? handValue(shown.holeUp ? d : d.slice(0, 1)) : { total: 0, soft: false };
    return {
      dealerTotal: dv.total, dealerSoft: dv.soft, dealerCards: shown.dealer.length,
      hands: shown.hands.map((cards, i) => {
        const hv = handValue(cards);
        const h = st?.hands[i];
        return { cards: cards.length, total: hv.total, soft: hv.soft, bet: h?.bet ?? 0, active: phase !== "bet" && !!st && st.phase === "player" && st.turn === i && phase !== "deal", doubled: !!h?.doubled };
      }),
    };
  };
  const draw = (): void => { try { ui.table(vm()); } catch { /* ignore */ } };

  const pause = (ms: number): Promise<void> => (disposed ? Promise.resolve() : clock.wait(ms));
  const beat = (animated: number): Promise<void> => pause(vivid ? animated : QUICK_GAP_MS);

  const skipCel = (): void => {
    if (cel && !cel.ended) cel.run.skip();
    cel = null;
  };

  async function exec(spec: MoveSpec): Promise<void> {
    if (disposed) return;
    switch (spec.k) {
      case "card": {
        const m: Move = { ...spec, ms: vivid ? CARD_MS : 0 };
        if (spec.to === "dealer") shown.dealer.push(spec.card);
        else shown.hands[spec.hand].push(spec.card);
        try { ui.move(m); } catch { /* ignore */ }
        fx.sfx.play("card", { k: 0.5, pitch: 0.96 + 0.08 * ((shown.dealer.length + shown.hands.length) % 4) / 3 });
        draw();
        await beat(CARD_GAP_MS);
        break;
      }
      case "flip": {
        await beat(PEEK_MS * 0.55);
        shown.dealer[1] = spec.card;
        shown.holeUp = true;
        try { ui.move({ k: "flip", card: spec.card, ms: vivid ? FLIP_MS : 0 }); } catch { /* ignore */ }
        fx.sfx.play("card", { k: 0.55, pitch: 1.12 });
        draw();
        await beat(FLIP_MS + 160);
        break;
      }
      case "split": {
        const second = shown.hands[0].pop() as number;
        shown.hands.push([second]);
        try { ui.move({ k: "split", ms: vivid ? SPLIT_MS : 0 }); } catch { /* ignore */ }
        fx.sfx.play("chip", { k: 0.5 });
        draw();
        await beat(SPLIT_MS + 120);
        break;
      }
      case "sweep": {
        try { ui.move({ k: "sweep", ms: vivid ? SWEEP_MS : 0 }); } catch { /* ignore */ }
        await beat(SWEEP_MS);
        break;
      }
    }
  }

  const short = (): void => {
    if (wallet.balance >= MIN_BET_GLOBAL && wallet.balance < MIN_BET.blackjack) ui.short("sheet");
  };

  /** Fixes the outcome in the log; the shoe is stored first so the resume snapshot of this settlement has it. */
  function settleNow(celebrate: boolean): { ev: Ev; res: ResultVm } {
    const r = round as Round, s = st as BjState;
    const settled = bjSettle(s);
    const out = bjOut(s);
    shoe = { ...s.shoe };
    ctx.store.set(STORE_SHOE, { no: shoe.no, pos: shoe.pos, rc: shoe.rc } satisfies StoredShoe);
    ctx.store.set(STORE_BET, lastBet);
    const disp: Record<string, unknown> = { tier: tierOf(settled.payout, settled.totalBet) };
    if (celebrate && vivid && settled.payout > 0) disp.celebrate = true;
    const ev = r.settle({ payout: settled.payout, out, dec: { trueCountApprox: tcBet, steps: steps.map((x) => ({ ...x })) }, disp });
    const hands = settled.hands.map((h) => ({ res: h.res, bet: h.bet, pay: handPay(h.res, h.bet) }));
    round = null;
    return {
      ev,
      res: { hands, payout: settled.payout, totalBet: settled.totalBet, net: settled.payout - settled.totalBet, natural: settled.hands.some((h) => h.res === "bj") },
    };
  }

  async function finishRound(): Promise<Ev | null> {
    if (disposed) return null;
    await beat(BEAT_MS);
    if (disposed || !round || !st) return null;
    const { ev, res } = settleNow(true);
    phase = "bet";
    pending = 0;
    try { ui.result(res); } catch { /* ignore */ }
    draw();
    emit();
    for (const cb of [...settleSubs]) cb(ev);
    if (res.payout > 0) {
      const run = fx.celebrate({ amount: res.payout, bet: res.totalBet, target: ui.winEl, anchor: ui.tableEl });
      const c = { run, ended: false };
      cel = c;
      if (res.natural && vivid) {
        try { ui.flourish(); } catch { /* ignore */ }
        // Extra for a natural 3:2: confetti from the table on top of the tier's own bundle.
        fx.particles("confetti", { k: 70, at: ui.tableEl });
        fx.sfx.play("coin", { k: 0.5, pitch: 1.2 });
      }
      await run.done;
      c.ended = true;
    }
    if (!disposed) short();
    return ev;
  }

  async function play(next: BjState, doubled: number): Promise<Ev | null> {
    st = next;
    for (const m of movesFor(shown, next, doubled)) await exec(m);
    if (disposed) return null;
    if (next.phase === "done") return finishRound();
    phase = "player";
    draw();
    emit();
    return null;
  }

  const core: BjCore = {
    get state() { return state(); },
    addChip(value) {
      if (phase !== "bet" || disposed || !CHIP_VALUES.includes(value)) return false;
      skipCel();
      if (pending + value > MAX_BET) { ui.short("max"); return false; }
      if (!wallet.canBet(pending + value)) { ui.short("funds"); return false; }
      pending += value;
      fx.sfx.play("chip", { k: 0.6, pitch: 0.94 + 0.05 * CHIP_VALUES.indexOf(value) });
      emit();
      return true;
    },
    clearBet() {
      if (phase !== "bet" || pending === 0) return;
      pending = 0;
      fx.sfx.play("chip", { k: 0.35, pitch: 0.8 });
      emit();
    },
    rebet() {
      if (phase !== "bet" || disposed) return false;
      skipCel();
      const b = affordableBet(wallet.balance, lastBet);
      if (b < MIN_BET.blackjack) { short(); return false; }
      pending = b;
      fx.sfx.play("chip", { k: 0.6 });
      emit();
      return true;
    },
    setBet(amount) {
      if (phase !== "bet" || disposed) return false;
      if (!(amount >= MIN_BET.blackjack) || amount > MAX_BET || amount % BET_UNIT !== 0 || !wallet.canBet(amount)) return false;
      pending = amount;
      emit();
      return true;
    },
    async deal() {
      if (disposed || phase !== "bet") return null;
      skipCel();
      const bet = pending;
      if (bet < MIN_BET.blackjack || bet > MAX_BET || bet % BET_UNIT !== 0) return null;
      if (!wallet.canBet(bet)) { pending = affordableBet(wallet.balance, pending); ui.short("funds"); emit(); short(); return null; }
      phase = "deal";
      emit();
      if (shown.dealer.length > 0 || shown.hands.some((h) => h.length > 0)) {
        await exec({ k: "sweep" });
        shown = emptyShown();
        st = null;
        draw();
      }
      if (disposed) return null;
      if (needsShuffle(shoe)) {
        shoe = newShoe(shoe.no + 1, shoeRng(shoe.no + 1));
        try { ui.shuffle(shoeInfo(shoe), vivid ? SHUFFLE_MS : 0); } catch { /* ignore */ }
        emit();
        await pause(vivid ? SHUFFLE_MS : QUICK_GAP_MS);
        if (disposed) return null;
      }
      let r: Round;
      try { r = ctx.rounds.begin({ bet, ctl: { gesture: "tap" } }); } catch { phase = "bet"; emit(); return null; }
      round = r;
      lastBet = bet;
      steps = [];
      tcBet = trueCount(shoe);
      const first = bjDeal(shoe, bet);
      st = first;
      shown = emptyShown();
      emit();
      draw();
      for (const m of initialMoves(first)) await exec(m);
      if (disposed) return null;
      // Peek: the dealer looks at the hole card when an ace or ten-value card shows.
      const up = first.dealer[0] % 13;
      if (vivid && (up === 0 || up >= 9) && first.phase === "player") await pause(PEEK_MS);
      if (disposed) return null;
      if (first.phase === "done") {
        for (const m of movesFor(shown, first)) await exec(m);
        return finishRound();
      }
      phase = "player";
      draw();
      emit();
      return null;
    },
    async act(a) {
      if (disposed || phase !== "player" || !st || !round) return null;
      const cur = st;
      if (!bjLegal(cur, afford).includes(a)) return null;
      const view = bjView(cur, afford) as HandView;
      const step = { hand: cur.turn, action: a, optimal: optimalAction(view, cur.dealer[0]), trueCountApprox: trueCount(cur.shoe) };
      const extra = cur.hands[cur.turn].bet;
      phase = "act";
      if (a === "D" || a === "P") {
        try { round.addBet(extra); } catch { phase = "player"; emit(); return null; }
        fx.sfx.play("chip", { k: 0.6 });
      }
      steps.push(step);
      const turn = cur.turn;
      const next = bjAct(cur, a);
      emit();
      return play(next, a === "D" ? turn : -1);
    },
    decision() {
      if (phase !== "player" || !st) return null;
      return { hand: bjView(st, afford) as HandView, up: st.dealer[0], shoe: st.shoe, legal: bjLegal(st, afford) };
    },
    canLeave: () => phase === "bet" && !disposed,
    suspend() { /* nothing runs on its own: a round waits for the player */ },
    dispose() {
      if (disposed) return;
      disposed = true;
      skipCel();
      // A round in flight already has its cards: the player stands on what is left, and the log keeps a settled round.
      if (round && st) {
        let s = st;
        while (s.phase === "player") s = bjAct(s, "S");
        st = s;
        const { ev } = settleNow(false);
        for (const cb of [...settleSubs]) cb(ev);
      }
      phase = "bet";
    },
    onSettle(cb) { settleSubs.add(cb); return () => { settleSubs.delete(cb); }; },
  };
  emit();
  return core;
}
