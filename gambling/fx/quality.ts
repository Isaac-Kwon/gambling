/**
 * Adaptive quality of the decoration layer (pure state machine, ARCHITECTURE §4.5).
 * Only frames the layer actually rendered are fed in.
 *
 * - EMA of frame time above 22 ms for 30 frames in a row → one level down.
 * - EMA below 14 ms for 10 s (accumulated rendered time) → one level up (max 2).
 * - At level 0, EMA above 40 ms for 5 s → "off" (layer destroyed, aux gfx why "slow").
 * Frames longer than GAP_MS are pauses (idle layer, tab switch), not frame times: ignored.
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
/** Each step down doubles the next up-hold (10 s, 20 s, 40 s, 80 s max), so a borderline device does not see-saw. */
export const UP_BACKOFF_MAX = 3;
export const OFF_MS = 40;
export const OFF_HOLD_MS = 5_000;
export const GAP_MS = 250;

export interface QualityState {
  readonly q: QualityLevel;
  readonly ema: number;
  /** Consecutive frames with ema > DOWN_MS. */
  readonly slow: number;
  /** Accumulated ms with ema below the "fast" threshold. */
  readonly fast: number;
  /** Accumulated ms with ema > OFF_MS (level 0 only). */
  readonly dead: number;
  /** Shortest frame seen (≈ the display refresh interval). */
  readonly vsync: number;
  /** Steps down taken so far (up-hold backoff). */
  readonly downs: number;
}

export function qualityInit(q: QualityLevel = 2): QualityState {
  return { q, ema: 1000 / 60, slow: 0, fast: 0, dead: 0, vsync: 1000 / 60, downs: 0 };
}

/** EMA threshold under which rendered time counts towards a step up. */
export function upThreshold(s: Pick<QualityState, "vsync">): number {
  return Math.max(UP_MS, s.vsync * UP_VSYNC);
}

/** Rendered ms below the threshold needed for the next step up. */
export function upHold(s: Pick<QualityState, "downs">): number {
  return UP_HOLD_MS * 2 ** Math.min(UP_BACKOFF_MAX, s.downs);
}

/** Feed one rendered frame's duration. Returns the next state; `changed` is set when the level moved. */
export function qualityStep(s: QualityState, frameMs: number): QualityState & { changed?: QualityLevel } {
  if (s.q === "off" || !(frameMs > 0) || frameMs > GAP_MS) {
    return { q: s.q, ema: s.ema, slow: s.slow, fast: s.fast, dead: s.dead, vsync: s.vsync, downs: s.downs };
  }
  const vsync = Math.max(MIN_VSYNC_MS, Math.min(s.vsync, frameMs));
  const ema = s.ema + EMA_ALPHA * (frameMs - s.ema);
  const slow = ema > DOWN_MS ? s.slow + 1 : 0;
  const fast = ema < upThreshold({ vsync }) ? s.fast + frameMs : 0;
  const dead = s.q === 0 && ema > OFF_MS ? s.dead + frameMs : 0;
  const q = s.q, downs = s.downs;

  if (q === 0 && dead >= OFF_HOLD_MS) return { q: "off", ema, slow: 0, fast: 0, dead: 0, vsync, downs, changed: "off" };
  if (q > 0 && slow >= DOWN_FRAMES) {
    const next = (q - 1) as Quality;
    return { q: next, ema, slow: 0, fast: 0, dead: 0, vsync, downs: downs + 1, changed: next };
  }
  if (q < 2 && fast >= upHold(s)) {
    const next = (q + 1) as Quality;
    return { q: next, ema, slow: 0, fast: 0, dead: 0, vsync, downs, changed: next };
  }
  return { q, ema, slow, fast, dead, vsync, downs };
}
