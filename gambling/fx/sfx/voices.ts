/**
 * One-shot voice recipes. Tonal material is in C major (pitch option transposes); jingles escalate from a
 * short bell arpeggio (win1) to a full brass + bell fanfare with a bVI-bVII-I cadence (win4).
 */
import type { SfxName } from '../types';
import { bass, bell, boom, brass, chip8, clamp, cymbal, env, filt, fq, metal, midi, mix, modTo, noise, osc, sparkle, sweep, vary, type Kit } from './kit';

export type Recipe = (k: Kit, arg: number) => void;

const at = (k: Kit, s: number): number => k.t + s;

/** Bell arpeggio: MIDI notes at a fixed step. */
function arp(k: Kit, t: number, notes: readonly number[], step: number, dur: number, peak: number, ratio = 3.5): void {
  notes.forEach((n, i) => bell(k, midi(n), t + i * step, dur, peak, { ratio, index: 1.4 }));
}

/** Brass chord (each note a brass voice) plus an optional bell doubling one octave up. */
function chord(k: Kit, t: number, notes: readonly number[], dur: number, peak: number, bells = true): void {
  const per = peak / Math.sqrt(notes.length);
  for (const n of notes) brass(k, midi(n), t, dur, per);
  if (bells) for (const n of notes) bell(k, midi(n + 12), t, dur + 0.3, per * 0.55, { ratio: 3.5, index: 1.1 });
}

// ---------------------------------------------------------------- UI / table

const tap: Recipe = (k) => {
  const t = k.t;
  const o = osc(k, 'sine', 1320, t, 0.09, env(k, t, 0.32, 0.01, 0, 0.05));
  sweep(o.frequency, fq(k, 1320), fq(k, 990), t, 0.05);
  osc(k, 'triangle', 2640, t, 0.06, env(k, t, 0.07, 0.01, 0, 0.025));
};

const stop: Recipe = (k) => {
  const t = k.t;
  const s = osc(k, 'sine', 160, t, 0.2, env(k, t, 0.6, 0.01, 0, 0.14));
  sweep(s.frequency, fq(k, 170), fq(k, 55), t, 0.11);
  osc(k, 'sawtooth', 110, t, 0.12, filt(k, 'lowpass', 420, 1, env(k, t, 0.22, 0.01, 0, 0.07)));
  noise(k, t, 0.06, filt(k, 'bandpass', 1800, 1.4, env(k, t, 0.38, 0.01, 0, 0.03)));
  osc(k, 'triangle', 3200, t, 0.05, env(k, t, 0.1, 0.01, 0, 0.025));
};

/** Count-up tick: tiny bright "tink" cycling through a pentatonic set so long runs do not drone. */
const TICK_STEPS = [1, 1.122, 1.26, 1.122, 1.498, 1.26] as const;
const tick: Recipe = (k) => {
  const r = TICK_STEPS[k.seed % TICK_STEPS.length]!;
  const f = 2637 * r;
  osc(k, 'sine', f, k.t, 0.08, env(k, k.t, 0.22, 0.01, 0, 0.05));
  osc(k, 'sine', f * 2.76, k.t, 0.05, env(k, k.t, 0.07, 0.01, 0, 0.025));
};

/** Coin drop: struck disc with three decaying bounces, each slightly detuned. */
const coin: Recipe = (k) => {
  const f = 2350 * vary(k, 0.06, 1);
  const hits: readonly [number, number][] = [[0, 1], [0.085, 0.5], [0.14, 0.26]];
  hits.forEach(([dt, a], i) => metal(k, f * vary(k, 0.012, i + 3), at(k, dt), 0.42 * a, 0.28 - i * 0.06));
};

/** Clay chip clack: two band-passed noise snaps with a short resonant body. */
const chip: Recipe = (k) => {
  for (const [dt, a, r] of [[0, 1, 1], [0.034, 0.6, 0.94]] as const) {
    const t = at(k, dt);
    noise(k, t, 0.06, filt(k, 'bandpass', 3800 * r, 5, env(k, t, 0.7 * a, 0.01, 0, 0.035)));
    osc(k, 'sine', 2100 * r, t, 0.08, env(k, t, 0.2 * a, 0.01, 0, 0.045));
    osc(k, 'sine', 5150 * r, t, 0.05, env(k, t, 0.07 * a, 0.01, 0, 0.02));
  }
};

