/**
 * Deterministic player scripts for the headless runner. They only use what the screen shows (the bet steps),
 * never outcomes, so a script is the same whatever the fx mode.
 */
import type { SlotStep } from "./run";

/** Bet step index pattern (changes every 10 spins). */
const BET_PATTERN = [0, 1, 2, 1, 3, 0, 4, 2, 5, 1] as const;

/**
 * `n` manual slot spins: the bet step changes every 10 spins, STOP on every 7th spin, turbo on spins 35..49 of
 * every 50, a swipe on every 4th spin.
 */
export function slotBot(n: number): SlotStep[] {
  const out: SlotStep[] = [];
  for (let i = 0; i < n; i++) {
    const st: SlotStep = { gesture: i % 4 === 3 ? "swipe" : "tap" };
    if (i % 10 === 0) st.bet = BET_PATTERN[(i / 10) % BET_PATTERN.length];
    if (i % 50 === 0) st.turbo = false;
    if (i % 50 === 35) st.turbo = true;
    if (i % 7 === 6) st.stop = true;
    out.push(st);
  }
  return out;
}

/** Flat bet, no STOP, no turbo: `n` spins at step `bet`. */
export function slotFlat(n: number, bet = 0): SlotStep[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? { bet, turbo: false } : {}));
}
