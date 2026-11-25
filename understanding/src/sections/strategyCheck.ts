// strategyCheck (BASE_PROMPT §6.5, CONTEXT §4.5, ARCHITECTURE §10.3).
// Per game the player actually played: what the log says about the choices (analysis/strategy.ts), then
// "your strategy vs random vs optimal" from the worker's `strategy` job, and for crash the target sweep
// (`crashTargets`). Slot and ocean get one line each: no choice changes their expected return.
//
// The exported functions above `render` are pure view-model helpers (unit tested in strategyCheck.test.ts).

import './strategyCheck.css';
import type { GameId } from '@shared/config';
import type { Session } from '@shared/schema';
import { CRASH } from '@shared/rules/crash';
import type { Section, SectionCtx } from './types';
import { strategyCheck as analyze, type BjDecision, type BlackjackCheck, type CrashCheck, type RouletteCheck } from '../analysis/strategy';
import { edgeOf, returnTable } from '../analysis/edges';
import { STREAK_MIN } from '../analysis/constants';
import { isFlush, stakeOf } from '../analysis/mapping';
import {
  buildModel, SimCancelled, type ArmId, type ArmResult, type CrashTargetsResult, type DistSummary, type SimRun,
  type StrategyModel, type StrategyResult,
} from '../sim';
import { scaled } from '../sim/protocol';
import type { Chart } from '../charts/kit';

// =========================================================================================== view model

/** Rounds per arm requested from the worker (spec: 10^5; the worker scales it on low-concurrency devices). */
export const STRATEGY_N = 100_000;
/** Rounds per crash target in the sweep. */
export const TARGETS_N = 100_000;
/** At least this many session-length blocks per arm, so the block histogram is not too coarse. */
export const MIN_BLOCKS = 200;

export type DecisionGame = 'blackjack' | 'roulette' | 'crash';
export const DECISION_GAMES: readonly DecisionGame[] = ['blackjack', 'roulette', 'crash'];
/** Display order of the arms (table, legend, chart series). */
export const ARM_ORDER: readonly ArmId[] = ['yours', 'optimal', 'random', 'machine'];

const GAME_IDS: readonly GameId[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];

/** Rounds per game (lump-sum flush events are not rounds). */
export function playedRounds(s: Pick<Session, 'events'>): Record<GameId, number> {
  const out = Object.fromEntries(GAME_IDS.map((g) => [g, 0])) as Record<GameId, number>;
  for (const e of s.events ?? []) if (e && e.game in out && !isFlush(e)) out[e.game]++;
  return out;
}

/** Mean initial stake per round of `game` (blackjack: the bet before doubles/splits). 0 when not played. */
export function avgStake(s: Pick<Session, 'events'>, game: GameId): number {
  let n = 0, sum = 0;
  for (const e of s.events ?? []) {
    if (!e || e.game !== game || isFlush(e)) continue;
    n++;
    sum += stakeOf(e);
  }
  return n > 0 ? sum / n : 0;
}

/** Block length for the "session-sized" distribution: the player's round count, capped so ≥ MIN_BLOCKS blocks fit. */
export function blockFor(rounds: number, nRun: number, minBlocks = MIN_BLOCKS): number {
  const cap = Math.max(1, Math.floor(nRun / minBlocks));
  return Math.max(1, Math.min(Math.floor(rounds) || 1, cap));
}

/**
 * Re-bins a histogram onto other edges, spreading each source bin's count uniformly over its width.
 * Mass outside the target range is dropped. A zero-width source bin goes wholly to the bin containing it.
 */
export function rebin(edges: ArrayLike<number>, counts: ArrayLike<number>, target: ArrayLike<number>): number[] {
  const nt = target.length - 1;
  const out = new Array<number>(Math.max(0, nt)).fill(0);
  if (nt <= 0) return out;
  const tLo = target[0], tHi = target[nt];
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i];
    if (!c) continue;
    const a = edges[i], b = edges[i + 1];
    if (!(b > a)) {
      if (a < tLo || a > tHi) continue;
      let k = 0;
      while (k < nt - 1 && target[k + 1] <= a) k++;
      out[k] += c;
      continue;
    }
    if (b <= tLo || a >= tHi) continue;
    for (let k = 0; k < nt; k++) {
      const lo = Math.max(a, target[k]), hi = Math.min(b, target[k + 1]);
      if (hi > lo) out[k] += (c * (hi - lo)) / (b - a);
    }
  }
  return out;
}

