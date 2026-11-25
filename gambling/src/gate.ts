/**
 * Tap-to-enter gate (ARCHITECTURE §6.3). Covers the whole frame on every page load; the first tap is the
 * user gesture that unlocks audio and starts (or resumes) the session. This module only draws the screen and
 * calls `onEnter` synchronously inside the gesture handler — the caller (main.ts) must call
 * `fx.sfx.unlock()` first thing in `onEnter`, then start the session.
 */
import './gate.css';
import { t } from '../../shared/i18n.gambling';
import { h, logo, num, sparkle, svgRoot } from './ui';

export interface GateOptions {
  /** Usually `#frame`. */
  host: HTMLElement;
  /** An unfinished session will be resumed (changes the greeting). */
  resume: boolean;
  /** Credits shown on the gate (start credits, or the balance that will be resumed). */
  credits: number;
  /** Called synchronously inside the tap / key handler, exactly once. */
  onEnter(): void;
}

export interface Gate {
  readonly el: HTMLElement;
  /** Fade out and remove. */
  close(): void;
}

/** Gold coins and gems drifting up behind the logo (transform-only loops). */
function floaters(): HTMLElement {
  const box = h('div', 'gate__float');
  const kinds = ['coin', 'gem-m', 'coin', 'gem-c', 'coin', 'coin', 'gem-m', 'coin', 'gem-c', 'coin', 'coin', 'gem-m'];
  kinds.forEach((k, i) => {
    const el = h('span', `gate__fl gate__fl--${k}`, [h('span', 'gate__fl-in')]);
    el.style.setProperty('--x', `${4 + ((i * 37) % 90)}%`);
    el.style.setProperty('--d', `${-((i * 1.37) % 9)}s`);
    el.style.setProperty('--s', `${0.55 + ((i * 13) % 7) / 10}`);
    el.style.setProperty('--dur', `${8 + ((i * 5) % 6)}s`);
    box.append(el);
  });
  return box;
}

function bulbs(): HTMLElement {
  // Marquee bulb border: two interleaved groups breathe in opposite phase (opacity, 1.4 s, ease-in-out).
  const box = h('div', 'gate__bulbs');
  const n = 14;
  for (const side of ['t', 'b', 'l', 'r'] as const) {
    const row = h('div', `gate__bulbrow gate__bulbrow--${side}`);
    for (let i = 0; i < n; i++) row.append(h('span', `gate__bulb ${i % 2 ? 'gate__bulb--b' : ''}`));
    box.append(row);
  }
  return box;
}

export function mountGate(o: GateOptions): Gate {
  const sparks = h('div', 'gate__sparks');
  ([[14, 18, 26, '#FFFFFF'], [84, 14, 18, '#FFE9A6'], [80, 60, 22, '#FFFFFF'], [9, 66, 16, '#29E6FF'], [50, 7, 14, '#FFFFFF'], [90, 84, 14, '#FF3DA5']] as const)
    .forEach(([x, y, size, color], i) => {
      const sp = svgRoot('0 0 20 20', [sparkle(10, 10, 10, color)], { class: 'gate__spark', width: size, height: size });
      sp.style.left = `${x}%`;
      sp.style.top = `${y}%`;
      sp.style.animationDelay = `${-i * 0.7}s`;
      sparks.append(sp);
    });

  const bonus = h('div', 'gate__bonus', [
    h('span', 'gate__bonus-label', [t(o.resume ? 'gate.welcome' : 'gate.bonus')]),
    h('span', 'gate__bonus-row', [num({ value: o.credits, tone: 'gold', size: 30 }).el, h('span', 'gate__bonus-unit', [t('gate.credits')])]),
  ]);

  const cta = h('div', 'gate__cta', [
    h('span', 'gate__cta-ring'),
    h('span', 'gate__cta-face', [h('span', 'gate__cta-ko', [t('gate.enter')]), h('span', 'gate__cta-en', [t('gate.enter.sub')])]),
  ]);

  const el = h('div', 'gate', [
    h('div', 'gate__rays'),
    h('div', 'gate__halo'),
    floaters(),
    sparks,
    bulbs(),
    h('div', 'gate__body', [h('div', 'gate__brand', [logo({ size: 'lg', ko: true, slogan: true })]), bonus, cta]),
  ]);
  el.dataset.testid = 'gate';
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', t('gate.enter'));

  let entered = false;
  const enter = (): void => {
    if (entered) return;
    entered = true;
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('keydown', onKey);
    o.onEnter();
  };
  const onUp = (e: PointerEvent): void => {
    if (e.button > 0) return;
    e.preventDefault();
    enter();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      enter();
    }
  };
  const onDown = (): void => el.classList.add('is-down');
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('keydown', onKey);

  o.host.append(el);
  try { el.focus({ preventScroll: true }); } catch { /* ignore */ }

  return {
    el,
    close() {
      el.classList.add('is-leaving');
      el.setAttribute('aria-hidden', 'true');
      el.removeEventListener('pointerdown', onDown);
      window.setTimeout(() => el.remove(), 520);
    },
  };
}
