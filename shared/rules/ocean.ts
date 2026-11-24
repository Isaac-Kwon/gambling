// ABYSS LEGEND machine rules (ARCHITECTURE.md 3, 5.6, 8). Pure functions; randomness only from the Rng argument.
import type { Rng } from "../rng";
import { SLOT_A, drawStops, evaluate, slotExact } from "./slot";
import type { SlotConfig, SlotResult } from "./slot";

export type Omen = "clam" | "shark" | "whale";

export interface OceanConfig {
  slot: SlotConfig;
  /** Trigger when rng.int(triggerDen) === 0. */
  triggerDen: 68;
  /** Bonus total multiple of the trigger round's bet, its integer weight, and the creature it maps to. */
  bonus: readonly { mult: number; w: number; omen: Omen }[];
  /** Number of release rounds [min, max] per creature. */
  release: Record<Omen, readonly [number, number]>;
  /** Rounds from trigger to the omen round [min, max]. */
  omenDelay: readonly [1, 3];
  cap: 1250;
}

const OCEAN_SLOT: SlotConfig = Object.freeze({
  id: "ocean",
  strips: SLOT_A.strips,
  lines: SLOT_A.lines,
  pay: Object.freeze({
    "7": [100, 500, 2000], B: [40, 150, 600], R: [30, 100, 400], C: [20, 60, 250], H: [12, 50, 200],
    s: [8, 25, 100], h: [8, 25, 100], c: [6, 20, 60], d: [6, 20, 60],
  } as const),
  top: "7",
});

/** Independent of the slot variant: always variant a's strips and lines with its own pay table. */
export const OCEAN: OceanConfig = Object.freeze({
  slot: OCEAN_SLOT,
  triggerDen: 68,
  bonus: Object.freeze([
    { mult: 5, w: 330, omen: "clam" }, { mult: 10, w: 300, omen: "clam" }, { mult: 15, w: 150, omen: "clam" },
    { mult: 30, w: 120, omen: "shark" }, { mult: 50, w: 60, omen: "shark" }, { mult: 100, w: 25, omen: "shark" },
    { mult: 250, w: 10, omen: "whale" }, { mult: 500, w: 4, omen: "whale" }, { mult: 1250, w: 1, omen: "whale" },
  ] as const),
  release: Object.freeze({ clam: [3, 5], shark: [4, 7], whale: [6, 10] } as const),
  omenDelay: Object.freeze([1, 3] as const),
  cap: 1250,
} as const);

/**
 * One bonus sequence. total = mult * bet in credits, fixed at the trigger round. chunks are paid in order
 * from index `next`. wait: rounds left until the omen (only counts down while at the queue head); -1 = omen shown.
 */
export interface OceanSeq {
  id: number; round: number; bet: number; mult: number; total: number; omen: Omen;
  delay: number; chunks: number[]; next: number; wait: number;
}
/** round: ocean rounds played so far. JSON-safe. */
export interface OceanState { round: number; nextId: number; queue: OceanSeq[] }
/** payout = basePay + seqPay; mult/wins/top5 describe the reels only. released.remaining: what is left in that sequence. */
export interface OceanResult extends SlotResult {
  basePay: number; seqPay: number; triggered?: OceanSeq; omen?: Omen;
  released?: { seqId: number; amount: number; remaining: number };
}

export function oceanInit(): OceanState {
  return { round: 0, nextId: 1, queue: [] };
}

/** Creature for a bonus multiple, from the config table (honest: it only depends on the size). */
export function omenOf(cfg: OceanConfig, mult: number): Omen {
  const b = cfg.bonus.find((x) => x.mult === mult);
  if (!b) throw new RangeError(`ocean: no bonus entry for ${mult}`);
  return b.omen;
}

const copySeq = (s: OceanSeq): OceanSeq => ({ ...s, chunks: s.chunks.slice() });
const leftOf = (s: OceanSeq): number => { let t = 0; for (let i = s.next; i < s.chunks.length; i++) t += s.chunks[i]; return t; };

/** Split total into n integer chunks, ascending weights 1 + U[0,1), last chunk takes the rounding remainder. */
function splitChunks(total: number, w: number[]): number[] {
  w.sort((a, b) => a - b);
  let sw = 0;
  for (const x of w) sw += x;
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < w.length - 1; i++) { const c = Math.floor((total * w[i]) / sw); out.push(c); used += c; }
  out.push(total - used);
  return out;
}

/**
 * One round. Random draws in order: 5 reel stops, trigger, then (on trigger) multiple, omen delay,
 * release count, chunk weights. The queue head advances without randomness. `st` is not modified.
 * `bet` must be a positive multiple of the line count (20).
 */
