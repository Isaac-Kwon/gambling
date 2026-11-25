import { describe, expect, it, vi } from 'vitest';
import { createSfx, MASTER_CAP, MAX_VOICES, PRERENDERED, SPECS, type SfxDoc } from './sfx';
import { riseFreq } from './sfx/loops';
import { MIN_ATTACK } from './sfx/kit';
import type { SfxName } from './types';

// ---------------------------------------------------------------- minimal fake Web Audio

type Ev = { m: string; v: number; t: number };
type Target = FakeNode | FakeParam;

class FakeParam {
  readonly isParam = true;
  events: Ev[] = [];
  private _v: number;
  constructor(v: number) {
    this._v = v;
  }
  get value(): number {
    return this._v;
  }
  set value(v: number) {
    this._v = v;
  }
  setValueAtTime(v: number, t: number) { this.events.push({ m: 'set', v, t }); this._v = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ m: 'lin', v, t }); this._v = v; return this; }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!(v > 0)) throw new RangeError('exp ramp needs > 0');
    this.events.push({ m: 'exp', v, t }); this._v = v; return this;
  }
  setTargetAtTime(v: number, t: number) { this.events.push({ m: 'target', v, t }); return this; }
  cancelScheduledValues(t: number) { this.events.push({ m: 'cancel', v: NaN, t }); return this; }
}

class FakeNode {
  out: Target[] = [];
  constructor(readonly ctx: FakeCtx, readonly kind: string) {
    ctx.nodes.push(this);
  }
  connect<T extends Target>(x: T): T { this.out.push(x); return x; }
  disconnect() { this.out = []; }
}
class FakeGain extends FakeNode { gain = new FakeParam(1); constructor(c: FakeCtx) { super(c, 'gain'); } }
class FakeSrc extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  start(t = 0) { if (this.startAt !== null) throw new Error('double start'); this.startAt = t; }
  stop(t = 0) { if (this.startAt === null) throw new Error('stop before start'); this.stopAt = t; }
}
class FakeOsc extends FakeSrc { type = 'sine'; frequency = new FakeParam(440); detune = new FakeParam(0); constructor(c: FakeCtx) { super(c, 'osc'); } }
class FakeBufSrc extends FakeSrc {
  buffer: unknown = null; loop = false; playbackRate = new FakeParam(1);
  constructor(c: FakeCtx) { super(c, 'bufsrc'); }
}
class FakeBiquad extends FakeNode { type = 'lowpass'; frequency = new FakeParam(350); Q = new FakeParam(1); gain = new FakeParam(0); constructor(c: FakeCtx) { super(c, 'biquad'); } }
class FakeComp extends FakeNode {
  threshold = new FakeParam(-24); knee = new FakeParam(30); ratio = new FakeParam(12); attack = new FakeParam(0.003); release = new FakeParam(0.25);
  constructor(c: FakeCtx) { super(c, 'comp'); }
}
class FakeConv extends FakeNode { buffer: unknown = null; constructor(c: FakeCtx) { super(c, 'conv'); } }

class FakeCtx {
  nodes: FakeNode[] = [];
  currentTime = 0;
  sampleRate = 8000; // small so buffer rendering is cheap
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  calls = { resume: 0, suspend: 0, close: 0 };
  destination: FakeNode;
  constructor() {
    this.destination = new FakeNode(this, 'dest');
  }
  resume() { this.calls.resume++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.calls.suspend++; this.state = 'suspended'; return Promise.resolve(); }
  close() { this.calls.close++; this.state = 'closed'; return Promise.resolve(); }
  createGain() { return new FakeGain(this); }
  createOscillator() { return new FakeOsc(this); }
  createBufferSource() { return new FakeBufSrc(this); }
  createBiquadFilter() { return new FakeBiquad(this); }
  createDynamicsCompressor() { return new FakeComp(this); }
  createConvolver() { return new FakeConv(this); }
  createBuffer(ch: number, len: number, sr: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i: number) => data[i]! };
  }
}

