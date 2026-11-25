import { getLang, pickLang, setLang, LANG_STORAGE_KEY, type Lang } from '../../shared/i18n';
import { t } from '../../shared/i18n.gambling';
import { START_CREDITS } from '../../shared/config';
import { createRng, randomSeed, type Rng } from '../../shared/rng';
import type { Session } from '../../shared/schema';
import { createFx, createDomBackend, createNullFx } from '../fx/index';
import { loadGfx, type GfxLayer } from '../fx/gl/loader';
import { createSfx } from '../fx/sfx';
import { createHaptics } from '../fx/haptics';
import type { Fx } from '../fx/types';
import { createClock } from './clock';
import { detectEnv, type Env } from './env';
import { mountGate } from './gate';
import { mountReceipt } from './cashout';
import { mountHud } from './hud';
import { mountLobby } from './lobby';
import { parseParams, type AppParams } from './params';
import { createRegistry, type Registry } from './registry';
import { createRouter, windowHost, type Route, type Router } from './router';
import { bindVisibility, createSession, findResume, type SessionRuntime } from './session';
import type { Clock, GameModule } from './types';
import { fmtCredits, onRotateBlock, rotateOverlay, setFxMode } from './ui';

export interface AppHooks {
  /** The lobby task renders here; return a cleanup function. */
  lobby?(root: HTMLElement, rt: SessionRuntime): void | (() => void);
  /** Called for every applied route (before the screen is mounted). The HUD uses it. */
  route?(r: Route): void;
  /**
   * Cash-out / bust. When this runs the router is locked, the game is unmounted and the session is finished
   * (ocean queue flushed, `endedAt` saved). `cashout.ts` shows the receipt + handoff (wired in startPage).
   */
  cashout?(reason: 'bust' | 'cashout', rt: SessionRuntime, session: Session): void;
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
          if (rt.ended) return;
          hooks.route?.(r);
          if (r.kind === 'lobby') { lobbyCleanup = hooks.lobby?.(root, rt); return; }
          const g = await registry.load(r.id);
          if (rt.ended) return;
          game = g;
          await g.mount(root, rt.makeCtx(r.id));
          // A game module that is still an empty shell renders nothing: go back to the lobby.
          if (!root.firstElementChild && game === g) {
            g.unmount();
            game = null;
            void router.go({ kind: 'lobby' });
          }
        },
      });
      rt.bindNav({ toLobby: () => { void router.go({ kind: 'lobby' }); } });

      // Cash-out / bust (ARCHITECTURE 6.3): lock routing, unmount, finish the log, then the receipt hook.
      rt.onCashout((reason) => {
        router.lock();
        if (game) { game.unmount(); game = null; }
        if (typeof lobbyCleanup === 'function') lobbyCleanup();
        lobbyCleanup = undefined;
        root.textContent = '';
        rt.logger.nav('cashout');
        const session = rt.finish(reason);
        hooks.cashout?.(reason, rt, session);
      });
      if (typeof window !== 'undefined') window.addEventListener('pagehide', () => rt.save());
      return { rt, router };
    },
  };
}

// ------------------------------------------------------------------------------------------ page fx

/** A presentation stream whose seed is bound after the session starts (the seed is only known then). */
function lateRng(label: string): { rng: Rng; bind(seed: string): void } {
  let inner: Rng | null = null;
  const cur = (): Rng => (inner ??= createRng('', label));
  return {
    rng: {
      u32: () => cur().u32(), float: () => cur().float(), int: (n) => cur().int(n),
      weighted: (w) => cur().weighted(w), shuffle: (a) => cur().shuffle(a),
    },
    bind(seed) { inner = createRng(seed, label); },
  };
}

export interface PageFx {
  readonly fx: Fx;
  readonly on: boolean;
  /** Inside the gate tap, after the session started: binds the `pre:fx` seed and (fx on) starts loading the Pixi layer. */
  attach(rt: SessionRuntime): void;
}

