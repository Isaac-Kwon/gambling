/**
 * ABYSS LEGEND case-study numbers (BASE_PROMPT §6.8 "my session", ARCHITECTURE §8.3, §10.6).
 * Facts the interpretation rests on: a bonus total is fixed in credits on its trigger round, before its omen; it
 * is paid chunk by chunk on later spins, or all at once at session end (flush). Staying seated did not change the
 * amount, so spins played after an omen were new bets, not the price of the bonus; and nothing pressed during
 * the release changed anything.
 */
import type { Session } from "@shared/schema";
import { oceanReturn } from "./edges";
import {
  autoSpin, bonusFlush, bonusRelease, bonusTrigger, isFlush, omenOf, omenShown, stopPressed, timeOf, turbo, type OmenKind,
} from "./mapping";

export interface OceanSeqInfo {
  seqId: number;
  /** Index (session.events) and round of the trigger: the amount was fixed here. */
  triggerI: number;
  triggerRound: number;
  /** Bet of the trigger round. */
  bet: number;
  /** Credits fixed at the trigger. */
  total: number;
  omen: OmenKind | null;
  omenI: number | null;
  /** Paid on spins / by the flush. */
  paidBySpins: number;
  paidByFlush: number;
  /** Index of the last payment (release or flush), null if still open at the end of the log. */
  doneI: number | null;
}

export interface OmenInfo {
  i: number;
  round: number;
  t: number;
  creature: OmenKind;
  /** Shown on screen (fx on); with fx off the omen is in the honest outcome only. */
  shown: boolean;
  seqId: number | null;
  /** Credits already fixed when the omen appeared. */
  fixedTotal: number;
  fixedAtRound: number | null;
  /** Ocean rounds played after this omen until its sequence was paid out (or the session ended). */
  roundsAfter: number;
  betAfter: number;
}

export interface Stretch { rounds: number; bet: number; avgBet: number | null }

export interface OceanAnalysis {
  rounds: number;
  wagered: number;
  seqs: OceanSeqInfo[];
  omens: OmenInfo[];
  /** Σ credits fixed before their omen appeared. */
  fixedAtOmens: number;
  /** Rounds after an omen while its (already fixed) bonus was being paid, vs every other ocean round. */
  afterOmen: Stretch & { expectedLoss: number };
  otherRounds: Stretch;
  /** Ocean rounds after the first omen round that were not omen rounds (= Summary.omen.after with fx on). */
  afterFirstOmen: { rounds: number; bet: number };
  /** Controls used in the after-omen stretch. Effect on payouts: 0. */
  controls: { rounds: number; stop: number; turbo: number; auto: number; betChanges: number; total: number; effect: 0 };
  /** The end-of-session lump sum (null when none). */
  flush: { i: number | null; t: number | null; amount: number; seqs: { id: number; amount: number }[] } | null;
  /** 1 − return of the machine (expected loss per credit staked). */
  edge: number;
}

const stretch = (rounds: number, bet: number): Stretch => ({ rounds, bet, avgBet: rounds ? bet / rounds : null });