function setup(o: { doc?: SfxDoc | null; maxVoices?: number } = {}) {
  const ctx = new FakeCtx();
  const create = vi.fn(() => ctx as unknown as AudioContext);
  const errors: unknown[] = [];
  const sfx = createSfx({ createContext: create, doc: o.doc ?? null, maxVoices: o.maxVoices, onError: (e) => errors.push(e) });
  return { ctx, create, sfx, errors };
}

const isParam = (x: Target): x is FakeParam => (x as FakeParam).isParam === true;
const sources = (nodes: FakeNode[]) => nodes.filter((n): n is FakeSrc => n instanceof FakeSrc);

/** Envelope gain: first event sets exactly 0 and the next one ramps up over >= MIN_ATTACK. */
function isEnvelope(n: FakeNode): boolean {
  if (!(n instanceof FakeGain)) return false;
  const ev = n.gain.events;
  if (ev.length < 2) return false;
  const [a, b] = [ev[0]!, ev[1]!];
  return a.m === 'set' && a.v === 0 && b.m === 'lin' && b.t - a.t >= MIN_ATTACK - 1e-9;
}

/** Every audio path from `src` to the pre-existing graph must pass through an envelope gain. */
function pathsSafe(src: FakeNode, isNew: (n: FakeNode) => boolean): boolean {
  const walk = (n: FakeNode, depth: number): boolean => {
    if (depth > 40) return false;
    for (const t of n.out) {
      if (isParam(t)) continue; // modulation, not an audio path
      if (isEnvelope(t)) continue;
      if (!isNew(t)) return false; // reached master chain without an envelope
      if (!walk(t, depth + 1)) return false;
    }
    return true;
  };
  return walk(src, 0);
}

const ONE_SHOTS: SfxName[] = ['tap', 'stop', 'tick', 'coin', 'chip', 'card', 'win0', 'win1', 'win2', 'win3', 'win4', 'omen', 'ticket', 'level'];

// ---------------------------------------------------------------- tests

