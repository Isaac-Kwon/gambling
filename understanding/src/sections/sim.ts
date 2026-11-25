// sim (BASE_PROMPT §6.6, CONTEXT §4.5, ARCHITECTURE §10.3, §10.6).
//  1. 10,000-player bankroll Monte Carlo with controls (house edge, rounds, betting system): final-balance
//     histogram, bust share, ~20 sample paths, the top 1% ("the winners you hear about").
//  2. Slot variant card "same RTP, different feel": both variants' exact stats (`slotStats`) side by side and
//     their final-balance distributions for the same rounds and bet (`bankroll` with a slot payoff).
// Works with a summary-only source (needs 'any'): only the default edge and bankroll come from the data.
//
// The exported functions above `render` are pure view-model helpers (unit tested in sim.view.test.ts).

import './sim.css';
import { START_CREDITS, type GameId, type SlotVariant } from '@shared/config';
import type { Summary } from '../../../shared/handoff';
import type { Section, SectionCtx } from './types';
import { edgeOf } from '../analysis/edges';
import {
  SimCancelled, type BankrollParams, type BankrollResult, type BetSystem, type ScaleInfo, type SimRun,
  type SlotStatsResult,
} from '../sim';
import { Q_LEVELS } from '../sim/stats';
import { histogramBins, type Chart } from '../charts/kit';

// =========================================================================================== view model

export const PLAYERS = 10_000;
export const ROUND_STEPS: readonly number[] = [50, 100, 200, 500, 1000, 2000, 5000];
export const SYSTEMS: readonly BetSystem[] = ['flat', 'martingale', 'fibonacci', 'dalembert'];
/** Edge slider: 0 … EDGE_MAX in steps of EDGE_STEP. */
export const EDGE_MAX = 0.15;
export const EDGE_STEP = 0.001;
/** Base bet as a share of the starting bankroll. */
export const BASE_BET_SHARE = 0.01;
/** Sample paths drawn. */
export const PATHS = 20;
/** Debounce for slider input (ms). */
export const DEBOUNCE_MS = 280;
/** Slot comparison: rounds and total bet per round (20 lines × line bet 5). */
export const SLOT_ROUNDS = 500;
export const SLOT_BET = 100;

const GAME_ORDER: readonly GameId[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];
const MEDIAN_AT = Q_LEVELS.indexOf(0.5);

/** The game with the most credits wagered in the summary (ties: page order). Null when nothing was played. */
export function mainGame(s: Pick<Summary, 'games'> | undefined): GameId | null {
  let best: GameId | null = null, bet = 0;
  for (const g of GAME_ORDER) {
    const x = s?.games?.[g];
    if (x && x.n > 0 && x.bet > bet) { best = g; bet = x.bet; }
  }
  return best;
}

/** Default edge: the main game's (for the session's slot variant), else European roulette's. Clamped to the slider. */
export function defaultEdge(s: Pick<Summary, 'games' | 'sv'> | undefined): { game: GameId; edge: number; fromSession: boolean } {
  const g = mainGame(s);
  const game = g ?? 'roulette';
  const edge = edgeOf(game, s?.sv === 'b' ? 'b' : 'a');
  return { game, edge: Math.min(EDGE_MAX, Math.max(0, edge)), fromSession: g !== null };
}

/** Total rounds in the summary. */
export function sessionRounds(s: Pick<Summary, 'games'> | undefined): number {
  let n = 0;
  for (const g of GAME_ORDER) n += s?.games?.[g]?.n ?? 0;
  return n;
}

/** Index of the step closest to v on a log scale (v ≤ 0 → default index). */
export function nearestStep(steps: readonly number[], v: number, dflt = 3): number {
  if (!(v > 0)) return Math.min(dflt, steps.length - 1);
  let best = 0, d = Infinity;
  steps.forEach((s, i) => { const x = Math.abs(Math.log(s / v)); if (x < d) { d = x; best = i; } });
  return best;
}