export function oceanAnalysis(s: Session): OceanAnalysis | null {
  const seqs = new Map<number, OceanSeqInfo>();
  const order: number[] = [];
  const omens: OmenInfo[] = [];
  const oceanIdx: number[] = [];
  let flush: OceanAnalysis["flush"] = null;
  let wagered = 0;

  s.events.forEach((e, i) => {
    if (e.game !== "ocean") return;
    const f = bonusFlush(e);
    if (f) {
      flush = { i, t: timeOf(e), amount: f.amount, seqs: f.seqs };
      for (const x of f.seqs) { const q = seqs.get(x.id); if (q) { q.paidByFlush += x.amount; if (q.doneI === null) q.doneI = i; } }
      // a single-sequence flush without `seqs` closes every open sequence
      if (f.seqs.length <= 1) for (const q of seqs.values()) if (q.doneI === null) q.doneI = i;
      return;
    }
    oceanIdx.push(i);
    wagered += e.bet;
    // queue head first (release / omen), then the new trigger goes to the back — same order as oceanSpin
    const rel = bonusRelease(e);
    if (rel) {
      const q = seqs.get(rel.seqId);
      if (q) { q.paidBySpins += rel.amount; if (rel.left <= 0) q.doneI = i; }
    }
    const creature = omenOf(e);
    if (creature) {
      const id = order.find((k) => { const q = seqs.get(k)!; return q.omenI === null && q.doneI === null; });
      const q = id !== undefined ? seqs.get(id)! : null;
      if (q) { q.omen = creature; q.omenI = i; }
      omens.push({
        i, round: e.round, t: timeOf(e), creature, shown: omenShown(e), seqId: q?.seqId ?? null,
        fixedTotal: q?.total ?? 0, fixedAtRound: q?.triggerRound ?? null, roundsAfter: 0, betAfter: 0,
      });
    }
    const trig = bonusTrigger(e);
    if (trig && !seqs.has(trig.seqId)) {
      seqs.set(trig.seqId, {
        seqId: trig.seqId, triggerI: i, triggerRound: e.round, bet: e.bet, total: trig.total,
        omen: null, omenI: null, paidBySpins: 0, paidByFlush: 0, doneI: null,
      });
      order.push(trig.seqId);
    }
  });

  if (oceanIdx.length === 0 && !flush) {
    if (!s.unreleased) return null;
  }

  // after-omen stretch: rounds after an omen round up to (and including) the payment that closed its sequence
  const inWindow = new Set<number>();
  for (const o of omens) {
    const q = o.seqId !== null ? seqs.get(o.seqId) : undefined;
    const until = q?.doneI ?? Infinity;
    for (const i of oceanIdx) {
      if (i > o.i && i <= until) {
        inWindow.add(i);
        o.roundsAfter++;
        o.betAfter += s.events[i].bet;
      }
    }
  }
  let wBet = 0, oRounds = 0, oBet = 0;
  const ctl = { rounds: 0, stop: 0, turbo: 0, auto: 0, betChanges: 0, total: 0, effect: 0 as const };
  let prevBet: number | null = null;
  for (const i of oceanIdx) {
    const e = s.events[i];
    if (inWindow.has(i)) {
      wBet += e.bet;
      ctl.rounds++;
      if (stopPressed(e)) ctl.stop++;
      if (turbo(e)) ctl.turbo++;
      if (autoSpin(e)) ctl.auto++;
      if (prevBet !== null && e.bet !== prevBet) ctl.betChanges++;
    } else { oRounds++; oBet += e.bet; }
    prevBet = e.bet;
  }
  ctl.total = ctl.stop + ctl.turbo + ctl.auto + ctl.betChanges;

  let after = 0, afterBet = 0;
  if (omens.length) {
    const first = omens[0].i;
    for (const i of oceanIdx) if (i > first && !omenOf(s.events[i])) { after++; afterBet += s.events[i].bet; }
  }

  const edge = 1 - oceanReturn();
  if (!flush && s.unreleased) flush = { i: null, t: null, amount: s.unreleased, seqs: [] };
  let fixed = 0;
  for (const o of omens) fixed += o.fixedTotal;
  return {
    rounds: oceanIdx.length, wagered,
    seqs: order.map((k) => seqs.get(k)!),
    omens, fixedAtOmens: fixed,
    afterOmen: { ...stretch(inWindow.size, wBet), expectedLoss: wBet * edge },
    otherRounds: stretch(oRounds, oBet),
    afterFirstOmen: { rounds: after, bet: afterBet },
    controls: ctl,
    flush,
    edge,
  };
}

/** Convenience: is there anything ocean-specific to show? */
export const hasOcean = (s: Session): boolean => s.events.some((e) => e.game === "ocean" && !isFlush(e)) || !!s.unreleased;
