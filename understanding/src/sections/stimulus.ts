import './stimulus.css';
import type { Session } from '@shared/schema';
import type { Chart } from '../charts/kit';
import { bigWinMoments, fakeElements, fxSplit, stimulusSeries, type FxSplit, type StimRow } from '../analysis/stimulus';
import { fxCategory, fxChannel, isBigWin, isCelebrated, isFlush, isLdw, type FxChannel } from '../analysis/mapping';
import type { Section, SectionCtx } from './types';

export const CHANNELS: readonly FxChannel[] = ['sound', 'visual', 'particles', 'motion', 'haptic'];
export const MAX_BIG_ROWS = 40;
export const MAX_EXAMPLES = 3;

export interface BigRow { n: number; game: string; tier: number; payout: number; cumNet: number }

export interface StimView {
  fxOff: boolean;
  /** 1-based round number per row (shared x of both plots). */
  x: number[];
  /** Stimulus seconds per round (process sounds excluded). */
  stim: number[];
  cum: number[];
  split: FxSplit;
  /** Sum of seconds per sensory channel, process sounds excluded. */
  channels: Record<FxChannel, number>;
  big: BigRow[];
  bigTotal: number;
  /** Big wins shown while the cumulative net was below zero. */
  bigBelow: number;
  /** What a session with effects on would have shown. */
  absent: { celebrated: number; bigWin: number; ldw: number };
  fakes: {
    tickers: number; tickerTotal: number; hot: number; crowds: number; crowdTotal: number;
    exTicker: { name: string; game: string; amt: number }[];
    exHot: string[][];
    exCrowd: number[];
  };
}

/** Seconds per channel over non-process records. Local helper (analysis only has the per-round channel count). */
export function channelSeconds(s: Session): Record<FxChannel, number> {
  const out: Record<FxChannel, number> = { sound: 0, visual: 0, particles: 0, motion: 0, haptic: 0 };
  for (const e of s.events) {
    if (isFlush(e)) continue;
    for (const r of e.fx ?? []) {
      if (fxCategory(r.type) === 'process') continue;
      if (Number.isFinite(r.ms) && r.ms > 0) out[fxChannel(r.type)] += r.ms / 1000;
    }
  }
  return out;
}

