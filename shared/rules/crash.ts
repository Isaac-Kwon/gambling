import type { Rng } from "../rng";

export const CRASH = { edge: 0.01, k: 0.12, minTarget: 1.01, maxTarget: 1000, cap: 10000, countdownMs: 3000 } as const;

const TWO32 = 4294967296;
/** Guards floor() against e^(k*ln(m)/k) landing a hair below m. */
const EPS = 1e-9;

/** Crash point from u in (0, 1]: max(1, min(cap, floor(99 / u) / 100)). 2-decimal floor. */
export function crashFromU(u: number): number {
  if (!(u > 0 && u <= 1)) throw new RangeError(`crashFromU: u must be in (0, 1], got ${u}`);
  const v = Math.floor((100 * (1 - CRASH.edge)) / u) / 100;
  return Math.max(1, Math.min(CRASH.cap, v));
}

/** One draw from the outcome stream: u = (u32 + 1) / 2^32, in (0, 1]. */
export function crashPoint(rng: Rng): number {
  return crashFromU((rng.u32() + 1) / TWO32);
}

/** Displayed multiplier after tSec seconds of climb: floor(100 * e^(k t)) / 100. */
export function multAt(tSec: number): number {
  if (!(tSec >= 0)) return 1;
  return Math.floor(100 * Math.exp(CRASH.k * tSec) + EPS) / 100;
}

/** Seconds at which the curve reaches `mult`: ln(mult) / k. */
export function timeOf(mult: number): number {
  if (!(mult >= 1)) throw new RangeError(`timeOf: mult must be >= 1, got ${mult}`);
  return Math.log(mult) / CRASH.k;
}

/** Bet is a positive multiple of 100 (keeps bet x 2-decimal multiplier an integer). */
export function isValidCrashBet(bet: number): boolean {
  return Number.isInteger(bet) && bet >= 100 && bet % 100 === 0;
}

/** Auto target: 1.01..1000.00 on the 0.01 grid. */
export function isValidCrashTarget(target: number): boolean {
  return Number.isFinite(target)
    && target >= CRASH.minTarget && target <= CRASH.maxTarget
    && Math.abs(target * 100 - Math.round(target * 100)) < 1e-6;
}

/**
 * Integer payout (stake included). cashoutAt null or > crash -> 0; cashoutAt === crash is a success.
 * Computed in cents of multiplier so 100 x 1.01 is exactly 101.
 */
export function settleCrash(bet: number, crash: number, cashoutAt: number | null): number {
  if (cashoutAt === null || !(cashoutAt <= crash)) return 0;
  return Math.floor((bet * Math.round(cashoutAt * 100)) / 100);
}

/**
 * Resolve a round to the effective cashout multiplier (null = busted).
 * - target: auto cashout multiplier or null.
 * - tapSec: elapsed clock seconds at the manual tap (from ctx.clock) or null.
 * Manual tap succeeds iff tapSec < timeOf(crash); cashoutAt = min(multAt(tapSec), crash).
 * If both are set, whichever happens first wins (a tap at/after the target time yields target).
 * A target above the crash never fires.
 */
export function resolveCrashCashout(crash: number, target: number | null, tapSec: number | null): number | null {
  const crashT = timeOf(crash);
  const targetHits = target !== null && target <= crash;
  const tapOk = tapSec !== null && tapSec < crashT;
  if (targetHits && tapOk) {
    // multiplier shown at tap vs target: tap strictly earlier than the target's time wins
    return tapSec < timeOf(target) ? Math.min(multAt(tapSec), crash) : target;
  }
  if (targetHits) return target;
  if (tapOk) return Math.min(multAt(tapSec), crash);
  return null;
}

/** Convenience: resolve then settle. */
export function settleCrashRound(bet: number, crash: number, target: number | null, tapSec: number | null): { cashoutAt: number | null; payout: number } {
  const cashoutAt = resolveCrashCashout(crash, target, tapSec);
  return { cashoutAt, payout: settleCrash(bet, crash, cashoutAt) };
}
