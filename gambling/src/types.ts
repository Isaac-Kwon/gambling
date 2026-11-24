import type { GameId, SlotVariant } from "../../shared/config";
import type { Lang } from "../../shared/i18n";
import type { Logger } from "../../shared/logger";
import type { Rng, Streams } from "../../shared/rng";
import type { Ev } from "../../shared/schema";
import type { Fx } from "../fx/types";

/** A lazily loaded game. */
export interface GameModule {
  readonly id: GameId;
  mount(root: HTMLElement, ctx: GameCtx): void | Promise<void>;
  /** Release listeners, timers, rAF, audio loops. Must be safe to call more than once. */
  unmount(): void;
  /** false while a round is in progress (lobby / CASH OUT are deferred until settlement). */
  canLeave(): boolean;
  onSuspend?(): void;
  onResume?(): void;
}

export interface GameCtx {
  game: GameId;
  wallet: Wallet;
  rounds: RoundApi;
  fx: Fx;
  rng: Streams;
  clock: Clock;
  log: Pick<Logger, "aux" | "now">;
  settings: Settings;
  store: GameStore;
  t: (key: string, params?: Record<string, string | number>) => string;
  nav: { toLobby(): void; requestCashout(reason?: "bust" | "cashout"): void };
}

export interface Wallet {
  /** The true value. The number on screen is counted up separately by the HUD. */
  readonly balance: number;
  canBet(amount: number): boolean;
  /** Throws if the balance is insufficient. */
  debit(amount: number): void;
  credit(amount: number): void;
  /** Returns an unsubscribe function. */
  onChange(cb: (balance: number, delta: number) => void): () => void;
}

export interface RoundApi {
  /** Number of settled rounds (of game `g`, or of the current game if omitted). */
  count(g?: GameId): number;
  /** Debits the bet, assigns the round number, starts collecting fx. */
  begin(o: { bet: number; ctl?: Ev["ctl"] }): Round;
  readonly active: Round | null;
}

export interface Round {
  /** Round number, starting at 1. */
  readonly n: number;
  /** rng.res(game).at(n) */
  readonly res: Rng;
  /** rng.pre(game).at(n) */
  readonly pre: Rng;
  /** Extra stake (double, split); debits the wallet. */
  addBet(amount: number): void;
  ctl(patch: Partial<NonNullable<Ev["ctl"]>>): void;
  /** Credits `payout` (total incl. stake), records the Ev, schedules a save. */
  settle(o: { payout: number; out?: Ev["out"]; dec?: Ev["dec"]; disp?: Ev["disp"] }): Ev;
}

export interface Clock {
  now(): number;
  wait(ms: number): Promise<void>;
  /** Per-frame callback with delta ms; returns a cancel function. */
  frame(cb: (dtMs: number) => void): () => void;
  /** While paused, now() stands still. */
  pause(): void;
  resume(): void;
}

export interface Settings {
  readonly fx: "on" | "off";
  readonly lang: Lang;
  readonly reducedMotion: boolean;
  muted: boolean;
  /** Slot math variant (`?sv=`). Only the slot reads it: SLOTS[ctx.settings.sv]. */
  readonly sv: SlotVariant;
}

/** JSON values only; lives for the session. */
export interface GameStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