/** Card slide + snap. */
const card: Recipe = (k) => {
  const t = k.t;
  const bp = filt(k, 'bandpass', 900, 1.1, env(k, t, 0.42, 0.02, 0.02, 0.07));
  sweep(bp.frequency, fq(k, 900), fq(k, 3600), t, 0.1);
  noise(k, t, 0.16, bp);
  const s = at(k, 0.085);
  noise(k, s, 0.05, filt(k, 'highpass', 5000, 0.7, env(k, s, 0.28, 0.01, 0, 0.025)));
  osc(k, 'sine', 190, s, 0.08, env(k, s, 0.18, 0.01, 0, 0.05));
};

// ---------------------------------------------------------------- wins (escalating)

/** Tier 0: light two-note "ding-ding". */
const win0: Recipe = (k) => {
  bell(k, midi(79), k.t, 0.32, 0.3, { ratio: 3.5, index: 1.2 });
  bell(k, midi(84), at(k, 0.09), 0.45, 0.3, { ratio: 3.5, index: 1.2 });
};

/** NICE: quick C-major bell arpeggio resolving on a held dyad, soft bass. ~0.9 s */
const win1: Recipe = (k) => {
  arp(k, k.t, [72, 76, 79, 84], 0.07, 0.45, 0.32);
  const t = at(k, 0.28);
  bell(k, midi(84), t, 0.7, 0.3);
  bell(k, midi(88), t, 0.7, 0.24);
  bass(k, midi(48), t, 0.35, 0.3);
  sparkle(k, at(k, 0.36), [103, 100, 96], 0.05, 0.08);
};

/** BIG: two-octave run into a brass + bell C-major stab with bass, boom and a light crash. ~1.6 s */
const win2: Recipe = (k) => {
  arp(k, k.t, [72, 76, 79, 84, 88, 91], 0.055, 0.35, 0.28);
  const t = at(k, 0.36);
  chord(k, t, [60, 64, 67, 72], 0.85, 0.55);
  bass(k, midi(36), t, 0.6, 0.35);
  boom(k, t, 0.35, 60, 0.6);
  cymbal(k, t, 0.1, 1.1);
  sparkle(k, at(k, 0.5), [108, 103, 100, 96, 91], 0.06, 0.09);
};

/** MEGA: brass pickup (G G G | C), bell run, IV - V - I cadence with boom and crash. ~2.9 s */
const win3: Recipe = (k) => {
  [0, 0.13, 0.26].forEach((dt) => brass(k, midi(67), at(k, dt), 0.1, 0.32));
  const t1 = at(k, 0.4);
  chord(k, t1, [60, 64, 67, 72], 0.62, 0.5, false);
  bass(k, midi(36), t1, 0.5, 0.3);
  arp(k, at(k, 0.45), [72, 76, 79, 84, 88, 91, 96], 0.05, 0.35, 0.22);
  chord(k, at(k, 1.15), [65, 69, 72], 0.3, 0.42);
  bass(k, midi(41), at(k, 1.15), 0.3, 0.28);
  chord(k, at(k, 1.5), [67, 71, 74], 0.3, 0.44);
  bass(k, midi(43), at(k, 1.5), 0.3, 0.28);
  const t3 = at(k, 1.85);
  chord(k, t3, [60, 64, 67, 72, 76], 1.0, 0.6);
  bass(k, midi(36), t3, 0.9, 0.38);
  boom(k, t3, 0.45, 58, 0.9);
  cymbal(k, t3, 0.13, 1.4);
  sparkle(k, at(k, 2.0), [108, 105, 103, 100, 98, 96, 93, 91], 0.055, 0.1);
};

