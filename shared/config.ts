export type GameId = "slot" | "roulette" | "blackjack" | "crash" | "ocean";

export const START_CREDITS = 10_000;
export const MIN_BET: Record<GameId, number> = { slot: 20, ocean: 20, roulette: 10, blackjack: 20, crash: 100 };
/** bust <=> balance < MIN_BET_GLOBAL */
export const MIN_BET_GLOBAL = 10;
export const BET_STEPS = {
  slot: [20, 40, 100, 200, 400, 1000],
  ocean: [20, 40, 100, 200],
  crash: [100, 200, 500, 1000, 2000],
} as const;
export const CHIPS = { roulette: [10, 50, 100, 500], blackjack: [20, 100, 500] } as const;
/** Minimum payout/bet multiples for tiers 1..4 (NICE, BIG, MEGA, EPIC). */
export const TIER_MIN = [2, 5, 15, 50] as const;
/** 0 = below TIER_MIN[0] (including no payout); 1 NICE, 2 BIG, 3 MEGA, 4 EPIC. */
export type Tier = 0 | 1 | 2 | 3 | 4;

/**
 * Tier of a round by payout multiple (payout / bet). `payout` is the total returned to the wallet
 * including the stake. bet <= 0 or payout <= 0 gives 0.
 */
export function tierOf(payout: number, bet: number): Tier {
  if (!(bet > 0) || !(payout > 0)) return 0;
  const m = payout / bet;
  if (m >= TIER_MIN[3]) return 4;
  if (m >= TIER_MIN[2]) return 3;
  if (m >= TIER_MIN[1]) return 2;
  if (m >= TIER_MIN[0]) return 1;
  return 0;
}

/** Slot math variant for A/B feel testing; same RTP, different hit rate. Ocean is unaffected. Chosen by hidden URL param `?sv=b`. */
export type SlotVariant = "a" | "b";
export const SLOT_VARIANTS = ["a", "b"] as const satisfies readonly SlotVariant[];
export const DEFAULT_SLOT_VARIANT: SlotVariant = "a";
