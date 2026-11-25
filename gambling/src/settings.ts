/**
 * Settings sheet, opened from the lobby dock (gear button): language (ko / en / it) and sound on/off,
 * plus the purpose / problem-gambling notice at the bottom.
 *
 * A language change is applied in place (no reload, the session goes on): the global language is switched,
 * stored under `eg.lang` (the same key both pages read at start), `?lang=` is dropped from the URL so it cannot
 * override the choice on the next launch, the change is logged as `aux("lang", {lang})`, and `onLang` lets
 * the caller re-render (HUD labels + lobby). Games mounted later read the new language through `t()`.
 */
import './settings.css';
import { LANG_STORAGE_KEY, LANGS, getLang, setLang, type Lang } from '../../shared/i18n';
import { t } from '../../shared/i18n.gambling';
import type { Fx } from '../fx/types';
import { noticeBlock } from './notice';
import type { SessionRuntime } from './session';
import { h, pressable, sheet, type Overlay } from './ui';

/** Each language is named in itself. */
export const LANG_NAMES: Record<Lang, string> = { ko: '한국어', en: 'English', it: 'Italiano' };

export interface SettingsOptions {
  rt: SessionRuntime;
  fx: Fx;
  /** After a language change: re-render whatever shows text (the sheet itself is rebuilt by the caller). */
  onLang(lang: Lang): void;
}

/** Switch the page language and remember it. Returns false when `lang` is already active. */
export function applyLang(lang: Lang, o: { storage?: Pick<Storage, 'setItem'> | null; doc?: Document; log?: (lang: Lang) => void } = {}): boolean {
  if (lang === getLang()) return false;
  setLang(lang);
  try {
    const st = o.storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage : o.storage;
    st?.setItem(LANG_STORAGE_KEY, lang);
  } catch { /* storage blocked: the choice lasts for this page */ }
  const doc = o.doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (doc) {
    doc.documentElement.lang = lang;
    doc.title = t('app.title');
    try {
      const u = new URL(doc.location.href);
      if (u.searchParams.has('lang')) {
        u.searchParams.delete('lang');
        history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      }
    } catch { /* ignore */ }
  }
  o.log?.(lang);
  return true;
}

function segmented<T extends string>(o: {
  label: string; testid: string; items: readonly T[]; name(v: T): string; value: T; onPick(v: T): void;
}): { el: HTMLElement; cleanup(): void } {
  const cleanups: (() => void)[] = [];
  const group = h('div', 'st-seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', o.label);
  group.dataset.testid = o.testid;
  const btns = o.items.map((v) => {
    const b = h('button', 'st-seg__btn', [o.name(v)]);
    b.type = 'button';
    b.dataset.value = v;
    b.setAttribute('aria-pressed', String(v === o.value));
    cleanups.push(pressable(b));
    b.addEventListener('click', () => {
      for (const x of btns) x.setAttribute('aria-pressed', String(x === b));
      o.onPick(v);
    });
    return b;
  });
  group.append(...btns);
  const row = h('div', 'st-row', [h('span', 'st-row__label', [o.label]), group]);
  return { el: row, cleanup: () => { for (const c of cleanups.splice(0)) c(); } };
}

/** Build and open the sheet. */
export function openSettings(o: SettingsOptions): Overlay {
  const { rt, fx } = o;
  const tap = (): void => { try { fx.sfx.play('tap'); } catch { /* ignore */ } };

  const lang = segmented<Lang>({
    label: t('settings.lang'), testid: 'settings-lang', items: LANGS, name: (l) => LANG_NAMES[l], value: getLang(),
    onPick: (l) => {
      tap();
      if (!applyLang(l, { log: (x) => rt.logger.aux('lang', { lang: x }) })) return;
      cleanup();
      sh.close();
      o.onLang(l);
    },
  });
  const sound = segmented<'on' | 'off'>({
    label: t('settings.sound'), testid: 'settings-sound', items: ['on', 'off'],
    name: (v) => t(`settings.${v}`), value: rt.settings.muted ? 'off' : 'on',
    onPick: (v) => {
      rt.settings.muted = v === 'off';
      tap();
    },
  });
  const cleanup = (): void => { lang.cleanup(); sound.cleanup(); };

  const sh = sheet({
    title: t('settings.title'),
    testid: 'settings',
    body: [h('div', 'st', [lang.el, sound.el, noticeBlock({ testid: 'settings-notice' })])],
    onClose: cleanup,
  });
  sh.open();
  return sh;
}
