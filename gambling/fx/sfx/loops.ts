/**
 * Continuous voices. Each loop fades in from 0 (>= MIN_ATTACK), follows `set(pitch)` with short linear
 * ramps (no zipper noise), and fades out before its sources stop.
 */
import { clamp, filt, fq, hitEnv, midi, mix, modTo, noise, osc, MIN_ATTACK, type Kit } from './kit';

export type LoopName = 'ambient' | 'spin' | 'rise' | 'heartbeat';

export interface LoopVoice {
  set(pitch: number, t: number): void;
  stop(t: number): void;
}

/** Buffer cache keyed by name (per AudioContext). */
export type BufCache = (key: string, render: (ac: BaseAudioContext) => AudioBuffer) => AudioBuffer | null;

const FOREVER = 60 * 60 * 24;

/** Sustaining VCA: 0 -> peak over `a`, held until `release()`. */
function sustain(k: Kit, peak: number, a: number): { g: GainNode; release(t: number, r: number): void } {
  const g = k.ac.createGain();
  const p = clamp(peak * k.g, 0, 1);
  g.gain.value = 0;
  g.gain.setValueAtTime(0, k.t);
  g.gain.linearRampToValueAtTime(p, k.t + Math.max(MIN_ATTACK, a));
  g.connect(k.out);
  return {
    g,
    release(t, r) {
      const gp = g.gain;
      gp.cancelScheduledValues(t);
      gp.setValueAtTime(Math.min(p, Math.max(0, gp.value)), t);
      gp.linearRampToValueAtTime(0, t + Math.max(MIN_ATTACK, r));
    },
  };
}

/** Linear glide of a param to `v` starting at `t` (setValueAtTime + linearRamp). */
export function glideTo(prm: AudioParam, v: number, t: number, dur: number): void {
  prm.cancelScheduledValues(t);
  prm.setValueAtTime(prm.value, t);
  prm.linearRampToValueAtTime(v, t + dur);
}

function stopAll(k: Kit, t: number): void {
  for (const s of k.srcs) {
    try {
      s.stop(t);
    } catch {
      /* already stopped */
    }
  }
}

// ---------------------------------------------------------------- ambient

/** Warm detuned Cmaj7 pad (C2 G2 E3 B3) through a slowly breathing low-pass. */
function ambient(k: Kit, p0: number): LoopVoice {
  const v = sustain(k, 0.08, 2.5);
  const breath = mix(k, 0.85, v.g);
  const lfoA = osc(k, 'sine', 0.05, k.t, FOREVER, null);
  modTo(k, lfoA, 0.15, breath.gain);
  const lp = k.ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 480;
  lp.Q.value = 0.7;
  lp.connect(breath);
  const lfoF = osc(k, 'sine', 0.07, k.t, FOREVER, null);
  modTo(k, lfoF, 170, lp.frequency);
  const oscs: [OscillatorNode, number][] = [];
  for (const n of [36, 43, 52, 59]) {
    const f = midi(n);
    oscs.push([osc(k, 'sawtooth', f * p0, k.t, FOREVER, mix(k, 0.2, lp), -8), f]);
    oscs.push([osc(k, 'sawtooth', f * p0, k.t, FOREVER, mix(k, 0.2, lp), 8), f]);
    oscs.push([osc(k, 'triangle', f * p0, k.t, FOREVER, mix(k, 0.3, lp)), f]);
  }
  return {
    set(p, t) {
      for (const [o, f] of oscs) glideTo(o.frequency, fq(k, f * p), t, 0.6);
    },
    stop(t) {
      v.release(t, 1.0);
      stopAll(k, t + 1.05);
    },
  };
}

// ---------------------------------------------------------------- spin

/** One bar of reel-ratchet clicks (4 per 0.3 s at rate 1). */
function renderClicks(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate;
  const n = Math.floor(sr * 0.3);
  const b = ac.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const amps = [1, 0.7, 0.85, 0.7];
  let s = 0x1234567;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const j = Math.min(3, Math.floor(t / 0.075));
    const lt = t - j * 0.075;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const nz = (s / 4294967296) * 2 - 1;
    const e = hitEnv(lt, MIN_ATTACK, 0.016) * amps[j]!;
    d[i] = e * (0.55 * Math.sin(2 * Math.PI * 2300 * lt) + 0.25 * Math.sin(2 * Math.PI * 3700 * lt) + 0.3 * nz);
  }
  return b;
}

/** Reel spin: ratchet clicks + tonal whir + air whoosh; all three rise with `pitch` (= reel speed). */
function spin(k: Kit, p0: number, buf: BufCache): LoopVoice {
  const v = sustain(k, 0.24, 0.05);
  const t = k.t;
  const up = 0.35; // spin-up: start 35% lower and glide up
  const params: [AudioParam, number][] = [];
  const cb = buf('clicks', renderClicks);
  if (cb) {
    const s = k.ac.createBufferSource();
    s.buffer = cb;
    s.loop = true;
    s.connect(filt(k, 'bandpass', 2600, 0.9, mix(k, 0.9, v.g)));
    s.start(t);
    k.srcs.push(s);
    params.push([s.playbackRate, 1]);
  }
  const whir = osc(k, 'sawtooth', 85 * p0, t, FOREVER, filt(k, 'lowpass', 650, 1.5, mix(k, 0.3, v.g)));
  params.push([whir.frequency, 85]);
  const bp = filt(k, 'bandpass', 700 * p0, 1.2, mix(k, 0.35, v.g));
  noise(k, t, FOREVER, bp);
  params.push([bp.frequency, 700]);
  for (const [prm, base] of params) {
    const target = base === 1 ? clamp(p0, 0.25, 4) : fq(k, base * p0);
    prm.setValueAtTime(target * (1 - up), t);
    prm.linearRampToValueAtTime(target, t + 0.4);
  }
  return {
    set(p, at) {
      for (const [prm, base] of params) glideTo(prm, base === 1 ? clamp(p, 0.25, 4) : fq(k, base * p), at, 0.12);
    },
    stop(at) {
      v.release(at, 0.12);
      stopAll(k, at + 0.15);
    },
  };
}

