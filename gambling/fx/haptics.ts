/**
 * Vibration (`Haptics`, fx/types.ts). Uses navigator.vibrate where it exists (Android Chrome);
 * iOS Safari and desktop have none, so every call is a silent no-op there. Never throws.
 * Every pattern is normalized and truncated so its total (on + off) is <= HAPTIC_CAP_MS.
 */
import type { Haptics } from './types';

export const HAPTIC_CAP_MS = 600;

/** Tier patterns (index = celebrate tier 0..4). Escalate in length and density; each fits the cap. */
export const TIER_HAPTIC: readonly (readonly number[])[] = [
  [18],
  [30, 60, 30],
  [45, 50, 45, 50, 80],
  [50, 40, 50, 40, 60, 40, 140],
  [60, 40, 60, 40, 60, 40, 100, 60, 140],
];

/** Omen grades 1 (clam) / 2 (shark, lub-dub) / 3 (whale, long rumble). Index 0 unused. */
export const OMEN_HAPTIC: readonly (readonly number[])[] = [[], [40, 120, 40], [60, 80, 40, 200, 60, 80, 40], [160, 80, 160, 80, 120]];

export const TAP_HAPTIC = 10;

/**
 * Clean a pattern: numbers only, rounded, negatives/NaN -> 0, total (on + off) capped at `cap`
 * (the entry that crosses the cap is shortened), trailing pauses removed.
 */
export function normPattern(p: number | readonly number[], cap = HAPTIC_CAP_MS): number[] {
  const src = typeof p === 'number' ? [p] : Array.isArray(p) ? p : [];
  const out: number[] = [];
  let total = 0;
  for (const raw of src) {
    if (total >= cap) break;
    const v = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    const take = Math.min(v, cap - total);
    out.push(take);
    total += take;
  }
  while (out.length && (out.length % 2 === 0 || out[out.length - 1] === 0)) out.pop();
  return out;
}

/** Sum of the vibrating (even-index) entries of a normalized pattern: what `haptic` records as `k`. */
export function vibeMs(p: number | readonly number[]): number {
  return normPattern(p).reduce((s, v, i) => (i % 2 === 0 ? s + v : s), 0);
}

export interface HapticsNav {
  vibrate?: (pattern: number | number[]) => boolean;
  userActivation?: { readonly hasBeenActive: boolean };
}

export interface HapticsOptions {
  /** Default: globalThis.navigator. Null disables. */
  nav?: HapticsNav | null;
}

export interface HapticsEngine extends Haptics {
  /** True when navigator.vibrate exists. */
  readonly supported: boolean;
  setEnabled(on: boolean): void;
}

export function createHaptics(o: HapticsOptions = {}): HapticsEngine {
  const nav: HapticsNav | null =
    o.nav !== undefined ? o.nav : ((globalThis as { navigator?: HapticsNav }).navigator ?? null);
  let enabled = true;
  const supported = (): boolean => {
    try {
      return !!nav && typeof nav.vibrate === 'function';
    } catch {
      return false;
    }
  };
  return {
    get supported() {
      return supported();
    },
    setEnabled(on: boolean) {
      enabled = !!on;
    },
    pulse(pattern: number | number[]): void {
      try {
        if (!enabled || !nav || !supported()) return;
        // Chrome ignores (and warns about) vibrate before the first user gesture; skip quietly instead.
        const ua = nav.userActivation;
        if (ua && ua.hasBeenActive === false) return;
        const p = normPattern(pattern);
        if (!p.length || vibeMs(p) <= 0) return;
        nav.vibrate!.call(nav, p.length === 1 ? p[0]! : p);
      } catch {
        /* never throw */
      }
    },
  };
}
