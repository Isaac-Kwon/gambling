/**
 * The ONE place where the gambling page's neutral log names get their meaning (ARCHITECTURE §0.3, §10.1).
 * The game logs what it showed and did under deliberately plain names (`dispVar`, `celebrate`, `antic`, `ticker`,
 * `crowd` …); everything in understanding that needs "near-miss", "loss disguised as a win", "fake social proof"
 * and so on asks this module. No other analysis file reads a neutral display field directly.
 *
 * Field facts this relies on (docs/DECISIONS.md, shared/schema.ts):
 *  - `disp.tier` is recorded in both fx modes; `celebrate`, `dispVar`, `antic`, `omen` (disp), `ticket`, `crowd`
 *    only when actually shown (never with fx=off).
 *  - `celebrate` is set whenever payout > 0 with fx on — including payouts below the bet and blackjack pushes
 *    (push celebrates at tier 0).
 *  - `dispVar` lives only in the half-visible peek cells above/below the reels; the three real rows are always
 *    the true result (§7.5).
 *  - `Ev.fx` holds only real stimuli; `sfx:card`/`sfx:chip` are recorded, UI `tap`/`tick` are not.
 *  - The ocean flush Ev (`dec.flush`) is not a round (bet 0, no out/disp/ctl, empty fx).
 */
import { tierOf, type GameId } from "@shared/config";
import type { Aux, Ev, Session } from "@shared/schema";
import { BIG_TIER } from "./constants";

// ------------------------------------------------------------------------------------------- the table

export type Meaning =
  | "nearMiss" | "ldw" | "celebratedPush" | "celebration" | "anticipation" | "bigWin"
  | "fakeTicker" | "fakeHot" | "fakeCrowd"
  | "controlStop" | "controlSwipe" | "controlManualCashout" | "controlTurbo" | "controlAuto"
  | "chase" | "omen" | "bonusTrigger" | "bonusRelease" | "bonusFlush" | "notARound";

/** Documentation table (also usable by a "how we read your log" disclosure). `field` is the neutral source. */
export const MAPPING: readonly { meaning: Meaning; field: string; rule: string }[] = [
  { meaning: "nearMiss", field: "Ev.disp.dispVar.cells", rule: "a 7 was drawn in a peek cell next to a non-jackpot result (slot, ocean)" },
  { meaning: "celebration", field: "Ev.disp.celebrate", rule: "a win celebration was shown" },
  { meaning: "ldw", field: "Ev.disp.celebrate && 0 < payout < bet", rule: "celebrated although the round lost money" },
  { meaning: "celebratedPush", field: "Ev.disp.celebrate && payout === bet", rule: "celebrated although nothing was won (blackjack push)" },
  { meaning: "anticipation", field: "Ev.disp.antic; Ev.fx antic:* / sfx:rise / sfx:heartbeat", rule: "reels slowed with glow and heartbeat (slot, ocean); rising pitch (crash)" },
  { meaning: "bigWin", field: "Ev.disp.tier >= 2", rule: "BIG WIN or above (payout ≥ 5× bet)" },
  { meaning: "fakeTicker", field: "Session.aux kind ticker {name, game, amt}", rule: "invented 'recent winner' line shown in the lobby" },
  { meaning: "fakeHot", field: "Session.aux kind hot {games}", rule: "random HOT badge on a game card" },
  { meaning: "fakeCrowd", field: "Session.aux kind crowd {n}; Ev.disp.crowd", rule: "invented players shown cashing out (crash)" },
  { meaning: "controlStop", field: "Ev.ctl.stopPressed", rule: "STOP pressed — only shortens the animation, result already fixed" },
  { meaning: "controlSwipe", field: "Ev.ctl.gesture === 'swipe'", rule: "spin by swipe — same result as a tap" },
  { meaning: "controlManualCashout", field: "Ev.dec.manualCashoutAt", rule: "manual cash-out tap (crash) — any cash-out point returns 99%" },
  { meaning: "controlTurbo", field: "Ev.ctl.turbo", rule: "turbo — faster animation, same result" },
  { meaning: "controlAuto", field: "Ev.ctl.auto", rule: "auto spin" },
  { meaning: "chase", field: "stake of a round > stake of the previous round of the same game, which lost (net < 0)", rule: "bet raised right after a loss" },
  { meaning: "omen", field: "Ev.out.omen (honest) / Ev.disp.omen (shown)", rule: "the creature that announces an already-fixed bonus (ocean)" },
  { meaning: "bonusTrigger", field: "Ev.dec.queued without releasedFromSeq, or Ev.dec.trig", rule: "bonus total fixed at this round (ocean)" },
  { meaning: "bonusRelease", field: "Ev.dec.releasedFromSeq; Ev.out.seqPay", rule: "a chunk of an already-fixed bonus paid out (ocean)" },
  { meaning: "bonusFlush", field: "Ev.dec.flush", rule: "rest of the queue paid at session end without spinning" },
  { meaning: "notARound", field: "Ev.dec.flush", rule: "excluded from round counts, celebrations, chase, max win" },
];