const armsSorted = (r: StrategyResult): ArmResult[] =>
  r.arms.slice().sort((a, b) => ARM_ORDER.indexOf(a.arm) - ARM_ORDER.indexOf(b.arm));

/** The block summary when present (session-length sums), else the per-round one. */
const shapeOf = (a: ArmResult): DistSummary => a.blocks ?? a.dist;

export interface Overlay {
  /** Bin centres, multiplied by `unit` (e.g. credits per stake). */
  x: number[];
  /** Share of blocks per bin (0..1), one series per arm, in ARM_ORDER. */
  series: { arm: ArmId; y: number[] }[];
}

/**
 * Overlaid distributions of the arms on one common grid: [lowest 1% quantile, highest 99% quantile] over all
 * arms, `bins` equal bins. Each arm's own histogram is re-binned onto it.
 */
export function armOverlay(r: StrategyResult, unit = 1, bins = 40): Overlay | null {
  const arms = armsSorted(r).filter((a) => shapeOf(a).n > 0);
  if (arms.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const a of arms) {
    const q = shapeOf(a).q;
    if (Number.isFinite(q[0])) lo = Math.min(lo, q[0]);
    if (Number.isFinite(q[q.length - 1])) hi = Math.max(hi, q[q.length - 1]);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (hi <= lo) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.02;
  lo -= pad; hi += pad;
  const w = (hi - lo) / bins;
  const target = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  const x = Array.from({ length: bins }, (_, i) => (lo + (i + 0.5) * w) * unit);
  const series = arms.map((a) => {
    const s = shapeOf(a);
    const c = rebin(s.hist.edges, s.hist.counts, target);
    return { arm: a.arm, y: c.map((v) => v / s.n) };
  });
  return { x, series };
}

export interface ArmRow {
  arm: ArmId;
  n: number;
  /** Mean net per round in stake units, with a 95% interval. */
  mean: number; lo: number; hi: number;
  sd: number;
  /** Share of session-length blocks that ended ahead (null without blocks). */
  ahead: number | null;
}

export function armRows(r: StrategyResult): ArmRow[] {
  return armsSorted(r).map((a) => ({
    arm: a.arm, n: a.n, mean: a.dist.mean, lo: a.dist.mean - 1.96 * a.dist.se, hi: a.dist.mean + 1.96 * a.dist.se,
    sd: a.dist.sd, ahead: a.blocks ? a.blocks.pPos : null,
  }));
}

/** Deviations with the largest expected loss first (unknown losses last). */
export function topDeviations(bj: BlackjackCheck, k = 6): BjDecision[] {
  const v = (d: BjDecision) => d.evLossCredits ?? -1;
  return bj.deviations.slice().sort((a, b) => v(b) - v(a) || a.i - b.i).slice(0, k);
}

export interface RouletteView {
  martingale: { detected: boolean; doublings: number; longest: number; maxStake: number };
  streak: { min: number; opportunities: number; against: number; with: number };
}

export function rouletteView(rc: RouletteCheck): RouletteView {
  const longest = rc.martingale.runs.reduce((m, r) => Math.max(m, r.len), 0);
  const maxStake = rc.martingale.runs.reduce((m, r) => Math.max(m, r.maxStake), 0);
  return {
    martingale: { detected: rc.martingale.detected, doublings: rc.martingale.doublings, longest, maxStake },
    streak: { min: STREAK_MIN, opportunities: rc.streak.opportunities, against: rc.streak.against, with: rc.streak.with },
  };
}

export interface CrashTargetRow { target: number; pWin: number; rtp: number; lo: number; hi: number; exact: number }

export function crashTargetRows(r: CrashTargetsResult): CrashTargetRow[] {
  return Array.from(r.targets, (target, k) => ({
    target, pWin: r.pWin[k], rtp: r.rtp[k], lo: r.rtp[k] - 1.96 * r.se[k], hi: r.rtp[k] + 1.96 * r.se[k], exact: r.exact[k],
  }));
}

/** Chosen-multiple histogram as bar data: x = bin index, labels "lo–hi" / "lo+". */
export function crashChosenBars(c: CrashCheck): { x: number[]; y: number[]; bins: { lo: number; hi: number }[] } {
  return { x: c.bins.map((_, i) => i), y: c.bins.map((b) => b.n), bins: c.bins.map((b) => ({ lo: b.lo, hi: b.hi })) };
}

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
/** "Ts" → "10♠". */
export function cardLabel(c: string): string {
  const r = c.charAt(0), s = c.charAt(1);
  return (r === 'T' ? '10' : r) + (SUIT[s] ?? s);
}

// =========================================================================================== DOM helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Fmt {
  int(v: number): string;
  num(v: number, digits?: number): string;
  pct(v: number, digits?: number): string;
  signedPct(v: number, digits?: number): string;
  mult(v: number): string;
  /** Two significant digits (axis ticks on a log scale). */
  sig(v: number): string;
}

