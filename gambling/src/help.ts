/**
 * "How to play" sheet, opened from the HUD's ? button inside a game. Each game ships its own content in
 * `games/<id>/help.ts` (lazy, next to the game's chunk) so paytable numbers come straight from the game's
 * tables and stay right when the math changes. Text is built at open time through `t()`, so a language
 * change shows up the next time the sheet opens.
 *
 * Opening it is logged as `aux("help", {game})`; nothing else about it is recorded.
 */
import './help.css';
import type { GameId, SlotVariant } from '../../shared/config';
import { t } from '../../shared/i18n.gambling';
import type { Fx } from '../fx/types';
import { h, sheet, type Overlay } from './ui';

/** A reel symbol: its standalone SVG document and its name. */
export interface HelpSym { svg: string; label: string }
/** A table cell: text, or a group of symbols that share the row. */
export type HelpCell = string | HelpSym[];
export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  /** `num`: indices of right-aligned numeric columns. */
  | { kind: 'table'; head?: string[]; rows: HelpCell[][]; num?: number[] }
  | { kind: 'syms'; items: HelpSym[] }
  /** Payline diagrams: `rows[i]` = the lit row (0..2) on reel i. */
  | { kind: 'paylines'; lines: readonly (readonly number[])[] };
export interface HelpSection { title: string; blocks: HelpBlock[] }
export interface HelpDoc { title: string; sections: HelpSection[] }

export interface HelpEnv {
  t: (key: string, params?: Record<string, string | number>) => string;
  sv: SlotVariant;
}
export type HelpBuilder = (env: HelpEnv) => HelpDoc;
export type HelpLoader = () => Promise<{ help: HelpBuilder }>;

export const HELP_LOADERS: Record<GameId, HelpLoader> = {
  slot: () => import('../games/slot/help'),
  roulette: () => import('../games/roulette/help'),
  blackjack: () => import('../games/blackjack/help'),
  crash: () => import('../games/crash/help'),
  ocean: () => import('../games/ocean/help'),
};

/** Split a dictionary value on newlines into list items (one string per rule line). */
export function lines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean);
}

/** A reel symbol as a small image next to its name. */
function symEl(x: HelpSym): HTMLElement {
  const img = h('img');
  img.src = `data:image/svg+xml,${encodeURIComponent(x.svg)}`;
  img.alt = '';
  img.width = 30;
  img.height = 30;
  return h('span', 'hp-sym', [img, x.label]);
}
const symsEl = (xs: HelpSym[]): HTMLElement => h('span', 'hp-syms', xs.map(symEl));

function cell(tag: 'td' | 'th', c: HelpCell, isNum: boolean): HTMLElement {
  return h(tag, isNum ? 'hp-num' : '', [typeof c === 'string' ? c : symsEl(c)]);
}

function paylinesEl(lines: readonly (readonly number[])[]): HTMLElement {
  return h('div', 'hp-lines', lines.map((rows, i) => {
    const g = h('div', 'hp-line');
    for (let r = 0; r < 3; r++) for (let c = 0; c < rows.length; c++) g.append(h('i', rows[c] === r ? 'on' : ''));
    return h('div', 'hp-line-box', [h('span', 'hp-line-n', [String(i + 1)]), g]);
  }));
}

/** Render a help document into a DOM tree (no sheet). */
export function renderHelp(doc: HelpDoc): HTMLElement {
  const root = h('div', 'hp');
  for (const s of doc.sections) {
    const sec = h('section', 'hp-sec', [h('h3', 'hp-sec__title', [s.title])]);
    for (const b of s.blocks) {
      if (b.kind === 'p') sec.append(h('p', 'hp-p', [b.text]));
      else if (b.kind === 'list') sec.append(h('ul', 'hp-list', b.items.map((x) => h('li', '', [x]))));
      else if (b.kind === 'syms') sec.append(symsEl(b.items));
      else if (b.kind === 'paylines') sec.append(paylinesEl(b.lines));
      else {
        const num = new Set(b.num ?? []);
        const table = h('table', 'hp-table');
        if (b.head) table.append(h('thead', '', [h('tr', '', b.head.map((x, i) => cell('th', x, num.has(i))))]));
        table.append(h('tbody', '', b.rows.map((r) => h('tr', '', r.map((x, i) => cell('td', x, num.has(i)))))));
        sec.append(h('div', 'hp-table-wrap', [table]));
      }
    }
    root.append(sec);
  }
  return root;
}

/** Left-to-right line paytable: one row per distinct pay (symbols that pay the same share a row). */
export function paytable<S extends string>(o: {
  pay: Readonly<Record<S, readonly number[]>>;
  order: readonly S[];
  svg(sym: S): string;
  name(sym: S): string;
  head: string;
}): HelpBlock {
  const rows: HelpCell[][] = [];
  const done = new Set<S>();
  for (const sym of o.order) {
    if (done.has(sym)) continue;
    const same = o.order.filter((x) => !done.has(x) && o.pay[x].join() === o.pay[sym].join());
    for (const x of same) done.add(x);
    rows.push([same.map((x) => ({ svg: o.svg(x), label: o.name(x) })), ...o.pay[sym].map((v) => v.toLocaleString('en-US'))]);
  }
  return { kind: 'table', head: [o.head, '×3', '×4', '×5'], rows, num: [1, 2, 3] };
}

export interface HelpOptions {
  game: GameId;
  sv: SlotVariant;
  fx?: Fx;
  log?: (game: GameId) => void;
  loaders?: Record<GameId, HelpLoader>;
}

/** Load the game's content, build and open the sheet. Resolves to the open sheet. */
export async function openHelp(o: HelpOptions): Promise<Overlay> {
  try { o.fx?.sfx.play('tap'); } catch { /* ignore */ }
  o.log?.(o.game);
  const mod = await (o.loaders ?? HELP_LOADERS)[o.game]();
  const doc = mod.help({ t, sv: o.sv });
  const sh = sheet({ title: doc.title, testid: 'help', body: [renderHelp(doc)] });
  sh.panel.classList.add('ui-sheet--help');
  sh.open();
  return sh;
}