// ------------------------------------------------------------------------------------------- raw accessors

type Disp = { tier?: number; celebrate?: boolean; dispVar?: { cells?: [number, "a" | "b"][] }; antic?: number; omen?: string; ticket?: number; crowd?: number; board?: number[] };
type Dec = Record<string, unknown> & {
  flush?: boolean; bonusSeqId?: number; queued?: number; releasedFromSeq?: boolean;
  trig?: { bonusSeqId: number; queued: number }; seqs?: { id: number; amount: number }[];
  target?: number | null; manualCashoutAt?: number | null;
};
const disp = (e: Ev): Disp => (e.disp ?? {}) as Disp;
const dec = (e: Ev): Dec => (e.dec ?? {}) as Dec;
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Ocean end-of-session lump sum (not a round). */
export const isFlush = (e: Ev): boolean => dec(e).flush === true;
/** Settled rounds only (flush Evs removed), keeping their index in `s.events`. */
export function roundsOf(s: Pick<Session, "events">): { e: Ev; i: number }[] {
  const out: { e: Ev; i: number }[] = [];
  s.events.forEach((e, i) => { if (!isFlush(e)) out.push({ e, i }); });
  return out;
}
/** Settlement time (te, else start time). */
export const timeOf = (e: Ev): number => e.te ?? e.t;

// ------------------------------------------------------------------------------------------- per-round meanings

/** Tier shown/decided for the round (disp.tier, else recomputed from payout/bet). */
export const tierOfEv = (e: Ev): number => num(disp(e).tier) ?? tierOf(e.payout, e.bet);

/** Near-miss display: number of peek cells where a 7 was drawn (0 = none). */
export const nearMissCells = (e: Ev): number => (isFlush(e) ? 0 : disp(e).dispVar?.cells?.length ?? 0);
export const isNearMiss = (e: Ev): boolean => nearMissCells(e) > 0;

export const isCelebrated = (e: Ev): boolean => !isFlush(e) && disp(e).celebrate === true;
/** Loss disguised as a win: celebrated, paid something, but less than the stake. */
export const isLdw = (e: Ev): boolean => isCelebrated(e) && e.payout > 0 && e.payout < e.bet;
/** Celebrated although net 0 (blackjack push). */
export const isCelebratedPush = (e: Ev): boolean => isCelebrated(e) && e.payout === e.bet;
/** A real win (net > 0). */
export const isNetWin = (e: Ev): boolean => !isFlush(e) && e.net > 0;
/** Lost the whole stake (nothing came back). */
export const isZeroPayout = (e: Ev): boolean => !isFlush(e) && e.bet > 0 && e.payout === 0;
/** Something came back but less than the stake (whether or not it was celebrated). */
export const isPartialReturn = (e: Ev): boolean => !isFlush(e) && e.payout > 0 && e.payout < e.bet;

