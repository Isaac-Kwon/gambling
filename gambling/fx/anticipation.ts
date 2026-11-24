/**
 * Build-up effects (`antic`) — pure parameters. The game decides *when* (slot: §7.5, 2+ top symbols showing
 * with reels still turning; crash: while the multiplier climbs; ocean: dim for the omen). fx decides *how*.
 *
 * - reel: remaining reels each stop ANTIC_REEL_EXTRA_MS later (the slot view does the slowing), fx adds the
 *   border glow, sparkles around the reel window and the heartbeat loop. k = decelerated reel count.
 * - rise: the "rise" loop gets `pitch = multiplier` (sfx.ts maps it to a rising tone); the layer adds exhaust sparks and a glow at the
 *   element. Calling antic(rise) again on the same element while it runs updates k / pitch and extends it.
 * - dim: darkens the element to opacity k over >= 600 ms (not a flash, §6.6), holds, then lifts.
 */

export const ANTIC_REEL_EXTRA_MS = 1200;

export function anticReelMs(reels: number): number {
  return Math.max(0, Math.round(reels)) * ANTIC_REEL_EXTRA_MS;
}

/** Exhaust sparks per second at multiplier `m` (more fire as it climbs). */
export function riseSparkRate(m: number): number {
  const x = Number.isFinite(m) && m > 1 ? m : 1;
  return Math.min(120, 45 + 22 * Math.log2(x));
}

/** Glow intensity 0..1 for multiplier `m`. */
export function riseGlow(m: number): number {
  const x = Number.isFinite(m) && m > 1 ? m : 1;
  return Math.min(1, 0.35 + 0.18 * Math.log2(x));
}

/** Minimum ramp for dim in and out: slower than this would not matter, faster would approach a flash. */
export const DIM_RAMP_MS = 600;

/** Dim opacity `t` ms into a dim of depth `k` (0..0.9) lasting `ms`. */
export function dimLevel(t: number, ms: number, k: number): number {
  const depth = Math.max(0, Math.min(0.9, k));
  const total = Math.max(ms, 2 * DIM_RAMP_MS);
  if (t <= 0 || t >= total) return 0;
  if (t < DIM_RAMP_MS) return depth * (t / DIM_RAMP_MS);
  if (t > total - DIM_RAMP_MS) return depth * ((total - t) / DIM_RAMP_MS);
  return depth;
}
