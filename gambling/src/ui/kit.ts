// OROBELLE UI kit: small DOM component functions (no framework). Styles live in kit.css.
// Every interactive part is a real <button type="button"> with a hit area of at least 44×44 px.
import { t } from '@shared/i18n.gambling';
import { s, svgRoot, starPath, uid, radialGrad, circlePath } from './svg';
import { fmtCredits } from './format';

// ---------------------------------------------------------------- basics

type Kid = Node | string | null | undefined | false;

/** Create an HTML element with class names and children (strings become text nodes). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', kids: Kid[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

function testid(el: HTMLElement, id?: string): void {
  if (id) el.dataset.testid = id;
}

/**
 * Instant pressed look on pointerdown (iOS does not apply :active without a touch listener),
 * released on up/cancel/leave. Returns a cleanup function.
 */
export function pressable(el: HTMLElement): () => void {
  const down = (e: PointerEvent) => {
    if ((el as HTMLButtonElement).disabled || e.button > 0) return;
    el.classList.add('is-down');
  };
  const up = () => el.classList.remove('is-down');
  el.addEventListener('pointerdown', down);
  for (const n of ['pointerup', 'pointercancel', 'pointerleave', 'blur'] as const) el.addEventListener(n, up);
  return () => {
    el.removeEventListener('pointerdown', down);
    for (const n of ['pointerup', 'pointercancel', 'pointerleave', 'blur'] as const) el.removeEventListener(n, up);
  };
}

function baseButton(cls: string, o: { testid?: string; onTap?: (e: MouseEvent) => void; disabled?: boolean; aria?: string }): HTMLButtonElement {
  const b = h('button', cls);
  b.type = 'button';
  testid(b, o.testid);
  if (o.aria) b.setAttribute('aria-label', o.aria);
  if (o.disabled) b.disabled = true;
  if (o.onTap) b.addEventListener('click', o.onTap);
  pressable(b);
  return b;
}

/** Root `data-fx="off"` turns off kit glow layers and looping decorations (same DOM, plain look). */
export function setFxMode(mode: 'on' | 'off', root: HTMLElement = document.documentElement): void {
  root.dataset.fx = mode;
}

// ---------------------------------------------------------------- icons

export type IconName =
  | 'close' | 'plus' | 'minus' | 'back' | 'sound' | 'mute' | 'bolt' | 'loop' | 'coin' | 'star' | 'crown' | 'grid' | 'gear';

/** Cog outline: `teeth` square-ish teeth between radius `r0` and `r1`, centred on (12, 12). */
function gearPath(teeth = 8, r0 = 7.6, r1 = 10.4): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  const half = step * 0.22;
  const p = (r: number, a: number) => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    pts.push(p(r0, a - step / 2 + half * 0.6), p(r1, a - half), p(r1, a + half), p(r0, a + step / 2 - half * 0.6));
  }
  return `M${pts.join(' L')} Z`;
}

const STROKE: Partial<Record<IconName, string>> = {
  close: 'M6 6L18 18M18 6L6 18',
  plus: 'M12 5V19M5 12H19',
  minus: 'M5 12H19',
  back: 'M15 4.5L7.5 12L15 19.5',
  loop: 'M4.5 12A7.5 7.5 0 0 1 17.6 7M19.5 12A7.5 7.5 0 0 1 6.4 17M18 3V7.2H13.8M6 21V16.8H10.2',
};
const FILL: Partial<Record<IconName, string>> = {
  bolt: 'M13.5 2L4.5 13.5H11L10 22L19.5 10H13Z',
  star: starPath(12, 12.6, 10.5, 4.4),
  crown: 'M3 18.5L4.6 7.5L9.2 11.6L12 4.5L14.8 11.6L19.4 7.5L21 18.5Z',
  grid: 'M4 4H10.5V10.5H4ZM13.5 4H20V10.5H13.5ZM4 13.5H10.5V20H4ZM13.5 13.5H20V20H13.5Z',
};