/** Reels slowed by the build-up (slot / ocean), 0 = none. */
export const anticReels = (e: Ev): number => (isFlush(e) ? 0 : num(disp(e).antic) ?? 0);
export const isBigWin = (e: Ev, bigTier = BIG_TIER): boolean => !isFlush(e) && tierOfEv(e) >= bigTier;

/** Illusion-of-control inputs. */
export const stopPressed = (e: Ev): boolean => e.ctl?.stopPressed === true;
export const swiped = (e: Ev): boolean => e.ctl?.gesture === "swipe";
export const turbo = (e: Ev): boolean => e.ctl?.turbo === true;
export const autoSpin = (e: Ev): boolean => e.ctl?.auto === true;
/** Crash: multiplier of a manual cash-out tap, null when none. */
export const manualCashoutAt = (e: Ev): number | null => (e.game === "crash" ? num(dec(e).manualCashoutAt) : null);
/** Crash: auto cash-out target set for the round, null when none. */
export const crashTarget = (e: Ev): number | null => (e.game === "crash" ? num(dec(e).target) : null);

/** Fake crowd size shown on the round (crash), null when none was shown. */
export const crowdShown = (e: Ev): number | null => num(disp(e).crowd);

// ------------------------------------------------------------------------------------------- stake and chase

/**
 * The stake the player chose before the round started. Equals `bet` except in blackjack, where `bet` also holds
 * doubles and splits (each adds exactly one initial stake: no resplit, a double doubles a hand of one stake).
 */
export function stakeOf(e: Ev): number {
  if (e.game !== "blackjack") return e.bet;
  const steps = (dec(e).steps as { action?: string }[] | undefined) ?? [];
  let extra = 0;
  for (const s of steps) if (s.action === "D" || s.action === "P") extra++;
  return e.bet / (1 + extra);
}

/**
 * Indices (into s.events) of rounds whose stake was raised right after a losing round (net < 0) of the same game.
 * The flush is skipped. Same rule as shared/handoff summarize().chase, except that blackjack compares initial
 * stakes (a double/split inside the losing round is not "the previous bet").
 */
export function chaseIndices(s: Pick<Session, "events">): number[] {
  const prev: Partial<Record<GameId, Ev>> = {};
  const out: number[] = [];
  s.events.forEach((e, i) => {
    if (isFlush(e)) return;
    const p = prev[e.game];
    if (p && p.net < 0 && stakeOf(e) > stakeOf(p)) out.push(i);
    prev[e.game] = e;
  });
  return out;
}

// ------------------------------------------------------------------------------------------- ocean meanings

export type OmenKind = "clam" | "shark" | "whale";
const OMENS: readonly string[] = ["clam", "shark", "whale"];
/** The creature announced on this round (honest outcome field; present with fx off too). */
export function omenOf(e: Ev): OmenKind | null {
  if (e.game !== "ocean" || isFlush(e)) return null;
  const o = (e.out as { omen?: unknown } | undefined)?.omen ?? disp(e).omen;
  return typeof o === "string" && OMENS.includes(o) ? (o as OmenKind) : null;
}
/** The creature was actually shown (fx on). */
export const omenShown = (e: Ev): boolean => typeof disp(e).omen === "string";