export const edgeToSlider = (e: number): number => Math.round(Math.min(EDGE_MAX, Math.max(0, e)) / EDGE_STEP);
export const sliderToEdge = (v: number): number => Math.min(EDGE_MAX, Math.max(0, Math.round(v) * EDGE_STEP));

export interface SimState { edge: number; rounds: number; system: BetSystem }

export function baseBetFor(bankroll: number): number {
  return Math.max(1, Math.round(bankroll * BASE_BET_SHARE));
}

export function bankrollParams(s: SimState, o: { bankroll: number; seed: string; players?: number }): BankrollParams {
  return {
    edge: s.edge, rounds: s.rounds, system: s.system, bankroll: o.bankroll, baseBet: baseBetFor(o.bankroll),
    players: o.players ?? PLAYERS, seed: o.seed, payoff: { kind: 'even' }, paths: PATHS, points: 160, bins: 40,
  };
}

export interface BankrollView {
  players: number;
  requested: number;
  scale: number;
  bust: number;
  ahead: number;
  mean: number;
  median: number;
  /** Net per credit wagered (≈ −edge). */
  perWagered: number;
  top: { n: number; threshold: number; mean: number };
  /** Final balance histogram: bin centres and player counts. */
  hist: { x: number[]; y: number[] };
}

/**
 * Final-balance histogram from 0 to `hi` with about `bins` bins whose width is a multiple of `step`.
 * Even-money balances move on a lattice (multiples of the base bet), so a width that is not a multiple of the
 * lattice step makes neighbouring bins alternate high/low. Values ≥ hi go to the last bin.
 */
export function latticeHist(finals: ArrayLike<number>, hi: number, bins: number, step: number): { x: number[]; y: number[] } {
  const top = hi > 0 ? hi : 1;
  const raw = top / Math.max(1, bins);
  const w = step > 0 ? Math.max(step, Math.ceil(raw / step) * step) : raw;
  const n = Math.max(1, Math.ceil(top / w));
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < finals.length; i++) {
    const v = finals[i];
    if (!Number.isFinite(v)) continue;
    y[Math.min(n - 1, Math.max(0, Math.floor(v / w)))]++;
  }
  return { x: y.map((_, i) => (i + 0.5) * w), y };
}

/** `step`: lattice step of the final balances (2 × base bet for even-money bets); 0 keeps the worker's bins. */
export function bankrollView(r: BankrollResult & Partial<ScaleInfo>, step = 0): BankrollView {
  const e = r.hist.edges, c = r.hist.counts;
  let x: number[] = [], y: number[] = [];
  if (step > 0) ({ x, y } = latticeHist(r.finals, e[e.length - 1], c.length, step));
  else for (let i = 0; i < c.length; i++) { x.push((e[i] + e[i + 1]) / 2); y.push(c[i]); }
  return {
    players: r.players, requested: r.requested ?? r.players, scale: r.scale ?? 1,
    bust: r.ruinRate, ahead: r.ahead.rate, mean: r.mean, median: r.q[MEDIAN_AT], perWagered: r.perWagered.mean,
    top: { n: r.top1.n, threshold: r.top1.threshold, mean: r.top1.mean },
    hist: { x, y },
  };
}

/** Sample paths as line-chart data: the starting balance (flat reference) first, then one series per player. */
export function pathSeries(r: BankrollResult): { x: number[]; start: number[]; paths: number[][] } {
  const x = Array.from(r.paths.x);
  const G = x.length;
  const paths: number[][] = [];
  for (let p = 0; p < r.paths.n; p++) paths.push(Array.from(r.paths.y.subarray(p * G, (p + 1) * G)));
  return { x, start: x.map(() => r.bankroll), paths };
}

/**
 * Several final-balance samples on one grid: [0, highest 99.5% quantile], `bins` bins, share of players per bin.
 * Values above the range are left out (at most 0.5% of each sample).
 */
