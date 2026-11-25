/**
 * Cash-out ticket (BASE_PROMPT 5.4, ARCHITECTURE 6.3): the settlement screen shown after CASH OUT or a bust,
 * in the game's own casino style (a thermal-paper ticket printed out of a slot). It shows four facts only:
 * final credits, play time, biggest single win and the games played, plus a "BONUS PAYOUT" line when the ocean
 * queue was paid out at the end. One button hands the player on to the detail page, carrying the summary
 * in the URL hash (the full log travels through localStorage). There is no "play again".
 *
 * The data side (`buildReceipt`, `detailUrl`, `goToDetail`) is pure/injectable so node tests cover it.
 */
import './cashout.css';
import { t } from '../../shared/i18n.gambling';
import { createRng, type Rng } from '../../shared/rng';
import { summarize, summaryHash } from '../../shared/handoff';
import type { GameId } from '../../shared/config';
import type { Ev, Session } from '../../shared/schema';
import type { Fx } from '../fx/types';
import { button, fmtCredits, h, logo, num } from './ui';

const DETAIL_PATH = 'understanding/';

const GAME_ORDER: readonly GameId[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];

export interface ReceiptData {
  reason: 'bust' | 'cashout';
  finalCredits: number;
  /** Ocean queue paid out as the end-of-session lump sum (0 when none). */
  bonus: number;
  playMs: number;
  /** Biggest single-round net gain (the lump-sum payout does not count as a round). */
  maxWin: number;
  games: { id: GameId; rounds: number }[];
}

const isFlush = (e: Ev): boolean => !!(e.dec && (e.dec as { flush?: unknown }).flush);

/** Everything the ticket prints, from the finished session and the wallet's final balance. */
export function buildReceipt(session: Session, balance: number): ReceiptData {
  const rounds: Partial<Record<GameId, number>> = {};
  let maxWin = 0;
  let flushed = 0;
  for (const e of session.events) {
    if (isFlush(e)) { flushed += e.payout; continue; }
    rounds[e.game] = (rounds[e.game] ?? 0) + 1;
    if (e.net > maxWin) maxWin = e.net;
  }
  const bonus = flushed > 0 ? flushed : Math.max(0, session.unreleased ?? 0);
  return {
    reason: session.endReason ?? 'cashout',
    finalCredits: balance,
    bonus,
    playMs: session.endedAt !== undefined ? Math.max(0, session.endedAt - session.startedAt) : 0,
    maxWin,
    games: GAME_ORDER.filter((id) => (rounds[id] ?? 0) > 0).map((id) => ({ id, rounds: rounds[id] as number })),
  };
}

/** mm:ss, or h:mm:ss from one hour. */
export function fmtPlayTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** Ticket serial (12 digits) and barcode bar widths (1..4 units), from a presentation stream. */
export function ticketMarks(rng: Rng): { serial: string; bars: number[] } {
  let serial = '';
  for (let i = 0; i < 12; i++) serial += String(rng.int(10));
  const bars: number[] = [];
  for (let i = 0; i < 46; i++) bars.push(1 + rng.int(4));
  return { serial, bars };
}

/** `<base>` + detail page + `#s=<summary>`; `base` is `import.meta.env.BASE_URL`. */
export async function detailUrl(session: Session, base: string): Promise<string> {
  const b = base.endsWith('/') ? base : base + '/';
  return b + DETAIL_PATH + (await summaryHash(summarize(session)));
}

/**
 * Save the finished session, then navigate. A failed save (storage blocked) does not stop the handoff: the
 * hash carries the summary. Returns the URL.
 */
export async function goToDetail(o: {
  session: Session;
  base: string;
  save(): unknown;
  navigate(url: string): void;
}): Promise<string> {
  try { o.save(); } catch { /* the summary in the hash is enough */ }
  const url = await detailUrl(o.session, o.base);
  o.navigate(url);
  return url;
}

export interface ReceiptOptions {
  session: Session;
  balance: number;
  fx: Fx;
  fxOn: boolean;
  save(): unknown;
  /** Defaults to `location.assign` (same window). */
  navigate?(url: string): void;
  base?: string;
}