function makeFmt(lang: string): Fmt {
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, o: Intl.NumberFormatOptions) => {
    let f = cache.get(key);
    if (!f) { f = new Intl.NumberFormat(lang, o); cache.set(key, f); }
    return f;
  };
  return {
    int: (v) => nf('i', { maximumFractionDigits: 0 }).format(v),
    num: (v, d = 1) => nf('n' + d, { maximumFractionDigits: d }).format(v),
    pct: (v, d = 1) => nf('p' + d, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }).format(v),
    signedPct: (v, d = 1) => nf('s' + d, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: 'exceptZero' }).format(v),
    mult: (v) => nf('m', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + '×',
    sig: (v) => nf('g', { maximumSignificantDigits: 2 }).format(v),
  };
}

function statGrid(items: [string, string][]): HTMLElement {
  const wrap = h('div', 'stats');
  for (const [k, v] of items) {
    const c = h('div', 'stat');
    c.append(h('span', 'stat-v', v), h('span', 'stat-k', k));
    wrap.append(c);
  }
  return wrap;
}

function table(head: { text: string; num?: boolean }[], rows: { text: string; num?: boolean }[][], cls = ''): HTMLElement {
  const wrap = h('div', cls ? `table-wrap ${cls}` : 'table-wrap');
  const tb = h('table');
  const thead = h('thead');
  const tr = h('tr');
  for (const c of head) { const th = h('th', c.num ? 'num' : undefined, c.text); th.scope = 'col'; tr.append(th); }
  thead.append(tr);
  const tbody = h('tbody');
  for (const r of rows) {
    const row = h('tr');
    for (const c of r) row.append(h('td', c.num ? 'num' : undefined, c.text));
    tbody.append(row);
  }
  tb.append(thead, tbody);
  wrap.append(tb);
  return wrap;
}

interface Status { el: HTMLElement; progress(p: number): void; done(): void; fail(): void }

function jobStatus(label: string, failText: string): Status {
  const el = h('div', 'sc-job');
  el.setAttribute('role', 'status');
  const text = h('span', 'sc-job-text', label);
  const bar = h('progress', 'sc-job-bar');
  bar.max = 1;
  bar.value = 0;
  bar.setAttribute('aria-label', label);
  el.append(text, bar);
  return {
    el,
    progress(p) { bar.value = Math.min(1, Math.max(0, p)); },
    done() { el.remove(); },
    fail() { bar.remove(); text.textContent = failText; el.classList.add('sc-job-failed'); },
  };
}

/** Runs worker jobs one after another (the first card fills first); dispose cancels the one in flight. */
function jobQueue() {
  let chain: Promise<void> = Promise.resolve();
  let dead = false;
  const live = new Set<SimRun<unknown>>();
  return {
    add<T>(start: () => SimRun<T>, ok: (v: T) => void, fail: (e: unknown) => void): void {
      chain = chain.then(async () => {
        if (dead) return;
        const run = start();
        live.add(run as SimRun<unknown>);
        try {
          const v = await run.promise;
          if (!dead) ok(v);
        } catch (e) {
          if (!dead && !(e instanceof SimCancelled)) { console.error('strategyCheck job failed', e); fail(e); }
        } finally {
          live.delete(run as SimRun<unknown>);
        }
      });
    },
    dispose(): void { dead = true; live.forEach((r) => r.cancel()); live.clear(); },
  };
}

// =========================================================================================== render

interface Env {
  ctx: SectionCtx;
  f: Fmt;
  q: ReturnType<typeof jobQueue>;
  charts: Chart[];
  model: StrategyModel;
  seed: string;
}

let teardown: (() => void)[] = [];

function scaledNote(env: Env, r: { scale: number; n: number; requested: number }, key: string): HTMLElement | null {
  if (!(r.scale < 1)) return null;
  return h('p', 'muted sc-note', env.ctx.t(key, { n: env.f.int(r.n), requested: env.f.int(r.requested) }));
}