export function finalsOverlay(samples: ArrayLike<number>[], bins = 40): { x: number[]; ys: number[][] } {
  let hi = 0;
  for (const s of samples) {
    const sorted = Float64Array.from(s).sort();
    if (sorted.length === 0) continue;
    const k = Math.min(sorted.length - 1, Math.floor(0.995 * (sorted.length - 1)));
    hi = Math.max(hi, sorted[k]);
  }
  if (!(hi > 0)) hi = 1;
  let x: number[] = [];
  const ys = samples.map((s) => {
    const b = histogramBins(Array.from(s), bins, [0, hi]);
    x = b.centers;
    return b.counts.map((c) => (s.length > 0 ? c / s.length : 0));
  });
  return { x, ys };
}

export type SlotRowKey = 'rtp' | 'hit' | 'under' | 'big' | 'sigma';
export interface SlotRow { key: SlotRowKey; a: number; b: number }

/** The comparison table, every value from the exact distributions (null until both variants are in). */
export function slotRows(d: SlotStatsResult): SlotRow[] | null {
  const a = d.a, b = d.b;
  if (!a || !b) return null;
  return [
    { key: 'rtp', a: a.ret, b: b.ret },
    { key: 'hit', a: a.hitRate, b: b.hitRate },
    { key: 'under', a: a.underRate, b: b.underRate },
    { key: 'big', a: a.bigEvery, b: b.bigEvery },
    { key: 'sigma', a: a.sigma, b: b.sigma },
  ];
}

export function slotBankrollParams(sv: SlotVariant, o: { bankroll: number; seed: string; players?: number }): BankrollParams {
  return {
    edge: 0, rounds: SLOT_ROUNDS, system: 'flat', bankroll: o.bankroll, baseBet: SLOT_BET, players: o.players ?? PLAYERS,
    seed: o.seed, payoff: { kind: 'slot', sv }, paths: 0, bins: 40,
  };
}

// =========================================================================================== DOM helpers

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface Fmt { int(v: number): string; num(v: number, d?: number): string; pct(v: number, d?: number): string; signedPct(v: number, d?: number): string }

function makeFmt(lang: string): Fmt {
  const cache = new Map<string, Intl.NumberFormat>();
  const nf = (key: string, o: Intl.NumberFormatOptions) => {
    let f = cache.get(key);
    if (!f) { f = new Intl.NumberFormat(lang, o); cache.set(key, f); }
    return f;
  };
  return {
    int: (v) => (Number.isFinite(v) ? nf('i', { maximumFractionDigits: 0 }).format(v) : '-'),
    num: (v, d = 1) => (Number.isFinite(v) ? nf('n' + d, { maximumFractionDigits: d }).format(v) : '-'),
    pct: (v, d = 1) => (Number.isFinite(v) ? nf('p' + d, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }).format(v) : '-'),
    signedPct: (v, d = 1) => (Number.isFinite(v) ? nf('s' + d, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: 'exceptZero' }).format(v) : '-'),
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

function table(head: { text: string; num?: boolean }[], rows: { text: string; num?: boolean; th?: boolean }[][]): HTMLElement {
  const wrap = h('div', 'table-wrap');
  const tb = h('table');
  const thead = h('thead');
  const tr = h('tr');
  for (const c of head) { const th = h('th', c.num ? 'num' : undefined, c.text); th.scope = 'col'; tr.append(th); }
  thead.append(tr);
  const tbody = h('tbody');
  for (const r of rows) {
    const row = h('tr');
    for (const c of r) {
      if (c.th) { const th = h('th', undefined, c.text); th.scope = 'row'; row.append(th); }
      else row.append(h('td', c.num ? 'num' : undefined, c.text));
    }
    tbody.append(row);
  }
  tb.append(thead, tbody);
  wrap.append(tb);
  return wrap;
}

interface Status { el: HTMLElement; start(): void; progress(p: number): void; done(): void; fail(): void }