/** 24×24 line/solid icon in currentColor. */
export function icon(name: IconName, size = 22): SVGSVGElement {
  const kids: SVGElement[] = [];
  const line = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (STROKE[name]) kids.push(s('path', { d: STROKE[name], ...line }));
  if (FILL[name]) kids.push(s('path', { d: FILL[name], fill: 'currentColor' }));
  if (name === 'sound' || name === 'mute') {
    kids.push(s('path', { d: 'M3.5 9H7.5L12.5 4.8V19.2L7.5 15H3.5Z', fill: 'currentColor', 'stroke-linejoin': 'round' }));
    kids.push(s('path', { d: name === 'sound' ? 'M15.5 9C17 10.6 17 13.4 15.5 15M18.2 6.4C21.2 9.6 21.2 14.4 18.2 17.6' : 'M15.5 9.2L21 14.8M21 9.2L15.5 14.8', ...line }));
  }
  if (name === 'gear') {
    kids.push(s('path', { d: `${gearPath()} M12 8.4 A3.6 3.6 0 1 0 12 15.6 A3.6 3.6 0 1 0 12 8.4 Z`, fill: 'currentColor', 'fill-rule': 'evenodd' }));
  }
  if (name === 'coin') {
    kids.push(s('circle', { cx: 12, cy: 12, r: 9.5, fill: 'currentColor' }));
    kids.push(s('circle', { cx: 12, cy: 12, r: 6, fill: 'none', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 1.8 }));
  }
  return svgRoot('0 0 24 24', kids, { class: 'ui-icon', width: size, height: size });
}

// ---------------------------------------------------------------- text

export type Glow = 'magenta' | 'cyan' | 'violet' | 'gold' | 'none';

/**
 * Gold display text (Lilita One): gradient fill over a thick dark outline layer, plus an optional
 * static neon glow layer that breathes via opacity only. `size` in px (or any CSS length).
 */
export function goldText(text: string, o: { size?: number | string; glow?: Glow; tag?: 'span' | 'div' | 'h1' | 'h2' | 'h3'; className?: string } = {}): HTMLElement {
  const el = h(o.tag ?? 'span', `ui-gold ${o.className ?? ''}`.trim());
  setGoldText(el, text);
  if (o.size !== undefined) el.style.fontSize = typeof o.size === 'number' ? `${o.size}px` : o.size;
  el.dataset.glow = o.glow ?? 'magenta';
  return el;
}

/** Replace the text of a goldText element (keeps all layers in sync). */
export function setGoldText(el: HTMLElement, text: string): void {
  el.dataset.text = text;
  let fill = el.querySelector<HTMLElement>(':scope > .ui-gold__fill');
  if (!fill) {
    el.append(h('span', 'ui-gold__glow ui-glow', []), (fill = h('span', 'ui-gold__fill')));
  }
  (el.querySelector(':scope > .ui-gold__glow') as HTMLElement).textContent = text;
  fill.textContent = text;
}

/** Neon tube lettering in a palette colour; static glow + a breathing halo layer. */
export function neonText(text: string, o: { color?: 'magenta' | 'cyan' | 'violet' | 'gold' | 'crimson'; size?: number | string; className?: string } = {}): HTMLElement {
  const el = h('span', `ui-neon ${o.className ?? ''}`.trim(), [h('span', 'ui-neon__halo ui-glow', [text]), h('span', 'ui-neon__tube', [text])]);
  el.dataset.color = o.color ?? 'magenta';
  if (o.size !== undefined) el.style.fontSize = typeof o.size === 'number' ? `${o.size}px` : o.size;
  return el;
}

/** Tier title for win banners: tier 0..4 -> WIN / NICE / BIG WIN / MEGA WIN / EPIC WIN (via i18n keys). */
export function winTitle(tier: number, o: { size?: number | string } = {}): HTMLElement {
  const n = Math.max(0, Math.min(4, Math.round(tier)));
  const glow: Glow[] = ['gold', 'gold', 'magenta', 'cyan', 'violet'];
  const el = goldText(t(`tier.${n}`), { size: o.size, glow: glow[n], className: 'ui-wintitle', tag: 'div' });
  el.dataset.tier = String(n);
  return el;
}

// ---------------------------------------------------------------- numbers

/**
 * Write `text` into `el` as fixed-width digit cells (.ui-d, width .62em) and narrow separators (.ui-sep),
 * reusing existing cells so a count-up does not jitter or re-create nodes every frame.
 */
