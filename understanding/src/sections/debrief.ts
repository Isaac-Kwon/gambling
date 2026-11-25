import type { Summary } from '../../../shared/handoff';
import type { Session } from '../../../shared/schema';
import { debrief as analyse } from '../analysis/debrief';
import { KRW_PER_CREDIT, MIN_WAGE_KRW_PER_HOUR, MIN_WAGE_SOURCE, MIN_WAGE_YEAR } from '../analysis/constants';
import { feltVsActual, moneyView, type FeltAnswers, type FeltVsActual, type MoneyView } from '../analysis/money';
import { timeline, type MarkerKind, type Timeline } from '../analysis/timeline';
import type { Chart } from '../charts/kit';
import { decimate } from '../charts/kit';
import { feltKey, onFelt, readFelt } from '../felt';
import type { Section, SectionCtx } from './types';
import './debrief.css';

// ------------------------------------------------------------------ view model (pure, no DOM)

export interface StripMark { t: number; kind: MarkerKind }

export interface ChartModel {
  /** Minutes since the start. */
  x: number[];
  balance: number[];
  expected: number[];
  /** Vertical marks drawn on the chart: peak and flush. */
  marks: { x: number; label: 'peak' | 'flush' }[];
  strip: StripMark[];
  stripCounts: Partial<Record<MarkerKind, number>>;
  durMin: number;
}

