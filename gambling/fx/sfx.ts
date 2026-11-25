/**
 * Web Audio sound engine implementing `Sfx` (fx/types.ts). Everything is synthesized at runtime.
 *
 * - Lazy: no AudioContext exists until `unlock()`, which must run synchronously inside a user gesture
 *   (gate tap). It creates/resumes the context and plays a 1-sample silent buffer (iOS unlock).
 *   Calling it again later (e.g. on a pointerdown after iOS re-locked audio) just resumes.
 * - Before unlock every `play`/`loop` call is a no-op. Nothing ever throws; a missing or failing
 *   AudioContext (or iOS silent mode) simply yields silence.
 * - Master chain: voices -> dry bus -> high-pass 28 Hz -> compressor -> limiter -> master gain (<= MASTER_CAP)
 *   -> destination, plus a shared synthetic reverb send. Master fades in on unlock, mute ramps.
 * - Voice limiting: global cap on concurrent one-shots, per-sound cap and minimum gap (count-up ticks are
 *   throttled), tier jingles share one slot (a new jingle replaces the old one with a 30 ms fade).
 * - `play(name, { k, pitch })`: k = max gain 0..1, pitch = transposition multiplier. For `omen` the pitch
 *   option carries the grade instead: 1 = clam, 2 = shark, 3 = whale.
 * - `loop(name, on, { pitch })`: calling again with on=true updates the parameter with a short linear ramp.
 *   spin: pitch = reel speed (clicks, whir and whoosh rise together). rise: pitch = current multiplier.
 *   heartbeat: pitch = tempo factor (1 = 75 bpm). ambient: pitch = transposition.
 * - `suspend()/resume()` (and document visibilitychange when a document is available) suspend the context.
 */
import type { Sfx, SfxName } from './types';
import { clamp, makeImpulse, makeNoise, type Kit } from './sfx/kit';
import { LOOP_BUFFERS, makeLoop, type BufCache, type LoopName, type LoopVoice } from './sfx/loops';
import { RECIPES } from './sfx/voices';

/** Hard cap of the master gain (ARCHITECTURE §6.4: master 0.5 + limiter). */
export const MASTER_CAP = 0.5;
export const MAX_VOICES = 14;

interface Spec {
  /** Steal priority: a new voice may only replace voices of equal or lower priority. */
  prio: number;
  /** Max concurrent voices of this key. */
  max: number;
  /** Minimum seconds between two starts of this sound. */
  gap: number;
  /** Reverb send level. */
  rev: number;
  /** Voices sharing a group share the `max` budget. */
  group?: string;
}

const JINGLE: Spec = { prio: 4, max: 1, gap: 0.05, rev: 0.28, group: 'jingle' };
export const SPECS: Readonly<Record<SfxName, Spec>> = {
  tap: { prio: 1, max: 3, gap: 0.03, rev: 0.04 },
  stop: { prio: 2, max: 5, gap: 0.03, rev: 0.06 },
  tick: { prio: 0, max: 3, gap: 0.05, rev: 0.06 },
  coin: { prio: 1, max: 6, gap: 0.03, rev: 0.12 },
  chip: { prio: 1, max: 4, gap: 0.03, rev: 0.06 },
  card: { prio: 1, max: 4, gap: 0.03, rev: 0.05 },
  win0: { ...JINGLE, prio: 3 },
  win1: JINGLE,
  win2: JINGLE,
  win3: JINGLE,
  win4: JINGLE,
  omen: { prio: 4, max: 1, gap: 0.2, rev: 0.45 },
  ticket: { prio: 2, max: 2, gap: 0.12, rev: 0.08 },
  level: { prio: 3, max: 1, gap: 0.2, rev: 0.2 },
};

const LOOP_GAIN_REV: Readonly<Record<LoopName, number>> = { ambient: 0.3, spin: 0.03, rise: 0.05, heartbeat: 0.08 };

/** Minimal document surface used for visibility and re-unlock listeners. */
export interface SfxDoc {
  readonly visibilityState?: string;
  addEventListener(type: string, fn: () => void, o?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: () => void, o?: boolean | EventListenerOptions): void;
}