function jobStatus(label: string, failText: string): Status {
  const el = h('div', 'sim-job');
  el.setAttribute('role', 'status');
  const text = h('span', 'sim-job-text', label);
  const bar = h('progress', 'sim-job-bar');
  bar.max = 1;
  bar.value = 0;
  bar.setAttribute('aria-label', label);
  el.append(text, bar);
  el.hidden = true;
  return {
    el,
    start() { el.hidden = false; el.classList.remove('sim-job-failed'); text.textContent = label; if (!bar.isConnected) el.append(bar); bar.value = 0; },
    progress(p) { bar.value = Math.min(1, Math.max(0, p)); },
    done() { el.hidden = true; },
    fail() { el.hidden = false; bar.remove(); text.textContent = failText; el.classList.add('sim-job-failed'); },
  };
}

let teardown: (() => void)[] = [];

// =========================================================================================== main simulation

function renderMain(root: HTMLElement, ctx: SectionCtx, f: Fmt, charts: Chart[], runs: Set<SimRun<unknown>>): void {
  const t = ctx.t;
  const bankroll = ctx.summary.startCredits > 0 ? ctx.summary.startCredits : START_CREDITS;
  const baseBet = baseBetFor(bankroll);
  const seed = `${ctx.summary.seed || 'sim'}:bankroll`;
  const de = defaultEdge(ctx.summary);
  const state: SimState = {
    edge: de.edge,
    rounds: ROUND_STEPS[nearestStep(ROUND_STEPS, sessionRounds(ctx.summary))],
    system: 'flat',
  };

  root.append(h('p', '', t('sim.lead', { players: f.int(PLAYERS), bankroll: f.int(bankroll) })));
  root.append(h('p', 'muted', t('sim.setup', { bet: f.int(baseBet) })));

  // ---- controls
  const form = h('form', 'sim-controls');
  form.addEventListener('submit', (e) => e.preventDefault());

  // edge
  const edgeBox = h('div', 'sim-ctl');
  const edgeLabel = h('label', 'sim-ctl-label');
  edgeLabel.htmlFor = 'sim-edge';
  const edgeOut = h('output', 'sim-ctl-value');
  edgeLabel.append(h('span', '', t('sim.ctl.edge')), edgeOut);
  const edgeIn = h('input');
  edgeIn.type = 'range';
  edgeIn.id = 'sim-edge';
  edgeIn.min = '0';
  edgeIn.max = String(edgeToSlider(EDGE_MAX));
  edgeIn.step = '1';
  edgeIn.value = String(edgeToSlider(state.edge));
  const presets = h('div', 'sim-presets');
  presets.setAttribute('role', 'group');
  presets.setAttribute('aria-label', t('sim.ctl.presets'));
  const sv: SlotVariant = ctx.summary?.sv === 'b' ? 'b' : 'a';
  for (const g of GAME_ORDER) {
    const e = edgeOf(g, sv);
    if (!(e >= 0 && e <= EDGE_MAX)) continue;
    const b = h('button', 'sim-chip', `${t(`sim.game.${g}`)} ${f.pct(e, 1)}`);
    b.type = 'button';
    b.addEventListener('click', () => { edgeIn.value = String(edgeToSlider(e)); onInput(true); });
    presets.append(b);
  }
  const edgeHint = h('p', 'muted sim-hint', de.fromSession
    ? t('sim.ctl.edgeFromSession', { game: t(`sim.game.${de.game}`) })
    : t('sim.ctl.edgeDefault', { game: t(`sim.game.${de.game}`) }));
  edgeBox.append(edgeLabel, edgeIn, presets, edgeHint);

  // rounds
  const roundsBox = h('div', 'sim-ctl');
  const roundsLabel = h('label', 'sim-ctl-label');
  roundsLabel.htmlFor = 'sim-rounds';
  const roundsOut = h('output', 'sim-ctl-value');
  roundsLabel.append(h('span', '', t('sim.ctl.rounds')), roundsOut);
  const roundsIn = h('input');
  roundsIn.type = 'range';
  roundsIn.id = 'sim-rounds';
  roundsIn.min = '0';
  roundsIn.max = String(ROUND_STEPS.length - 1);
  roundsIn.step = '1';
  roundsIn.value = String(ROUND_STEPS.indexOf(state.rounds));
  roundsBox.append(roundsLabel, roundsIn);
  const sr = sessionRounds(ctx.summary);
  if (sr > 0) roundsBox.append(h('p', 'muted sim-hint', t('sim.ctl.roundsSession', { n: f.int(sr) })));

  // system
  const sysBox = h('fieldset', 'sim-ctl sim-sys');
  sysBox.append(h('legend', 'sim-ctl-label', t('sim.ctl.system')));
  const seg = h('div', 'sim-seg');
  const sysDesc = h('p', 'muted sim-hint');
  for (const s of SYSTEMS) {
    const lab = h('label', 'sim-seg-opt');
    const r = h('input');
    r.type = 'radio';
    r.name = 'sim-system';
    r.value = s;
    r.checked = s === state.system;
    r.addEventListener('change', () => { if (r.checked) onInput(true); });
    lab.append(r, h('span', '', t(`sim.sys.${s}`)));
    seg.append(lab);
  }
  sysBox.append(seg, sysDesc);

  form.append(edgeBox, roundsBox, sysBox);
  root.append(form);

  // ---- output
  const status = jobStatus(t('sim.running'), t('sim.failed'));
  const statsBox = h('div', 'sim-stats');
  const histTitle = h('h3', '', t('sim.hist.title'));
  const histEl = h('div', 'chart');
  const histCap = h('p', 'muted sim-hint', t('sim.hist.caption'));
  const pathsTitle = h('h3');
  const pathsEl = h('div', 'chart sim-paths');
  const pathsCap = h('p', 'muted sim-hint', t('sim.paths.caption'));
  const top = h('div', 'callout sim-top');
  const scaledP = h('p', 'muted sim-hint');
  const out = h('div', 'sim-out');
  out.append(statsBox, histTitle, histEl, histCap, pathsTitle, pathsEl, pathsCap, top, scaledP);
  out.hidden = true;
  root.append(status.el, out);

  let histChart: Chart | null = null;
  let pathsChart: Chart | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: SimRun<unknown> | null = null;
  let dead = false;

  const readState = () => {
    state.edge = sliderToEdge(Number(edgeIn.value));
    state.rounds = ROUND_STEPS[Math.min(ROUND_STEPS.length - 1, Math.max(0, Math.round(Number(roundsIn.value))))];
    const chosen = seg.querySelector<HTMLInputElement>('input:checked');
    state.system = (chosen?.value as BetSystem) ?? 'flat';
    edgeOut.textContent = f.pct(state.edge, 1);
    roundsOut.textContent = t('sim.ctl.roundsValue', { n: f.int(state.rounds) });
    sysDesc.textContent = t(`sim.sys.desc.${state.system}`, { bet: f.int(baseBet) });
  };

  const show = (r: BankrollResult & ScaleInfo) => {
    const v = bankrollView(r, 2 * baseBet);
    out.hidden = false;
    statsBox.replaceChildren(statGrid([
      [t('sim.stat.bust'), f.pct(v.bust, 1)],
      [t('sim.stat.ahead'), f.pct(v.ahead, 1)],
      [t('sim.stat.median'), f.int(v.median)],
      [t('sim.stat.mean'), f.int(v.mean)],
      [t('sim.stat.perWagered'), f.signedPct(v.perWagered, 2)],
    ]));
    if (histChart) histChart.update({ x: v.hist.x, y: v.hist.y });
    else {
      histChart = ctx.charts.bars(histEl, { x: v.hist.x, y: v.hist.y, label: t('sim.hist.y'), fmtY: (y) => f.int(y), ariaLabel: t('sim.hist.title') });
      charts.push(histChart);
    }
    const ps = pathSeries(r);
    pathsTitle.textContent = t('sim.paths.title', { n: f.int(ps.paths.length) });
    const series = [
      { label: t('sim.paths.start'), y: ps.start as (number | null)[], dash: true },
      ...ps.paths.map((y, i) => ({ label: String(i + 1), y: y as (number | null)[] })),
    ];
    if (pathsChart) pathsChart.update({ x: ps.x, series });
    else {
      pathsChart = ctx.charts.line(pathsEl, { x: ps.x, series, fmtY: (y) => f.int(y), ariaLabel: pathsTitle.textContent });
      charts.push(pathsChart);
    }
    top.replaceChildren(
      h('strong', '', t('sim.top.title', { top: f.pct(0.01, 0) })),
      h('p', '', t('sim.top.body', {
        top: f.pct(0.01, 0), n: f.int(v.top.n), threshold: f.int(v.top.threshold), mean: f.int(v.top.mean),
        bust: f.pct(v.bust, 1), median: f.int(v.median), bankroll: f.int(bankroll),
      })),
    );
    scaledP.textContent = v.scale < 1 ? t('sim.scaled', { n: f.int(v.players), requested: f.int(v.requested) }) : '';
    scaledP.hidden = !(v.scale < 1);
  };

  const run = () => {
    if (dead) return;
    timer = null;
    status.start();
    out.classList.add('is-stale');
    const r = ctx.sim.latest('sim:bankroll', 'bankroll', bankrollParams(state, { bankroll, seed }), { onProgress: status.progress });
    current = r as SimRun<unknown>;
    runs.add(current);
    r.promise.then(
      (res) => { if (dead || current !== (r as SimRun<unknown>)) return; status.done(); out.classList.remove('is-stale'); show(res); },
      (e) => {
        if (dead || e instanceof SimCancelled) return;
        console.error('sim bankroll failed', e);
        status.fail();
      },
    ).finally(() => runs.delete(r as SimRun<unknown>));
  };

  function onInput(now: boolean) {
    readState();
    if (timer) clearTimeout(timer);
    current?.cancel();   // a stale run stops right away; the new one starts after the debounce
    if (now) run();
    else timer = setTimeout(run, DEBOUNCE_MS);
  }

  edgeIn.addEventListener('input', () => onInput(false));
  roundsIn.addEventListener('input', () => onInput(false));
  teardown.push(() => { dead = true; if (timer) clearTimeout(timer); current?.cancel(); });

  readState();
  run();
}