function renderArms(box: HTMLElement, env: Env, game: DecisionGame, rounds: number, stake: number): void {
  const { ctx, f } = env;
  const t = ctx.t;
  box.append(
    h('h4', 'sc-sub', t('strategy.arms.title')),
    h('p', 'muted', t(`strategy.arms.def.${game}`, { min: f.mult(CRASH.minTarget), max: f.mult(CRASH.maxTarget) })),
  );
  const status = jobStatus(t('strategy.job.arms'), t('strategy.job.failed'));
  box.append(status.el);
  const nRun = scaled(STRATEGY_N, ctx.sim.scale);
  const block = blockFor(rounds, nRun);
  const out = h('div', 'sc-arms');
  box.append(out);
  env.q.add(
    () => ctx.sim.run('strategy', { game, model: env.model, n: STRATEGY_N, seed: `${env.seed}:strategy:${game}`, block }, { onProgress: status.progress }),
    (r) => {
      status.done();
      const bl = r.block ?? 1;
      out.append(h('p', '', t('strategy.arms.lead', { n: f.int(r.n), block: f.int(bl) })));
      const ov = armOverlay(r, stake > 0 ? stake : 1);
      if (ov) {
        out.append(h('p', 'sc-caption', t(stake > 0 ? 'strategy.arms.x' : 'strategy.arms.xUnits', { block: f.int(bl), bet: f.int(stake) })));
        const el = h('div', 'chart');
        out.append(el);
        env.charts.push(ctx.charts.line(el, {
          x: ov.x,
          series: ov.series.map((s) => ({ label: t(`strategy.arm.${s.arm}`), y: s.y, dash: s.arm === 'random' })),
          fmtY: (v) => f.pct(v, 1),
          ariaLabel: t('strategy.arms.aria', { game: t(`strategy.game.${game}`) }),
        }));
      }
      const rows = armRows(r);
      out.append(table(
        [
          { text: t('strategy.arms.col.arm') },
          { text: t('strategy.arms.col.mean'), num: true },
          { text: t('strategy.arms.col.ci', { level: f.pct(0.95, 0) }), num: true },
          { text: t('strategy.arms.col.ahead', { block: f.int(bl) }), num: true },
        ],
        rows.map((x) => [
          { text: t(`strategy.arm.${x.arm}`) },
          { text: f.signedPct(x.mean, 2), num: true },
          { text: `${f.signedPct(x.lo, 2)} ~ ${f.signedPct(x.hi, 2)}`, num: true },
          { text: x.ahead === null ? '-' : f.pct(x.ahead, 0), num: true },
        ]),
      ));
      const opt = rows.find((x) => x.arm === 'optimal');
      out.append(h('p', '', t(`strategy.arms.conclusion.${game}`, {
        edge: f.pct(edgeOf(game), 2), n: f.int(r.n), ci: opt ? f.pct((opt.hi - opt.lo) / 2, 2) : '-',
      })));
      const note = scaledNote(env, r, 'strategy.scaled');
      if (note) out.append(note);
    },
    () => status.fail(),
  );
}

