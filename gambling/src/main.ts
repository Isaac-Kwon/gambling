import { getLang, pickLang, setLang, LANG_STORAGE_KEY, type Lang } from '../../shared/i18n';
import { t } from '../../shared/i18n.gambling';
import { randomSeed } from '../../shared/rng';
import type { Fx } from '../fx/types';
import { createClock } from './clock';
import { detectEnv, type Env } from './env';
import { parseParams, type AppParams } from './params';
import { createRegistry, type Registry } from './registry';
import { createRouter, windowHost, type Router } from './router';
import { bindVisibility, createSession, findResume, type SessionRuntime } from './session';
import type { Clock, GameModule } from './types';

export interface AppHooks {
  /** The lobby task renders here; return a cleanup function. */
  lobby?(root: HTMLElement, rt: SessionRuntime): void | (() => void);
}

export interface App {
  params: AppParams;
  env: Env;
  clock: Clock;
  lang: Lang;
  registry: Registry;
  hooks: AppHooks;
  /** True when an unfinished session exists that this URL may resume (same fx, sv, seed rules; within 6 h). */
  canResume(): boolean;
  /**
   * Called by the gate inside the tap handler, with the Fx chosen for this page (createNullFx() when
   * params.fx is "off", else createFx(...)). Starts or resumes the session and wires visibility and routing.
   * Call `router.start()` afterwards (the gate does nav("gate") first, then the router logs the lobby).
   */
  startSession(fx: Fx, o?: { resume?: boolean }): { rt: SessionRuntime; router: Router };
}

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function boot(): App {
  const params = parseParams(location.search);
  const env = detectEnv();
  const lang = pickLang({ query: params.lang, stored: readStored(LANG_STORAGE_KEY), navigatorLang: navigator.language });
  setLang(lang);
  const clock = createClock();
  const registry = createRegistry();
  const hooks: AppHooks = {};
  const resumable = () => findResume({ now: Date.now(), seed: params.seed, fx: params.fx, sv: params.sv });

  return {
    params, env, clock, lang, registry, hooks,
    canResume: () => resumable() !== null,
    startSession(fx, o = {}) {
      const resume = o.resume === false ? null : resumable();
      const rt = createSession({
        seed: params.seed ?? randomSeed(), mode: params.seed ? 'class' : 'free',
        fx, fxMode: params.fx, sv: params.sv, lang: getLang(), env, clock,
        t: (k, p) => t(k, p), resume: resume ?? undefined,
      });
      bindVisibility(document, rt);

      const root = document.getElementById('app') as HTMLElement;
      let game: GameModule | null = null;
      let lobbyCleanup: void | (() => void);
      rt.onVisibility((s) => { if (s === 'hidden') game?.onSuspend?.(); else game?.onResume?.(); });

      const router = createRouter({
        host: windowHost(),
        logNav: (to) => rt.logger.nav(to),
        canLeave: () => game?.canLeave() ?? true,
        async onRoute(r) {
          if (game) { game.unmount(); game = null; }
          if (typeof lobbyCleanup === 'function') lobbyCleanup();
          lobbyCleanup = undefined;
          root.textContent = '';
          if (r.kind === 'lobby') { lobbyCleanup = hooks.lobby?.(root, rt); return; }
          const g = await registry.load(r.id);
          game = g;
          await g.mount(root, rt.makeCtx(r.id));
        },
      });
      rt.bindNav({ toLobby: () => { void router.go({ kind: 'lobby' }); } });
      return { rt, router };
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  // Placeholder; the gate task replaces this with the tap-to-enter screen.
  const app = boot();
  const el = document.getElementById('app') as HTMLElement;
  el.textContent = t('app.title');
  (globalThis as { __app?: App }).__app = app;
}