export function setDigits(el: HTMLElement, text: string): void {
  const cells = el.children;
  let i = 0;
  for (const ch of text) {
    const cls = ch >= '0' && ch <= '9' ? 'ui-d' : 'ui-sep';
    let c = cells[i] as HTMLElement | undefined;
    if (!c || c.className !== cls) {
      const n = h('span', cls);
      if (c) el.replaceChild(n, c);
      else el.append(n);
      c = n;
    }
    if (c.textContent !== ch) c.textContent = ch;
    i++;
  }
  while (cells.length > i) el.lastElementChild!.remove();
  el.setAttribute('aria-label', text);
}

export type NumTone = 'gold' | 'win' | 'plain' | 'neon';
export interface NumDisplay {
  readonly el: HTMLElement;
  /** Numbers are formatted as credits; strings are written as-is (e.g. "2.50×"). */
  set(v: number | string): void;
}

/** Chunky Lilita One number with fixed-width digits. `size` in px. */
export function num(o: { value?: number | string; tone?: NumTone; size?: number; testid?: string } = {}): NumDisplay {
  const el = h('span', `ui-num ui-num--${o.tone ?? 'gold'}`);
  if (o.size) el.style.fontSize = `${o.size}px`;
  testid(el, o.testid);
  const set = (v: number | string) => setDigits(el, typeof v === 'number' ? fmtCredits(v) : v);
  set(o.value ?? 0);
  return { el, set };
}

export interface Plate extends NumDisplay {
  readonly value: HTMLElement;
  setLabel(text: string): void;
}

/** Recessed dark plate with a small caps label and a number (BALANCE / BET / WIN read-outs). */
export function plate(o: { label: string; value?: number | string; tone?: NumTone; size?: number; testid?: string; className?: string }): Plate {
  const lab = h('span', 'ui-plate__label', [o.label]);
  const n = num({ value: o.value, tone: o.tone, size: o.size ?? 24, testid: o.testid });
  const el = h('div', `ui-plate ${o.className ?? ''}`.trim(), [lab, n.el]);
  return { el, value: n.el, set: n.set, setLabel: (x) => void (lab.textContent = x) };
}

/** Thin glossy progress bar (0..1), filled with gold; the fill moves with transform only. */
export function progressBar(o: { value?: number; testid?: string; tone?: 'gold' | 'cyan' | 'magenta' } = {}): { el: HTMLElement; set(v: number): void } {
  const fill = h('span', 'ui-bar__fill');
  const el = h('div', `ui-bar ui-bar--${o.tone ?? 'gold'}`, [fill]);
  el.setAttribute('role', 'progressbar');
  testid(el, o.testid);
  const set = (v: number) => {
    const c = Math.max(0, Math.min(1, v));
    fill.style.transform = `scaleX(${c})`;
    el.setAttribute('aria-valuenow', String(Math.round(c * 100)));
  };
  set(o.value ?? 0);
  return { el, set };
}

// ---------------------------------------------------------------- buttons

export type BtnVariant = 'gold' | 'red' | 'violet' | 'dark';
export interface BtnOpts {
  label: string;
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Full width. */
  block?: boolean;
  /** Periodic light sweep across the face (transform only). */
  shine?: boolean;
  disabled?: boolean;
  aria?: string;
  testid?: string;
  onTap?: (e: MouseEvent) => void;
}

/** Bevelled glossy pill button with a bottom lip; sinks into the lip when pressed. */
export function button(o: BtnOpts): HTMLButtonElement {
  const cls = ['ui-btn', `ui-btn--${o.variant ?? 'gold'}`, `ui-btn--${o.size ?? 'md'}`, o.block ? 'ui-btn--block' : '', o.shine ? 'ui-btn--shine' : '']
    .filter(Boolean)
    .join(' ');
  const b = baseButton(cls, o);
  b.append(h('span', 'ui-btn__gloss'), h('span', 'ui-btn__face', [o.icon ? icon(o.icon, o.size === 'lg' ? 26 : 20) : null, h('span', 'ui-btn__label', [o.label])]));
  return b;
}

/** Relabel a kit button. */
export function setButtonLabel(b: HTMLElement, label: string): void {
  const l = b.querySelector('.ui-btn__label, .ui-toggle__label, .ui-spin__label');
  if (l) l.textContent = label;
}

