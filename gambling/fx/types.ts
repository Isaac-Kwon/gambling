/**
 * fx API contract. Pure type definitions; implementations live in index.ts / null.ts / backend.ts.
 * Recording rule: when an effect starts, push `{type, ms: planned, k}` into the array given to
 * `collect`; when it ends or is skipped, overwrite `ms` of the same object with the actual duration.
 * The collected array stays that round's `Ev.fx` until the next `RoundApi.begin`, so celebrations that
 * run after settlement still land in it.
 *
 * `type` values: tier, countup, particles:<kind>, shake, antic:<kind>, flash, sfx:<name>, haptic, omen, ticket.
 */
export type FxRecord = { type: string; ms: number; k: number };

export interface FxRun {
  /** Resolves when the effect has finished or been skipped. Never rejects. */
  readonly done: Promise<void>;
  /** Ends the effect immediately (and fixes up the record's `ms`). Safe to call repeatedly. */
  skip(): void;
}

export interface Fx {
  /** false when fx=off. */
  readonly enabled: boolean;
  /** RoundApi.begin passes that round's Ev.fx array here; null detaches. */
  collect(into: FxRecord[] | null): void;
  /** Resolves when every running effect has finished. */
  idle(): Promise<void>;
  /** Tier banner, count-up, particles, shake, sound and haptics bundled by payout/bet tier. payout > 0 always celebrates, even if payout < bet; payout === 0 does nothing. */
  celebrate(o: { amount: number; bet: number; target: HTMLElement; anchor?: HTMLElement }): FxRun;
  /** `ms` is capped at 8000. Optional `k` = value recorded as the countup record's k (default 0); optional `fmt` formats the number (default "12,345"). */
  countup(o: { el: HTMLElement; from: number; to: number; ms: number; tick?: boolean; k?: number; fmt?: (n: number) => string }): FxRun;
  /** `k` = particle count. */
  particles(kind: "coins" | "confetti" | "rays" | "bubbles" | "tickets", o: { k: number; at?: HTMLElement; ms?: number }): FxRun;
  /** `k` = amplitude in px (max 8, 1s; 0 under reduced motion). */
  shake(o: { el: HTMLElement; k: number; ms: number }): FxRun;
  /**
   * `k` = decelerated reels / multiplier / dim ratio depending on `kind`.
   * `rise`: calling it again on the same `el` while it runs updates k (max) and pitch and extends it to
   * now + ms — one record per climb. Call `skip()` when the climb ends (crash: silent stop).
   */
  antic(o: { el: HTMLElement; kind: "reel" | "rise" | "dim"; k: number; ms: number }): FxRun;
  /** If the flash guard refuses, nothing happens and nothing is recorded. `area` = screen fraction 0..1. */
  flash(o: { el: HTMLElement; color: string; ms: number; area: number }): FxRun;
  sfx: Sfx;
  haptics: Haptics;
  /** Background: suspend audio context and particle loop. */
  suspend(): void;
  resume(): void;
}

export type SfxName =
  | "tap" | "stop" | "tick" | "coin" | "chip" | "card"
  | "win0" | "win1" | "win2" | "win3" | "win4"
  | "omen" | "ticket" | "level";

export interface Sfx {
  /** Must be called inside a user-gesture handler. */
  unlock(): Promise<void>;
  /** `k` = max gain 0..1. */
  play(name: SfxName, o?: { k?: number; pitch?: number }): void;
  loop(name: "ambient" | "spin" | "rise" | "heartbeat", on: boolean, o?: { pitch?: number }): void;
  setMuted(m: boolean): void;
}

export interface Haptics {
  /** Silently ignored when navigator.vibrate is missing. Total <= 600ms per call. */
  pulse(pattern: number | number[]): void;
}