describe('sfx: lazy unlock', () => {
  it('creates no context and does nothing before unlock', () => {
    const { create, sfx, ctx } = setup();
    for (const n of ONE_SHOTS) sfx.play(n);
    sfx.loop('ambient', true);
    sfx.loop('spin', true, { pitch: 2 });
    sfx.setMuted(false);
    sfx.suspend();
    sfx.resume();
    expect(create).not.toHaveBeenCalled();
    expect(sfx.unlocked).toBe(false);
    expect(ctx.nodes.length).toBe(1); // only the fake destination
  });

  it('unlock creates once, resumes synchronously and plays a silent buffer', async () => {
    const { create, sfx, ctx } = setup();
    const p = sfx.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(ctx.calls.resume).toBe(1); // called synchronously inside the gesture
    const silent = ctx.nodes.find((n) => n instanceof FakeBufSrc && n.out.includes(ctx.destination)) as FakeBufSrc | undefined;
    expect(silent?.startAt).toBe(0);
    await expect(p).resolves.toBeUndefined();
    expect(ctx.state).toBe('running');
    expect(sfx.unlocked).toBe(true);
    await sfx.unlock();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('unlock re-resumes when the context was suspended again (iOS re-lock)', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    ctx.state = 'suspended';
    await sfx.unlock();
    expect(ctx.calls.resume).toBe(2);
    expect(ctx.state).toBe('running');
  });
});

describe('sfx: levels and envelopes', () => {
  function masterOf(ctx: FakeCtx): FakeGain {
    const m = ctx.nodes.find((n) => n instanceof FakeGain && n.out.includes(ctx.destination));
    expect(m).toBeTruthy();
    return m as FakeGain;
  }

  it('master gain never exceeds the cap and fades in from 0', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    const m = masterOf(ctx);
    expect(m.gain.events[0]).toEqual({ m: 'set', v: 0, t: 0 });
    for (const n of ONE_SHOTS) sfx.play(n, { k: 1 });
    for (let i = 0; i < 5; i++) {
      ctx.currentTime += 0.5;
      sfx.setMuted(i % 2 === 0);
    }
    sfx.setMuted(false);
    const vals = m.gain.events.filter((e) => e.m !== 'cancel').map((e) => e.v);
    expect(Math.max(...vals, m.gain.value)).toBeLessThanOrEqual(MASTER_CAP);
    expect(vals).toContain(MASTER_CAP);
    expect(MASTER_CAP).toBeLessThanOrEqual(0.5);
    // a limiter sits right before the master gain
    const lim = ctx.nodes.find((n) => n instanceof FakeComp && n.out.includes(m));
    expect(lim).toBeTruthy();
  });

  it.each(ONE_SHOTS)('%s: every source is gated by a 0-start envelope, peaks <= k', async (name) => {
    const { sfx, ctx, errors } = setup();
    await sfx.unlock();
    const before = new Set(ctx.nodes);
    const isNew = (n: FakeNode) => !before.has(n);
    const k = 0.3;
    if (name === 'omen') for (const g of [1, 2, 3]) { sfx.play('omen', { k, pitch: g }); ctx.currentTime += 5; }
    else sfx.play(name, { k, pitch: 1.2 });
    expect(errors).toEqual([]);
    const fresh = ctx.nodes.filter(isNew);
    const srcs = sources(fresh);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) {
      expect(s.startAt).not.toBeNull();
      expect(s.stopAt).not.toBeNull();
      expect(pathsSafe(s, isNew)).toBe(true);
    }
    const envs = fresh.filter((n) => isEnvelope(n) && n.out.some((t) => !isParam(t))) as FakeGain[];
    expect(envs.length).toBeGreaterThan(0);
    for (const e of envs) {
      const peak = Math.max(...e.gain.events.filter((x) => x.m !== 'cancel').map((x) => x.v));
      expect(peak).toBeLessThanOrEqual(k + 1e-9);
      expect(e.gain.events.at(-1)!.v).toBe(0); // ends silent
    }
  });

  it.each(['ambient', 'spin', 'rise', 'heartbeat'] as const)('loop %s fades in from 0 and fades out on stop', async (name) => {
    const { sfx, ctx, errors } = setup();
    await sfx.unlock();
    const before = new Set(ctx.nodes);
    const isNew = (n: FakeNode) => !before.has(n);
    sfx.loop(name, true, { pitch: 1 });
    expect(errors).toEqual([]);
    const fresh = ctx.nodes.filter(isNew);
    const srcs = sources(fresh);
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) expect(pathsSafe(s, isNew)).toBe(true);
    const envs = fresh.filter((n) => isEnvelope(n) && n.out.some((t) => !isParam(t))) as FakeGain[];
    expect(envs.length).toBe(1);
    const env = envs[0]!;
    expect(Math.max(...env.gain.events.map((e) => e.v).filter((v) => !Number.isNaN(v)))).toBeLessThanOrEqual(1);
    ctx.currentTime += 2;
    sfx.loop(name, false);
    const last = env.gain.events.at(-1)!;
    expect(last).toMatchObject({ m: 'lin', v: 0 });
    expect(last.t - ctx.currentTime).toBeGreaterThanOrEqual(MIN_ATTACK);
    for (const s of srcs) expect(s.stopAt).toBeGreaterThanOrEqual(last.t);
  });
});

