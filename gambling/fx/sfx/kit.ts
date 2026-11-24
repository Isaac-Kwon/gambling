/**
 * Synthesis primitives shared by one-shot voices and loops. Everything is built from Web Audio nodes
 * (no samples, no network). Click-safety rule: every audible source reaches the voice output only
 * through at least one `env()` gain, which always starts at 0 and rises over >= MIN_ATTACK seconds.
 */

export const MIN_ATTACK = 0.01;

/** Build context for a single voice. `p` = pitch multiplier, `g` = gain multiplier (0..1). */
export interface Kit {
  readonly ac: BaseAudioContext;
  readonly out: AudioNode;
  readonly t: number;
  readonly p: number;
  readonly g: number;
  readonly noise: AudioBuffer | null;
  readonly srcs: AudioScheduledSourceNode[];
  /** Latest time any part of the voice is still sounding. Grows as parts are scheduled. */
  end: number;
  /** Deterministic per-voice variation seed. */
  readonly seed: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Pitch-scaled, Nyquist-safe frequency. */
export function fq(k: Kit, f: number): number {
  return clamp(f * k.p, 0.01, k.ac.sampleRate * 0.45);
}

/** Small deterministic variation in [1 - amt, 1 + amt] derived from the voice seed and a salt. */
export function vary(k: Kit, amt: number, salt = 0): number {
  let h = (k.seed * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return 1 + amt * ((h % 10007) / 10007 * 2 - 1);
}

/**
 * Amplitude envelope (VCA). Starts at exactly 0, linear attack (>= MIN_ATTACK), optional hold,
 * exponential release, then a short linear tail to 0. Peak is `peak * k.g`, clamped to [0, 1].
 */
export function env(k: Kit, at: number, peak: number, a: number, hold: number, rel: number, dest: AudioNode = k.out): GainNode {
  const g = k.ac.createGain();
  const p = clamp(peak * k.g, 0, 1);
  const atk = Math.max(MIN_ATTACK, a);
  const h = Math.max(0, hold);
  const r = Math.max(0.01, rel);
  const gp = g.gain;
  gp.value = 0;
  gp.setValueAtTime(0, at);
  gp.linearRampToValueAtTime(p, at + atk);
  if (h > 0) gp.setValueAtTime(p, at + atk + h);
  gp.exponentialRampToValueAtTime(Math.max(1e-4, p * 1e-3), at + atk + h + r);
  gp.linearRampToValueAtTime(0, at + atk + h + r + 0.02);
  g.connect(dest);
  k.end = Math.max(k.end, at + atk + h + r + 0.03);
  return g;
}

/** Oscillator started at `at` for `dur` s. `dest` null = modulator only (caller connects it to a param). */
export function osc(k: Kit, type: OscillatorType, f: number, at: number, dur: number, dest: AudioNode | null, detune = 0): OscillatorNode {
  const o = k.ac.createOscillator();
  o.type = type;
  o.frequency.value = fq(k, f);
  if (detune) o.detune.value = detune;
  if (dest) o.connect(dest);
  o.start(at);
  o.stop(at + dur);
  k.srcs.push(o);
  k.end = Math.max(k.end, at + dur);
  return o;
}

/** Looped white-noise source (offset varied per voice so repeated hits differ). Null when no buffer. */
export function noise(k: Kit, at: number, dur: number, dest: AudioNode, rate = 1): AudioBufferSourceNode | null {
  if (!k.noise) return null;
  const s = k.ac.createBufferSource();
  s.buffer = k.noise;
  s.loop = true;
  s.playbackRate.value = rate;
  s.connect(dest);
  const off = (vary(k, 0.5, 7) - 0.5) * k.noise.duration;
  s.start(at, clamp(off, 0, Math.max(0, k.noise.duration - 0.01)));
  s.stop(at + dur);
  k.srcs.push(s);
  k.end = Math.max(k.end, at + dur);
  return s;
}

export function filt(k: Kit, type: BiquadFilterType, f: number, q: number, dest: AudioNode): BiquadFilterNode {
  const b = k.ac.createBiquadFilter();
  b.type = type;
  b.frequency.value = fq(k, f);
  b.Q.value = q;
  b.connect(dest);
  return b;
}

/** Frequency sweep on a param (values already in Hz; exponential needs positive values). */
export function sweep(prm: AudioParam, from: number, to: number, at: number, dur: number): void {
  prm.setValueAtTime(from, at);
  prm.exponentialRampToValueAtTime(Math.max(1, to), at + Math.max(0.005, dur));
}

/** Static mixing gain (not an envelope). Callers must place an `env()` somewhere on the path. */
export function mix(k: Kit, v: number, dest: AudioNode): GainNode {
  const g = k.ac.createGain();
  g.gain.value = v;
  g.connect(dest);
  return g;
}

/** Modulator depth gain feeding an AudioParam (FM index, LFO depth). */
export function modTo(k: Kit, src: AudioNode, depth: number, target: AudioParam): GainNode {
  const g = k.ac.createGain();
  g.gain.value = depth;
  src.connect(g);
  g.connect(target);
  return g;
}

// ---------------------------------------------------------------- instruments

/**
 * FM bell with an additive octave partial and a short bright "ping". `ratio` 3.5 = glassy casino bell,
 * 1.4 = softer metallic, 2 = warm electric piano.
 */
export function bell(k: Kit, f: number, at: number, dur: number, peak: number, o: { ratio?: number; index?: number; dest?: AudioNode } = {}): void {
  const dest = o.dest ?? k.out;
  const ratio = o.ratio ?? 3.5;
  const index = o.index ?? 1.6;
  const car = osc(k, 'sine', f, at, dur + 0.05, env(k, at, peak, 0.01, 0, dur, dest));
  const mod = osc(k, 'sine', f * ratio, at, dur + 0.05, null);
  const mg = modTo(k, mod, fq(k, f) * index, car.frequency);
  mg.gain.setValueAtTime(fq(k, f) * index, at);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, fq(k, f) * index * 0.06), at + dur * 0.7);
  osc(k, 'sine', f * 2, at, dur * 0.45 + 0.05, env(k, at, peak * 0.22, 0.01, 0, dur * 0.4, dest));
  osc(k, 'triangle', f * 4, at, 0.12, env(k, at, peak * 0.1, 0.01, 0, 0.07, dest));
}

