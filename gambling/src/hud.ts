/**
 * Top HUD (BASE_PROMPT §5.1, ARCHITECTURE §6.2–6.3): shared credit balance (counted up on gains), session
 * level + XP bar, CASH OUT (always visible), back-to-lobby and how-to-play (?) inside games, and two notices from the runtime:
 * the ocean bonus line (`hud.bonus`, shown even with fx off — it explains a balance change) and the level-up
 * banner. No clock anywhere.
 *
 * The balance count-up is the HUD's own DOM tween, not `fx.countup`: the director would record it into the
 * current round's `Ev.fx`, and the HUD number is not a stimulus of a round outcome. `data-value` on the
 * balance element always carries the true wallet balance (tests read it while the digits still count).
 */
import './hud.css';
import { t } from '../../shared/i18n.gambling';
import type { GameId } from '../../shared/config';
import type { Fx } from '../fx/types';
import type { Route } from './router';
import type { SessionRuntime } from './session';
import type { Clock } from './types';
import { bellEmblem, button, fmtCredits, goldText, h, icon, iconButton, num, progressBar, setButtonLabel, setDigits } from './ui';

export interface HudOptions {
  rt: SessionRuntime;
  fx: Fx;
  clock: Clock;
  /** false with `?fx=off`: no count-up, no level banner. */
  fxOn: boolean;
  /** Back button inside a game. */
  onBack(): void;
  /** ? button inside a game: open that game's how-to-play sheet. */
  onHelp(game: GameId): void;
}

export interface Hud {
  readonly el: HTMLElement;
  setRoute(r: Route): void;
  /** Disable every control (cash-out cover is up). */
  lock(): void;
  /** Redraw the labels after a language change. */
  relabel(): void;
  destroy(): void;
}

/** Level n needs 500·n·(n+1) cumulative stake (session.ts levelOf). Progress inside the current level, 0..1. */
export function levelProgress(xp: number, level: number): number {
  const lo = 500 * level * (level + 1);
  const hi = 500 * (level + 1) * (level + 2);
  return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
}

/** Count-up length for a balance gain (ms). */
export function countMs(delta: number): number {
  if (!(delta > 0)) return 0;
  return Math.round(Math.min(1600, 360 + 260 * Math.log10(1 + delta / 20)));
}