describe('sfx: voice limiting', () => {
  it('caps concurrent voices globally and per sound', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    for (let i = 0; i < 60; i++) {
      sfx.play('coin');
      ctx.currentTime += 0.031;
      expect(sfx.voices).toBeLessThanOrEqual(SPECS.coin.max);
    }
    for (let i = 0; i < 200; i++) {
      sfx.play(ONE_SHOTS[i % ONE_SHOTS.length]!, { pitch: 2 });
      ctx.currentTime += 0.011;
      expect(sfx.voices).toBeLessThanOrEqual(MAX_VOICES);
    }
  });

  it('throttles count-up ticks', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    const n0 = sources(ctx.nodes).length;
    for (let i = 0; i < 100; i++) sfx.play('tick');
    const per = sources(ctx.nodes).length - n0;
    expect(per).toBeGreaterThan(0);
    // 100 calls in the same instant start exactly one tick
    for (let i = 0; i < 100; i++) sfx.play('tick');
    expect(sources(ctx.nodes).length - n0).toBe(per);
    // ~1 s of 60 fps calls starts at most 1 / gap ticks
    for (let i = 0; i < 60; i++) { ctx.currentTime += 1 / 60; sfx.play('tick'); }
    const started = (sources(ctx.nodes).length - n0) / per;
    expect(started).toBeLessThanOrEqual(Math.ceil(1 / SPECS.tick.gap) + 1);
  });

  it('a new tier jingle replaces the running one with a fade', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    const before = new Set(ctx.nodes);
    sfx.play('win3');
    const first = sources(ctx.nodes.filter((n) => !before.has(n)));
    ctx.currentTime += 0.5;
    sfx.play('win4');
    expect(sfx.voices).toBe(1);
    for (const s of first) expect(s.stopAt).toBeLessThanOrEqual(ctx.currentTime + 0.05);
  });

  it('a low-priority voice cannot steal from a full set of high-priority ones', async () => {
    const { sfx, ctx } = setup({ maxVoices: 2 });
    await sfx.unlock();
    sfx.play('win2');
    ctx.currentTime += 0.3;
    sfx.play('omen', { pitch: 3 });
    expect(sfx.voices).toBe(2);
    const n = ctx.nodes.length;
    ctx.currentTime += 0.1;
    sfx.play('tick');
    expect(ctx.nodes.length).toBe(n);
  });
});