/** EPIC: reverse-cymbal swell, fanfare, rising I - IV arpeggios, bVI - bVII - I cadence, timpani roll. ~4.4 s */
const win4: Recipe = (k) => {
  cymbal(k, k.t, 0.12, 0.85, true);
  const t0 = at(k, 0.9);
  boom(k, t0, 0.45, 55, 0.9);
  [0, 0.13, 0.26].forEach((dt) => brass(k, midi(67), t0 + dt, 0.1, 0.34));
  const t1 = t0 + 0.4;
  chord(k, t1, [60, 64, 67, 72], 0.55, 0.5, false);
  bass(k, midi(36), t1, 0.5, 0.32);
  arp(k, t1 + 0.05, [72, 76, 79, 84, 88], 0.06, 0.3, 0.2);
  const t2 = t1 + 0.6;
  chord(k, t2, [65, 69, 72, 77], 0.5, 0.48, false);
  bass(k, midi(41), t2, 0.45, 0.3);
  arp(k, t2 + 0.05, [77, 81, 84, 89, 93], 0.06, 0.3, 0.2);
  const t3 = t2 + 0.55;
  chord(k, t3, [68, 72, 75], 0.34, 0.46);
  bass(k, midi(44), t3, 0.32, 0.3);
  const t4 = t3 + 0.38;
  chord(k, t4, [70, 74, 77], 0.34, 0.48);
  bass(k, midi(46), t4, 0.32, 0.3);
  const t5 = t4 + 0.4;
  chord(k, t5, [60, 64, 67, 72, 76, 79], 1.5, 0.62);
  bass(k, midi(36), t5, 1.3, 0.4);
  [0, 0.11, 0.2, 0.28, 0.35].forEach((dt, i) => boom(k, t5 - 0.4 + dt, 0.18 + i * 0.05, 60, 0.35));
  boom(k, t5, 0.55, 50, 1.2);
  cymbal(k, t5, 0.15, 1.8);
  sparkle(k, t5 + 0.12, [108, 107, 103, 100, 98, 96, 95, 91, 88, 84], 0.07, 0.11);
};

// ---------------------------------------------------------------- ocean / meta

/**
 * Deep rumble: sub sine + band-limited saw harmonics (so phones can hear it) + low-passed noise swell.
 * Envelope rises slowly (no sudden peak) and fades out.
 */
function rumble(k: Kit, f: number, dur: number, peak: number): void {
  const t = k.t;
  const a = dur * 0.35;
  const hold = dur * 0.25;
  const rel = dur * 0.4;
  osc(k, 'sine', f, t, dur + 0.05, env(k, t, peak, a, hold, rel));
  const lp = filt(k, 'lowpass', 240, 3, env(k, t, peak * 0.45, a, hold, rel));
  osc(k, 'sawtooth', f, t, dur + 0.05, lp, -6);
  osc(k, 'sawtooth', f * 1.5, t, dur + 0.05, lp, 5);
  const nl = filt(k, 'lowpass', 140, 0.8, env(k, t, peak * 0.7, a, hold, rel));
  sweep(nl.frequency, fq(k, 120), fq(k, 420), t, dur * 0.55);
  noise(k, t, dur + 0.05, nl, 0.5);
}

/** Thump used by the shark omen (lub-dub). */
function thump(k: Kit, t: number, peak: number): void {
  const s = osc(k, 'sine', 62, t, 0.24, env(k, t, peak, 0.012, 0, 0.17));
  sweep(s.frequency, 64, 40, t, 0.15);
  osc(k, 'triangle', 124, t, 0.14, env(k, t, peak * 0.35, 0.012, 0, 0.08));
}

/** Whale call: gliding sine with slow vibrato and a touch of FM grit, heavy reverb send downstream. */
function call(k: Kit, t: number, path: readonly number[], dur: number, peak: number): void {
  const v = env(k, t, peak, dur * 0.25, dur * 0.35, dur * 0.4);
  const bp = filt(k, 'bandpass', 520, 0.9, v);
  const o = osc(k, 'sine', path[0]!, t, dur + 0.05, bp);
  const seg = dur / (path.length - 1);
  o.frequency.setValueAtTime(fq(k, path[0]!), t);
  for (let i = 1; i < path.length; i++) o.frequency.exponentialRampToValueAtTime(fq(k, path[i]!), t + seg * i);
  const lfo = osc(k, 'sine', 5.2, t, dur + 0.05, null);
  modTo(k, lfo, 16, o.detune);
  const fm = osc(k, 'sine', path[0]! * 0.5, t, dur + 0.05, null);
  modTo(k, fm, 22, o.frequency);
  osc(k, 'triangle', path[0]! * 2, t, dur + 0.05, mix(k, 0.15, bp));
}