function renderBlackjack(box: HTMLElement, env: Env, bj: BlackjackCheck): void {
  const { ctx, f } = env;
  const t = ctx.t;
  const edge = edgeOf('blackjack');
  box.append(h('p', '', t('strategy.bj.lead')));
  if (bj.decisions > 0) {
    box.append(statGrid([
      [t('strategy.bj.stat.decisions'), f.int(bj.decisions)],
      [t('strategy.bj.stat.match'), bj.matchRate === null ? '-' : f.pct(bj.matchRate, 0)],
      [t('strategy.bj.stat.evLoss'), f.num(bj.evLossCredits, 1)],
      [t('strategy.bj.stat.edgeAdded'), bj.edgeAdded === null ? '-' : f.signedPct(bj.edgeAdded, 2)],
    ]));
  }
  const dev = bj.decisions - bj.matches;
  if (bj.decisions === 0) box.append(h('p', '', t('strategy.bj.noDecisions', { edge: f.pct(edge, 2) })));
  else if (dev === 0) box.append(h('p', '', t('strategy.bj.perfect', { decisions: f.int(bj.decisions), edge: f.pct(edge, 2) })));
  else {
    box.append(h('p', '', t('strategy.bj.summary', {
      decisions: f.int(bj.decisions), matches: f.int(bj.matches), dev: f.int(dev), loss: f.num(bj.evLossCredits, 1), edge: f.pct(edge, 2),
    })));
    const top = topDeviations(bj);
    box.append(h('h4', 'sc-sub', t('strategy.bj.devTitle')));
    box.append(table(
      [
        { text: t('strategy.bj.col.round'), num: true },
        { text: t('strategy.bj.col.hand') },
        { text: t('strategy.bj.col.up') },
        { text: t('strategy.bj.col.yours') },
        { text: t('strategy.bj.col.basic') },
        { text: t('strategy.bj.col.loss'), num: true },
      ],
      top.map((d) => [
        { text: f.int(d.round), num: true },
        { text: `${d.cards.map(cardLabel).join(' ')} (${t(d.soft ? 'strategy.bj.soft' : 'strategy.bj.hard', { total: d.total })})` },
        { text: cardLabel(d.up) },
        { text: t(`strategy.action.${d.action}`) },
        { text: t(`strategy.action.${d.optimal}`) },
        { text: d.evLossCredits === null ? '-' : f.num(d.evLossCredits, 1), num: true },
      ]),
      'sc-nowrap',
    ));
    box.append(h('p', 'muted sc-note', t('strategy.bj.evNote')));
  }
  if (bj.unresolved > 0) box.append(h('p', 'muted sc-note', t('strategy.bj.unresolved', { n: f.int(bj.unresolved) })));
}

function renderRoulette(box: HTMLElement, env: Env, rc: RouletteCheck): void {
  const { ctx, f } = env;
  const t = ctx.t;
  const v = rouletteView(rc);
  box.append(h('p', '', t('strategy.rl.lead', { edge: f.pct(edgeOf('roulette'), 2) })));
  const ul = h('ul', 'sc-findings');
  const m = v.martingale;
  ul.append(h('li', '', m.detected
    ? t('strategy.rl.martingale.yes', { n: f.int(m.doublings), len: f.int(m.longest), max: f.int(m.maxStake) })
    : t('strategy.rl.martingale.no', { n: f.int(m.doublings) })));
  const s = v.streak;
  ul.append(h('li', '', s.opportunities > 0
    ? t('strategy.rl.streak', { k: f.int(s.min), opps: f.int(s.opportunities), against: f.int(s.against), with: f.int(s.with) })
    : t('strategy.rl.streak.none', { k: f.int(s.min) })));
  box.append(ul);
  if (m.detected) box.append(h('p', '', t('strategy.rl.martingale.why')));
  if (s.against > 0) box.append(h('p', '', t('strategy.rl.streak.why')));
  box.append(h('p', '', t('strategy.rl.unchanged')));
}