describe('sfx: parameters, mute, visibility', () => {
  it('rise loop follows the multiplier with setValueAtTime + linearRamp', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    const before = new Set(ctx.nodes);
    sfx.loop('rise', true, { pitch: 1 });
    const oscs = ctx.nodes.filter((n) => !before.has(n) && n instanceof FakeOsc) as FakeOsc[];
    ctx.currentTime = 1;
    sfx.loop('rise', true, { pitch: 10 });
    const target = riseFreq(10);
    const hit = oscs.some((o) => {
      const ev = o.frequency.events;
      const i = ev.findIndex((e) => e.m === 'lin' && Math.abs(e.v - target) < 1e-6);
      return i > 0 && ev[i - 1]!.m === 'set' && ev[i - 1]!.t === 1;
    });
    expect(hit).toBe(true);
    expect(riseFreq(2)).toBeGreaterThan(riseFreq(1));
    expect(riseFreq(1e9)).toBeLessThanOrEqual(2000);
  });

  it('spin pitch rises with speed', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    sfx.loop('spin', true, { pitch: 1 });
    const src = ctx.nodes.find((n) => n instanceof FakeBufSrc && n.loop) as FakeBufSrc;
    expect(src).toBeTruthy();
    ctx.currentTime = 1;
    sfx.loop('spin', true, { pitch: 1.6 });
    expect(src.playbackRate.events.at(-1)).toMatchObject({ m: 'lin', v: 1.6 });
  });

  it('mute ramps master to 0, silences play and stops loops; unmute restarts them', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    sfx.loop('ambient', true);
    const loopSrcs = sources(ctx.nodes).filter((s) => s.stopAt !== null && s.stopAt > 1e4);
    expect(loopSrcs.length).toBeGreaterThan(0);
    ctx.currentTime = 1;
    sfx.setMuted(true);
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.out.includes(ctx.destination)) as FakeGain;
    expect(master.gain.events.at(-1)).toMatchObject({ m: 'lin', v: 0 });
    for (const s of loopSrcs) expect(s.stopAt).toBeLessThan(10);
    const n = ctx.nodes.length;
    sfx.play('win4');
    expect(ctx.nodes.length).toBe(n);
    sfx.setMuted(false);
    expect(ctx.nodes.length).toBeGreaterThan(n); // ambient restarted
    expect(master.gain.events.at(-1)).toMatchObject({ m: 'lin', v: MASTER_CAP });
  });

  it('mute set before unlock is honoured at unlock', async () => {
    const { sfx, ctx } = setup();
    sfx.setMuted(true);
    await sfx.unlock();
    const master = ctx.nodes.find((n) => n instanceof FakeGain && n.out.includes(ctx.destination)) as FakeGain;
    expect(Math.max(...master.gain.events.map((e) => e.v))).toBe(0);
  });

  it('visibilitychange hidden suspends, visible resumes', async () => {
    const ls = new Map<string, () => void>();
    const doc = {
      visibilityState: 'visible',
      addEventListener: (t: string, f: () => void) => void ls.set(t, f),
      removeEventListener: (t: string) => void ls.delete(t),
    };
    const { sfx, ctx } = setup({ doc });
    ls.get('visibilitychange')!(); // before unlock: harmless
    await sfx.unlock();
    doc.visibilityState = 'hidden';
    ls.get('visibilitychange')!();
    expect(ctx.calls.suspend).toBe(1);
    expect(ctx.state).toBe('suspended');
    const n = ctx.nodes.length;
    sfx.play('coin');
    expect(ctx.nodes.length).toBe(n); // no scheduling while backgrounded
    sfx.resume(); // still hidden: ignored
    expect(ctx.state).toBe('suspended');
    doc.visibilityState = 'visible';
    ls.get('visibilitychange')!();
    expect(ctx.state).toBe('running');
    // iOS re-lock: next pointerdown resumes
    ctx.state = 'suspended';
    ls.get('pointerdown')!();
    expect(ctx.state).toBe('running');
    sfx.dispose();
    expect(ls.size).toBe(0);
    expect(ctx.calls.close).toBe(1);
  });

  it('explicit suspend()/resume() (fx background hooks)', async () => {
    const { sfx, ctx } = setup();
    await sfx.unlock();
    sfx.suspend();
    sfx.suspend();
    expect(ctx.state).toBe('suspended');
    sfx.resume();
    expect(ctx.state).toBe('running');
  });
});