/** omen: arg = grade 1 (clam) / 2 (shark) / 3 (whale). Lengths match the 1.8 / 2.4 / 4 s cues. */
const omen: Recipe = (k, arg) => {
  const grade = clamp(Math.round(arg), 1, 3);
  if (grade === 1) {
    rumble(k, 55, 1.8, 0.32);
    // pearl light leaking: soft high bells with slow swells
    const t = at(k, 0.95);
    osc(k, 'sine', midi(96), t, 0.95, env(k, t, 0.07, 0.3, 0.1, 0.5));
    sparkle(k, at(k, 1.0), [100, 103, 108], 0.12, 0.08);
  } else if (grade === 2) {
    rumble(k, 46, 2.4, 0.5);
    for (const dt of [0.45, 0.72, 1.25, 1.52]) thump(k, at(k, dt), 0.5);
    // fast silhouette crossing: band-pass noise sweep
    const s = at(k, 1.05);
    const bp = filt(k, 'bandpass', 300, 1.4, env(k, s, 0.3, 0.3, 0, 0.4));
    sweep(bp.frequency, 300, 2400, s, 0.35);
    bp.frequency.exponentialRampToValueAtTime(380, s + 0.75);
    noise(k, s, 0.8, bp);
    // tension tone rising underneath
    const o = osc(k, 'sine', 220, at(k, 0.2), 2.0, env(k, at(k, 0.2), 0.08, 0.9, 0.5, 0.5));
    sweep(o.frequency, 220, 330, at(k, 0.2), 1.9);
  } else {
    rumble(k, 36, 4.0, 0.55);
    const lp = filt(k, 'lowpass', 300, 1, env(k, k.t, 0.16, 1.2, 1.6, 1.2));
    osc(k, 'sawtooth', midi(33), k.t, 4.05, lp, -8);
    osc(k, 'sawtooth', midi(40), k.t, 4.05, lp, 8);
    call(k, at(k, 0.7), [250, 470, 330], 1.5, 0.26);
    call(k, at(k, 2.3), [300, 560, 240], 1.4, 0.24);
    boom(k, at(k, 3.0), 0.32, 45, 1.0);
  }
};

/** Thermal ticket printer: stepper-motor buzz + paper feed hiss, then a tear. ~0.55 s per ticket. */
const ticket: Recipe = (k) => {
  const t = k.t;
  const motorV = env(k, t, 0.3, 0.02, 0.36, 0.06);
  const am = k.ac.createGain();
  am.gain.value = 0.55;
  am.connect(motorV);
  const bp = filt(k, 'bandpass', 1400, 2.5, am);
  osc(k, 'square', 62, t, 0.48, bp);
  osc(k, 'sawtooth', 124.5, t, 0.48, mix(k, 0.4, bp));
  const lfo = osc(k, 'triangle', 38, t, 0.48, null);
  modTo(k, lfo, 0.45, am.gain);
  noise(k, t, 0.48, filt(k, 'bandpass', 3000, 0.7, env(k, t, 0.12, 0.03, 0.33, 0.06)));
  const s = at(k, 0.44);
  const hp = filt(k, 'highpass', 2500, 0.8, env(k, s, 0.26, 0.01, 0.02, 0.05));
  sweep(hp.frequency, fq(k, 2500), fq(k, 6000), s, 0.07);
  noise(k, s, 0.12, hp);
};

/** Level up: chiptune square arpeggio capped by a bell. */
const level: Recipe = (k) => {
  [72, 76, 79, 84].forEach((n, i) => chip8(k, midi(n), at(k, i * 0.06), 0.09, 0.2));
  bell(k, midi(96), at(k, 0.24), 0.6, 0.24);
  chip8(k, midi(88), at(k, 0.24), 0.3, 0.14);
};

export const RECIPES: Record<SfxName, Recipe> = { tap, stop, tick, coin, chip, card, win0, win1, win2, win3, win4, omen, ticket, level };