// =========================================================================================== slot variants

function renderSlotCard(root: HTMLElement, ctx: SectionCtx, f: Fmt, charts: Chart[], runs: Set<SimRun<unknown>>): void {
  const t = ctx.t;
  const bankroll = ctx.summary.startCredits > 0 ? ctx.summary.startCredits : START_CREDITS;
  const mine: SlotVariant | null = ctx.summary?.games?.slot ? (ctx.summary.sv === 'b' ? 'b' : 'a') : null;
  const seed = `${ctx.summary.seed || 'sim'}:slotcmp`;
  let dead = false;
  teardown.push(() => { dead = true; });

  const card = h('div', 'card sim-slot');
  card.append(h('h3', '', t('sim.slot.title')), h('p', '', t('sim.slot.lead')));
  const status = jobStatus(t('sim.slot.running'), t('sim.failed'));
  const body = h('div');
  card.append(status.el, body);
  root.append(card);

  const colName = (v: SlotVariant) => t(`sim.slot.col.${v}`) + (mine === v ? ` ${t('sim.slot.mine')}` : '');

  const track = <T,>(r: SimRun<T>): Promise<T> => {
    runs.add(r as SimRun<unknown>);
    return r.promise.finally(() => runs.delete(r as SimRun<unknown>));
  };

  const go = async () => {
    status.start();
    const stats = await track(ctx.sim.run('slotStats', { variants: ['a', 'b'] }, { onProgress: (p) => status.progress(p * 0.5) }));
    if (dead) return;
    const rows = slotRows(stats);
    if (!rows || !stats.a || !stats.b) throw new Error('slotStats: missing variant');
    const cell = (k: SlotRowKey, v: number): string =>
      k === 'big' ? t('sim.slot.every', { n: f.num(v, 1) }) : k === 'sigma' ? f.num(v, 2) : f.pct(v, k === 'rtp' ? 2 : 1);
    body.append(h('p', 'muted sim-hint', t('sim.slot.exact', { combos: f.int(stats.a.cycle) })));
    body.append(table(
      [{ text: t('sim.slot.col.metric') }, { text: colName('a'), num: true }, { text: colName('b'), num: true }],
      rows.map((r) => [{ text: t(`sim.slot.row.${r.key}`), th: true }, { text: cell(r.key, r.a), num: true }, { text: cell(r.key, r.b), num: true }]),
    ));

    // same rounds, same bet, both machines
    const both = await Promise.all((['a', 'b'] as const).map((v, i) =>
      track(ctx.sim.run('bankroll', slotBankrollParams(v, { bankroll, seed: `${seed}:${v}` }), {
        onProgress: (p) => status.progress(0.5 + 0.25 * i + 0.25 * p),
      }))));
    if (dead) return;
    status.done();
    const [ra, rb] = both;
    body.append(h('h4', 'sim-sub', t('sim.slot.bankTitle', { rounds: f.int(SLOT_ROUNDS) })));
    body.append(h('p', '', t('sim.slot.bankLead', { players: f.int(ra.players), bankroll: f.int(bankroll), bet: f.int(SLOT_BET), rounds: f.int(SLOT_ROUNDS) })));
    const ov = finalsOverlay([ra.finals, rb.finals]);
    const el = h('div', 'chart');
    body.append(el);
    charts.push(ctx.charts.line(el, {
      x: ov.x,
      series: [{ label: colName('a'), y: ov.ys[0] }, { label: colName('b'), y: ov.ys[1] }],
      fmtY: (y) => f.pct(y, 1),
      ariaLabel: t('sim.slot.bankTitle', { rounds: f.int(SLOT_ROUNDS) }),
    }));
    body.append(h('p', 'muted sim-hint', t('sim.slot.bankCaption')));
    const va = bankrollView(ra), vb = bankrollView(rb);
    const row = (key: string, fa: string, fb: string) => [{ text: t(key), th: true }, { text: fa, num: true }, { text: fb, num: true }];
    body.append(table(
      [{ text: t('sim.slot.col.metric') }, { text: colName('a'), num: true }, { text: colName('b'), num: true }],
      [
        row('sim.stat.median', f.int(va.median), f.int(vb.median)),
        row('sim.stat.mean', f.int(va.mean), f.int(vb.mean)),
        row('sim.stat.bust', f.pct(va.bust, 1), f.pct(vb.bust, 1)),
        row('sim.stat.ahead', f.pct(va.ahead, 1), f.pct(vb.ahead, 1)),
        row('sim.stat.perWagered', f.signedPct(va.perWagered, 2), f.signedPct(vb.perWagered, 2)),
      ],
    ));
    body.append(h('p', '', t('sim.slot.conclusion', {
      hitA: f.pct(stats.a.hitRate, 1), hitB: f.pct(stats.b.hitRate, 1),
      lossA: f.pct(1 - stats.a.ret, 1), lossB: f.pct(1 - stats.b.ret, 1),
    })));
    if (va.scale < 1) body.append(h('p', 'muted sim-hint', t('sim.scaled', { n: f.int(va.players), requested: f.int(va.requested) })));
  };

  go().catch((e) => {
    if (dead || e instanceof SimCancelled) return;
    console.error('sim slot comparison failed', e);
    status.fail();
  });
}

// =========================================================================================== section

function render(el: HTMLElement, ctx: SectionCtx): void {
  const f = makeFmt(ctx.lang);
  const charts: Chart[] = [];
  const runs = new Set<SimRun<unknown>>();
  teardown.push(() => { runs.forEach((r) => r.cancel()); runs.clear(); }, () => { charts.splice(0).forEach((c) => c.destroy()); });
  const main = h('div', 'sim-main');
  el.append(main);
  renderMain(main, ctx, f, charts, runs);
  renderSlotCard(el, ctx, f, charts, runs);
}

const section: Section = {
  id: 'sim',
  titleKey: 'app.toc.sim',
  needs: 'any',
  render,
  dispose() {
    const fs = teardown;
    teardown = [];
    for (const fn of fs) { try { fn(); } catch { /* keep disposing */ } }
  },
};
export default section;