/** Brass-like stab: two detuned saws + sub square through an enveloped low-pass, delayed vibrato. */
export function brass(k: Kit, f: number, at: number, dur: number, peak: number, dest: AudioNode = k.out): void {
  const rel = 0.22;
  const hold = Math.max(0, dur - 0.04 - rel);
  const v = env(k, at, peak, 0.035, hold, rel, dest);
  const lp = k.ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.connect(v);
  const base = fq(k, f);
  const top = clamp(base * 7, 800, 7000);
  lp.frequency.setValueAtTime(base * 1.3, at);
  lp.frequency.linearRampToValueAtTime(top, at + 0.06);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, base * 3), at + 0.3);
  const len = dur + 0.05;
  const a = osc(k, 'sawtooth', f, at, len, mix(k, 0.45, lp), -7);
  const b = osc(k, 'sawtooth', f, at, len, mix(k, 0.45, lp), 7);
  osc(k, 'square', f / 2, at, len, mix(k, 0.18, lp));
  if (dur > 0.25) {
    const lfo = osc(k, 'sine', 5.5 / k.p, at, len, null);
    const d = k.ac.createGain();
    d.gain.setValueAtTime(0, at);
    d.gain.linearRampToValueAtTime(9, at + 0.35);
    lfo.connect(d);
    d.connect(a.detune);
    d.connect(b.detune);
  }
}

/** Round synth bass pluck (sine + filtered saw), audible on phone speakers through its harmonics. */
export function bass(k: Kit, f: number, at: number, dur: number, peak: number, dest: AudioNode = k.out): void {
  osc(k, 'sine', f, at, dur + 0.05, env(k, at, peak, 0.012, 0.02, dur, dest));
  const lp = filt(k, 'lowpass', f * 5, 2, env(k, at, peak * 0.5, 0.012, 0, dur * 0.6, dest));
  osc(k, 'sawtooth', f, at, dur + 0.05, lp);
}

