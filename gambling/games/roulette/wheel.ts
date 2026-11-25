/**
 * Wheel and ball motion (pure, DOM-free). The result is fixed before the spin starts (ARCHITECTURE §9.1); this
 * module only draws a path for the ball that ends exactly on that pocket.
 *
 * Angles are degrees, clockwise from the top. Pocket `i` of `WHEEL_ORDER` sits at `i * STEP` in the wheel's own
 * frame; the wheel turns clockwise and slows to a stop, the ball runs counter-clockwise on the outer track, slows,
 * drops into the pocket ring (with a few hops) and ends on the winning pocket at the same moment the wheel stops.
 */
import { WHEEL_ORDER } from "../../../shared/rules/roulette";

export const POCKETS = WHEEL_ORDER.length;
export const STEP = 360 / POCKETS;
export const TRACK_R = 82;
export const POCKET_R = 61;
/** Where the ball starts to drop (progress 0..1) and where it has settled. */
export const DROP_AT = 0.7;
export const DROP_END = 0.95;

/** Presentation-stream draws that shape one spin (decided by the core after the outcome). */
export interface AnimSeed {
  /** Wheel turn during the spin, degrees clockwise. */
  wheelTurn: number;
  /** Where the ball starts, degrees. */
  ballStart: number;
  /** Whole extra ball revolutions (counter-clockwise). */
  revs: number;
}

export interface WheelAnim {
  w0: number;
  wTurn: number;
  b0: number;
  bTurn: number;
  /** Absolute angle the ball ends at. */
  bEnd: number;
  n: number;
}

export const pocketIndex = (n: number): number => WHEEL_ORDER.indexOf(n);
export const pocketDeg = (n: number): number => pocketIndex(n) * STEP;
const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** Anim of one spin: the wheel starts at `restDeg`; the ball ends in `n`'s pocket. */
export function makeAnim(n: number, restDeg: number, seed: AnimSeed): WheelAnim {
  const w1 = restDeg + seed.wheelTurn;
  const bEnd = w1 + pocketDeg(n);
  const delta = mod(bEnd - seed.ballStart, 360);
  const bTurn = delta - 360 * (Math.max(3, Math.round(seed.revs)) + 1);
  return { w0: restDeg, wTurn: seed.wheelTurn, b0: seed.ballStart, bTurn, bEnd, n };
}

const clamp01 = (p: number): number => (p < 0 ? 0 : p > 1 ? 1 : p);
/** Ease-out of the ball (fast start, long slow end). */
export const easeBall = (p: number): number => 1 - Math.pow(1 - clamp01(p), 2.4);
const easeWheel = (p: number): number => 1 - Math.pow(1 - clamp01(p), 2);

export function wheelDeg(a: WheelAnim, p: number): number {
  return a.w0 + a.wTurn * easeWheel(p);
}

/** Ball angle. A small damped wobble in the last stretch makes it skip between pockets; it is exactly 0 at the end. */
export function ballDeg(a: WheelAnim, p: number): number {
  const q = clamp01(p);
  const base = a.b0 + a.bTurn * easeBall(q);
  if (q <= DROP_AT) return base;
  const s = (q - DROP_AT) / (1 - DROP_AT);
  const wobble = Math.sin(s * Math.PI * 5) * 7 * (1 - s) * (1 - s) * (s < 0.15 ? s / 0.15 : 1);
  return base + wobble;
}

/** Bounce curve 0 → 1 (values never above 1), like a ball hitting a floor. */
function bounce(t: number): number {
  if (t >= 1) return 1;
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) { const u = t - 1.5 / 2.75; return 7.5625 * u * u + 0.75; }
  if (t < 2.5 / 2.75) { const u = t - 2.25 / 2.75; return 7.5625 * u * u + 0.9375; }
  const u = t - 2.625 / 2.75;
  return 7.5625 * u * u + 0.984375;
}

/** Ball distance from the centre: track, then down into the pocket ring with hops. */
export function ballRadius(p: number): number {
  const q = clamp01(p);
  if (q <= DROP_AT) return TRACK_R;
  const s = clamp01((q - DROP_AT) / (DROP_END - DROP_AT));
  return TRACK_R - (TRACK_R - POCKET_R) * bounce(s);
}

/** Position of the ball in the 200×200 wheel box. */
export function ballXY(a: WheelAnim, p: number): { x: number; y: number; r: number; deg: number } {
  const deg = ballDeg(a, p), r = ballRadius(p);
  const rad = (deg * Math.PI) / 180;
  return { x: 100 + r * Math.sin(rad), y: 100 - r * Math.cos(rad), r, deg };
}

/** Pocket index under the ball (wheel frame) at progress p. */
export function pocketUnder(a: WheelAnim, p: number): number {
  return Math.round(mod(ballDeg(a, p) - wheelDeg(a, p), 360) / STEP) % POCKETS;
}
