/**
 * Stimulus anatomy (BASE_PROMPT §6.3): what the game threw at the senses, round by round, against the money.
 * `ms` of an fx record is its planned duration, or the actual one when skipped. Records of one round overlap in
 * time, so "seconds" here are summed stimulus-seconds (the same measure as Summary.fxMsPos/fxMsNeg), not wall time;
 * `spanMs` (longest single record) is the closer bound on how long the round "felt" lit.
 * Win = net > 0. A loss disguised as a win counts as a losing round — that is the point of the split.
 */
import type { GameId } from "@shared/config";
import type { Ev, Session } from "@shared/schema";
import {
  fakeOfAux, fxCategory, fxChannel, crowdShown, isBigWin, isCelebrated, isFlush, isLdw, tierOfEv, timeOf,
  type FakeElement, type FxCategory, type FxChannel,
} from "./mapping";

export interface StimRow {
  /** Index in session.events. */
  i: number;
  t: number;
  game: GameId;
  round: number;
  bet: number;
  net: number;
  /** balance − startCredits after this round. */
  cumNet: number;
  tier: number;
  celebrated: boolean;
  ldw: boolean;
  /** Σ ms of every record. */
  ms: number;
  /** Σ ms without the "process" sounds (reel spin/stop, cards, chips): the stimuli that answer the outcome. */
  stimMs: number;
  byCategory: Record<FxCategory, number>;
  /** Longest single non-process record (ms). */
  spanMs: number;
  /** Sensory channels hit by non-process records (0..5: sound, visual, particles, motion, haptic). */
  channels: number;
  records: number;
}

const CATS: readonly FxCategory[] = ["reward", "anticipation", "omen", "process", "other"];

function rowOf(e: Ev, i: number, start: number): StimRow {
  const byCategory = { reward: 0, anticipation: 0, omen: 0, process: 0, other: 0 } as Record<FxCategory, number>;
  const ch = new Set<FxChannel>();
  let ms = 0, stimMs = 0, span = 0;
  const fx = e.fx ?? [];
  for (const r of fx) {
    const m = Number.isFinite(r.ms) && r.ms > 0 ? r.ms : 0;
    const c = fxCategory(r.type);
    byCategory[c] += m;
    ms += m;
    if (c !== "process") { stimMs += m; if (m > span) span = m; ch.add(fxChannel(r.type)); }
  }
  return {
    i, t: timeOf(e), game: e.game, round: e.round, bet: e.bet, net: e.net, cumNet: e.balance - start,
    tier: tierOfEv(e), celebrated: isCelebrated(e), ldw: isLdw(e),
    ms, stimMs, byCategory, spanMs: span, channels: ch.size, records: fx.length,
  };
}

/** One row per round (flush excluded) — the top/bottom pair of the stacked chart. */
export function stimulusSeries(s: Session): StimRow[] {
  const out: StimRow[] = [];
  s.events.forEach((e, i) => { if (!isFlush(e)) out.push(rowOf(e, i, s.startCredits)); });
  return out;
}

export interface FxSplit {
  winRounds: number;
  lossRounds: number;
  /** lossRounds / rounds (0 when no rounds). */
  lossRoundFrac: number;
  /** Stimulus-seconds (process sounds excluded) on winning / losing rounds. */
  winSec: number;
  lossSec: number;
  /** Of the losing-round seconds: celebrations of disguised losses / build-up and omens / the rest. */
  lossSecBy: { ldw: number; anticipation: number; omen: number; other: number };
  /** Same split counting every record (= Summary.fxMsPos / fxMsNeg in seconds). */
  winSecAll: number;
  lossSecAll: number;
  /** Rounds with no record at all (always every round with fx off). */
  silentRounds: number;
}

export function fxSplit(rows: readonly StimRow[]): FxSplit {
  let wr = 0, lr = 0, w = 0, l = 0, wa = 0, la = 0, silent = 0;
  const by = { ldw: 0, anticipation: 0, omen: 0, other: 0 };
  for (const r of rows) {
    if (r.records === 0) silent++;
    if (r.net > 0) { wr++; w += r.stimMs; wa += r.ms; continue; }
    lr++; l += r.stimMs; la += r.ms;
    const reward = r.byCategory.reward;
    if (r.ldw) by.ldw += reward;
    by.other += (r.ldw ? 0 : reward) + r.byCategory.other;
    by.anticipation += r.byCategory.anticipation;
    by.omen += r.byCategory.omen;
  }
  const n = wr + lr;
  const sec = (x: number) => x / 1000;
  return {
    winRounds: wr, lossRounds: lr, lossRoundFrac: n ? lr / n : 0,
    winSec: sec(w), lossSec: sec(l),
    lossSecBy: { ldw: sec(by.ldw), anticipation: sec(by.anticipation), omen: sec(by.omen), other: sec(by.other) },
    winSecAll: sec(wa), lossSecAll: sec(la), silentRounds: silent,
  };
}

/** Cumulative net at each BIG WIN-or-above moment ("you were down X when the screen said BIG WIN"). */
export function bigWinMoments(s: Session): { i: number; t: number; game: GameId; round: number; tier: number; payout: number; bet: number; cumNet: number }[] {
  const out: ReturnType<typeof bigWinMoments> = [];
  s.events.forEach((e, i) => {
    if (isBigWin(e)) out.push({ i, t: timeOf(e), game: e.game, round: e.round, tier: tierOfEv(e), payout: e.payout, bet: e.bet, cumNet: e.balance - s.startCredits });
  });
  return out;
}

export interface FakeList {
  tickers: Extract<FakeElement, { kind: "ticker" }>[];
  hot: Extract<FakeElement, { kind: "hot" }>[];
  crowds: Extract<FakeElement, { kind: "crowd" }>[];
  /** Σ invented winning amounts shown in the ticker. */
  tickerTotal: number;
  /** Σ invented players shown. */
  crowdTotal: number;
}

/**
 * Every fake element shown: ticker lines, HOT badges, crash crowds (from aux; crowds fall back to Ev.disp.crowd
 * for logs without the aux record). Empty with fx off (they are neither drawn nor logged).
 */
export function fakeElements(s: Session): FakeList {
  const out: FakeList = { tickers: [], hot: [], crowds: [], tickerTotal: 0, crowdTotal: 0 };
  for (const a of s.aux ?? []) {
    const f = fakeOfAux(a);
    if (!f) continue;
    if (f.kind === "ticker") { out.tickers.push(f); out.tickerTotal += f.amt; }
    else if (f.kind === "hot") out.hot.push(f);
    else { out.crowds.push(f); out.crowdTotal += f.n; }
  }
  if (out.crowds.length === 0) {
    for (const e of s.events) {
      const n = crowdShown(e);
      if (n !== null) { out.crowds.push({ kind: "crowd", t: e.t, n, game: e.game, round: e.round }); out.crowdTotal += n; }
    }
  }
  return out;
}

export { CATS as FX_CATEGORIES };