/** Timpani/sub boom with a mid "knock" layer so it reads on small speakers. */
export function boom(k: Kit, at: number, peak: number, f = 62, dur = 0.8, dest: AudioNode = k.out): void {
  const s = osc(k, 'sine', f, at, dur + 0.05, env(k, at, peak, 0.012, 0.03, dur, dest));
  sweep(s.frequency, fq(k, f * 1.6), fq(k, f * 0.75), at, dur * 0.6);
  const t2 = osc(k, 'triangle', f * 2, at, dur * 0.5, env(k, at, peak * 0.45, 0.012, 0, dur * 0.35, dest));
  sweep(t2.frequency, fq(k, f * 3), fq(k, f * 1.5), at, dur * 0.3);
  noise(k, at, 0.12, filt(k, 'lowpass', 900, 0.7, env(k, at, peak * 0.35, 0.01, 0, 0.08, dest)));
}

/** Crash cymbal (or reverse swell into a downbeat when `swell`). */
export function cymbal(k: Kit, at: number, peak: number, dur: number, swell = false, dest: AudioNode = k.out): void {
  const v = swell ? env(k, at, peak, dur, 0, 0.12, dest) : env(k, at, peak, 0.01, 0, dur, dest);
  const hp = filt(k, 'highpass', 5200, 0.6, v);
  const pk = filt(k, 'peaking', 8500, 1, hp);
  pk.gain.value = 5;
  noise(k, at, dur + 0.2, pk);
}

/** Descending (or ascending) cascade of tiny high bells. `notes` are MIDI numbers. */
export function sparkle(k: Kit, at: number, notes: readonly number[], step: number, peak: number, dest: AudioNode = k.out): void {
  notes.forEach((n, i) => {
    const pk = peak * (1 - (i / notes.length) * 0.55);
    bell(k, midi(n) * vary(k, 0.004, i), at + i * step, 0.35, pk, { ratio: 3.5, index: 0.9, dest });
  });
}

/** Struck metal disc (coin): inharmonic partials with fast decay plus a high noise "chink". */
export function metal(k: Kit, f: number, at: number, peak: number, dur: number, dest: AudioNode = k.out): void {
  const parts: readonly [number, number, number][] = [[1, 1, 1], [2.32, 0.55, 0.7], [4.25, 0.3, 0.45]];
  for (const [r, a, d] of parts) osc(k, 'sine', f * r, at, dur * d + 0.05, env(k, at, peak * a, 0.01, 0, dur * d, dest));
  noise(k, at, 0.05, filt(k, 'highpass', 6500, 0.8, env(k, at, peak * 0.35, 0.01, 0, 0.025, dest)));
}

/** Chiptune square lead (softened by a low-pass) for level-up style cues. */
export function chip8(k: Kit, f: number, at: number, dur: number, peak: number, dest: AudioNode = k.out): void {
  const lp = filt(k, 'lowpass', clamp(f * 6, 1500, 5000), 0.7, env(k, at, peak, 0.01, dur * 0.4, dur * 0.6, dest));
  osc(k, 'square', f, at, dur + 0.05, lp);
}

// ---------------------------------------------------------------- buffers

/** Deterministic white noise (LCG), mono. */
export function makeNoise(ac: BaseAudioContext, seconds = 2): AudioBuffer {
  const n = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  let s = 0x2f6b1d3 >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

/** Synthetic stereo room impulse: decaying noise that darkens over time (one-pole low-pass). */
export function makeImpulse(ac: BaseAudioContext, seconds = 1.8, decay = 3.2): AudioBuffer {
  const sr = ac.sampleRate;
  const n = Math.max(1, Math.floor(sr * seconds));
  const b = ac.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = (0x9e3779b9 ^ (c * 0x85ebca6b)) >>> 0;
    let lp = 0;
    for (let i = pre; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const x = (s / 4294967296) * 2 - 1;
      const t = (i - pre) / sr;
      const a = 0.25 + 0.7 * Math.exp(-t * 2.2); // brighter early, darker tail
      lp += a * (x - lp);
      const fadeIn = Math.min(1, (i - pre) / (sr * 0.004));
      d[i] = lp * Math.exp(-t * decay) * fadeIn * 0.6;
    }
  }
  return b;
}

/** Raised-cosine onset (>= MIN_ATTACK) then exponential decay; used when rendering loop buffers. */
export function hitEnv(t: number, rise: number, decay: number): number {
  if (t < 0) return 0;
  const r = Math.max(MIN_ATTACK, rise);
  if (t < r) return 0.5 - 0.5 * Math.cos((Math.PI * t) / r);
  return Math.exp(-(t - r) / decay);
}