/** 44×44 round icon button (close, back, sound...). */
export function iconButton(o: { icon: IconName; aria: string; variant?: 'dark' | 'gold' | 'violet'; testid?: string; onTap?: (e: MouseEvent) => void; disabled?: boolean }): HTMLButtonElement {
  const b = baseButton(`ui-ibtn ui-ibtn--${o.variant ?? 'dark'}`, o);
  b.append(h('span', 'ui-ibtn__face', [icon(o.icon, 22)]));
  return b;
}

export type SpinMode = 'spin' | 'stop' | 'auto';
export interface SpinButton {
  readonly el: HTMLButtonElement;
  set(o: { label?: string; sub?: string | null; mode?: SpinMode; badge?: string | number | null; disabled?: boolean }): void;
}

/**
 * The big round primary button (SPIN / DEAL / BET): chrome-gold ring with a rotating bulb ring,
 * glossy crimson core, neon halo. `mode` recolours the core (stop = gold, auto = violet).
 * `size` = diameter in px (default 112).
 */
export function spinButton(o: { label?: string; sub?: string; size?: number; testid?: string; aria?: string; onTap?: (e: MouseEvent) => void } = {}): SpinButton {
  const b = baseButton('ui-spin', o);
  if (o.size) b.style.setProperty('--d', `${o.size}px`);
  const label = h('span', 'ui-spin__label', [o.label ?? 'SPIN']);
  const sub = h('span', 'ui-spin__sub');
  const badge = h('span', 'ui-spin__badge');
  badge.hidden = true;
  const bulbs: SVGElement[] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const x = 50 + 43 * Math.cos(a), y = 50 + 43 * Math.sin(a);
    bulbs.push(s('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 3.1, fill: i % 2 ? '#FFD36A' : '#FFFBEA', class: i % 2 ? 'b2' : 'b1' }));
  }
  const lights = svgRoot('0 0 100 100', bulbs, { class: 'ui-spin__lights ui-anim' });
  b.append(
    h('span', 'ui-spin__halo ui-glow'),
    h('span', 'ui-spin__base'),
    h('span', 'ui-spin__body', [h('span', 'ui-spin__ring'), lights, h('span', 'ui-spin__core', [h('span', 'ui-spin__gloss'), label, sub])]),
    badge,
  );
  const set: SpinButton['set'] = (p) => {
    if (p.label !== undefined) label.textContent = p.label;
    if (p.sub !== undefined) {
      sub.textContent = p.sub ?? '';
      sub.hidden = !p.sub;
    }
    if (p.mode) b.dataset.mode = p.mode;
    if (p.badge !== undefined) {
      badge.hidden = p.badge === null || p.badge === '';
      badge.textContent = p.badge === null ? '' : String(p.badge);
    }
    if (p.disabled !== undefined) b.disabled = p.disabled;
  };
  set({ mode: 'spin', sub: o.sub ?? null });
  return { el: b, set };
}

export interface Toggle {
  readonly el: HTMLButtonElement;
  readonly on: boolean;
  set(on: boolean): void;
}

/** Pill toggle with an LED (TURBO / AUTO). aria-pressed carries the state. */
export function toggle(o: { label: string; on?: boolean; icon?: IconName; testid?: string; onChange?: (on: boolean) => void; disabled?: boolean }): Toggle {
  let on = !!o.on;
  const b = baseButton('ui-toggle', o);
  b.append(h('span', 'ui-toggle__led'));
  if (o.icon) b.append(icon(o.icon, 16));
  b.append(h('span', 'ui-toggle__label', [o.label]));
  const set = (v: boolean) => {
    on = v;
    b.setAttribute('aria-pressed', String(v));
  };
  set(on);
  b.addEventListener('click', () => {
    set(!on);
    o.onChange?.(on);
  });
  return { el: b, get on() { return on; }, set };
}

export type PillTone = 'hot' | 'gold' | 'cyan' | 'violet' | 'win';
/** Small badge (HOT, NEW, x2 ...). `hot` pulses with transform only. */
export function pill(text: string, tone: PillTone = 'gold'): HTMLElement {
  return h('span', `ui-pill ui-pill--${tone}`, [text]);
}

export interface Stepper {
  readonly el: HTMLElement;
  readonly index: number;
  readonly value: number;
  set(index: number): void;
  setDisabled(d: boolean): void;
}

/** [−] LABEL value [+] selector over a fixed list (bet steps). Ends disable their button. */
export function stepper(o: { label: string; values: readonly number[]; index?: number; format?: (v: number) => string; testid?: string; onChange?: (value: number, index: number) => void }): Stepper {
  let i = Math.max(0, Math.min(o.values.length - 1, o.index ?? 0));
  let off = false;
  const fmt = o.format ?? ((v: number) => fmtCredits(v));
  const val = num({ tone: 'gold', size: 24, testid: o.testid ? `${o.testid}-value` : undefined });
  const go = (d: number) => {
    const n = Math.max(0, Math.min(o.values.length - 1, i + d));
    if (n === i) return;
    set(n);
    o.onChange?.(o.values[i], i);
  };
  const minus = iconButton({ icon: 'minus', aria: '-', variant: 'violet', testid: o.testid ? `${o.testid}-minus` : undefined, onTap: () => go(-1) });
  const plus = iconButton({ icon: 'plus', aria: '+', variant: 'violet', testid: o.testid ? `${o.testid}-plus` : undefined, onTap: () => go(1) });
  const el = h('div', 'ui-stepper', [minus, h('div', 'ui-stepper__mid', [h('span', 'ui-plate__label', [o.label]), val.el]), plus]);
  testid(el, o.testid);
  function set(n: number) {
    i = Math.max(0, Math.min(o.values.length - 1, n));
    val.set(fmt(o.values[i]));
    minus.disabled = off || i === 0;
    plus.disabled = off || i === o.values.length - 1;
  }
  set(i);
  return {
    el,
    get index() { return i; },
    get value() { return o.values[i]; },
    set,
    setDisabled(d) { off = d; set(i); },
  };
}

// ---------------------------------------------------------------- chips

const CHIP_COLORS: [max: number, base: string, edge: string, text: string][] = [
  [1, '#E9E4F2', '#7A3CFF', '#3A1606'],
  [10, '#1E6BFF', '#FFFFFF', '#FFFFFF'],
  [25, '#16A05A', '#FFFFFF', '#FFFFFF'],
  [50, '#E0183C', '#FFFFFF', '#FFFFFF'],
  [100, '#1B1424', '#F5C542', '#FFE9A6'],
  [500, '#7A3CFF', '#FFE9A6', '#FFFFFF'],
  [1000, '#F5C542', '#E0183C', '#3A1606'],
  [Infinity, '#FF3DA5', '#29E6FF', '#FFFFFF'],
];

/** Colour set by denomination (10 blue, 50 red, 100 black-gold, 500 violet, 1K gold ...). */
export function chipColors(value: number): { base: string; edge: string; text: string } {
  const c = CHIP_COLORS.find(([m]) => value <= m)!;
  return { base: c[1], edge: c[2], text: c[3] };
}

/** 1000 -> "1K", 2500 -> "2.5K", 1000000 -> "1M". */
export function chipLabel(value: number): string {
  const k = (v: number, u: string) => `${+(v.toFixed(1))}${u}`;
  if (value >= 1e6) return k(value / 1e6, 'M');
  if (value >= 1e3) return k(value / 1e3, 'K');
  return String(value);
}

/** Casino chip art (SVG, 100 user units). */
export function chipArt(value: number, label = chipLabel(value)): SVGSVGElement {
  const c = chipColors(value);
  const id = uid('chip');
  const r = 41;
  const circ = 2 * Math.PI * r;
  const fs = (label.length <= 2 ? 30 : label.length === 3 ? 26 : 21) - (/[A-Z]/.test(label) ? 5 : 0);
  const txt = s('text', {
    x: 50, y: 51, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'ui-chip__text',
    fill: c.text, stroke: '#0B0612', 'stroke-width': 5, 'paint-order': 'stroke', 'stroke-linejoin': 'round', 'font-size': fs,
  });
  txt.textContent = label;
  return svgRoot('0 0 100 100', [
    s('defs', {}, [
      radialGrad(`${id}s`, [[0, '#FFFFFF', 0.35], [0.45, '#FFFFFF', 0], [0.85, '#000000', 0.1], [1, '#000000', 0.45]], { cx: 0.38, cy: 0.3, r: 0.75 }),
    ]),
    s('circle', { cx: 50, cy: 50, r: 48, fill: c.base, stroke: '#0B0612', 'stroke-width': 2.5 }),
    s('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: c.edge, 'stroke-width': 11, 'stroke-dasharray': `${(circ / 16).toFixed(2)} ${(circ / 16).toFixed(2)}`, transform: 'rotate(-11.25 50 50)' }),
    s('circle', { cx: 50, cy: 50, r: 33, fill: c.base, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 2 }),
    s('circle', { cx: 50, cy: 50, r: 29, fill: 'none', stroke: c.edge, 'stroke-width': 1.6, 'stroke-dasharray': '2.4 3', 'stroke-opacity': 0.9 }),
    s('circle', { cx: 50, cy: 50, r: 48, fill: `url(#${id}s)` }),
    txt,
    s('ellipse', { cx: 50, cy: 27, rx: 26, ry: 11, fill: '#FFFFFF', 'fill-opacity': 0.16 }),
  ], { class: 'ui-chip__art' });
}

export interface Chip {
  readonly el: HTMLElement;
  readonly value: number;
  select(on: boolean): void;
}

/** A chip; with `onTap` it is a button (selectable chip rack), otherwise a plain decoration. `size` px, min 44 for buttons. */
export function chip(o: { value: number; size?: number; selected?: boolean; testid?: string; onTap?: (e: MouseEvent) => void; aria?: string }): Chip {
  const el: HTMLElement = o.onTap ? baseButton('ui-chip', { ...o, aria: o.aria ?? String(o.value) }) : h('span', 'ui-chip');
  el.append(chipArt(o.value));
  const size = o.onTap ? Math.max(44, o.size ?? 56) : (o.size ?? 56);
  el.style.setProperty('--s', `${size}px`);
  el.dataset.value = String(o.value);
  if (!o.onTap) testid(el, o.testid);
  const select = (on: boolean) => {
    el.classList.toggle('is-selected', on);
    if (o.onTap) el.setAttribute('aria-pressed', String(on));
  };
  select(!!o.selected);
  return { el, value: o.value, select };
}

// ---------------------------------------------------------------- panels

/** Crimson ribbon banner with folded tails (section titles, panel headers). */
export function ribbon(text: string, o: { tone?: 'red' | 'violet' | 'gold'; className?: string } = {}): HTMLElement {
  return h('div', `ui-ribbon ui-ribbon--${o.tone ?? 'red'} ${o.className ?? ''}`.trim(), [h('span', 'ui-ribbon__body', [text])]);
}

/** Ornate gold-bordered panel with corner gems and an optional ribbon title. */
export function frameBox(o: { title?: string; tone?: 'red' | 'violet' | 'gold'; children?: Kid[]; className?: string; testid?: string } = {}): HTMLElement {
  const el = h('div', `ui-box ${o.className ?? ''}`.trim(), [
    h('span', 'ui-box__gem ui-box__gem--tl'),
    h('span', 'ui-box__gem ui-box__gem--tr'),
    h('span', 'ui-box__gem ui-box__gem--bl'),
    h('span', 'ui-box__gem ui-box__gem--br'),
    o.title ? ribbon(o.title, { tone: o.tone, className: 'ui-box__title' }) : null,
    ...(o.children ?? []),
  ]);
  if (o.title) el.classList.add('ui-box--titled');
  testid(el, o.testid);
  return el;
}

export interface Overlay {
  /** The layer root (scrim + panel). Present in the DOM only while open. */
  readonly el: HTMLElement;
  readonly panel: HTMLElement;
  /** Put content here. */
  readonly body: HTMLElement;
  readonly isOpen: boolean;
  /** Attach to `host` (default `#frame`, else body) and animate in. */
  open(host?: HTMLElement): void;
  /** Animate out, then detach. Calls `onClose`. */
  close(): void;
}

interface OverlayOpts {
  title?: string;
  body?: Kid[];
  /** Buttons laid out in a row at the bottom. */
  actions?: HTMLElement[];
  /** Tap on scrim / Escape / close button closes (default true). */
  dismissible?: boolean;
  testid?: string;
  onClose?: () => void;
}

function overlay(kind: 'sheet' | 'modal', panel: HTMLElement, body: HTMLElement, o: OverlayOpts): Overlay {
  const scrim = h('div', 'ui-scrim');
  const el = h('div', `ui-layer ui-layer--${kind}`, [scrim, panel]);
  testid(el, o.testid);
  let isOpen = false;
  let timer = 0;
  const dismissible = o.dismissible !== false;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) api.close();
  };
  if (dismissible) scrim.addEventListener('click', () => api.close());
  const api: Overlay = {
    el, panel, body,
    get isOpen() { return isOpen; },
    open(host) {
      if (isOpen) return;
      isOpen = true;
      clearTimeout(timer);
      (host ?? document.getElementById('frame') ?? document.body).append(el);
      void el.offsetHeight; // commit the closed state so the transition runs
      el.classList.add('is-open');
      document.addEventListener('keydown', onKey);
    },
    close() {
      if (!isOpen) return;
      isOpen = false;
      el.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
      timer = window.setTimeout(() => el.remove(), 320);
      o.onClose?.();
    },
  };
  return api;
}