export interface DebriefView {
  /** false for a summary-only source: no chart, no expected line, no after-peak figures. */
  hasLog: boolean;
  rounds: number;
  durMs: number;
  start: number;
  endBalance: number;
  net: number;
  peak: { balance: number; t: number; atStart: boolean };
  afterPeak: { rounds: number; wagered: number } | null;
  wagered: number;
  expectedNet: number | null;
  nearMiss: number;
  celebrations: { total: number; netLoss: number };
  stop: number;
  chase: number;
  flush: number;
  /** A shared class seed was played on a slot variant: the slot outcomes depend on it (ARCHITECTURE §10.6). */
  slotNote: { sv: string } | null;
  money: MoneyView;
  chart: ChartModel | null;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export function chartModel(tl: Timeline): ChartModel {
  const x = [0], balance = [tl.startCredits], expected = [tl.startCredits];
  for (const p of tl.points) { x.push(p.t / 60_000); balance.push(p.balance); expected.push(p.expBalance); }
  const d = decimate(x, [balance, expected]);
  const marks: ChartModel['marks'] = [];
  if (tl.peak.i >= 0) marks.push({ x: tl.peak.t / 60_000, label: 'peak' });
  const fl = tl.markers.find((m) => m.kind === 'flush');
  if (fl) marks.push({ x: fl.t / 60_000, label: 'flush' });
  const stripCounts: ChartModel['stripCounts'] = {};
  for (const m of tl.markers) stripCounts[m.kind] = (stripCounts[m.kind] ?? 0) + 1;
  return {
    x: d.x, balance: d.ys[0] as number[], expected: d.ys[1] as number[], marks,
    strip: tl.markers.map((m) => ({ t: m.t, kind: m.kind })), stripCounts,
    durMin: Math.max(tl.end.t, tl.points.at(-1)?.t ?? 0) / 60_000,
  };
}

/** Numbers for the debrief. Full log: from analysis/debrief + timeline. Summary only: what the summary carries. */
export function buildView(session: Session | undefined, summary: Summary): DebriefView {
  const slotNote = (n: number) => (summary.mode === 'class' && n > 0 ? { sv: summary.sv ?? session?.sv ?? 'a' } : null);
  if (session) {
    const d = analyse(session);
    const tl = timeline(session);
    return {
      hasLog: true, rounds: d.rounds, durMs: d.durMs, start: d.start, endBalance: d.end.balance, net: d.net,
      peak: { balance: d.peak.balance, t: d.peak.t, atStart: d.peak.i < 0 },
      afterPeak: d.peak.i < 0 ? null : { rounds: d.afterPeak.rounds, wagered: d.afterPeak.wagered },
      wagered: d.wagered, expectedNet: d.expectedNet, nearMiss: d.nearMiss,
      celebrations: { total: d.celebrations.total, netLoss: d.celebrations.netLoss },
      stop: d.stop.n, chase: d.chase, flush: d.flush, slotNote: slotNote(d.byGame.slot?.rounds ?? 0),
      money: d.money, chart: chartModel(tl),
    };
  }
  const gs = Object.values(summary.games).filter((g) => !!g);
  const net = summary.finalCredits - summary.startCredits;
  const wagered = sum(gs.map((g) => g.bet));
  return {
    hasLog: false, rounds: sum(gs.map((g) => g.n)), durMs: summary.durMs, start: summary.startCredits,
    endBalance: summary.finalCredits, net,
    peak: { balance: summary.peak.bal, t: summary.peak.t, atStart: summary.peak.bal <= summary.startCredits },
    afterPeak: null, wagered, expectedNet: null, nearMiss: sum(gs.map((g) => g.dv)),
    celebrations: { total: sum(gs.map((g) => g.cel)), netLoss: sum(gs.map((g) => g.celNeg)) },
    stop: sum(gs.map((g) => g.stop)), chase: summary.chase, flush: summary.unreleased ?? 0,
    slotNote: slotNote(summary.games.slot?.n ?? 0), money: moneyView(net, wagered), chart: null,
  };
}

/** Felt answers vs the actual figures (updates when the intro is answered). */
export function feltView(v: Pick<DebriefView, 'durMs' | 'net'>, felt: FeltAnswers | null): FeltVsActual {
  return feltVsActual({ durMs: v.durMs, net: v.net }, felt);
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ DOM

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG = 'http://www.w3.org/2000/svg';
const KIND_ORDER: MarkerKind[] = ['antic', 'ldw', 'bigWin', 'chase', 'omen', 'flush'];

function strip(ctx: SectionCtx, m: ChartModel): HTMLElement {
  const { t } = ctx;
  const kinds = KIND_ORDER.filter((k) => (m.stripCounts[k] ?? 0) > 0);
  const wrap = h('div', 'dbf-strip');
  wrap.setAttribute('role', 'img');
  const nf = new Intl.NumberFormat(ctx.lang);
  wrap.setAttribute('aria-label', kinds.map((k) => `${t(`debrief.mark.${k}`)} ${nf.format(m.stripCounts[k] ?? 0)}`).join(', '));
  const dur = Math.max(1, m.durMin * 60_000);
  for (const k of kinds) {
    const row = h('div', 'dbf-strip-row');
    row.append(h('span', 'dbf-strip-k', `${t(`debrief.mark.${k}`)} ${nf.format(m.stripCounts[k] ?? 0)}`));
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 1000 14');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', `dbf-strip-svg k-${k}`);
    svg.setAttribute('aria-hidden', 'true');
    for (const s of m.strip) {
      if (s.kind !== k) continue;
      const x = Math.min(999, Math.max(1, (s.t / dur) * 1000));
      const l = document.createElementNS(SVG, 'line');
      l.setAttribute('x1', x.toFixed(1)); l.setAttribute('x2', x.toFixed(1));
      l.setAttribute('y1', '1'); l.setAttribute('y2', '13');
      svg.append(l);
    }
    row.append(svg);
    wrap.append(row);
  }
  return wrap;
}

function render(el: HTMLElement, ctx: SectionCtx): void {
  const { t, lang } = ctx;
  const nf = new Intl.NumberFormat(lang);
  const nf1 = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const sgn = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' });
  const v = buildView(ctx.session, ctx.summary);
  const cleanups: (() => void)[] = [];
  chartRef = null;

  el.append(h('p', '', t('debrief.lead')));
  if (!v.hasLog) el.append(h('div', 'callout', t('debrief.summaryOnly')));

  // ---- chart
  if (v.chart) {
    el.append(h('h3', '', t('debrief.chart.title')));
    el.append(h('p', 'muted', t('debrief.chart.note')));
    const box = h('div', 'chart');
    el.append(box);
    const c = v.chart;
    const chart: Chart = ctx.charts.line(box, {
      x: c.x,
      series: [
        { label: t('debrief.series.balance'), y: c.balance },
        { label: t('debrief.series.expected'), y: c.expected, dash: true },
      ],
      marks: c.marks.map((m) => ({ x: m.x, label: t(`debrief.mark.${m.label}`) })),
      fmtX: (x) => t('debrief.axis.min', { v: nf1.format(x) }),
      ariaLabel: t('debrief.chart.aria'),
    });
    chartRef = chart;
    if (Object.keys(c.stripCounts).length) {
      el.append(h('h3', '', t('debrief.strip.title')));
      el.append(strip(ctx, c));
    }
  }

  // ---- key numbers
  el.append(h('h3', '', t('debrief.nums.title')));
  const stats = h('div', 'stats dbf-stats');
  const add = (val: string, label: string): void => {
    const s = h('div', 'stat');
    s.append(h('span', 'stat-v', val), h('span', 'stat-k', label));
    stats.append(s);
  };
  add(nf.format(v.rounds), t('debrief.stat.rounds'));
  add(nf.format(v.nearMiss), t('debrief.stat.nearMiss'));
  add(nf.format(v.celebrations.total), t('debrief.stat.celebrations'));
  add(nf.format(v.celebrations.netLoss), t('debrief.stat.celebratedLoss'));
  add(nf.format(v.stop), t('debrief.stat.stop'));
  add(nf.format(v.chase), t('debrief.stat.chase'));
  el.append(stats);

  const list = h('ul', 'dbf-list');
  const li = (txt: string): HTMLLIElement => { const e = h('li', '', txt); list.append(e); return e; };
  li(t('debrief.read.celebrations', { n: nf.format(v.celebrations.total), m: nf.format(v.celebrations.netLoss) }));
  li(t('debrief.read.stop', { n: nf.format(v.stop) }));
  li(t('debrief.read.chase', { n: nf.format(v.chase) }));
  if (v.peak.atStart) {
    li(t('debrief.read.peakStart', { end: nf.format(v.endBalance), start: nf.format(v.start) }));
  } else {
    const after = v.afterPeak
      ? ` ${t('debrief.read.afterPeak', { rounds: nf.format(v.afterPeak.rounds), wagered: nf.format(v.afterPeak.wagered) })}`
      : '';
    li(t('debrief.read.peak', {
      time: clock(v.peak.t), peak: nf.format(v.peak.balance), endTime: clock(v.durMs), end: nf.format(v.endBalance),
    }) + after);
  }
  if (v.expectedNet !== null) {
    li(t('debrief.read.expected', { exp: sgn.format(Math.round(v.expectedNet)), net: sgn.format(v.net), wagered: nf.format(v.wagered) }));
  }
  if (v.flush > 0) li(t('debrief.read.flush', { n: nf.format(v.flush) }));
  el.append(list);

  // ---- felt vs actual (re-rendered when the intro is answered)
  el.append(h('h3', '', t('debrief.felt.title')));
  const feltBox = h('div', 'dbf-felt');
  feltBox.setAttribute('aria-live', 'polite');
  el.append(feltBox);
  const key = feltKey(ctx.summary);
  const paintFelt = (): void => {
    const rec = readFelt(key);
    const f = feltView(v, rec);
    const rows: string[] = [];
    if (f.feltMinutes !== null) {
      rows.push(t('debrief.felt.time', { felt: nf1.format(f.feltMinutes), actual: nf1.format(f.actualMinutes) }));
      if (f.minutesRatio !== null && (f.minutesRatio >= 1.25 || f.minutesRatio <= 0.8)) {
        rows.push(t('debrief.felt.ratio', { r: nf1.format(f.minutesRatio) }));
      }
    }
    if (f.feltNet !== null) rows.push(t('debrief.felt.net', { felt: sgn.format(f.feltNet), actual: sgn.format(f.actualNet) }));
    feltBox.replaceChildren(...(rows.length ? rows.map((r) => h('p', '', r)) : [h('p', 'muted', t('debrief.felt.none'))]));
  };
  paintFelt();
  cleanups.push(onFelt(paintFelt));

  // ---- money
  el.append(h('h3', '', t('debrief.money.title')));
  const m = v.money;
  const hours = (x: number | null): string => (x === null ? '' : nf1.format(x));
  const wage = MIN_WAGE_KRW_PER_HOUR;
  const mp = h('p');
  if (m.lossCredits > 0) {
    mp.textContent = t('debrief.money.loss', { credits: nf.format(m.lossCredits), krw: nf.format(m.lossKrw), rate: KRW_PER_CREDIT });
  } else {
    mp.textContent = t('debrief.money.noLoss', { credits: nf.format(m.netCredits), rate: KRW_PER_CREDIT });
  }
  el.append(mp);
  if (wage !== null) {
    const wp = h('p', '');
    const parts: string[] = [];
    if (m.lossCredits > 0 && m.lossWageHours !== null) {
      parts.push(t('debrief.money.wageLoss', { year: MIN_WAGE_YEAR, wage: nf.format(wage), hours: hours(m.lossWageHours) }));
    }
    if (m.wageredWageHours !== null) {
      parts.push(t('debrief.money.wageWagered', { krw: nf.format(m.wageredKrw), hours: hours(m.wageredWageHours) }));
    }
    wp.textContent = parts.join(' ');
    wp.append(' ');
    const a = h('a', '', t('debrief.money.source'));
    a.href = MIN_WAGE_SOURCE; a.target = '_blank'; a.rel = 'noopener noreferrer';
    wp.append(a);
    el.append(wp);
  }

  if (v.slotNote) el.append(h('p', 'muted', t('debrief.slotNote', { sv: v.slotNote.sv.toUpperCase() })));

  // ---- helpline
  const help = h('div', 'callout dbf-help');
  help.append(h('p', '', t('debrief.help.body')));
  const tel = h('a', 'btn secondary', t('debrief.help.call'));
  tel.href = 'tel:1336';
  help.append(tel);
  el.append(help);

  cleanup = () => { cleanups.forEach((f) => f()); };
}

let chartRef: Chart | null = null;
let cleanup: (() => void) | null = null;

const section: Section = {
  id: 'debrief',
  titleKey: 'app.toc.debrief',
  needs: 'summary',
  render,
  dispose() {
    chartRef?.destroy(); chartRef = null;
    cleanup?.(); cleanup = null;
  },
};
export default section;
