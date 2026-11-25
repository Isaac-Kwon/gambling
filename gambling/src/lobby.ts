/**
 * Lobby (BASE_PROMPT §5.1, ARCHITECTURE §2.1, §3): neon logo, recent-wins ticker, the "casino" section
 * (ORO SEVENS, RUBY ROULETTE, BLACKJACK 21, SKYROCKET) and the "arcade" section (ABYSS LEGEND in a
 * code-drawn arcade cabinet), random HOT badges, and a bottom dock in the thumb zone. No clock.
 *
 * Ticker lines and HOT badges come from the presentation stream `pre:lobby` (`streams.pre("lobby").at(n)`,
 * n = running display-item number kept in the GameStore) and every displayed item is logged:
 * `aux("ticker", {name, game, amt})`, `aux("hot", {games})`. With fx off neither is drawn nor logged
 * (ARCHITECTURE §6.5) and the looping card art stands still.
 */
import './lobby.css';
import type { GameId } from '../../shared/config';
import { t } from '../../shared/i18n.gambling';
import type { Rng } from '../../shared/rng';
import type { Fx } from '../fx/types';
import type { SessionRuntime } from './session';
import type { Clock } from './types';
import { chipArt, fmtCredits, goldText, h, icon, iconButton, logo, pill, pressable, ribbon, starPath, svgRoot, s } from './ui';

export interface LobbyOptions {
  rt: SessionRuntime;
  fx: Fx;
  clock: Clock;
  fxOn: boolean;
  /** Navigate to a game (the router handles deferral / logging). */
  go(id: GameId): void;
}

// ================================================================== presentation-stream content (pure)

export const LOBBY_N_KEY = 'lobby.n';
export const TICKER_MS = 3800;

const NICK_HEAD = ['lucky', 'gold', 'king', 'queen', 'ace', 'vip', 'jack', 'neon', 'star', 'rich', 'high', 'super', 'ruby', 'royal', 'mega', 'jjang',
  '골드', '럭키', '대박', '행운', '부자', '황금', '별빛', '다이아', '슬롯왕', '잭팟', '하이롤러', '세븐', '여왕', '블랙'];
const NICK_TAIL = ['boy', 'girl', 'man', 'king', 'pro', 'master', 'win', 'shot', '777', '99', '1004', '짱', '킹', '맨', '러버', '보스', '7', '88'];

interface GameDraw { bets: readonly number[]; mults: readonly number[]; w: readonly number[]; jitter?: boolean }
const DRAW: Record<GameId, GameDraw> = {
  slot: { bets: [100, 200, 400, 1000], mults: [15, 20, 30, 50, 100, 250, 500], w: [22, 18, 12, 9, 6, 2, 1] },
  roulette: { bets: [100, 500, 1000], mults: [36, 18, 12], w: [8, 3, 2] },
  blackjack: { bets: [1000, 2000, 5000], mults: [2.5, 2, 4], w: [4, 6, 2] },
  crash: { bets: [200, 500, 1000, 2000], mults: [5, 8, 12, 25, 50, 100], w: [14, 10, 7, 4, 2, 1], jitter: true },
  ocean: { bets: [40, 100, 200], mults: [50, 100, 250, 500, 1250], w: [10, 8, 4, 2, 1] },
};
const GAME_W: readonly [GameId, number][] = [['slot', 6], ['roulette', 2], ['blackjack', 2], ['crash', 3], ['ocean', 4]];

export interface TickerItem { name: string; game: GameId; amt: number }

/** Masked nickname: the first ~60% of the characters, then "**". */
export function maskNick(nick: string): string {
  const chars = [...nick];
  const keep = Math.max(2, Math.ceil(chars.length * 0.6));
  return chars.slice(0, Math.min(keep, chars.length - 1)).join('') + '**';
}

