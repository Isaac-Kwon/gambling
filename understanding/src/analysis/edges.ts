/**
 * Exact long-run return per game, from shared/rules (ARCHITECTURE §10.1: never hardcode edges).
 * Cheap closed forms only — `slotFormula` counts strip symbols (no 32^5 enumeration), the ocean bonus term comes
 * from its table — so this is safe on the main thread. Computed once per slot variant and cached.
 */
import type { GameId, SlotVariant } from "@shared/config";
import { CRASH } from "@shared/rules/crash";
import { OCEAN } from "@shared/rules/ocean";
import { rouletteExact } from "@shared/rules/roulette";
import { SLOTS, slotFormula } from "@shared/rules/slot";
import { BLACKJACK_EDGE } from "./constants";

/** Expected return per credit staked (1 − house edge), by game. */
export type ReturnTable = Readonly<Record<GameId, number>>;

const cache = new Map<SlotVariant, ReturnTable>();

/** Ocean: reel return + P(trigger) × E[bonus multiple]. Exact (ARCHITECTURE §8.1); independent of the slot variant. */
export function oceanReturn(): number {
  let sw = 0, swm = 0;
  for (const b of OCEAN.bonus) { sw += b.w; swm += b.w * b.mult; }
  return slotFormula(OCEAN.slot).ret + swm / sw / OCEAN.triggerDen;
}

/**
 * Returns by game for a session of slot variant `sv` (absent = "a").
 * slot: exact for the variant; ocean: exact 91.98%; roulette: 36/37 for every bet; crash: 1 − edge for any target
 * or cash-out point; blackjack: basic-strategy measurement per initial stake (constants.ts).
 */
export function returnTable(sv: SlotVariant = "a"): ReturnTable {
  const hit = cache.get(sv);
  if (hit) return hit;
  const t: ReturnTable = Object.freeze({
    slot: slotFormula(SLOTS[sv] ?? SLOTS.a).ret,
    ocean: oceanReturn(),
    roulette: rouletteExact({ kind: "red" }),
    crash: 1 - CRASH.edge,
    blackjack: 1 - BLACKJACK_EDGE,
  });
  cache.set(sv, t);
  return t;
}

/** House edge (1 − return) by game. */
export function edgeOf(game: GameId, sv: SlotVariant = "a"): number {
  return 1 - returnTable(sv)[game];
}