function actionsRow(actions?: HTMLElement[]): HTMLElement | null {
  return actions?.length ? h('div', 'ui-actions', actions) : null;
}

/** Bottom sheet sliding up from the thumb zone. */
export function sheet(o: OverlayOpts = {}): Overlay {
  const body = h('div', 'ui-sheet__body', o.body ?? []);
  const closeBtn = o.dismissible !== false ? iconButton({ icon: 'close', aria: t('app.btn.close'), testid: o.testid ? `${o.testid}-close` : undefined }) : null;
  const panel = h('div', 'ui-sheet', [
    h('span', 'ui-sheet__grab'),
    o.title || closeBtn ? h('div', 'ui-sheet__head', [o.title ? goldText(o.title, { size: 24, glow: 'magenta', tag: 'h2' }) : h('span'), closeBtn]) : null,
    body,
    actionsRow(o.actions),
  ]);
  panel.setAttribute('role', 'dialog');
  const ov = overlay('sheet', panel, body, o);
  closeBtn?.addEventListener('click', () => ov.close());
  return ov;
}

/** Centred modal on an ornate frameBox. */
export function modal(o: OverlayOpts & { tone?: 'red' | 'violet' | 'gold' } = {}): Overlay {
  const body = h('div', 'ui-modal__body', o.body ?? []);
  const box = frameBox({ title: o.title, tone: o.tone, children: [body, actionsRow(o.actions)], className: 'ui-modal' });
  box.setAttribute('role', 'dialog');
  return overlay('modal', box, body, o);
}

