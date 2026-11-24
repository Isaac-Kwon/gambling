import { tierOf, type Tier } from "../../shared/config";
import { countupMs } from "./countup";
import type { SfxName } from "./types";

/**
 * Celebration bundles by tier (ARCHITECTURE §6.4). Pure data + one pure planner.
 * Tier is decided only by this round's payout / bet (BASE_PROMPT §5.2); cumulative results never matter.
 */
export interface TierStyle {
  /** Banner on screen, upper limit (0 = no banner). */
  bannerMs: number;
  coins: number;
  confetti: number;
  rays: boolean;
  /** Shake amplitude in px (0 = none). Only tier 2+. */
  shakePx: number;
  shakeMs: number;
  /** Planned flash times, ms after the start. Each one still asks the flash guard. */
  flashAt: readonly number[];
  sfx: SfxName;
  /** Max gain 0..1 of the win jingle. */
  gain: number;
  /** navigator.vibrate pattern; vibration total <= 600 ms. */
  haptic: readonly number[];
}

export const TIER_STYLE: Readonly<Record<Tier, TierStyle>> = {
  0: { bannerMs: 0, coins: 0, confetti: 0, rays: false, shakePx: 0, shakeMs: 0, flashAt: [], sfx: "win0", gain: 0.5, haptic: [18] },
  1: { bannerMs: 1200, coins: 20, confetti: 0, rays: false, shakePx: 0, shakeMs: 0, flashAt: [], sfx: "win1", gain: 0.6, haptic: [40] },
  2: { bannerMs: 2500, coins: 60, confetti: 0, rays: true, shakePx: 4, shakeMs: 450, flashAt: [], sfx: "win2", gain: 0.7, haptic: [60, 50, 60] },
  3: { bannerMs: 4000, coins: 120, confetti: 80, rays: true, shakePx: 6, shakeMs: 650, flashAt: [0, 650], sfx: "win3", gain: 0.85, haptic: [80, 60, 80, 60, 140] },
  4: { bannerMs: 6000, coins: 200, confetti: 150, rays: true, shakePx: 8, shakeMs: 850, flashAt: [0, 950, 1900], sfx: "win4", gain: 1, haptic: [90, 50, 90, 50, 90, 50, 180] },
};

/** Banner caption keys (i18n namespace `tier`) and the English fallback used when a key is missing. */
export const TIER_LABEL: Readonly<Record<1 | 2 | 3 | 4, string>> = { 1: "NICE WIN", 2: "BIG WIN", 3: "MEGA WIN", 4: "EPIC WIN" };

/** Particle lifetimes by kind (ms). Coins get longer the bigger the tier. */
export function coinMs(tier: Tier): number {
  return 1700 + 300 * tier;
}
export const CONFETTI_MS = 3600;
/** Delay of the confetti cannons after the start, so they land on the banner's impact. */
export const CONFETTI_AT = 250;
/** Shake starts a beat after the banner slam. */
export const SHAKE_AT = 90;
/** Ray count requested for tier 2+ (the layer may draw fewer at low quality). */
export const RAY_COUNT = 12;
/** Duration of one flash (fast rise, slower fall). */
export const FLASH_MS = 160;
export const FLASH_COLOR = "#FFF6E0";

export interface CelebrationPlan {
  tier: Tier;
  /** Multiple payout / bet, 2 decimals. */
  mult: number;
  /** `k` of the `tier` record: 0.5 for a win below 2x, else the tier. */
  k: number;
  /** Planned ms of the `tier` record (banner, or the win-line emphasis for tier 0). */
  tierMs: number;
  countupMs: number;
  /** When the whole celebration is over (ms after start). */
  totalMs: number;
  style: TierStyle;
  shakePx: number;
}

/** null when nothing should happen (payout 0: loss is silent). payout < bet still celebrates at tier 0. */
export function planCelebration(amount: number, bet: number, o: { reducedMotion?: boolean } = {}): CelebrationPlan | null {
  if (!(amount > 0)) return null;
  const tier = tierOf(amount, bet);
  const mult = bet > 0 ? Math.round((amount / bet) * 100) / 100 : 0;
  const style = TIER_STYLE[tier];
  const cu = countupMs(mult);
  const tierMs = tier === 0 ? cu : style.bannerMs;
  return {
    tier, mult, k: tier === 0 ? 0.5 : tier, tierMs, countupMs: cu,
    totalMs: Math.max(cu, tierMs),
    style,
    shakePx: o.reducedMotion ? 0 : style.shakePx,
  };
}