function renderCrash(box: HTMLElement, env: Env, cc: CrashCheck): void {
  const { ctx, f } = env;
  const t = ctx.t;
  box.append(h('p', '', t('strategy.cr.lead', { rtp: f.pct(cc.theoreticalReturn, 0) })));
  box.append(statGrid([
    [t('strategy.cr.stat.rounds'), f.int(cc.rounds)],
    [t('strategy.cr.stat.auto'), f.int(cc.auto)],
    [t('strategy.cr.stat.manual'), f.int(cc.manual)],
    [t('strategy.cr.stat.none'), f.int(cc.none)],
  ]));
  if (cc.actualReturn !== null) {
    box.append(h('p', '', t('strategy.cr.actual', { actual: f.pct(cc.actualReturn, 1), rtp: f.pct(cc.theoreticalReturn, 0) })));
  }
  if (cc.chosen.length > 0) {
    const bars = crashChosenBars(cc);
    const label = (i: number): string => {
      if (!Number.isInteger(i) || i < 0 || i >= bars.bins.length) return '';
      const b = bars.bins[i];
      return Number.isFinite(b.hi) ? `${f.num(b.lo, 2)}–${f.num(b.hi, 2)}×` : `${f.num(b.lo, 2)}×+`;
    };
    box.append(h('h4', 'sc-sub', t('strategy.cr.chosenTitle')));
    const el = h('div', 'chart');
    box.append(el);
    env.charts.push(ctx.charts.bars(el, {
      x: bars.x, y: bars.y, label: t('strategy.cr.chosenY'), fmtX: label, fmtY: (v) => f.int(v),
      ariaLabel: t('strategy.cr.chosenTitle'),
    }));
  }

  // target sweep
  box.append(h('h4', 'sc-sub', t('strategy.cr.targetsTitle')));
  const status = jobStatus(t('strategy.job.targets'), t('strategy.job.failed'));
  const out = h('div');
  box.append(status.el, out);
  env.q.add(
    () => ctx.sim.run('crashTargets', { n: TARGETS_N, seed: `${env.seed}:crashTargets` }, { onProgress: status.progress }),
    (r) => {
      status.done();
      const rows = crashTargetRows(r);
      out.append(h('p', '', t('strategy.cr.targetsLead', { n: f.int(r.n) })));
      const el = h('div', 'chart');
      out.append(el);
      env.charts.push(ctx.charts.line(el, {
        x: rows.map((x) => Math.log10(x.target)),
        series: [
          { label: t('strategy.cr.series.sim'), y: rows.map((x) => x.rtp) },
          { label: t('strategy.cr.series.exact'), y: rows.map((x) => x.exact), dash: true },
          { label: t('strategy.cr.series.lo', { level: f.pct(0.95, 0) }), y: rows.map((x) => x.lo), dash: true },
          { label: t('strategy.cr.series.hi', { level: f.pct(0.95, 0) }), y: rows.map((x) => x.hi), dash: true },
        ],
        fmtX: (v) => f.sig(10 ** v) + '×',
        fmtY: (v) => f.pct(v, 0),
        ariaLabel: t('strategy.cr.targetsTitle'),
      }));
      out.append(table(
        [
          { text: t('strategy.cr.col.target'), num: true },
          { text: t('strategy.cr.col.pWin'), num: true },
          { text: t('strategy.cr.col.rtp', { level: f.pct(0.95, 0) }), num: true },
          { text: t('strategy.cr.col.exact'), num: true },
        ],
        rows.map((x) => [
          { text: f.mult(x.target), num: true },
          { text: f.pct(x.pWin, 2), num: true },
          { text: `${f.pct(x.rtp, 1)} (${f.pct(x.lo, 1)}~${f.pct(x.hi, 1)})`, num: true },
          { text: f.pct(x.exact, 2), num: true },
        ]),
      ));
      out.append(h('p', 'muted sc-note', t('strategy.cr.targetsNote')));
      const note = scaledNote(env, r, 'strategy.scaled');
      if (note) out.append(note);
    },
    () => status.fail(),
  );
}

function render(el: HTMLElement, ctx: SectionCtx): void {
  const session = ctx.session;
  if (!session) return;   // needs 'full': main.ts never calls render without a session
  const t = ctx.t;
  const f = makeFmt(ctx.lang);
  const q = jobQueue();
  const env: Env = { ctx, f, q, charts: [], model: buildModel(session), seed: session.seed || 'session' };
  teardown.push(() => q.dispose(), () => { env.charts.splice(0).forEach((c) => c.destroy()); });

  const check = analyze(session);
  const rounds = playedRounds(session);
  const sv = session.sv === 'b' ? 'b' : 'a';

  el.append(h('p', '', t('strategy.lead')));
  const decision = DECISION_GAMES.filter((g) => rounds[g] > 0);
  if (decision.length === 0) el.append(h('p', 'muted', t('strategy.none')));

  for (const g of decision) {
    const box = h('div', 'sc-game');
    box.dataset.game = g;
    box.append(h('h3', '', t(`strategy.game.${g}`)), h('p', 'muted sc-rounds', t('strategy.rounds', { n: f.int(rounds[g]) })));
    if (g === 'blackjack' && check.blackjack) renderBlackjack(box, env, check.blackjack);
    if (g === 'roulette' && check.roulette) renderRoulette(box, env, check.roulette);
    if (g === 'crash' && check.crash) renderCrash(box, env, check.crash);
    renderArms(box, env, g, rounds[g], avgStake(session, g));
    el.append(box);
  }

  if (check.noStrategy.length > 0) {
    const box = h('div', 'sc-game');
    box.append(h('h3', '', t('strategy.noStrategy.title')));
    const ret = returnTable(sv);
    for (const g of check.noStrategy) box.append(h('p', '', t(`strategy.noStrategy.${g}`, { rtp: f.pct(ret[g], 1) })));
    el.append(box);
  }
}

const section: Section = {
  id: 'strategyCheck',
  titleKey: 'app.toc.strategyCheck',
  needs: 'full',
  render,
  dispose() {
    const fs = teardown;
    teardown = [];
    for (const fn of fs) { try { fn(); } catch { /* keep disposing */ } }
  },
};
export default section;
