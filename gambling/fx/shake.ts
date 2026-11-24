/** Screen shake (pure). Amplitude cap 8 px, duration cap 1 s, 0 under reduced motion (ARCHITECTURE §6.4, §6.6). */

export const SHAKE_MAX_PX = 8;
export const SHAKE_MAX_MS = 1000;

export function clampShake(px: number, ms: number, reducedMotion: boolean): { px: number; ms: number } {
  if (reducedMotion || !(px > 0) || !(ms > 0)) return { px: 0, ms: 0 };
  return { px: Math.min(SHAKE_MAX_PX, px), ms: Math.min(SHAKE_MAX_MS, ms) };
}

/** Small deterministic PRNG for visual jitter (mulberry32); seeded from the fx presentation stream. */
export function jitter(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Transform keyframes for a decaying shake: `n` steps, direction from `seed`, amplitude falls off
 * quadratically, small rotation for weight. Ends at rest. Offsets in px, rotation in deg.
 */
export function shakeFrames(px: number, ms: number, seed: number): { x: number; y: number; r: number }[] {
  if (!(px > 0) || !(ms > 0)) return [{ x: 0, y: 0, r: 0 }];
  const rnd = jitter(seed);
  const n = Math.max(4, Math.min(24, Math.round(ms / 40)));
  const out: { x: number; y: number; r: number }[] = [{ x: 0, y: 0, r: 0 }];
  let ang = rnd() * Math.PI * 2;
  for (let i = 1; i < n; i++) {
    const decay = (1 - i / n) ** 2;
    // Alternate roughly opposite directions so the motion reads as a shake, not a drift.
    ang += Math.PI + (rnd() - 0.5) * 1.6;
    const a = px * decay * (0.7 + 0.3 * rnd());
    out.push({
      x: Math.round(Math.cos(ang) * a * 10) / 10,
      y: Math.round(Math.sin(ang) * a * 10) / 10,
      r: Math.round((rnd() - 0.5) * 0.25 * a * 100) / 100,
    });
  }
  out.push({ x: 0, y: 0, r: 0 });
  return out;
}