export function buildStimView(s: Session): StimView {
  const rows: StimRow[] = stimulusSeries(s);
  const bigs = bigWinMoments(s);
  const f = fakeElements(s);
  const rounds = s.events.filter((e) => !isFlush(e));
  const roundNo = new Map<number, number>();
  rows.forEach((r, k) => roundNo.set(r.i, k + 1));
  const big: BigRow[] = bigs.slice(0, MAX_BIG_ROWS).map((b) => ({
    n: roundNo.get(b.i) ?? 0, game: b.game, tier: Math.min(4, b.tier), payout: b.payout, cumNet: b.cumNet,
  }));
  return {
    fxOff: s.fx === 'off',
    x: rows.map((_, k) => k + 1),
    stim: rows.map((r) => r.stimMs / 1000),
    cum: rows.map((r) => r.cumNet),
    split: fxSplit(rows),
    channels: channelSeconds(s),
    big,
    bigTotal: bigs.length,
    bigBelow: bigs.filter((b) => b.cumNet < 0).length,
    absent: {
      celebrated: rounds.filter(isCelebrated).length,
      bigWin: rounds.filter((e) => isBigWin(e)).length,
      ldw: rounds.filter(isLdw).length,
    },
    fakes: {
      tickers: f.tickers.length, tickerTotal: f.tickerTotal, hot: f.hot.length, crowds: f.crowds.length, crowdTotal: f.crowdTotal,
      exTicker: f.tickers.slice(0, MAX_EXAMPLES).map((x) => ({ name: x.name, game: x.game, amt: x.amt })),
      exHot: f.hot.slice(0, MAX_EXAMPLES).map((x) => x.games),
      exCrowd: f.crowds.slice(0, MAX_EXAMPLES).map((x) => x.n),
    },
  };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stats(items: [string, string][]): HTMLElement {
  const wrap = h('div', 'stats');
  for (const [k, v] of items) {
    const c = h('div', 'stat');
    c.append(h('span', 'stat-v', v), h('span', 'stat-k', k));
    wrap.append(c);
  }
  return wrap;
}

function table(head: [string, boolean][], rows: string[][]): HTMLElement {
  const wrap = h('div', 'table-wrap');
  const tb = h('table');
  const thead = h('thead');
  const tr = h('tr');
  for (const [k, num] of head) {
    const th = h('th', num ? 'num' : '', k);
    th.scope = 'col';
    tr.append(th);
  }
  thead.append(tr);
  const body = h('tbody');
  for (const r of rows) {
    const row = h('tr');
    r.forEach((c, k) => row.append(h('td', head[k][1] ? 'num' : '', c)));
    body.append(row);
  }
  tb.append(thead, body);
  wrap.append(tb);
  return wrap;
}

let charts: Chart[] = [];

function render(el: HTMLElement, ctx: SectionCtx): void {
  const s = ctx.session as Session;
  const { t, lang } = ctx;
  const nf = new Intl.NumberFormat(lang);
  const sf = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' });
  const pf = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 });
  const df = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const v = buildStimView(s);
  const n = v.x.length;
  const game = (g: string) => t(`replay.game.${g}`);

  el.append(h('p', '', t('stimulus.intro')));

  if (v.fxOff) {
    const c = h('div', 'callout');
    c.append(h('strong', '', t('stimulus.fxoff.title')), h('p', '', t('stimulus.fxoff.body')));
    const ul = h('ul');
    ul.append(
      h('li', '', t('stimulus.fxoff.celebrated', { n: nf.format(v.absent.celebrated) })),
      h('li', '', t('stimulus.fxoff.bigwin', { n: nf.format(v.absent.bigWin) })),
      h('li', '', t('stimulus.fxoff.ldw', { n: nf.format(v.absent.ldw) })),
      h('li', '', t('stimulus.fxoff.fakes')),
    );
    c.append(ul);
    el.append(c);
    return;
  }

  el.append(h('h3', '', t('stimulus.chart.title')));
  const holder = h('div', 'chart');
  el.append(holder);
  const fmtX = (x: number) => t('stimulus.chart.round', { n: nf.format(Math.round(x)) });
  const marks = v.big.filter((b) => b.n > 0).slice(0, 20).map((b) => ({ x: b.n, label: t(`stimulus.tier.${b.tier}`) }));
  charts.push(ctx.charts.stacked2(
    holder,
    { x: v.x, series: [{ label: t('stimulus.chart.top'), y: v.stim, area: true }], fmtX, fmtY: (y) => `${df.format(y)}s`, ariaLabel: t('stimulus.chart.aria') },
    { x: v.x, series: [{ label: t('stimulus.chart.bottom'), y: v.cum }], marks, fmtX, fmtY: (y) => nf.format(y), ariaLabel: t('stimulus.chart.aria') },
  ));
  el.append(h('p', 'stim-note', t('stimulus.chart.note')));

  const sp = v.split;
  el.append(h('h3', '', t('stimulus.split.title')));
  el.append(stats([
    [t('stimulus.split.win'), t('stimulus.split.sec', { s: df.format(sp.winSec) })],
    [t('stimulus.split.loss'), t('stimulus.split.sec', { s: df.format(sp.lossSec) })],
    [t('stimulus.split.share'), pf.format(sp.lossRoundFrac)],
  ]));
  el.append(h('p', '', t('stimulus.split.body', {
    w: nf.format(sp.winRounds), ws: df.format(sp.winSec), l: nf.format(sp.lossRounds), ls: df.format(sp.lossSec),
    n: nf.format(n), p: pf.format(sp.lossRoundFrac),
  })));
  if (sp.lossSec > 0) {
    el.append(h('p', '', t('stimulus.split.lossby', {
      ls: df.format(sp.lossSec), ldw: df.format(sp.lossSecBy.ldw), antic: df.format(sp.lossSecBy.anticipation), omen: df.format(sp.lossSecBy.omen),
    })));
  }

  el.append(h('h3', '', t('stimulus.channels.title')));
  el.append(table(
    [[t('stimulus.channels.head'), false], [t('stimulus.channels.sec'), true]],
    CHANNELS.map((c) => [t(`stimulus.channels.${c}`), df.format(v.channels[c])]),
  ));

  el.append(h('h3', '', t('stimulus.big.title')));
  if (v.bigTotal === 0) {
    el.append(h('p', 'muted', t('stimulus.big.none')));
  } else {
    el.append(h('p', '', t('stimulus.big.lede')));
    el.append(table(
      [[t('stimulus.big.round'), true], [t('stimulus.big.game'), false], [t('stimulus.big.tier'), false], [t('stimulus.big.payout'), true], [t('stimulus.big.cum'), true]],
      v.big.map((b) => [nf.format(b.n), game(b.game), t(`stimulus.tier.${b.tier}`), nf.format(b.payout), sf.format(b.cumNet)]),
    ));
    if (v.bigTotal > v.big.length) el.append(h('p', 'muted', t('stimulus.big.more', { n: nf.format(v.bigTotal - v.big.length) })));
    if (v.bigBelow > 0) {
      el.append(h('p', '', v.bigBelow === v.bigTotal ? t('stimulus.big.allbelow') : t('stimulus.big.below', { n: nf.format(v.bigBelow) })));
    }
  }

  el.append(h('h3', '', t('stimulus.fake.title')));
  const fk = v.fakes;
  if (fk.tickers + fk.hot + fk.crowds === 0) {
    el.append(h('p', 'muted', t('stimulus.fake.none')));
    return;
  }
  el.append(h('p', '', t('stimulus.fake.lede')));
  const ul = h('ul', 'stim-fakes');
  const item = (text: string, ex: string[]) => {
    const li = h('li', '', text);
    if (ex.length) {
      const eu = h('ul', 'stim-ex');
      ex.forEach((x) => eu.append(h('li', '', x)));
      li.append(eu);
    }
    ul.append(li);
  };
  if (fk.tickers) {
    item(t('stimulus.fake.ticker', { n: nf.format(fk.tickers), amt: nf.format(fk.tickerTotal) }),
      fk.exTicker.map((x) => t('stimulus.fake.exTicker', { name: x.name, game: game(x.game), amt: nf.format(x.amt) })));
  }
  if (fk.hot) {
    item(t('stimulus.fake.hot', { n: nf.format(fk.hot) }),
      fk.exHot.map((g) => t('stimulus.fake.exHot', { games: g.map(game).join(', ') })));
  }
  if (fk.crowds) {
    item(t('stimulus.fake.crowd', { n: nf.format(fk.crowds), total: nf.format(fk.crowdTotal) }),
      fk.exCrowd.map((c) => t('stimulus.fake.exCrowd', { n: nf.format(c) })));
  }
  el.append(ul, h('p', '', t('stimulus.fake.foot')));
}

const section: Section = {
  id: 'stimulus',
  titleKey: 'app.toc.stimulus',
  needs: 'full',
  render,
  dispose() {
    charts.forEach((c) => c.destroy());
    charts = [];
  },
};
export default section;