// ---------------------------------------------------------------- rise (crash multiplier)

/** Multiplier -> tone frequency. 1x = 130 Hz, 2x ~ 178 Hz, 10x ~ 366 Hz, 100x ~ 1 kHz, capped 2 kHz. */
export function riseFreq(mult: number): number {
  const m = Math.max(1, Number.isFinite(mult) ? mult : 1);
  return Math.min(2000, 130 * Math.pow(m, 0.45));
}

/** Tremolo rate grows with the multiplier (4 Hz -> 14 Hz). */
export function riseRate(mult: number): number {
  const m = Math.max(1, Number.isFinite(mult) ? mult : 1);
  return Math.min(14, 4 + 3 * Math.log2(m));
}

/** Rising engine tone: detuned saws + sub square through a tracking low-pass with tremolo. */
function rise(k: Kit, m0: number): LoopVoice {
  const v = sustain(k, 0.2, 0.08);
  const trem = mix(k, 0.75, v.g);
  const lp = k.ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.connect(trem);
  const f0 = riseFreq(m0);
  lp.frequency.value = Math.min(9000, f0 * 4);
  const t = k.t;
  const a = osc(k, 'sawtooth', f0, t, FOREVER, mix(k, 0.4, lp), -9);
  const b = osc(k, 'sawtooth', f0, t, FOREVER, mix(k, 0.4, lp), 9);
  const c = osc(k, 'square', f0 / 2, t, FOREVER, mix(k, 0.25, lp));
  const lfo = osc(k, 'sine', riseRate(m0), t, FOREVER, null);
  modTo(k, lfo, 0.25, trem.gain);
  return {
    set(m, at) {
      const f = riseFreq(m);
      glideTo(a.frequency, f, at, 0.1);
      glideTo(b.frequency, f, at, 0.1);
      glideTo(c.frequency, f / 2, at, 0.1);
      glideTo(lp.frequency, Math.min(9000, f * 4), at, 0.1);
      glideTo(lfo.frequency, riseRate(m), at, 0.1);
    },
    stop(at) {
      v.release(at, 0.06);
      stopAll(k, at + 0.08);
    },
  };
}

// ---------------------------------------------------------------- heartbeat

/** One lub-dub cycle (0.8 s = 75 bpm at rate 1), with 2nd/3rd harmonics so small speakers carry it. */
function renderBeat(ac: BaseAudioContext): AudioBuffer {
  const sr = ac.sampleRate;
  const n = Math.floor(sr * 0.8);
  const b = ac.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const beats: readonly [number, number, number][] = [[0, 1, 62], [0.27, 0.7, 54]];
  for (const [t0, amp, f0] of beats) {
    let ph = 0;
    const i0 = Math.floor(t0 * sr);
    const len = Math.floor(0.25 * sr);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const t = i / sr;
      const f = f0 * (0.65 + 0.35 * Math.exp(-t / 0.05));
      ph += (2 * Math.PI * f) / sr;
      const e = hitEnv(t, 0.012, 0.07) * amp;
      d[i0 + i] = (d[i0 + i] ?? 0) + e * (0.7 * Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph));
    }
  }
  return b;
}

/** Heartbeat: `pitch` scales tempo (and pitch) together; 1 = 75 bpm. */
function heartbeat(k: Kit, p0: number, buf: BufCache): LoopVoice {
  const v = sustain(k, 0.55, 0.05);
  const bb = buf('beat', renderBeat);
  let s: AudioBufferSourceNode | null = null;
  if (bb) {
    s = k.ac.createBufferSource();
    s.buffer = bb;
    s.loop = true;
    s.playbackRate.value = clamp(p0, 0.5, 2);
    s.connect(filt(k, 'lowpass', 420, 0.7, v.g));
    s.start(k.t);
    k.srcs.push(s);
  }
  return {
    set(p, at) {
      if (s) glideTo(s.playbackRate, clamp(p, 0.5, 2), at, 0.3);
    },
    stop(at) {
      v.release(at, 0.25);
      stopAll(k, at + 0.3);
    },
  };
}

export function makeLoop(name: LoopName, k: Kit, pitch: number, buf: BufCache): LoopVoice | null {
  switch (name) {
    case 'ambient':
      return ambient(k, clamp(pitch, 0.5, 2));
    case 'spin':
      return spin(k, clamp(pitch, 0.25, 4), buf);
    case 'rise':
      return rise(k, pitch);
    case 'heartbeat':
      return heartbeat(k, pitch, buf);
    default:
      return null;
  }
}
