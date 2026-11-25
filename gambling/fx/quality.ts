/**
 * Adaptive quality of the decoration layer (pure state machine, ARCHITECTURE §4.5).
 * Only frames the layer actually rendered are fed in.
 *
 * - EMA of frame time above 22 ms for 30 frames in a row → one level down.
 * - EMA below the "fast" threshold for 10 s (accumulated rendered time) → one level up (max 2).
 * - At level 0, EMA above 40 ms for 5 s → "off" (layer destroyed, aux gfx why "slow").
 * Frames longer than GAP_MS are pauses (idle layer, tab switch), not frame times: ignored.
 *
 * Hysteresis: after every level change the next SETTLE_FRAMES frames are not judged (the change itself
 * reallocates the canvas) and a step down restarts the EMA at the down threshold, so the new level is
 * judged on its own frames, never on the slowness that caused the previous step.
 */
export type Quality = 0 | 1 | 2;
export type QualityLevel = Quality | "off";

export interface QualitySpec {
  /** Canvas resolution cap: resolution = min(devicePixelRatio, scale). */
  scale: number;
  /** Max concurrent particles. */
  cap: number;
  rays: boolean;
  /** Multiplier of additive glow sprites. */
  glow: number;
}

export const QUALITY: Readonly<Record<Quality, QualitySpec>> = {
  2: { scale: 2, cap: 600, rays: true, glow: 1 },
  1: { scale: 1.5, cap: 250, rays: true, glow: 0.5 },
  0: { scale: 1, cap: 100, rays: false, glow: 0.5 },
};

/** Particle cap for any level, including "off" (0). */
export function particleCap(q: QualityLevel): number {
  return q === "off" ? 0 : QUALITY[q].cap;
}

export const EMA_ALPHA = 0.1;
export const DOWN_MS = 22;
export const DOWN_FRAMES = 30;
export const UP_MS = 14;
/**
 * Frame times are rAF intervals, so they never go below the display's refresh interval: on a 60 Hz phone
 * a perfectly smooth layer still measures 16.7 ms and "below 14 ms" can never happen. "Fast" therefore
 * means below max(UP_MS, refresh × UP_VSYNC), the refresh interval being the shortest frame seen.
 */
export const UP_VSYNC = 1.15;
/** Shortest refresh interval believed (a 144 Hz panel is 6.9 ms; anything shorter is a timing artefact). */
export const MIN_VSYNC_MS = 6.5;
export const UP_HOLD_MS = 10_000;
/**
 * Each bounce (a step down that undoes an earlier step up) doubles the next up-hold (10 s, 20 s, 40 s,
 * 80 s max), so a borderline device does not see-saw. The first walk down from the start level is not a
 * bounce: a device that was only slow for a while gets its quality back after the plain 10 s.
 */
export const UP_BACKOFF_MAX = 3;
export const OFF_MS = 40;
export const OFF_HOLD_MS = 5_000;
export const GAP_MS = 250;
/** Frames not judged right after a level change (canvas reallocation, first frames at the new size). */
export const SETTLE_FRAMES = 12;

export interface QualityState {
  readonly q: QualityLevel;
  readonly ema: number;
  /** Consecutive frames with ema > DOWN_MS. */
  readonly slow: number;
  /** Accumulated ms with ema below the "fast" threshold (kept while merely "ok", reset when slow). */
  readonly fast: number;
  /** Accumulated ms with ema > OFF_MS (level 0 only). */
  readonly dead: number;
  /** Shortest frame seen (≈ the display refresh interval). */
  readonly vsync: number;
  /** Bounces so far (up-hold backoff). */
  readonly bounces: number;
  /** Steps up taken so far (a later step down is a bounce). */
  readonly ups: number;
  /** Frames still to skip after a level change. */
  readonly settle: number;
}

export function qualityInit(q: QualityLevel = 2): QualityState {
  return { q, ema: 1000 / 60, slow: 0, fast: 0, dead: 0, vsync: 1000 / 60, bounces: 0, ups: 0, settle: 0 };
}

/** EMA threshold under which rendered time counts towards a step up. */
export function upThreshold(s: Pick<QualityState, "vsync">): number {
  return Math.max(UP_MS, s.vsync * UP_VSYNC);
}

/** Rendered ms below the threshold needed for the next step up. */
export function upHold(s: Pick<QualityState, "bounces">): number {
  return UP_HOLD_MS * 2 ** Math.min(UP_BACKOFF_MAX, s.bounces);
}

/** Plain copy with overrides: never carries a previous step's `changed` along. */
function copy(s: QualityState, o: Partial<QualityState>): QualityState {
  return { q: s.q, ema: s.ema, slow: s.slow, fast: s.fast, dead: s.dead, vsync: s.vsync, bounces: s.bounces, ups: s.ups, settle: s.settle, ...o };
}

/** Feed one rendered frame's duration. Returns the next state; `changed` is set when the level moved. */
export function qualityStep(s: QualityState, frameMs: number): QualityState & { changed?: QualityLevel } {
  if (s.q === "off" || !(frameMs > 0) || frameMs > GAP_MS) return copy(s, {});
  const vsync = Math.max(MIN_VSYNC_MS, Math.min(s.vsync, frameMs));
  if (s.settle > 0) return copy(s, { vsync, settle: s.settle - 1 });
  const ema = s.ema + EMA_ALPHA * (frameMs - s.ema);
  const slow = ema > DOWN_MS ? s.slow + 1 : 0;
  const fast = ema < upThreshold({ vsync }) ? s.fast + frameMs : ema > DOWN_MS ? 0 : s.fast;
  const dead = s.q === 0 && ema > OFF_MS ? s.dead + frameMs : 0;
  const { q, bounces, ups } = s;

  if (q === 0 && dead >= OFF_HOLD_MS) return { ...copy(s, { q: "off", ema, slow: 0, fast: 0, dead: 0, vsync }), changed: "off" };
  if (q > 0 && slow >= DOWN_FRAMES) {
    const next = (q - 1) as Quality;
    const bounce = ups > 0 ? 1 : 0;
    return {
      q: next, ema: Math.min(ema, DOWN_MS), slow: 0, fast: 0, dead: 0, vsync,
      bounces: bounces + bounce, ups: ups - bounce, settle: SETTLE_FRAMES, changed: next,
    };
  }
  if (q < 2 && fast >= upHold(s)) {
    const next = (q + 1) as Quality;
    return { q: next, ema, slow: 0, fast: 0, dead: 0, vsync, bounces, ups: ups + 1, settle: SETTLE_FRAMES, changed: next };
  }
  return { q, ema, slow, fast, dead, vsync, bounces, ups, settle: 0 };
}
