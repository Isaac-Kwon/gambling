import type { Rng } from "../rng";

export type RouletteBet =
  | { kind: "straight"; n: number }
  | { kind: "split"; a: number; b: number }
  | { kind: "red" | "black" | "odd" | "even" | "low" | "high" }
  | { kind: "dozen" | "column"; i: 1 | 2 | 3 };
export type Placed = { bet: RouletteBet; amt: number };

export const RED: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
export const BLACK: ReadonlySet<number> = new Set([
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
]);

/** European single-zero wheel, clockwise from 0. Display only. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const isCell = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 36;

/** Two cells are adjacent on the table layout (3 columns x 12 rows, 0 touches 1, 2, 3). */
function adjacent(a: number, b: number): boolean {
  if (!isCell(a) || !isCell(b) || a === b) return false;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 0) return hi <= 3;
  if (hi - lo === 3) return true;               // vertical neighbours
  return hi - lo === 1 && lo % 3 !== 0;         // same row
}

export function isValid(b: RouletteBet): boolean {
  switch (b.kind) {
    case "straight": return isCell(b.n);
    case "split": return adjacent(b.a, b.b);
    case "red": case "black": case "odd": case "even": case "low": case "high": return true;
    case "dozen": case "column": return b.i === 1 || b.i === 2 || b.i === 3;
    default: return false;
  }
}

export function spinWheel(rng: Rng): number {
  return rng.int(37);
}

/** Does the bet win when the ball lands on n? Zero loses every outside bet. */
export function wins(b: RouletteBet, n: number): boolean {
  if (!isValid(b) || !isCell(n)) return false;
  switch (b.kind) {
    case "straight": return n === b.n;
    case "split": return n === b.a || n === b.b;
    case "red": return RED.has(n);
    case "black": return BLACK.has(n);
    case "odd": return n !== 0 && n % 2 === 1;
    case "even": return n !== 0 && n % 2 === 0;
    case "low": return n >= 1 && n <= 18;
    case "high": return n >= 19;
    case "dozen": return n !== 0 && Math.ceil(n / 12) === b.i;
    case "column": return n !== 0 && (n % 3 === 0 ? 3 : n % 3) === b.i;
  }
}

/** Total returned per unit staked on a win (stake included). */
export function multOf(b: RouletteBet): number {
  switch (b.kind) {
    case "straight": return 36;
    case "split": return 18;
    case "dozen": case "column": return 3;
    default: return 2;
  }
}

/** Return for one bet at outcome n (stake included; 0 when lost). */
export function betReturn(p: Placed, n: number): number {
  return wins(p.bet, n) ? p.amt * multOf(p.bet) : 0;
}

/** Total return for a layout at outcome n, stake included. */
export function returnOf(placed: readonly Placed[], n: number): number {
  let t = 0;
  for (const p of placed) t += betReturn(p, n);
  return t;
}

export interface Settlement {
  n: number;
  totalBet: number;
  payout: number;
  net: number;
  lines: { bet: RouletteBet; amt: number; won: boolean; ret: number }[];
}

export function settle(placed: readonly Placed[], n: number): Settlement {
  let totalBet = 0, payout = 0;
  const lines = placed.map((p) => {
    const ret = betReturn(p, n);
    totalBet += p.amt;
    payout += ret;
    return { bet: p.bet, amt: p.amt, won: ret > 0, ret };
  });
  return { n, totalBet, payout, net: payout - totalBet, lines };
}

/** Exact expected return per unit staked, by enumerating all 37 outcomes. Always 36/37. */
export function rouletteExact(b: RouletteBet): number {
  let sum = 0;
  for (let n = 0; n <= 36; n++) if (wins(b, n)) sum += multOf(b);
  return sum / 37;
}
