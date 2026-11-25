/**
 * Install affordance (ARCHITECTURE 1.4, CONTEXT 6.1): a casino-style "앱 설치" button in the lobby dock when the
 * browser offers the install prompt, and a one-time "홈 화면에 추가" tip on iOS Safari. Nothing is logged, nothing
 * is requested from the user besides the browser's own install dialog. `beforeinstallprompt` can fire before the
 * lobby exists (the gate comes first), so it is captured here at module load and replayed on mount.
 */
import './install.css';
import { t } from '../../shared/i18n.gambling';
import { button, h, iconButton } from './ui';

interface BipEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const HINT_KEY = 'og.ihint';

export interface InstallGlobals {
  ua?: string;
  platform?: string;
  maxTouchPoints?: number;
  /** navigator.standalone (iOS) */
  standalone?: boolean;
  matchMedia?: (q: string) => { matches: boolean };
}

export function globalsFromWindow(): InstallGlobals {
  if (typeof window === 'undefined') return {};
  const n = window.navigator as Navigator & { standalone?: boolean };
  return {
    ua: n.userAgent, platform: n.platform, maxTouchPoints: n.maxTouchPoints, standalone: n.standalone,
    matchMedia: typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined,
  };
}

/** Already running as an installed app (fullscreen / standalone display mode, or iOS home-screen launch). */
export function isInstalledDisplay(g: InstallGlobals = globalsFromWindow()): boolean {
  if (g.standalone === true) return true;
  try {
    return !!g.matchMedia && (g.matchMedia('(display-mode: fullscreen)').matches || g.matchMedia('(display-mode: standalone)').matches);
  } catch { return false; }
}

/** iPhone / iPad (incl. iPadOS posing as a Mac) in Safari proper; other iOS browsers are left out. */
export function isIosSafari(g: InstallGlobals = globalsFromWindow()): boolean {
  const ua = g.ua ?? '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (g.platform === 'MacIntel' && (g.maxTouchPoints ?? 0) > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

function readFlag(): boolean {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
}
function writeFlag(): void {
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* blocked storage: the tip may show again, harmless */ }
}

// ---- early capture (module load)
let deferred: BipEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const notify = (): void => { for (const f of [...subs]) f(); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BipEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

/**
 * Mounts into the (hidden) dock slot. Returns a cleanup. The slot stays hidden unless there is something to show.
 */
export function mountInstall(slot: HTMLElement, g: InstallGlobals = globalsFromWindow()): () => void {
  if (isInstalledDisplay(g)) return () => {};
  const dock = slot.parentElement ?? slot;
  let btn: HTMLButtonElement | null = null;
  let hint: HTMLElement | null = null;

  const closeHint = (): void => { hint?.remove(); hint = null; };

  const render = (): void => {
    const show = !installed && deferred !== null;
    if (show && !btn) {
      const b = button({
        label: t('install.button'), variant: 'gold', size: 'sm', icon: 'plus', testid: 'btn-install',
        onTap: () => {
          const ev = deferred;
          if (!ev) return;
          deferred = null; // an event can be prompted once; the browser re-fires it later if the user declines
          render();
          void ev.prompt().then(() => ev.userChoice).catch(() => undefined);
        },
      });
      const wrap = h('div', 'lb-install', [b]);
      slot.append(wrap);
      btn = b;
    } else if (!show && btn) {
      slot.textContent = '';
      btn = null;
    }
    slot.hidden = btn === null;
  };

  subs.add(render);
  render();

  // iOS Safari: no install event exists; point at Share → Add to Home Screen, once per device.
  if (isIosSafari(g) && !readFlag()) {
    writeFlag();
    const close = iconButton({ icon: 'close', aria: t('install.close'), testid: 'btn-install-hint-close', variant: 'dark' });
    close.addEventListener('click', closeHint);
    hint = h('div', 'lb-hint', [
      h('div', 'lb-hint__text', [h('b', 'lb-hint__title', [t('install.ios.title')]), h('span', 'lb-hint__body', [t('install.ios.body')])]),
      close,
    ]);
    hint.dataset.testid = 'install-hint';
    hint.setAttribute('role', 'note');
    dock.append(hint);
  }

  return () => {
    subs.delete(render);
    closeHint();
    slot.textContent = '';
    slot.hidden = true;
    btn = null;
  };
}

/** Test hook: forget captured state. */
export function __resetInstall(): void { deferred = null; installed = false; subs.clear(); }
