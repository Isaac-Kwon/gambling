import type { GameId } from "./config";

export type State4 = [number, number, number, number];

export interface Rng {
  /** Uniform integer in [0, 2^32). */
  u32(): number;
  /** Uniform float in [0, 1): u32 / 2^32. */
  float(): number;
  /** Uniform integer in [0, n), rejection sampling (no modulo bias). n must be an integer in [1, 2^32]. */
  int(n: number): number;
  /** Index drawn with probability w[i] / sum(w). Integer weights >= 0, sum > 0. */
  weighted(w: readonly number[]): number;
  /** Fisher-Yates, in place; returns the same array. */
  shuffle<T>(a: T[]): T[];
}

const TWO32 = 4294967296;

/** cyrb128 string hash (bryc): string -> four 32-bit words. */
export function cyrb128(s: string): State4 {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** xoshiro128** over a copy of `state`. An all-zero state is replaced by s[0] = 1. */
export function xoshiro128ss(state: State4): Rng {
  let s0 = state[0] | 0, s1 = state[1] | 0, s2 = state[2] | 0, s3 = state[3] | 0;
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const u32 = (): number => {
    const m = Math.imul(s1, 5);
    const r = Math.imul((m << 7) | (m >>> 25), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t;
    s3 = (s3 << 11) | (s3 >>> 21);
    return r;
  };

  const int = (n: number): number => {
    if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new RangeError(`int(n): n must be an integer in [1, 2^32], got ${n}`);
    if (n === 1) return 0;
    const limit = TWO32 - (TWO32 % n);   // accept x < limit
    let x = u32();
    while (x >= limit) x = u32();
    return x % n;
  };

  return {
    u32,
    float: () => u32() / TWO32,
    int,
    weighted(w) {
      let total = 0;
      for (const x of w) total += x;
      if (!(total > 0)) throw new RangeError("weighted: total weight must be > 0");
      let r = int(total);
      for (let i = 0; i < w.length; i++) {
        if (r < w[i]) return i;
        r -= w[i];
      }
      throw new RangeError("weighted: unreachable");
    },
    shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
  };
}

/** Sequential stream for (seed, label), for simulations and rtp-check. Not the same stream as at(n). */
export function createRng(seed: string, label: string): Rng {
  return xoshiro128ss(cyrb128(seed + "|" + label));
}

export interface RoundRng {
  /** Fresh generator for round n, seeded from `seed|label|n`. Independent of call order and of other rounds. */
  at(n: number): Rng;
}
export function createRoundRng(seed: string, label: string): RoundRng {
  return { at: (n) => xoshiro128ss(cyrb128(seed + "|" + label + "|" + n)) };
}

export interface Streams {
  /** Outcome stream, label `res:<game>`. */
  res(g: GameId): RoundRng;
  /** Presentation stream, label `pre:<game|lobby|fx>`. */
  pre(k: GameId | "lobby" | "fx"): RoundRng;
}
export function createStreams(seed: string): Streams {
  return {
    res: (g) => createRoundRng(seed, "res:" + g),
    pre: (k) => createRoundRng(seed, "pre:" + k),
  };
}

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
/** 10 chars of [a-z0-9] from crypto.getRandomValues (rejection sampling, unbiased). */
export function randomSeed(): string {
  let out = "";
  const buf = new Uint8Array(16);
  while (out.length < 10) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < 10; i++) {
      if (buf[i] < 252) out += ALNUM[buf[i] % 36];   // 252 = 7 * 36
    }
  }
  return out;
}