/** One ticker line, fully determined by `rng` (a presentation-stream generator). */
export function tickerItem(rng: Rng): TickerItem {
  const head = NICK_HEAD[rng.int(NICK_HEAD.length)];
  const tail = rng.int(3) === 0 ? String(rng.int(90) + 10) : NICK_TAIL[rng.int(NICK_TAIL.length)];
  const game = GAME_W[rng.weighted(GAME_W.map((g) => g[1]))][0];
  const d = DRAW[game];
  const bet = d.bets[rng.int(d.bets.length)];
  let mult = d.mults[rng.weighted(d.w)];
  if (d.jitter) mult = Math.round(mult * (100 + rng.int(40))) / 100;
  return { name: maskNick(head + tail), game, amt: Math.floor(bet * mult) };
}

/** 1–2 distinct games for the HOT badge. */
export function hotGames(rng: Rng): GameId[] {
  const ids: GameId[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];
  rng.shuffle(ids);
  return ids.slice(0, 1 + rng.int(2));
}

// ================================================================== card art (code-drawn; loops are transform/opacity only)

type Sym = 'seven' | 'bar' | 'cherry' | 'bell' | 'gem';
const STRIP: Sym[] = ['seven', 'cherry', 'bar', 'gem', 'bell', 'seven'];

function sym(k: Sym): HTMLElement {
  const el = h('span', `sy sy--${k}`);
  if (k === 'seven') el.textContent = '7';
  else if (k === 'bar') el.append(h('span', 'sy__bar', ['BAR']));
  else if (k === 'cherry') el.append(svgRoot('0 0 40 40', [
    s('path', { d: 'M20 6 C 22 14, 14 18, 12 24 M20 6 C 22 14, 27 18, 28 24', fill: 'none', stroke: '#2FBF4A', 'stroke-width': 3, 'stroke-linecap': 'round' }),
    s('path', { d: 'M20 6 C 26 3, 31 5, 33 8 C 28 10, 24 9, 20 6 Z', fill: '#3DDB5A' }),
    s('circle', { cx: 12, cy: 28, r: 8, fill: '#E0183C', stroke: '#5A0010', 'stroke-width': 2 }),
    s('circle', { cx: 28, cy: 28, r: 8, fill: '#FF2D55', stroke: '#5A0010', 'stroke-width': 2 }),
    s('circle', { cx: 9.5, cy: 25, r: 2.2, fill: '#FFD0DA' }),
    s('circle', { cx: 25.5, cy: 25, r: 2.2, fill: '#FFD0DA' }),
  ]));
  else if (k === 'bell') el.append(svgRoot('0 0 40 40', [
    s('path', { d: 'M20 5 C 12 5, 10 13, 10 20 C 10 26, 7 28, 5 31 L 35 31 C 33 28, 30 26, 30 20 C 30 13, 28 5, 20 5 Z', fill: '#F5C542', stroke: '#6A3A06', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M14 12 C 15 9, 17 8, 19 8', fill: 'none', stroke: '#FFF6D0', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
    s('circle', { cx: 20, cy: 34, r: 3.4, fill: '#B8791A', stroke: '#6A3A06', 'stroke-width': 1.6 }),
  ]));
  else el.append(svgRoot('0 0 40 40', [
    s('path', { d: 'M8 15 L14 7 L26 7 L32 15 L20 34 Z', fill: '#29E6FF', stroke: '#04323C', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M8 15 L32 15 M14 7 L18 15 L20 34 M26 7 L22 15 L20 34', fill: 'none', stroke: '#04323C', 'stroke-width': 1.2, opacity: 0.6 }),
    s('path', { d: 'M15 9 L18 9 L16 13 Z', fill: '#E8FDFF' }),
  ]));
  return el;
}

function slotArt(): HTMLElement {
  const reels = [0, 1, 2].map((i) => {
    const strip = h('span', 'art-slot__strip', STRIP.map(sym));
    strip.style.animationDelay = `${i * 0.18}s`;
    return h('span', 'art-slot__reel', [strip]);
  });
  return h('div', 'art art-slot', [
    h('span', 'art__rays'),
    h('span', 'art-slot__marquee', [h('span', 'art-slot__jp', ['JACKPOT'])]),
    h('span', 'art-slot__cab', [...reels, h('span', 'art-slot__line')]),
    sparkles(3),
  ]);
}

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function rouletteArt(): HTMLElement {
  const pockets: SVGElement[] = [];
  const n = WHEEL.length;
  const R1 = 41, R0 = 29;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const p = (r: number, a: number) => `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`;
    const v = WHEEL[i];
    const fill = v === 0 ? '#11A84A' : REDS.has(v) ? '#D3123A' : '#16101E';
    pockets.push(s('path', { d: `M${p(R0, a0)} L${p(R1, a0)} A${R1} ${R1} 0 0 1 ${p(R1, a1)} L${p(R0, a1)} A${R0} ${R0} 0 0 0 ${p(R0, a0)} Z`, fill, stroke: '#E8C25A', 'stroke-width': 0.5 }));
  }
  const wheel = svgRoot('0 0 100 100', [
    s('defs', {}, [
      s('radialGradient', { id: 'lb-rw-cone', cx: 0.45, cy: 0.4, r: 0.7 }, [s('stop', { offset: 0, 'stop-color': '#FFE9A6' }), s('stop', { offset: 0.45, 'stop-color': '#B8791A' }), s('stop', { offset: 1, 'stop-color': '#4A2A08' })]),
      s('linearGradient', { id: 'lb-rw-rim', x1: 0, y1: 0, x2: 0, y2: 1 }, [s('stop', { offset: 0, 'stop-color': '#FFF2C4' }), s('stop', { offset: 0.5, 'stop-color': '#D9A133' }), s('stop', { offset: 1, 'stop-color': '#7A4A0C' })]),
    ]),
    s('circle', { cx: 50, cy: 50, r: 49, fill: 'url(#lb-rw-rim)' }),
    s('circle', { cx: 50, cy: 50, r: 45.5, fill: '#3A1A0A', stroke: '#1A0805', 'stroke-width': 1 }),
    s('g', { class: 'art-rl__spin' }, [
      ...pockets,
      s('circle', { cx: 50, cy: 50, r: R0, fill: 'url(#lb-rw-cone)', stroke: '#E8C25A', 'stroke-width': 0.8 }),
      s('path', { d: 'M50 30 L50 70 M30 50 L70 50', stroke: '#FFE9A6', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      ...[[50, 30], [50, 70], [30, 50], [70, 50]].map(([x, y]) => s('circle', { cx: x, cy: y, r: 3, fill: '#FFF6D0', stroke: '#7A4A0C', 'stroke-width': 0.8 })),
      s('circle', { cx: 50, cy: 50, r: 6, fill: '#FFE9A6', stroke: '#7A4A0C', 'stroke-width': 1 }),
    ]),
    s('g', { class: 'art-rl__ball' }, [s('circle', { cx: 50, cy: 7.5, r: 2.8, fill: '#FFFFFF', stroke: '#9AA0B0', 'stroke-width': 0.6 })]),
  ], { class: 'art-rl__wheel' });
  return h('div', 'art art-rl', [h('span', 'art__rays'), h('span', 'art-rl__halo'), wheel, sparkles(2)]);
}

function playingCard(rank: string, suit: string, red: boolean, cls: string): HTMLElement {
  return h('span', `pc ${red ? 'pc--red' : ''} ${cls}`, [
    h('span', 'pc__c pc__c--tl', [h('b', '', [rank]), h('i', '', [suit])]),
    h('span', 'pc__mid', [rank === 'A' ? suit : rank]),
    h('span', 'pc__c pc__c--br', [h('b', '', [rank]), h('i', '', [suit])]),
  ]);
}

function blackjackArt(): HTMLElement {
  const chips = h('span', 'art-bj__chips', [chipArt(500), chipArt(100), chipArt(20)]);
  return h('div', 'art art-bj', [
    h('span', 'art-bj__arc'),
    h('span', 'art-bj__fan', [playingCard('A', '♠', false, 'art-bj__c1'), playingCard('K', '♥', true, 'art-bj__c2')]),
    chips,
    h('span', 'art-bj__21', ['21']),
    sparkles(2),
  ]);
}

function crashArt(): HTMLElement {
  const curve = 'M4 66 C 30 64, 52 56, 66 40 C 74 31, 80 22, 86 12';
  const sky = svgRoot('0 0 100 70', [
    s('defs', {}, [
      s('linearGradient', { id: 'lb-cr-area', x1: 0, y1: 0, x2: 0, y2: 1 }, [s('stop', { offset: 0, 'stop-color': '#FF3DA5', 'stop-opacity': 0.55 }), s('stop', { offset: 1, 'stop-color': '#FF3DA5', 'stop-opacity': 0 })]),
    ]),
    ...[14, 28, 42, 56].map((y) => s('path', { d: `M0 ${y} H100`, stroke: 'rgba(41,230,255,.12)', 'stroke-width': 0.5 })),
    ...[20, 40, 60, 80].map((x) => s('path', { d: `M${x} 0 V70`, stroke: 'rgba(41,230,255,.12)', 'stroke-width': 0.5 })),
    s('path', { d: `${curve} L86 70 L4 70 Z`, fill: 'url(#lb-cr-area)' }),
    s('path', { d: curve, fill: 'none', stroke: 'rgba(255,61,165,.35)', 'stroke-width': 5, 'stroke-linecap': 'round' }),
    s('path', { d: curve, fill: 'none', stroke: '#FFB3DC', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
  ], { class: 'art-cr__sky', preserveAspectRatio: 'none' });
  const rocket = svgRoot('0 0 40 40', [
    s('g', { class: 'art-cr__flame' }, [
      s('path', { d: 'M15 27 C 9 33, 6 36, 3 38 C 7 33, 9 29, 12 24 Z', fill: '#FFB52E' }),
      s('path', { d: 'M14 26 C 10 31, 8 33, 6 35 C 9 31, 10 28, 12 25 Z', fill: '#FFF6D0' }),
    ]),
    s('path', { d: 'M13 27 C 15 18, 22 10, 34 6 C 31 18, 23 25, 13 27 Z', fill: '#F4F1FF', stroke: '#2A1745', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M34 6 C 32 11, 30 13, 28 14 C 27 11, 29 8, 34 6 Z', fill: '#FF2D55' }),
    s('circle', { cx: 24, cy: 16, r: 3, fill: '#29E6FF', stroke: '#2A1745', 'stroke-width': 1.3 }),
    s('path', { d: 'M15 21 L9 21 L13 15 Z M19 25 L19 31 L25 27 Z', fill: '#FF2D55', stroke: '#2A1745', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
  ], { class: 'art-cr__rocket' });
  return h('div', 'art art-cr', [
    h('span', 'art-cr__stars'),
    sky,
    h('span', 'art-cr__rocket-wrap', [rocket]),
    h('span', 'art-cr__mult', ['8.88×']),
  ]);
}

function sparkles(n: number): HTMLElement {
  const box = h('span', 'art__sparks');
  for (let i = 0; i < n; i++) {
    const sp = svgRoot('0 0 20 20', [s('path', { d: 'M10 0 L12 8 L20 10 L12 12 L10 20 L8 12 L0 10 L8 8 Z', fill: '#FFF6D0' })], { class: `art__spark art__spark--${i}` });
    box.append(sp);
  }
  return box;
}

// ---- ABYSS LEGEND cabinet

function oceanReelSym(k: number): SVGSVGElement {
  if (k === 0) return svgRoot('0 0 40 40', [ // golden pearl in an open clam
    s('path', { d: 'M4 22 C 4 8, 36 8, 36 22 Z', fill: '#FF8A7E', stroke: '#5A1410', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('path', { d: 'M11 21 L14 12 M20 21 L20 10 M29 21 L26 12', stroke: '#5A1410', 'stroke-width': 1.3 }),
    s('path', { d: 'M4 24 C 6 35, 34 35, 36 24 Z', fill: '#FF6B5E', stroke: '#5A1410', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('circle', { cx: 20, cy: 24, r: 7, fill: '#FFC83D', stroke: '#6A3A06', 'stroke-width': 1.6 }),
    s('circle', { cx: 17.5, cy: 21.5, r: 2.2, fill: '#FFF6D0' }),
  ]);
  if (k === 1) return svgRoot('0 0 40 40', [ // treasure chest
    s('rect', { x: 6, y: 17, width: 28, height: 16, rx: 2, fill: '#8A4A1A', stroke: '#2A1005', 'stroke-width': 2 }),
    s('path', { d: 'M6 17 C 6 8, 34 8, 34 17 Z', fill: '#A85E24', stroke: '#2A1005', 'stroke-width': 2 }),
    s('path', { d: 'M6 17 H34 M20 9 V33', stroke: '#FFC83D', 'stroke-width': 2.4 }),
    s('rect', { x: 17, y: 16, width: 6, height: 7, rx: 1, fill: '#FFC83D', stroke: '#2A1005', 'stroke-width': 1.2 }),
  ]);
  return svgRoot('0 0 40 40', [ // starfish
    s('path', { d: starPath(20, 21, 15, 6.5), fill: '#FFC83D', stroke: '#6A3A06', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    s('circle', { cx: 20, cy: 21, r: 2, fill: '#FF6B5E' }),
  ]);
}

function cabinet(): { el: HTMLButtonElement; hot: HTMLElement } {
  const bulbs = h('span', 'cab__bulbs');
  for (let i = 0; i < 18; i++) bulbs.append(h('span', `cab__bulb ${i % 2 ? 'cab__bulb--b' : ''}`));

  const whale = svgRoot('0 0 120 50', [
    s('path', { d: 'M4 28 C 12 12, 42 7, 66 12 C 82 16, 94 22, 103 18 L 117 7 L 112 24 L 119 38 L 103 30 C 94 37, 80 43, 58 43 C 33 43, 10 40, 4 28 Z', fill: '#021B2E', stroke: 'rgba(120,255,240,.45)', 'stroke-width': 1.2 }),
    s('path', { d: 'M40 36 C 44 44, 52 46, 56 44', fill: 'none', stroke: '#021B2E', 'stroke-width': 5, 'stroke-linecap': 'round' }),
    s('path', { d: 'M8 31 C 20 36, 40 38, 60 37', fill: 'none', stroke: 'rgba(120,255,240,.25)', 'stroke-width': 1 }),
    s('circle', { cx: 18, cy: 26, r: 1.6, fill: '#19D3C5' }),
  ], { class: 'cab__whale' });

  const bubbles = h('span', 'cab__bubbles');
  for (let i = 0; i < 8; i++) {
    const b = h('span', 'cab__bubble');
    b.style.setProperty('--x', `${8 + ((i * 29) % 84)}%`);
    b.style.setProperty('--d', `${-((i * 0.9) % 5)}s`);
    b.style.setProperty('--z', `${0.5 + ((i * 7) % 6) / 6}`);
    bubbles.append(b);
  }
  const fish = h('span', 'cab__fish', [0, 1, 2, 3, 4].map((i) => h('span', `cab__f cab__f--${i}`)));

  const reels = h('span', 'cab__reels', [1, 0, 2].map((k) => h('span', 'cab__reel', [oceanReelSym(k)])));

  const screen = h('span', 'cab__screen', [
    h('span', 'cab__shafts', [h('span', 'cab__shaft'), h('span', 'cab__shaft cab__shaft--2'), h('span', 'cab__shaft cab__shaft--3')]),
    h('span', 'cab__whale-wrap', [whale]),
    fish,
    bubbles,
    reels,
    h('span', 'cab__credit', [h('span', 'cab__credit-k', ['CREDIT']), h('span', 'cab__credit-v', ['5,000'])]),
    h('span', 'cab__scan'),
  ]);

  const panelBtn = (label: string, tone: string) => h('span', `cab__pb cab__pb--${tone}`, [h('span', 'cab__pb-cap'), h('span', 'cab__pb-label', [label])]);
  const panel = h('span', 'cab__panel', [
    h('span', 'cab__coin', [h('span', 'cab__coin-slot'), h('span', 'cab__coin-label', [t('lobby.cab.coin')])]),
    h('span', 'cab__pbs', [panelBtn(t('lobby.cab.bet'), 'y'), panelBtn(t('lobby.cab.start'), 'r'), panelBtn(t('lobby.cab.stop'), 'b')]),
    h('span', 'cab__tk', [h('span', 'cab__tk-slot'), h('span', 'cab__tk-paper'), h('span', 'cab__tk-label', [t('lobby.cab.ticket')])]),
  ]);

  const hot = h('span', 'lb-card__hot');
  const el = h('button', 'cab', [
    h('span', 'cab__top', [
      bulbs,
      h('span', 'cab__sign', [
        h('span', 'cab__sign-glow'),
        h('span', 'cab__ko', [t('lobby.game.ocean.ko')]),
        h('span', 'cab__en', [t('lobby.game.ocean')]),
      ]),
    ]),
    h('span', 'cab__bezel', [screen]),
    panel,
    hot,
  ]);
  el.type = 'button';
  el.dataset.testid = 'card-ocean';
  el.dataset.game = 'ocean';
  el.setAttribute('aria-label', `${t('lobby.game.ocean.ko')} ${t('lobby.game.ocean')}`);
  return { el, hot };
}

// ================================================================== mount

interface Card { id: GameId; el: HTMLButtonElement; hot: HTMLElement }

function gameCard(id: Exclude<GameId, 'ocean'>, art: HTMLElement): Card {
  const hot = h('span', 'lb-card__hot');
  const el = h('button', `lb-card lb-card--${id}`, [
    art,
    h('span', 'lb-card__shine'),
    h('span', 'lb-card__foot', [
      goldText(t(`lobby.game.${id}`), { glow: 'none', className: 'lb-card__name' }),
      h('span', 'lb-card__tag', [t(`lobby.game.${id}.tag`)]),
    ]),
    hot,
  ]);
  el.type = 'button';
  el.dataset.testid = `card-${id}`;
  el.dataset.game = id;
  el.setAttribute('aria-label', t(`lobby.game.${id}`));
  return { id, el, hot };
}

let ambientStarted = false;

export function mountLobby(root: HTMLElement, o: LobbyOptions): () => void {
  const { rt, fx, clock } = o;
  const cleanups: (() => void)[] = [];
  let alive = true;

  if (o.fxOn && !ambientStarted) {
    ambientStarted = true;
    try { fx.sfx.loop('ambient', true); } catch { /* ignore */ }
  }

  const nextRng = (): Rng => {
    const n = (rt.store.get<number>(LOBBY_N_KEY) ?? 0) + 1;
    rt.store.set(LOBBY_N_KEY, n);
    return rt.streams.pre('lobby').at(n);
  };

  // ---- header
  const head = h('div', 'lb__head', [h('span', 'lb__head-rays'), h('span', 'lb__head-glow'), logo({ size: 'md' })]);

  // ---- ticker (fx on only)
  let ticker: HTMLElement | null = null;
  let tickerView: HTMLElement | null = null;
  if (o.fxOn) {
    tickerView = h('span', 'lb-ticker__view');
    ticker = h('div', 'lb-ticker', [
      h('span', 'lb-ticker__label', [icon('crown', 14), t('lobby.ticker.label')]),
      tickerView,
    ]);
    ticker.setAttribute('aria-live', 'off');
  }

  // ---- cards
  const cards: Card[] = [
    gameCard('slot', slotArt()),
    gameCard('roulette', rouletteArt()),
    gameCard('blackjack', blackjackArt()),
    gameCard('crash', crashArt()),
  ];
  const cab = cabinet();
  const all: Card[] = [...cards, { id: 'ocean', el: cab.el, hot: cab.hot }];
  for (const c of all) {
    cleanups.push(pressable(c.el));
    c.el.addEventListener('click', () => {
      try { fx.sfx.play('tap'); } catch { /* ignore */ }
      o.go(c.id);
    });
  }

  const casino = h('section', 'lb__sec', [h('div', 'lb__sec-head', [ribbon(t('lobby.section.casino'), { tone: 'red' })]), h('div', 'lb__grid', cards.map((c) => c.el))]);
  casino.id = 'lb-casino';
  const arcade = h('section', 'lb__sec lb__sec--arcade', [h('div', 'lb__sec-head', [ribbon(t('lobby.section.arcade'), { tone: 'violet' })]), cab.el]);
  arcade.id = 'lb-arcade';

  const scroll = h('div', 'lb__scroll', [head, ticker, casino, arcade]);

  // ---- dock (thumb zone)
  const tab = (key: string, ic: 'grid' | 'crown', target: HTMLElement) => {
    const b = h('button', 'lb-dock__tab', [icon(ic, 20), h('span', '', [t(key)])]);
    b.type = 'button';
    cleanups.push(pressable(b));
    b.addEventListener('click', () => {
      try { fx.sfx.play('tap'); } catch { /* ignore */ }
      scroll.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: o.fxOn ? 'smooth' : 'auto' });
    });
    return b;
  };
  const tCasino = tab('lobby.dock.casino', 'grid', casino);
  const tArcade = tab('lobby.dock.arcade', 'crown', arcade);
  const sound = iconButton({ icon: rt.settings.muted ? 'mute' : 'sound', aria: t('lobby.dock.sound'), testid: 'btn-sound', variant: 'dark' });
  sound.addEventListener('click', () => {
    rt.settings.muted = !rt.settings.muted;
    sound.querySelector('.ui-ibtn__face')!.replaceChildren(icon(rt.settings.muted ? 'mute' : 'sound', 22));
    sound.setAttribute('aria-pressed', String(rt.settings.muted));
  });
  const installSlot = h('div', 'lb-dock__slot');
  installSlot.dataset.slot = 'install'; // Phase 6 (install button) mounts here
  installSlot.hidden = true;
  const dock = h('nav', 'lb-dock', [tCasino, tArcade, installSlot, sound]);

  const lobby = h('div', 'lb', [scroll, dock]);
  lobby.dataset.testid = 'lobby';
  root.append(lobby);

  const syncTabs = (): void => {
    const inArcade = scroll.scrollTop + scroll.clientHeight * 0.45 >= arcade.offsetTop;
    tCasino.classList.toggle('is-on', !inArcade);
    tArcade.classList.toggle('is-on', inArcade);
  };
  scroll.addEventListener('scroll', syncTabs, { passive: true });
  syncTabs();

  // ---- HOT badges + ticker (presentation stream, logged)
  if (o.fxOn) {
    const games = hotGames(nextRng());
    rt.logger.aux('hot', { games });
    for (const c of all) if (games.includes(c.id)) c.hot.append(pill(t('lobby.hot'), 'hot'));

    const show = (): void => {
      if (!tickerView) return;
      const it = tickerItem(nextRng());
      rt.logger.aux('ticker', { name: it.name, game: it.game, amt: it.amt });
      const inner = h('span', 'lb-ticker__inner');
      const line = h('span', 'lb-ticker__line', [inner]);
      const tpl = t('lobby.ticker.line', { name: '\u0001', game: '\u0002', amt: '\u0003' });
      for (const part of tpl.split(/([\u0001\u0002\u0003])/)) {
        if (part === '\u0001') inner.append(h('b', 'lb-ticker__name', [it.name]));
        else if (part === '\u0002') inner.append(h('span', 'lb-ticker__game', [t(`lobby.game.${it.game}`)]));
        else if (part === '\u0003') inner.append(h('span', 'lb-ticker__amt', [fmtCredits(it.amt)]));
        else if (part) inner.append(part);
      }
      const prev = tickerView.lastElementChild as HTMLElement | null;
      if (prev) {
        prev.classList.add('is-out');
        window.setTimeout(() => prev.remove(), 500);
      }
      tickerView.append(line);
      // Too long for the strip (narrow phones): slide the line once so the amount comes into view.
      const over = inner.scrollWidth - line.clientWidth;
      if (over > 2) {
        inner.style.setProperty('--dx', `${-Math.ceil(over + 4)}px`);
        inner.classList.add('is-long');
      }
    };
    show();
    void (async () => {
      while (alive) {
        await clock.wait(TICKER_MS);
        if (!alive) return;
        show();
      }
    })();
  }

  return () => {
    alive = false;
    for (const c of cleanups.splice(0)) { try { c(); } catch { /* ignore */ } }
    lobby.remove();
  };
}