describe('sfx: never throws', () => {
  const exercise = async (sfx: ReturnType<typeof createSfx>) => {
    await expect(sfx.unlock()).resolves.toBeUndefined();
    for (const n of ONE_SHOTS) sfx.play(n, { k: 2, pitch: NaN });
    sfx.play('bogus' as SfxName);
    sfx.loop('rise', true, { pitch: Infinity });
    sfx.loop('nope' as 'rise', true);
    sfx.setMuted(true);
    sfx.setMuted(false);
    sfx.suspend();
    sfx.resume();
    sfx.dispose();
    sfx.dispose();
    await expect(sfx.unlock()).resolves.toBeUndefined();
  };

  it('when AudioContext is missing (node default)', async () => {
    const sfx = createSfx({ doc: null });
    await exercise(sfx);
    expect(sfx.unlocked).toBe(false);
  });

  it('when the constructor throws (and does not retry)', async () => {
    const create = vi.fn(() => { throw new Error('no audio'); });
    const sfx = createSfx({ createContext: create, doc: null });
    await exercise(sfx);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('when resume rejects (iOS silent / blocked)', async () => {
    const ctx = new FakeCtx();
    ctx.resume = () => { ctx.calls.resume++; return Promise.reject(new Error('NotAllowed')); };
    await exercise(createSfx({ createContext: () => ctx as unknown as AudioContext, doc: null }));
  });

  it('when node factories throw', async () => {
    const ctx = new FakeCtx();
    let calls = 0;
    const orig = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { if (++calls % 3 === 0) throw new Error('boom'); return orig(); };
    ctx.createConvolver = () => { throw new Error('nope'); };
    ctx.createDynamicsCompressor = () => { throw new Error('nope'); };
    await exercise(createSfx({ createContext: () => ctx as unknown as AudioContext, doc: null }));
  });

  it('a loop that fails half-built stops the sources it already started', async () => {
    const ctx = new FakeCtx();
    const errors: unknown[] = [];
    const sfx = createSfx({ createContext: () => ctx as unknown as AudioContext, doc: null, onError: (e) => errors.push(e) });
    await sfx.unlock();
    const before = new Set(ctx.nodes);
    let n = 0;
    const orig = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = () => { if (++n === 5) throw new Error('boom'); return orig(); };
    sfx.loop('ambient', true);
    expect(errors).toHaveLength(1);
    const started = sources(ctx.nodes.filter((x) => !before.has(x)));
    expect(started.length).toBeGreaterThan(0);
    for (const s of started) expect(s.stopAt).toBe(0);
  });

  it('when every method of the context throws', async () => {
    const bad = new Proxy({}, { get: () => { throw new Error('dead'); } });
    await exercise(createSfx({ createContext: () => bad as AudioContext, doc: null }));
  });
});

describe('sfx: pre-rendered sounds', () => {
  /** Offline context on the fake graph: rendering resolves with a buffer of the requested length. */
  class FakeOffline extends FakeCtx {
    constructor(readonly len: number, sr: number) { super(); this.sampleRate = sr; }
    startRendering() { return Promise.resolve(this.createBuffer(1, this.len, this.sampleRate)); }
  }
  const flush = async (until: () => boolean, maxMs = 4000) => {
    for (let t = 0; t < maxMs && !until(); t += 20) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
  };

  it('jingles and the spin / celebration one-shots become single buffer sources after idle pre-rendering', async () => {
    const ctx = new FakeCtx();
    const offline: FakeOffline[] = [];
    const sfx = createSfx({
      createContext: () => ctx as unknown as AudioContext, doc: null, prerender: true,
      createOffline: (_c, len, sr) => { const o = new FakeOffline(len, sr); offline.push(o); return o as unknown as OfflineAudioContext; },
    });
    await sfx.unlock();
    await flush(() => offline.length >= PRERENDERED.length);
    expect(offline.length).toBe(PRERENDERED.length);
    for (const [name, pitch] of PRERENDERED) {
      const before = new Set(ctx.nodes);
      ctx.currentTime += 1;
      sfx.play(name, { k: 0.5, pitch });
      const added = ctx.nodes.filter((n) => !before.has(n));
      const srcs = sources(added);
      expect(srcs, `${name}@${pitch}`).toHaveLength(1);
      expect(srcs[0]).toBeInstanceOf(FakeBufSrc);
      expect((srcs[0] as FakeBufSrc).buffer).not.toBeNull();
    }
    // Another pitch is still synthesized live.
    const before = new Set(ctx.nodes);
    ctx.currentTime += 1;
    sfx.play('stop', { pitch: 1.5 });
    expect(sources(ctx.nodes.filter((n) => !before.has(n))).length).toBeGreaterThan(1);
  });

  it('is off by default when a context factory is injected, and never throws without OfflineAudioContext', async () => {
    const ctx = new FakeCtx();
    const sfx = createSfx({ createContext: () => ctx as unknown as AudioContext, doc: null });
    await sfx.unlock();
    await flush(() => false, 200);
    const before = new Set(ctx.nodes);
    sfx.play('win3');
    expect(sources(ctx.nodes.filter((n) => !before.has(n))).length).toBeGreaterThan(5);
    const sfx2 = createSfx({ createContext: () => new FakeCtx() as unknown as AudioContext, doc: null, prerender: true, createOffline: () => { throw new Error('no offline'); } });
    await sfx2.unlock();
    await flush(() => false, 200);
    sfx2.play('win3');
  });
});