function barcode(bars: number[]): HTMLElement {
  const el = h('div', 'tk__bars');
  bars.forEach((w, i) => {
    const b = h('span', 'tk__bar');
    b.style.flexGrow = String(w);
    b.style.opacity = i % 2 === 0 ? '1' : '0';
    el.append(b);
  });
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function line(label: string, value: Node | string, cls = '', testid?: string): HTMLElement {
  const v = h('span', 'tk__v', [value]);
  const el = h('div', `tk__line ${cls}`.trim(), [h('span', 'tk__k', [label]), h('span', 'tk__dots'), v]);
  if (testid) v.dataset.testid = testid;
  return el;
}

/** Draws the ticket over `host` (the frame). Router and input are already locked by the caller. */
export function mountReceipt(host: HTMLElement, o: ReceiptOptions): HTMLElement {
  const d = buildReceipt(o.session, o.balance);
  const marks = ticketMarks(createRng(o.session.seed, 'pre:receipt'));

  const final = num({ value: d.finalCredits, tone: 'gold', size: 40, testid: 'receipt-credits' });
  const rows: HTMLElement[] = [
    h('div', 'tk__big', [h('span', 'tk__cap', [t('cashout.final')]), final.el]),
  ];
  if (d.bonus > 0) rows.push(line(t('cashout.bonus'), '+' + fmtCredits(d.bonus), 'tk__line--bonus', 'receipt-bonus'));
  rows.push(line(t('cashout.time'), fmtPlayTime(d.playMs), '', 'receipt-time'));
  rows.push(line(t('cashout.maxwin'), d.maxWin > 0 ? fmtCredits(d.maxWin) : '—', '', 'receipt-maxwin'));
  const games = h('div', 'tk__games', [h('span', 'tk__cap', [t('cashout.games')])]);
  games.dataset.testid = 'receipt-games';
  for (const g of d.games) {
    games.append(line(t(`lobby.game.${g.id}`), t('cashout.rounds', { n: g.rounds }), 'tk__line--game'));
  }
  if (d.games.length === 0) games.append(line('—', '', 'tk__line--game'));
  rows.push(games);

  const head = h('div', 'tk__head', [logo({ size: 'sm' }), h('span', 'tk__title', [t('cashout.title')])]);
  const foot = h('div', 'tk__foot', [
    h('span', 'tk__tear'),
    barcode(marks.bars),
    h('span', 'tk__serial', [marks.serial.replace(/(\d{4})(?=\d)/g, '$1 ')]),
    h('span', 'tk__thanks', [t('cashout.thanks')]),
  ]);
  const paper = h('div', 'tk__paper', [head, h('div', 'tk__body', rows), foot]);
  const printer = h('div', 'tk__printer', [h('span', 'tk__slot'), h('div', 'tk__feed', [paper])]);

  let busy = false;
  const detail = button({
    label: t('cashout.detail'), variant: 'gold', size: 'lg', block: true, shine: o.fxOn, testid: 'btn-detail',
    onTap: () => {
      if (busy) return;
      busy = true;
      detail.disabled = true;
      void goToDetail({
        session: o.session, base: o.base ?? import.meta.env.BASE_URL, save: o.save,
        navigate: o.navigate ?? ((u) => location.assign(u)),
      }).catch(() => { busy = false; detail.disabled = false; });
    },
  });
  const actions = h('div', 'tk__actions', [detail]);

  const el = h('div', 'tk', [h('div', 'tk__scrim'), h('div', 'tk__col', [printer, actions])]);
  el.dataset.testid = 'receipt';
  el.dataset.reason = d.reason;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('cashout.title'));
  if (!o.fxOn) el.classList.add('is-static');
  host.append(el);

  if (o.fxOn) {
    void el.offsetWidth;
    el.classList.add('is-printing');
    // Two bursts of the printer sound: one when the paper starts, one midway.
    try { o.fx.sfx.play('ticket'); } catch { /* ignore */ }
    window.setTimeout(() => { try { o.fx.sfx.play('ticket'); } catch { /* ignore */ } }, 900);
    window.setTimeout(() => el.classList.add('is-done'), 2100);
  } else {
    el.classList.add('is-done');
  }
  return el;
}