/**
 * The single fx branch (ARCHITECTURE 4.3, 6.5). fx=off: `createNullFx()` only — `loadGfx` is never called,
 * so the Pixi chunk is neither requested nor executed and no <canvas> exists. fx=on: the real director on
 * the DOM backend; the Pixi decoration layer is loaded after the gate tap and dropped into `ref`.
 */
export function createPageFx(app: App, frame: HTMLElement): PageFx {
  if (app.params.fx === 'off') {
    setFxMode('off');
    return { fx: createNullFx({ fmt: (n) => fmtCredits(n) }), on: false, attach() {} };
  }
  setFxMode('on');
  const ref: { current: GfxLayer | null } = { current: null };
  const pre = lateRng('pre:fx');
  const fx = createFx({
    backend: createDomBackend({ frame, gfx: ref, t: (k) => t(k) }),
    clock: app.clock,
    pre: pre.rng,
    sfx: createSfx(),
    haptics: createHaptics(),
    reducedMotion: app.env.reducedMotion,
    quality: () => ref.current?.quality ?? 2,
    fmt: (n) => fmtCredits(n),
  });
  return {
    fx,
    on: true,
    attach(rt) {
      pre.bind(rt.logger.session.seed);
      const host = document.getElementById('gfx') ?? frame;
      void loadGfx(host, {
        pre: pre.rng,
        onLost: () => { ref.current = null; },
        onChange: (st) => rt.logger.aux('gfx', { ...st }),
      }).then((layer) => { ref.current = layer; });
    },
  };
}

// ------------------------------------------------------------------------------------------ page start

/** Gate → session → HUD + lobby. Runs once per page load. */
export function startPage(app: App): void {
  const frame = document.getElementById('frame') as HTMLElement;
  frame.append(rotateOverlay());
  const page = createPageFx(app, frame);
  const fx = page.fx;
  const resume = app.canResume();
  const credits = resume
    ? (findResume({ now: Date.now(), seed: app.params.seed, fx: app.params.fx, sv: app.params.sv })?.rt.balance ?? START_CREDITS)
    : START_CREDITS;

  const gate = mountGate({
    host: frame,
    resume,
    credits,
    onEnter() {
      // iOS: the AudioContext must be created / resumed synchronously inside the gesture, before anything else.
      void fx.sfx.unlock().catch(() => undefined);
      const { rt, router } = app.startSession(fx, { resume });
      rt.logger.nav('gate');

      const hud = mountHud(document.getElementById('hud') as HTMLElement, {
        rt, fx, clock: app.clock, fxOn: page.on,
        onBack: () => { void router.go({ kind: 'lobby' }); },
      });
      app.hooks.route = (r) => hud.setRoute(r);
      app.hooks.lobby = (root, r) => mountLobby(root, {
        rt: r, fx, clock: app.clock, fxOn: page.on,
        go: (id) => { void router.go({ kind: 'game', id }); },
      });
      app.hooks.cashout = (_reason, r, session) => {
        try { fx.sfx.loop('ambient', false); } catch { /* ignore */ }
        hud.lock();
        mountReceipt(frame, { session, balance: r.wallet.balance, fx, fxOn: page.on, save: () => r.logger.save() });
      };

      void router.start().then(() => rt.save());
      page.attach(rt);
      gate.close();

      // Landscape phone (rotate cover showing): hold time and effects until upright again.
      let sideways = false;
      onRotateBlock((blocked) => {
        sideways = blocked;
        if (rt.ended) return;
        if (blocked) { app.clock.pause(); fx.suspend(); }
        else if (document.visibilityState !== 'hidden') { app.clock.resume(); fx.resume(); }
      });
      // Back from the background while still sideways: the session's resume restarted time; hold it again.
      rt.onVisibility((s) => {
        if (s === 'visible' && sideways && !rt.ended) { app.clock.pause(); fx.suspend(); }
      });
    },
  });
}

if (typeof document !== 'undefined' && document.getElementById('app') && document.getElementById('frame')) {
  const app = boot();
  (globalThis as { __app?: App }).__app = app;
  startPage(app);
}