// ---------------------------------------------------------------- frame helpers

/** Landscape phone (height < 480px): the rotate overlay is shown by CSS; JS can pause with onRotateBlock. */
export const ROTATE_QUERY = '(orientation: landscape) and (max-height: 479.98px)';

/** Calls `cb(true)` when the rotate overlay is showing, `cb(false)` when it goes away (and once now). Returns unsubscribe. */
export function onRotateBlock(cb: (blocked: boolean) => void): () => void {
  const mq = window.matchMedia(ROTATE_QUERY);
  const f = () => cb(mq.matches);
  mq.addEventListener('change', f);
  f();
  return () => mq.removeEventListener('change', f);
}

/** Casino-style "turn your phone upright" overlay. Append once inside #frame or body; CSS decides visibility. */
export function rotateOverlay(): HTMLElement {
  const id = uid('ph');
  const phone = svgRoot('0 0 120 120', [
    s('defs', {}, [radialGrad(id, [[0, '#2A1745'], [1, '#0B0612']])]),
    s('path', { d: circlePath(60, 60, 54), fill: 'none', stroke: '#FF3DA5', 'stroke-width': 2, 'stroke-dasharray': '4 7', 'stroke-linecap': 'round' }),
    s('g', { class: 'ui-rotate__phone' }, [
      s('rect', { x: 38, y: 18, width: 44, height: 84, rx: 9, fill: `url(#${id})`, stroke: '#F5C542', 'stroke-width': 4 }),
      s('rect', { x: 52, y: 24, width: 16, height: 3, rx: 1.5, fill: '#F5C542' }),
      s('path', { d: starPath(60, 60, 12, 5), fill: '#FF2D55' }),
    ]),
  ], { class: 'ui-rotate__art', width: 120, height: 120 });
  const el = h('div', 'ui-rotate', [
    phone,
    goldText(t('app.rotate.title'), { size: 22, glow: 'magenta', tag: 'div', className: 'ui-rotate__title' }),
    h('p', 'ui-rotate__body', [t('app.rotate.body')]),
  ]);
  el.dataset.testid = 'rotate';
  el.setAttribute('role', 'alert');
  return el;
}
