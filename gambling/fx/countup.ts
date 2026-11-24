/** Count-up timing and values (pure). ARCHITECTURE §6.4: clamp(600 + 450 × multiple, 600, 8000) ms, tap skips. */

export const COUNTUP_MIN_MS = 600;
export const COUNTUP_MAX_MS = 8000;
export const COUNTUP_PER_MULT_MS = 450;
/** Minimum spacing of the tick sound while counting. */
export const TICK_EVERY_MS = 70;

/** Duration for a win of `mult` × bet: proportional to the multiple, capped at 8 s. */
export function countupMs(mult: number): number {
  const m = Number.isFinite(mult) && mult > 0 ? mult : 0;
  return Math.round(Math.min(COUNTUP_MAX_MS, Math.max(COUNTUP_MIN_MS, COUNTUP_MIN_MS + COUNTUP_PER_MULT_MS * m)));
}

/** Clamp a caller-supplied duration into the allowed range (0 stays 0 = set immediately). */
export function clampCountupMs(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.min(COUNTUP_MAX_MS, ms);
}

/** Progress curve: fast start, soft landing (ease-out quadratic). u in [0, 1]. */
export function countEase(u: number): number {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return 1 - (1 - x) * (1 - x);
}

/** Integer value shown `t` ms into a count from `from` to `to` lasting `ms`. Reaches `to` exactly at t >= ms. */
export function countValue(from: number, to: number, t: number, ms: number): number {
  if (!(ms > 0) || t >= ms) return Math.round(to);
  const v = from + (to - from) * countEase(t / ms);
  // Never overshoot the target, never show a value "behind" the start.
  return Math.round(to >= from ? Math.min(to, Math.max(from, v)) : Math.max(to, Math.min(from, v)));
}

const EN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Default number format: integer with thousands separators ("12,345"). */
export function fmtInt(n: number): string {
  return EN.format(Math.round(n));
}