export interface SfxOptions {
  /** AudioContext factory (tests inject a stub). Default: window.AudioContext / webkitAudioContext. */
  createContext?: () => AudioContext | null;
  /** Document for visibilitychange + re-unlock on pointerdown. Default: globalThis.document if present; null disables. */
  doc?: SfxDoc | null;
  maxVoices?: number;
  /** Diagnostics hook for errors swallowed while building a voice (never rethrown). */
  onError?: (e: unknown) => void;
  /**
   * Pre-render the tier jingles into buffers (OfflineAudioContext) during idle time after `unlock()`, so a
   * celebration starts one buffer source instead of building ~100 synth nodes on the main thread in the
   * celebration's first frame. Default: on when no `createContext` is injected (i.e. in the browser).
   */
  prerender?: boolean;
  /** OfflineAudioContext factory (tests). Default: window.OfflineAudioContext / webkitOfflineAudioContext. */
  createOffline?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext | null;
}

/**
 * Sounds rendered ahead of time as [name, pitch]: the tier jingles (biggest first: they are the expensive
 * ones) and the one-shots a spin and a celebration start with (tap, the reel stops at their pitches, coin
 * drops). Any other pitch is synthesized live as before.
 */
export const PRERENDERED: readonly (readonly [SfxName, number])[] = [
  ['win4', 1], ['win3', 1], ['win2', 1], ['win1', 1], ['win0', 1], ['tap', 1],
  ['stop', 1], ['stop', 1.04], ['stop', 1.08], ['stop', 1.12], ['stop', 1.16],
  ['coin', 1], ['coin', 1.08], ['coin', 1.16], ['coin', 1.24], ['level', 1],
];
const preKey = (name: SfxName, p: number): string => `${name}@${p.toFixed(3)}`;
/** Upper bound of a jingle's length in seconds (the rendered buffer is trimmed to the recipe's real end). */
const PRERENDER_MAX_S = 6;

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
function defaultOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const C = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  return C ? new C(channels, length, sampleRate) : null;
}

function onIdle(fn: () => void): void {
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    setTimeout?: (f: () => void, ms: number) => unknown;
  };
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(fn, { timeout: 2000 });
  else if (typeof g.setTimeout === 'function') g.setTimeout(fn, 60);
}

export interface SfxEngine extends Sfx {
  /** True once `unlock()` created a context. */
  readonly unlocked: boolean;
  readonly muted: boolean;
  /** Active one-shot voices (debug/tests). */
  readonly voices: number;
  /** Background: suspend the AudioContext. Idempotent. */
  suspend(): void;
  /** Foreground: resume (no-op while the document is hidden). Idempotent. */
  resume(): void;
  /** Stops everything, removes listeners, closes the context. */
  dispose(): void;
}

interface Voice {
  name: SfxName;
  key: string;
  prio: number;
  start: number;
  end: number;
  out: GainNode;
  send: GainNode | null;
  srcs: AudioScheduledSourceNode[];
}

interface Chain {
  dry: GainNode;
  wet: AudioNode | null;
  master: GainNode;
  noise: AudioBuffer | null;
}

type Ctor = new (o?: AudioContextOptions) => AudioContext;

function defaultCreate(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    return new C({ latencyHint: 'interactive' });
  } catch {
    return new C();
  }
}

function defaultDoc(): SfxDoc | null {
  const d = (globalThis as { document?: unknown }).document;
  return d && typeof (d as SfxDoc).addEventListener === 'function' ? (d as SfxDoc) : null;
}

const noop = (): void => {};
const resolved = (): Promise<void> => Promise.resolve();

