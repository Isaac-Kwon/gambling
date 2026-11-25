import './replayPlain.css';
import { replayRows, type ReplayRow } from '../analysis/replay';
import type { Section, SectionCtx } from './types';

export const PAGE_SIZE = 50;
/** Rows revealed per 250 ms tick, by speed level (4, 16, 64 rows/s). */
export const SPEED_STEPS = [1, 4, 16] as const;
export const TICK_MS = 250;

export interface ReplayState { shown: number; page: number }

export const pageCount = (shown: number, size = PAGE_SIZE): number => Math.max(1, Math.ceil(shown / size));
export const lastPage = (shown: number, size = PAGE_SIZE): number => pageCount(shown, size) - 1;

/** Row index range [from, to) visible on `page` when `shown` rows are revealed. */
export function pageRange(st: ReplayState, size = PAGE_SIZE): [number, number] {
  const from = Math.min(st.page, lastPage(st.shown, size)) * size;
  return [from, Math.min(st.shown, from + size)];
}

export function jumpToEnd(total: number, size = PAGE_SIZE): ReplayState {
  return { shown: total, page: lastPage(total, size) };
}

/** Start playing: from the beginning when everything is already shown. */
export function restart(st: ReplayState, total: number): ReplayState {
  return st.shown >= total ? { shown: Math.min(1, total), page: 0 } : st;
}

/** One tick of fast-forward; the page follows the newest row. */
export function advance(st: ReplayState, step: number, total: number, size = PAGE_SIZE): ReplayState {
  const shown = Math.min(total, st.shown + step);
  return { shown, page: lastPage(shown, size) };
}

export function turnPage(st: ReplayState, dir: -1 | 1, size = PAGE_SIZE): ReplayState {
  return { shown: st.shown, page: Math.max(0, Math.min(lastPage(st.shown, size), st.page + dir)) };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let stop: (() => void) | null = null;

function render(el: HTMLElement, ctx: SectionCtx): void {
  const s = ctx.session!;
  const { t, lang } = ctx;
  const nf = new Intl.NumberFormat(lang);
  const sf = new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' });
  const rows: ReplayRow[] = replayRows(s);
  const total = rows.length;

  el.append(h('p', '', t('replay.intro')));
  if (total === 0) return;

  let st: ReplayState = jumpToEnd(total);
  let playing = false;
  let speed = 1;
  let timer: ReturnType<typeof setInterval> | null = null;

  const controls = h('div', 'rp-controls');
  const playBtn = h('button', 'btn');
  playBtn.type = 'button';
  const endBtn = h('button', 'btn secondary', t('replay.end'));
  endBtn.type = 'button';
  const speedBox = h('span', 'rp-speed');
  speedBox.setAttribute('role', 'group');
  speedBox.setAttribute('aria-label', t('replay.speed'));
  const speedBtns = SPEED_STEPS.map((_, k) => {
    const b = h('button', 'btn secondary', t(`replay.speed.${k + 1}`));
    b.type = 'button';
    b.addEventListener('click', () => { speed = k; paintSpeed(); });
    speedBox.append(b);
    return b;
  });
  controls.append(playBtn, endBtn, speedBox);

  const status = h('p', 'rp-status');
  status.setAttribute('aria-live', 'off');
  const wrap = h('div', 'table-wrap');
  const tb = h('table', 'rp-table');
  tb.createCaption().textContent = t('replay.table.caption');
  tb.caption!.className = 'muted';
  const head = h('tr');
  for (const [k, num] of [['round', true], ['game', false], ['bet', true], ['payout', true], ['net', true], ['balance', true]] as [string, boolean][]) {
    const th = h('th', num ? 'num' : '', t(`replay.col.${k}`));
    th.scope = 'col';
    head.append(th);
  }
  const thead = h('thead');
  thead.append(head);
  const body = h('tbody');
  tb.append(thead, body);
  wrap.append(tb);

  const pager = h('div', 'rp-pager');
  const prev = h('button', 'btn secondary', t('replay.prev'));
  const next = h('button', 'btn secondary', t('replay.next'));
  prev.type = next.type = 'button';
  const pageLbl = h('span');
  pager.append(prev, pageLbl, next);

  function paintSpeed(): void {
    speedBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === speed)));
  }

  function paint(): void {
    const [from, to] = pageRange(st);
    const frag = document.createDocumentFragment();
    for (let k = from; k < to; k++) {
      const r = rows[k];
      const tr = h('tr', r.flush ? 'flush' : '');
      if (r.flush) {
        const c = h('td', '', t('replay.flush'));
        c.colSpan = 4;
        tr.append(c, h('td', 'num', sf.format(r.net)), h('td', 'num', nf.format(r.balance)));
      } else {
        tr.append(
          h('td', 'num', nf.format(r.n)), h('td', '', t(`replay.game.${r.game}`)), h('td', 'num', nf.format(r.bet)),
          h('td', 'num', nf.format(r.payout)), h('td', 'num', sf.format(r.net)), h('td', 'num', nf.format(r.balance)),
        );
      }
      frag.append(tr);
    }
    body.replaceChildren(frag);
    const last = rows[st.shown - 1];
    status.textContent = t('replay.status', {
      shown: nf.format(st.shown), total: nf.format(total), balance: nf.format(last.balance), net: sf.format(last.balance - s.startCredits),
    });
    const pages = pageCount(st.shown);
    pageLbl.textContent = t('replay.page', { page: nf.format(Math.min(st.page, pages - 1) + 1), pages: nf.format(pages) });
    prev.disabled = st.page <= 0;
    next.disabled = st.page >= lastPage(st.shown);
    playBtn.textContent = playing ? t('replay.pause') : st.shown >= total ? t('replay.restart') : t('replay.play');
    playBtn.setAttribute('aria-pressed', String(playing));
    endBtn.disabled = st.shown >= total && st.page >= lastPage(total);
  }

  function halt(): void {
    playing = false;
    if (timer !== null) { clearInterval(timer); timer = null; }
  }

  playBtn.addEventListener('click', () => {
    if (playing) { halt(); paint(); return; }
    st = restart(st, total);
    playing = true;
    timer = setInterval(() => {
      st = advance(st, SPEED_STEPS[speed], total);
      if (st.shown >= total) halt();
      paint();
    }, TICK_MS);
    paint();
  });
  endBtn.addEventListener('click', () => { halt(); st = jumpToEnd(total); paint(); });
  prev.addEventListener('click', () => { st = turnPage(st, -1); paint(); });
  next.addEventListener('click', () => { st = turnPage(st, 1); paint(); });

  paintSpeed();
  paint();
  el.append(controls, status, wrap, pager, h('p', 'rp-question', t('replay.question')));
  stop = halt;
}

const section: Section = {
  id: 'replayPlain',
  titleKey: 'app.toc.replayPlain',
  needs: 'full',
  render,
  dispose() { stop?.(); stop = null; },
};
export default section;