/** A bonus sequence fixed (triggered) on this round: its id and absolute total. */
export function bonusTrigger(e: Ev): { seqId: number; total: number } | null {
  if (e.game !== "ocean" || isFlush(e)) return null;
  const d = dec(e);
  if (d.trig && num(d.trig.bonusSeqId) !== null) return { seqId: d.trig.bonusSeqId, total: num(d.trig.queued) ?? 0 };
  if (!d.releasedFromSeq && num(d.bonusSeqId) !== null && num(d.queued) !== null) return { seqId: d.bonusSeqId as number, total: d.queued as number };
  return null;
}
/** A chunk of a bonus paid on this round: sequence id, amount, what is left of that sequence. */
export function bonusRelease(e: Ev): { seqId: number; amount: number; left: number } | null {
  if (e.game !== "ocean" || isFlush(e)) return null;
  const d = dec(e);
  if (!d.releasedFromSeq || num(d.bonusSeqId) === null) return null;
  const out = (e.out ?? {}) as { seqPay?: unknown; basePay?: unknown };
  const amount = num(out.seqPay) ?? Math.max(0, e.payout - (num(out.basePay) ?? 0));
  return { seqId: d.bonusSeqId as number, amount, left: num(d.queued) ?? 0 };
}
/** The flush: amount and the sequences it closed. */
export function bonusFlush(e: Ev): { amount: number; seqs: { id: number; amount: number }[] } | null {
  if (!isFlush(e)) return null;
  const d = dec(e);
  const seqs = Array.isArray(d.seqs) ? d.seqs : num(d.bonusSeqId) !== null ? [{ id: d.bonusSeqId as number, amount: e.payout }] : [];
  return { amount: e.payout, seqs };
}

// ------------------------------------------------------------------------------------------- aux (not tied to a round)

export type FakeElement =
  | { kind: "ticker"; t: number; name: string; game: string; amt: number }
  | { kind: "hot"; t: number; games: string[] }
  | { kind: "crowd"; t: number; n: number; game: string; round: number | null };

/** One aux record as a fake element (ticker line, HOT badge, crowd), or null for anything else. */
export function fakeOfAux(a: Aux): FakeElement | null {
  const d = (a.d ?? {}) as Record<string, unknown>;
  if (a.kind === "ticker") return { kind: "ticker", t: a.t, name: String(d.name ?? ""), game: String(d.game ?? ""), amt: num(d.amt) ?? 0 };
  if (a.kind === "hot") return { kind: "hot", t: a.t, games: Array.isArray(d.games) ? d.games.map(String) : [] };
  if (a.kind === "crowd") return { kind: "crowd", t: a.t, n: num(d.n) ?? 0, game: String(d.game ?? "crash"), round: num(d.round) };
  return null;
}

// ------------------------------------------------------------------------------------------- fx records

export type FxCategory = "reward" | "anticipation" | "omen" | "process" | "other";
/** Sensory channel of an fx record (for "how many senses were hit"). */
export type FxChannel = "sound" | "visual" | "particles" | "motion" | "haptic";

/**
 * reward = celebration of a payout (banner, count-up, win jingles, coins, particles, shake, flash, haptics, tickets);
 * anticipation = build-up (reel slowdown, heartbeat, rising pitch); omen = the ocean creature;
 * process = the ordinary sounds of operating the game (reel spin/stop, cards, chips).
 */
export function fxCategory(type: string): FxCategory {
  if (type.startsWith("antic:") || type === "sfx:rise" || type === "sfx:heartbeat") return "anticipation";
  if (type === "omen" || type === "sfx:omen" || type === "particles:bubbles") return "omen";
  if (type === "sfx:spin" || type === "sfx:stop" || type === "sfx:card" || type === "sfx:chip" || type === "sfx:tap" || type === "sfx:tick") return "process";
  if (type === "tier" || type === "countup" || type === "shake" || type === "flash" || type === "haptic" || type === "ticket"
    || type.startsWith("sfx:win") || type === "sfx:coin" || type === "sfx:ticket" || type === "sfx:level" || type.startsWith("particles:")) return "reward";
  return "other";
}
export function fxChannel(type: string): FxChannel {
  if (type.startsWith("sfx:")) return "sound";
  if (type.startsWith("particles:")) return "particles";
  if (type === "shake") return "motion";
  if (type === "haptic") return "haptic";
  return "visual";
}