export function oceanSpin(cfg: OceanConfig, st: OceanState, rng: Rng, bet: number): { state: OceanState; result: OceanResult } {
  const nLines = cfg.slot.lines.length;
  if (!Number.isInteger(bet) || bet <= 0 || bet % nLines !== 0) throw new RangeError(`ocean: bet must be a positive multiple of ${nLines}`);
  const lineBet = bet / nLines;

  // 1. reels
  const stops = drawStops(cfg.slot, rng);
  const ev = evaluate(cfg.slot, stops);
  const basePay = ev.mult * lineBet;

  // trigger draws (all from the outcome stream, before any queue bookkeeping)
  let trig: { mult: number; omen: Omen; delay: number; chunks: number[] } | null = null;
  if (rng.int(cfg.triggerDen) === 0) {
    const b = cfg.bonus[rng.weighted(cfg.bonus.map((x) => x.w))];
    const [d0, d1] = cfg.omenDelay;
    const delay = d0 + rng.int(d1 - d0 + 1);
    const [r0, r1] = cfg.release[b.omen];
    const n = r0 + rng.int(r1 - r0 + 1);
    const w: number[] = [];
    for (let i = 0; i < n; i++) w.push(1 + rng.float());
    trig = { mult: b.mult, omen: b.omen, delay, chunks: splitChunks(b.mult * bet, w) };
  }

  const round = st.round + 1;
  const queue = st.queue.slice();
  let seqPay = 0;
  let omen: Omen | undefined;
  let released: OceanResult["released"];

  // 2. queue head
  if (queue.length > 0) {
    const h = copySeq(queue[0]);
    if (h.wait > 0) {
      h.wait--;
      if (h.wait === 0) { omen = h.omen; h.wait = -1; }
      queue[0] = h;
    } else {
      const amount = h.chunks[h.next];
      h.next++;
      seqPay = amount;
      released = { seqId: h.id, amount, remaining: leftOf(h) };
      if (h.next >= h.chunks.length) queue.shift(); else queue[0] = h;
    }
  }

  // 3. new sequence goes to the back
  let nextId = st.nextId;
  let triggered: OceanSeq | undefined;
  if (trig) {
    const total = trig.mult * bet;
    const seq: OceanSeq = { id: nextId++, round, bet, mult: trig.mult, total, omen: trig.omen, delay: trig.delay, chunks: trig.chunks, next: 0, wait: trig.delay };
    queue.push(seq);
    triggered = copySeq(seq);
  }

  const result: OceanResult = { stops, wins: ev.wins, mult: ev.mult, payout: basePay + seqPay, top5: ev.top5, basePay, seqPay };
  if (triggered) result.triggered = triggered;
  if (omen) result.omen = omen;
  if (released) result.released = released;
  return { state: { round, nextId, queue }, result };
}

/** Sum of every unpaid chunk in the queue. */
export function oceanPending(st: OceanState): number {
  let t = 0;
  for (const s of st.queue) t += leftOf(s);
  return t;
}

/**
 * Lump-sum payment of the whole queue (session end, ARCHITECTURE.md 8.3). null when the queue is empty.
 * No randomness, `round` unchanged, so later rounds are the same as without the flush. seqId = queue head.
 */
export function oceanFlush(st: OceanState): { state: OceanState; amount: number; seqId: number; seqs: { id: number; amount: number }[] } | null {
  if (st.queue.length === 0) return null;
  const seqs = st.queue.map((s) => ({ id: s.id, amount: leftOf(s) }));
  let amount = 0;
  for (const s of seqs) amount += s.amount;
  return { state: { round: st.round, nextId: st.nextId, queue: [] }, amount, seqId: st.queue[0].id, seqs };
}

/** base: reel return by full enumeration; bonus: E[mult] / triggerDen from the table; total = base + bonus. */
export function oceanExact(cfg: OceanConfig): { base: number; bonus: number; total: number } {
  const base = slotExact(cfg.slot).ret;
  let sw = 0, swm = 0;
  for (const b of cfg.bonus) { sw += b.w; swm += b.w * b.mult; }
  const bonus = swm / sw / cfg.triggerDen;
  return { base, bonus, total: base + bonus };
}

// ---- presentation (presentation stream only; called after the result is fixed) ----

/** Tickets for a round paying at least 10x its bet: clamp(round(payout / (5 * bet)), 2, 12). 0 otherwise. */
export function ticketCount(payout: number, bet: number): number {
  if (!(bet > 0) || payout < 10 * bet) return 0;
  return Math.min(12, Math.max(2, Math.round(payout / (5 * bet))));
}

/**
 * What the cabinet shows for a settled round. omen comes from the result (the queued sequence's creature,
 * never invented). serial: first ticket number 0..999999 from the presentation stream.
 */
export function oceanPresentation(r: OceanResult, bet: number, pre: Rng): { omen?: Omen; ticket?: number; serial?: number } {
  const out: { omen?: Omen; ticket?: number; serial?: number } = {};
  if (r.omen) out.omen = r.omen;
  const t = ticketCount(r.payout, bet);
  if (t > 0) { out.ticket = t; out.serial = pre.int(1_000_000); }
  return out;
}