export function mountHud(host: HTMLElement, o: HudOptions): Hud {
  const { rt, fx, clock } = o;
  const cleanups: (() => void)[] = [];

  // ---- left: back (game) / emblem (lobby)
  const back = iconButton({ icon: 'back', aria: t('hud.back'), testid: 'btn-lobby', onTap: () => o.onBack() });
  back.classList.add('hud__back');
  const emblem = h('span', 'hud__emblem', [bellEmblem()]);
  const left = h('div', 'hud__left', [emblem, back]);

  // ---- balance
  const bal = num({ value: rt.wallet.balance, tone: 'gold', size: 22, testid: 'balance' });
  bal.el.dataset.value = String(rt.wallet.balance);
  const coin = h('span', 'hud__coin', [icon('coin', 22)]);
  const balBox = h('div', 'hud__bal', [h('span', 'hud__bal-glow'), coin, h('span', 'hud__bal-num', [bal.el])]);

  // ---- how to play (games only)
  let game: GameId | null = null;
  const help = iconButton({ icon: 'help', aria: t('hud.help'), variant: 'violet', testid: 'btn-help', onTap: () => { if (game && !locked) o.onHelp(game); } });
  help.classList.add('hud__help');
  help.tabIndex = -1;

  // ---- cash out
  const cash = button({ label: t('hud.cashout'), variant: 'red', size: 'sm', testid: 'btn-cashout', onTap: () => requestCashout() });
  cash.classList.add('hud__cash');

  // ---- level + xp
  const lvl = h('span', 'hud__lv', [h('span', 'hud__lv-star', [icon('star', 16)]), h('span', 'hud__lv-text')]);
  const bar = progressBar({ value: 0, tone: 'gold', testid: 'xp' });
  bar.el.classList.add('hud__xp-bar');
  const xpRow = h('div', 'hud__xp', [lvl, bar.el]);

  const toasts = h('div', 'hud__toasts');
  const el = h('div', 'hud', [h('div', 'hud__row', [left, balBox, help, cash]), xpRow, toasts]);
  el.dataset.route = 'lobby';
  host.textContent = '';
  host.append(el);

  // ---- level display (shown as level + 1: the session starts at "LV 1"; logs keep the internal n)
  const showLevel = (): void => {
    lvl.lastElementChild!.textContent = t('hud.level', { n: rt.level + 1 });
    bar.set(levelProgress(rt.xp, rt.level));
  };
  showLevel();

  // ---- balance tween
  let shown = rt.wallet.balance;
  let target = shown;
  let from = shown, t0 = 0, dur = 0, elapsed = 0;
  let stopFrame: (() => void) | null = null;
  const paint = (v: number): void => setDigits(bal.el, fmtCredits(v));
  const endTween = (): void => {
    stopFrame?.();
    stopFrame = null;
    shown = target;
    paint(shown);
    balBox.classList.remove('is-up');
  };
  const onBalance = (balance: number, delta: number): void => {
    bal.el.dataset.value = String(balance);
    target = balance;
    showLevel();
    const ms = o.fxOn ? countMs(delta) : 0;
    if (ms === 0 || balance <= shown) { endTween(); return; }
    from = shown; t0 = clock.now(); dur = ms; elapsed = 0;
    // A state class (the glow fades in by transition), not a restarted animation: no reflow needed. A
    // forced layout here would land in the settle task, right before the celebration starts.
    balBox.classList.add('is-up');
    if (!stopFrame) {
      stopFrame = clock.frame((dt) => {
        elapsed += dt;
        const p = Math.min(1, Math.max(elapsed, clock.now() - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        shown = Math.round(from + (target - from) * e);
        paint(shown);
        if (p >= 1) endTween();
      });
    }
  };
  cleanups.push(rt.wallet.onChange(onBalance));
  cleanups.push(() => stopFrame?.());

  // ---- cash out (deferred while a round is in progress: the button stays pressed)
  let locked = false;
  const requestCashout = (): void => {
    if (locked || rt.ended || rt.cashoutRequested) return;
    try { fx.sfx.play('tap'); } catch { /* ignore */ }
    rt.requestCashout('cashout');
    if (!rt.cashoutRequested) {
      cash.classList.add('is-held');
      cash.setAttribute('aria-pressed', 'true');
    }
  };

  // ---- notices
  const toast = (node: HTMLElement, ms: number): void => {
    toasts.append(node);
    window.setTimeout(() => {
      node.classList.add('is-out');
      window.setTimeout(() => node.remove(), 420);
    }, ms);
  };
  cleanups.push(rt.onNotice((n) => {
    if (n.kind === 'bonus') {
      toast(h('div', 'hud-bonus', [icon('coin', 18), h('span', '', [t('hud.bonus', { amt: fmtCredits(n.amount) })])]), 3600);
    } else if (n.kind === 'level') {
      showLevel();
      lvl.classList.remove('is-pop');
      void lvl.offsetWidth;
      lvl.classList.add('is-pop');
      if (!o.fxOn) return;
      try { fx.sfx.play('level'); } catch { /* ignore */ }
      toast(h('div', 'hud-lvup', [
        h('span', 'hud-lvup__burst'),
        goldText(t('hud.levelup'), { size: 26, glow: 'magenta', className: 'hud-lvup__title' }),
        h('span', 'hud-lvup__n', [t('hud.level', { n: n.n + 1 })]),
      ]), 2200);
    }
  }));

  return {
    el,
    setRoute(r) {
      el.dataset.route = r.kind === 'game' ? 'game' : 'lobby';
      game = r.kind === 'game' ? r.id : null;
      back.tabIndex = r.kind === 'game' ? 0 : -1;
      help.tabIndex = r.kind === 'game' ? 0 : -1;
    },
    relabel() {
      back.setAttribute('aria-label', t('hud.back'));
      help.setAttribute('aria-label', t('hud.help'));
      if (!cash.classList.contains('is-held')) setButtonLabel(cash, t('hud.cashout'));
      showLevel();
    },
    lock() {
      locked = true;
      back.disabled = true;
      help.disabled = true;
      cash.disabled = true;
      cash.classList.remove('is-held');
      setButtonLabel(cash, t('hud.cashout'));
    },
    destroy() {
      for (const c of cleanups.splice(0)) { try { c(); } catch { /* ignore */ } }
      el.remove();
    },
  };
}
