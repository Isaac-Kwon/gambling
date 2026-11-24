/**
 * Pure particle simulation (no Pixi, no DOM): positions, velocities, lifetimes in Float32Arrays.
 * `gl/stage.ts` copies these values into Pixi `Particle`s and only draws (ARCHITECTURE §4.7).
 * Coordinates are CSS px relative to `#frame`. Time in ms.
 */

export const MAX_PARTICLES = 600;

export type EmitKind = "coins" | "confetti" | "bubbles" | "tickets" | "sparks" | "exhaust";
export const KIND_ID: Readonly<Record<EmitKind, number>> = { coins: 0, confetti: 1, bubbles: 2, tickets: 3, sparks: 4, exhaust: 5 };
export const K_COIN = 0, K_CONFETTI = 1, K_BUBBLE = 2, K_TICKET = 3, K_SPARK = 4, K_EXHAUST = 5;
/** Kinds drawn with additive blending. */
export function isAdditive(kindId: number): boolean {
  return kindId === K_SPARK || kindId === K_EXHAUST;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Coin spin frames in the atlas. */
export const COIN_FRAMES = 8;
/** Confetti shape variants in the atlas. */
export const CONFETTI_SHAPES = 4;

/** Confetti tints (palette §2.2). 0xRRGGBB. */
export const CONFETTI_TINTS = [0xf5c542, 0xffe9a6, 0xff3da5, 0x29e6ff, 0x7a3cff, 0xff2d55, 0x3dff8a] as const;
const SPARK_TINTS = [0xfff1c2, 0xf5c542, 0xffb347] as const;
const EXHAUST_TINTS = [0xffd36b, 0xff9a3d, 0xff5a3d, 0xfff1c2] as const;

const FIELDS = ["x", "y", "vx", "vy", "rot", "vr", "age", "life", "size", "phase", "spin", "swayA", "swayF", "swayP", "drag", "grav"] as const;
type Field = (typeof FIELDS)[number];

export interface ParticleSim {
  /** Live particles occupy indices [0, count). */
  readonly count: number;
  readonly cap: number;
  readonly f: Readonly<Record<Field, Float32Array>>;
  readonly kind: Uint8Array;
  readonly tint: Uint32Array;
  readonly frame: Uint8Array;
  setCap(cap: number): void;
  setBounds(w: number, h: number): void;
  /** Adds up to `n` particles (limited by the cap). Returns how many were added. */
  spawn(kind: EmitKind, n: number, at: Rect | null, ms: number, rnd: () => number): number;
  step(dtMs: number): void;
  /** Alpha 0..1 of particle i. */
  alpha(i: number): number;
  /** Shorten every remaining life to at most `ms` (quick fade on skip). */
  fade(ms: number): void;
  clear(): void;
}

export function createParticleSim(cap: number = MAX_PARTICLES, w = 390, h = 800): ParticleSim {
  const f = Object.fromEntries(FIELDS.map((k) => [k, new Float32Array(MAX_PARTICLES)])) as Record<Field, Float32Array>;
  const kind = new Uint8Array(MAX_PARTICLES);
  const tint = new Uint32Array(MAX_PARTICLES);
  const frame = new Uint8Array(MAX_PARTICLES);
  let count = 0;
  let limit = Math.max(0, Math.min(MAX_PARTICLES, cap));
  let W = w, H = h;

  const move = (dst: number, src: number) => {
    for (const k of FIELDS) f[k][dst] = f[k][src];
    kind[dst] = kind[src]; tint[dst] = tint[src]; frame[dst] = frame[src];
  };
  const remove = (i: number) => {
    count--;
    if (i !== count) move(i, count);
  };

  const sim: ParticleSim = {
    get count() { return count; },
    get cap() { return limit; },
    f, kind, tint, frame,
    setCap(c) {
      limit = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(c)));
      if (count > limit) count = limit;
    },
    setBounds(w2, h2) { W = Math.max(1, w2); H = Math.max(1, h2); },
    spawn(k, n, at, ms, rnd) {
      const want = Math.max(0, Math.floor(n));
      const room = Math.max(0, limit - count);
      const m = Math.min(want, room);
      if (m === 0 || !(ms > 0)) return 0;
      const id = KIND_ID[k];
      const s = Math.min(1.4, Math.max(0.8, W / 390));      // horizontal scale
      const sh = Math.min(1.35, Math.max(0.75, H / 800));    // vertical scale
      const cx = at ? at.x + at.w / 2 : W / 2;
      const cy = at ? at.y + at.h / 2 : H * 0.55;
      for (let j = 0; j < m; j++) {
        const i = count++;
        kind[i] = id; frame[i] = 0; tint[i] = 0xffffff;
        f.rot[i] = 0; f.vr[i] = 0; f.phase[i] = 0; f.spin[i] = 0;
        f.swayA[i] = 0; f.swayF[i] = 0; f.swayP[i] = 0; f.drag[i] = 0; f.grav[i] = 0;
        switch (id) {
          case K_COIN: {
            const ox = at ? cx + (rnd() - 0.5) * at.w * 0.5 : cx + (rnd() - 0.5) * 60;
            const oy = at ? at.y + at.h * 0.65 : H * 0.62;
            const delay = rnd() * Math.min(ms * 0.45, 1100);
            f.x[i] = ox; f.y[i] = oy;
            f.vx[i] = (rnd() - 0.5) * 2 * (140 + 300 * rnd()) * s;
            f.vy[i] = -(820 + 640 * rnd()) * sh;
            f.grav[i] = 2100 * sh;
            f.rot[i] = (rnd() - 0.5) * 0.6; f.vr[i] = (rnd() - 0.5) * 3;
            f.size[i] = (0.42 + 0.3 * rnd()) * s;
            f.phase[i] = rnd() * COIN_FRAMES;
            f.spin[i] = (9 + 11 * rnd()) * (rnd() < 0.5 ? -1 : 1);
            f.age[i] = -delay; f.life[i] = ms * (0.85 + 0.15 * rnd());
            break;
          }
          case K_CONFETTI: {
            const delay = rnd() * 260;
            if (at) {
              const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4, v = (500 + 600 * rnd()) * s;
              f.x[i] = cx; f.y[i] = cy; f.vx[i] = Math.cos(a) * v; f.vy[i] = Math.sin(a) * v;
            } else {
              // Two cannons in the lower corners shooting up and inwards.
              const side = j % 2;
              f.x[i] = side ? W + 8 : -8;
              f.y[i] = H * 0.8 + rnd() * 50;
              f.vx[i] = (side ? -1 : 1) * (220 + 560 * rnd()) * s;
              f.vy[i] = -(980 + 720 * rnd()) * sh;
            }
            f.drag[i] = 2.1 + rnd() * 0.6; f.grav[i] = 540 * sh;
            f.swayA[i] = (40 + 60 * rnd()) * s; f.swayF[i] = 2 + 2.5 * rnd(); f.swayP[i] = rnd() * 6.283;
            f.rot[i] = rnd() * 6.283; f.vr[i] = (rnd() - 0.5) * 12;
            f.phase[i] = rnd() * 6.283; f.spin[i] = 6 + 9 * rnd();
            f.size[i] = (0.5 + 0.38 * rnd()) * s;
            tint[i] = CONFETTI_TINTS[Math.floor(rnd() * CONFETTI_TINTS.length)];
            frame[i] = Math.floor(rnd() * CONFETTI_SHAPES);
            f.age[i] = -delay; f.life[i] = ms * (0.75 + 0.25 * rnd());
            break;
          }
          case K_BUBBLE: {
            const delay = rnd() * ms * 0.5;
            f.x[i] = at ? at.x + rnd() * at.w : rnd() * W;
            f.y[i] = at ? at.y + at.h : H + 20;
            f.vx[i] = (rnd() - 0.5) * 20; f.vy[i] = -(70 + 140 * rnd()) * sh;
            f.swayA[i] = 18 + 34 * rnd(); f.swayF[i] = 1 + 1.4 * rnd(); f.swayP[i] = rnd() * 6.283;
            f.size[i] = (0.28 + 0.5 * rnd()) * s;
            f.age[i] = -delay; f.life[i] = ms * (0.7 + 0.3 * rnd());
            break;
          }
          case K_TICKET: {
            const delay = Math.min(j * 90, ms * 0.5);
            f.x[i] = cx + (rnd() - 0.5) * (at ? at.w * 0.3 : 30);
            f.y[i] = at ? at.y + at.h * 0.3 : H * 0.7;
            f.vx[i] = (rnd() - 0.5) * 2 * (90 + 220 * rnd()) * s; f.vy[i] = -(480 + 420 * rnd()) * sh;
            f.drag[i] = 1.3; f.grav[i] = 760 * sh;
            f.swayA[i] = 30 + 40 * rnd(); f.swayF[i] = 1.5 + rnd() * 1.5; f.swayP[i] = rnd() * 6.283;
            f.rot[i] = (rnd() - 0.5) * 1.2; f.vr[i] = (rnd() - 0.5) * 8;
            f.phase[i] = rnd() * 6.283; f.spin[i] = 3 + 5 * rnd();
            f.size[i] = (0.8 + 0.25 * rnd()) * s;
            f.age[i] = -delay; f.life[i] = ms * (0.85 + 0.15 * rnd());
            break;
          }
          case K_SPARK: {
            const a = rnd() * 6.283, v = (150 + 520 * rnd()) * s;
            f.x[i] = at ? at.x + rnd() * at.w : cx; f.y[i] = at ? at.y + rnd() * at.h : cy;
            f.vx[i] = Math.cos(a) * v; f.vy[i] = Math.sin(a) * v;
            f.drag[i] = 3.2; f.grav[i] = 220;
            f.size[i] = (0.35 + 0.5 * rnd()) * s;
            tint[i] = SPARK_TINTS[Math.floor(rnd() * SPARK_TINTS.length)];
            f.age[i] = -rnd() * Math.min(ms * 0.5, 400); f.life[i] = Math.min(ms, 260 + 420 * rnd());
            break;
          }
          default: { // K_EXHAUST: cone pointing down-left, behind a rocket climbing up-right
            const a = (3 * Math.PI) / 4 + (rnd() - 0.5) * 0.9, v = (160 + 260 * rnd()) * s;
            f.x[i] = cx + (rnd() - 0.5) * 6; f.y[i] = cy + (rnd() - 0.5) * 6;
            f.vx[i] = Math.cos(a) * v; f.vy[i] = Math.sin(a) * v;
            f.drag[i] = 2.6; f.grav[i] = -60;
            f.size[i] = (0.45 + 0.55 * rnd()) * s;
            tint[i] = EXHAUST_TINTS[Math.floor(rnd() * EXHAUST_TINTS.length)];
            f.age[i] = 0; f.life[i] = Math.min(ms, 220 + 320 * rnd());
            break;
          }
        }
      }
      return m;
    },
    step(dtMs) {
      const dt = Math.min(50, Math.max(0, dtMs)) / 1000;
      if (dt === 0) return;
      let i = 0;
      while (i < count) {
        const k = kind[i];
        const age = (f.age[i] += dt * 1000);
        if (age < 0) { i++; continue; }
        if (age >= f.life[i]) { remove(i); continue; }
        const drag = f.drag[i];
        if (drag > 0) {
          const d = Math.exp(-drag * dt);
          f.vx[i] *= d; f.vy[i] *= d;
        }
        f.vy[i] += f.grav[i] * dt;
        let x = f.x[i] + f.vx[i] * dt;
        if (f.swayA[i] > 0) x += Math.sin((age / 1000) * f.swayF[i] * 6.283 + f.swayP[i]) * f.swayA[i] * dt;
        f.x[i] = x;
        const y = (f.y[i] += f.vy[i] * dt);
        f.rot[i] += f.vr[i] * dt;
        f.phase[i] += f.spin[i] * dt;
        if (k === K_COIN) {
          const p = f.phase[i] % COIN_FRAMES;
          frame[i] = Math.floor(p < 0 ? p + COIN_FRAMES : p) % COIN_FRAMES;
        } else if (k === K_BUBBLE) {
          f.size[i] *= 1 + 0.08 * dt;
        }
        // Off screen: fell below the frame, or rose above it.
        if ((f.vy[i] > 0 && y > H + 80) || (k === K_BUBBLE && y < -80)) { remove(i); continue; }
        i++;
      }
    },
    alpha(i) {
      const age = f.age[i], life = f.life[i];
      if (age < 0) return 0;
      const fin = Math.min(1, age / 80);
      const outMs = Math.max(120, life * 0.3);
      const fout = Math.min(1, Math.max(0, (life - age) / outMs));
      return fin * fout;
    },
    fade(ms) {
      for (let i = 0; i < count; i++) {
        if (f.age[i] < 0) { f.life[i] = 0; f.age[i] = 0; continue; }   // not born yet: drop
        f.life[i] = Math.min(f.life[i], f.age[i] + ms);
      }
    },
    clear() { count = 0; },
  };
  return sim;
}

/** Minimum rise and fall of `envelope` (§6.6: the layer never flashes). */
export const ENVELOPE_MIN_RAMP_MS = 200;

/**
 * Alpha 0..1 of rays and glow sprites, `t` ms into an effect lasting `ms`.
 * Rise and fall each take >= 200 ms (smoothstep), so no 100 ms window changes alpha by more than 0.75.
 * Durations shorter than 400 ms are stretched to 400 ms.
 */
export function envelope(t: number, ms: number): number {
  const total = Math.max(ms, 2 * ENVELOPE_MIN_RAMP_MS);
  if (!(t > 0) || t >= total) return 0;
  const ramp = Math.max(ENVELOPE_MIN_RAMP_MS, Math.min(450, total * 0.25));
  const ss = (u: number) => u * u * (3 - 2 * u);
  if (t < ramp) return ss(t / ramp);
  if (t > total - ramp) return ss((total - t) / ramp);
  return 1;
}
/** Effective length of an envelope of `ms` (after stretching). */
export function envelopeMs(ms: number): number {
  return Math.max(ms, 2 * ENVELOPE_MIN_RAMP_MS);
}