export function createSfx(o: SfxOptions = {}): SfxEngine {
  const create = o.createContext ?? defaultCreate;
  const doc = o.doc === undefined ? defaultDoc() : o.doc;
  const maxVoices = Math.max(1, o.maxVoices ?? MAX_VOICES);

  let ac: AudioContext | null = null;
  let chain: Chain | null = null;
  let failed = false;
  let unlocked = false;
  let muted = false;
  let paused = false;
  let disposed = false;
  let seq = 0;
  const voices: Voice[] = [];
  const dying: Voice[] = [];
  const last = new Map<SfxName, number>();
  const bufs = new Map<string, AudioBuffer>();
  const doPrerender = o.prerender ?? !o.createContext;
  const createOffline = o.createOffline ?? defaultOffline;
  const jingles = new Map<string, { buf: AudioBuffer; dur: number }>();
  let prerenderStarted = false;
  const loops: Record<LoopName, { on: boolean; pitch: number; v: LoopVoice | null; out: GainNode | null; send: GainNode | null }> = {
    ambient: { on: false, pitch: 1, v: null, out: null, send: null },
    spin: { on: false, pitch: 1, v: null, out: null, send: null },
    rise: { on: false, pitch: 1, v: null, out: null, send: null },
    heartbeat: { on: false, pitch: 1, v: null, out: null, send: null },
  };

  const report = (e: unknown): void => {
    try {
      o.onError?.(e);
    } catch {
      /* ignore */
    }
  };
  const halt = (srcs: AudioScheduledSourceNode[]): void => {
    for (const s of srcs) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
  };
  const hidden = (): boolean => !!doc && doc.visibilityState === 'hidden';
  const level = (): number => (muted ? 0 : MASTER_CAP);

  const buf: BufCache = (key, render) => {
    if (!ac) return null;
    let b = bufs.get(key);
    if (!b) {
      try {
        b = render(ac);
        bufs.set(key, b);
      } catch {
        return null;
      }
    }
    return b;
  };

  function build(c: AudioContext): Chain {
    const t = c.currentTime;
    const master = c.createGain();
    master.gain.value = 0;
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(level(), t + 0.06);
    master.connect(c.destination);
    let head: AudioNode = master;
    try {
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -2;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.08;
      lim.connect(head);
      head = lim;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.2;
      comp.connect(head);
      head = comp;
    } catch {
      /* no compressor: master cap still applies */
    }
    try {
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 28;
      hp.Q.value = 0.7;
      hp.connect(head);
      head = hp;
    } catch {
      /* optional */
    }
    const dry = c.createGain();
    dry.gain.value = 1;
    dry.connect(head);
    let wet: AudioNode | null = null;
    try {
      const conv = c.createConvolver();
      conv.buffer = makeImpulse(c);
      const ret = c.createGain();
      ret.gain.value = 0.32;
      conv.connect(ret);
      ret.connect(head);
      wet = conv;
    } catch {
      wet = null;
    }
    let nz: AudioBuffer | null = null;
    try {
      nz = makeNoise(c);
    } catch {
      nz = null;
    }
    return { dry, wet, master, noise: nz };
  }

  /** iOS: a silent 1-sample buffer started inside the gesture unlocks output. */
  function poke(c: AudioContext): void {
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }

  /** Resume if needed. The promise settles on resume or after 1 s (iOS can leave resume() pending forever). */
  function kick(): Promise<void> {
    if (!ac) return resolved();
    try {
      if (ac.state !== 'running' && ac.state !== 'closed') {
        const r = ac.resume();
        if (!r || typeof r.then !== 'function') return resolved();
        const settled = r.then(noop, noop);
        const st = (globalThis as { setTimeout?: (f: () => void, ms: number) => unknown }).setTimeout;
        if (!st) return settled;
        return Promise.race([settled, new Promise<void>((res) => void st(res, 1000))]);
      }
    } catch {
      /* ignore */
    }
    return resolved();
  }

  function live(): boolean {
    return !!ac && !!chain && unlocked && !disposed && ac.state !== 'closed';
  }

  function release(v: Voice, now: number): void {
    try {
      const g = v.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(clamp(g.value, 0, 1), now);
      g.linearRampToValueAtTime(0, now + 0.03);
    } catch {
      /* ignore */
    }
    for (const s of v.srcs) {
      try {
        s.stop(now + 0.04);
      } catch {
        /* not started or already stopped */
      }
    }
    v.end = Math.min(v.end, now + 0.05);
    dying.push(v);
  }

  function drop(v: Voice): void {
    try {
      v.out.disconnect();
      v.send?.disconnect();
    } catch {
      /* ignore */
    }
  }

  function prune(now: number): void {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i]!.end < now - 0.05) drop(voices.splice(i, 1)[0]!);
    }
    for (let i = dying.length - 1; i >= 0; i--) {
      if (dying[i]!.end < now - 0.05) drop(dying.splice(i, 1)[0]!);
    }
  }

  function steal(v: Voice, now: number): void {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    release(v, now);
  }

  function outFor(rev: number): { out: GainNode; send: GainNode | null } {
    const c = ac!;
    const ch = chain!;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(ch.dry);
    let send: GainNode | null = null;
    if (ch.wet && rev > 0) {
      send = c.createGain();
      send.gain.value = rev;
      out.connect(send);
      send.connect(ch.wet);
    }
    return { out, send };
  }

  function kit(out: GainNode, t: number, p: number, g: number, seed: number): Kit {
    return { ac: ac!, out, t, p, g, noise: chain!.noise, srcs: [], end: t, seed };
  }

  function play(name: SfxName, opt?: { k?: number; pitch?: number }): void {
    try {
      if (!live() || muted || paused) return;
      const spec = SPECS[name];
      const recipe = RECIPES[name];
      if (!spec || !recipe) return;
      const c = ac!;
      const now = c.currentTime;
      prune(now);
      const prev = last.get(name);
      if (prev !== undefined && now - prev < spec.gap && now >= prev) return;
      const g = clamp(opt?.k ?? 1, 0, 1);
      if (!(g > 0.001)) return;
      const raw = opt?.pitch ?? 1;
      const isOmen = name === 'omen';
      const p = isOmen ? 1 : clamp(Number.isFinite(raw) ? raw : 1, 0.25, 4);
      const arg = isOmen ? (Number.isFinite(raw) ? raw : 1) : p;

      const key = spec.group ?? name;
      const same = voices.filter((v) => v.key === key);
      while (same.length >= spec.max) steal(same.shift()!, now);
      if (voices.length >= maxVoices) {
        let victim: Voice | null = null;
        for (const v of voices) {
          if (v.prio > spec.prio) continue;
          if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.start < victim.start)) victim = v;
        }
        if (!victim) return;
        steal(victim, now);
      }

      const { out, send } = outFor(spec.rev);
      const t = now + 0.005;
      const k = kit(out, t, p, g, seq++);
      const pre = jingles.size ? jingles.get(preKey(name, p)) : undefined;
      if (pre) {
        // Pre-rendered at k = 1: the voice gain scales it (envelopes are linear in k below the 0..1 clamp).
        try {
          const src = c.createBufferSource();
          src.buffer = pre.buf;
          out.gain.value = g;
          src.connect(out);
          src.start(t);
          k.srcs.push(src);
          k.end = t + pre.dur;
        } catch (e) {
          halt(k.srcs);
          k.srcs.length = 0;
          report(e);
        }
      } else {
        try {
          recipe(k, arg);
        } catch (e) {
          halt(k.srcs);
          k.srcs.length = 0;
          report(e);
        }
      }
      if (!k.srcs.length) {
        try {
          out.disconnect();
          send?.disconnect();
        } catch {
          /* ignore */
        }
        return;
      }
      voices.push({ name, key, prio: spec.prio, start: t, end: k.end, out, send, srcs: k.srcs });
      last.set(name, now);
    } catch {
      /* never throw */
    }
  }

  /** Renders one jingle offline (graph built now, audio rendered off the main thread), then the next one. */
  function prerenderNext(queue: (readonly [SfxName, number])[]): void {
    if (disposed || !ac || !chain || !queue.length) return;
    const [name, pitch] = queue.shift()!;
    const recipe = RECIPES[name];
    const sr = ac.sampleRate;
    const maxS = name.startsWith('win') || name === 'level' ? PRERENDER_MAX_S : 1;
    let oc: OfflineAudioContext | null = null;
    try {
      oc = createOffline(1, Math.ceil(sr * maxS), sr);
    } catch {
      oc = null;
    }
    if (!oc || !recipe) return;
    const offline = oc;
    let k: Kit;
    try {
      const out = offline.createGain();
      out.gain.value = 1;
      out.connect(offline.destination);
      k = { ac: offline, out, t: 0, p: pitch, g: 1, noise: chain.noise, srcs: [], end: 0, seed: 0 };
      recipe(k, pitch);
    } catch (e) {
      report(e);
      onIdle(() => prerenderNext(queue));
      return;
    }
    const dur = Math.min(maxS, Math.max(0.05, k.end + 0.02));
    const done = (rendered: AudioBuffer): void => {
      try {
        if (disposed || !ac) return;
        const n = Math.min(rendered.length, Math.ceil(dur * sr));
        const b = ac.createBuffer(1, n, sr);
        b.getChannelData(0).set(rendered.getChannelData(0).subarray(0, n));
        jingles.set(preKey(name, pitch), { buf: b, dur });
      } catch (e) {
        report(e);
      }
      onIdle(() => prerenderNext(queue));
    };
    try {
      const r = offline.startRendering();
      if (r && typeof r.then === 'function') r.then(done, report);
      else (offline as unknown as { oncomplete: ((e: { renderedBuffer: AudioBuffer }) => void) | null }).oncomplete = (e) => done(e.renderedBuffer);
    } catch (e) {
      report(e);
    }
  }

  function startPrerender(): void {
    if (prerenderStarted || !doPrerender) return;
    prerenderStarted = true;
    const queue = [...PRERENDERED];
    onIdle(() => {
      // Loop buffers (reel clicks, heartbeat) are rendered in JS on first use: do that now as well.
      for (const [key, render] of Object.entries(LOOP_BUFFERS)) buf(key, render);
      prerenderNext(queue);
    });
  }

  function syncLoop(name: LoopName): void {
    const L = loops[name];
    try {
      const want = L.on && !muted && live();
      const c = ac;
      if (!c) return;
      const now = c.currentTime;
      if (want && !L.v) {
        const { out, send } = outFor(LOOP_GAIN_REV[name]);
        const k = kit(out, now + 0.005, 1, 1, seq++);
        try {
          L.v = makeLoop(name, k, L.pitch, buf);
        } catch (e) {
          L.v = null;
          halt(k.srcs);
          report(e);
        }
        L.out = out;
        L.send = send;
        if (!L.v) {
          out.disconnect();
          send?.disconnect();
          L.out = L.send = null;
        }
      } else if (want && L.v) {
        L.v.set(L.pitch, now);
      } else if (!want && L.v) {
        const v = L.v;
        const out = L.out;
        const send = L.send;
        L.v = null;
        L.out = L.send = null;
        v.stop(now);
        // disconnect after the fade (best effort; sources are already stopped by then)
        const tm = (globalThis as { setTimeout?: (f: () => void, ms: number) => unknown }).setTimeout;
        if (tm && out) {
          tm(() => {
            try {
              out.disconnect();
              send?.disconnect();
            } catch {
              /* ignore */
            }
          }, 1500);
        }
      }
    } catch {
      /* never throw */
    }
  }

  function loop(name: LoopName, on: boolean, opt?: { pitch?: number }): void {
    try {
      if (!live()) return;
      const L = loops[name];
      if (!L) return;
      L.on = !!on;
      const p = opt?.pitch;
      if (typeof p === 'number' && Number.isFinite(p)) L.pitch = p;
      syncLoop(name);
    } catch {
      /* never throw */
    }
  }

  function setMuted(m: boolean): void {
    try {
      muted = !!m;
      if (ac && chain) {
        const g = chain.master.gain;
        const now = ac.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(clamp(g.value, 0, MASTER_CAP), now);
        g.linearRampToValueAtTime(level(), now + 0.08);
        if (muted) for (const v of voices.splice(0)) release(v, now + 0.08);
      }
      for (const n of Object.keys(loops) as LoopName[]) syncLoop(n);
    } catch {
      /* never throw */
    }
  }

  function suspend(): void {
    paused = true;
    try {
      if (ac && ac.state !== 'closed') {
        const r = ac.suspend();
        if (r && typeof r.then === 'function') r.then(noop, noop);
      }
    } catch {
      /* ignore */
    }
  }

  function resume(): void {
    if (hidden()) return;
    paused = false;
    if (!unlocked) return;
    void kick();
  }

  function unlock(): Promise<void> {
    try {
      if (disposed || failed) return resolved();
      if (!ac) {
        let c: AudioContext | null = null;
        try {
          c = create();
        } catch {
          c = null;
        }
        if (!c) {
          failed = true;
          return resolved();
        }
        ac = c;
        chain = build(c);
      }
      unlocked = true;
      poke(ac);
      startPrerender();
      if (!hidden()) paused = false;
      return paused ? resolved() : kick();
    } catch {
      return resolved();
    }
  }

  const onVis = (): void => {
    if (hidden()) suspend();
    else resume();
  };
  const onPoke = (): void => {
    try {
      if (unlocked && !paused && ac && ac.state !== 'running' && ac.state !== 'closed') {
        poke(ac);
        void kick();
      }
    } catch {
      /* ignore */
    }
  };
  if (doc) {
    try {
      doc.addEventListener('visibilitychange', onVis);
      doc.addEventListener('pointerdown', onPoke, { capture: true, passive: true });
      doc.addEventListener('touchend', onPoke, { capture: true, passive: true });
    } catch {
      /* ignore */
    }
  }

  function dispose(): void {
    if (disposed) return;
    try {
      for (const n of Object.keys(loops) as LoopName[]) loops[n].on = false;
      for (const n of Object.keys(loops) as LoopName[]) syncLoop(n);
      if (ac) for (const v of voices.splice(0)) release(v, ac.currentTime);
    } catch {
      /* ignore */
    }
    disposed = true;
    try {
      if (doc) {
        doc.removeEventListener('visibilitychange', onVis);
        doc.removeEventListener('pointerdown', onPoke, { capture: true });
        doc.removeEventListener('touchend', onPoke, { capture: true });
      }
    } catch {
      /* ignore */
    }
    try {
      const r = ac?.close();
      if (r && typeof r.then === 'function') r.then(noop, noop);
    } catch {
      /* ignore */
    }
  }

  return {
    get unlocked() {
      return unlocked;
    },
    get muted() {
      return muted;
    },
    get voices() {
      return voices.length;
    },
    unlock,
    play,
    loop,
    setMuted,
    suspend,
    resume,
    dispose,
  };
}
