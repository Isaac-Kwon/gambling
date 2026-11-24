/**
 * fx director (ARCHITECTURE §6.5): decides what happens, how big and for how long, records it, and asks a
 * backend to draw. It knows nothing about Pixi or the DOM.
 *
 * Recording (§6.4): when an effect starts, `{type, ms: planned, k}` goes into the array given to `collect`;
 * when it ends naturally `ms` stays the planned value, when it is skipped (or its particles are dropped)
 * `ms` becomes the actual elapsed time. `particles:<kind>` uses the count the backend really emitted and
 * is not recorded at all when that is 0. Every flash asks the flash guard; refused flashes leave no trace.
 */
import type { Rng } from "../../shared/rng";
import type { Fx, FxRecord, FxRun, Haptics, Sfx, SfxName } from "./types";
import type { FxBackend, FxHandle } from "./backend";
import { createFlashGuard, isRedColor, type FlashGuard } from "./flashGuard";
import { particleCap, QUALITY, type QualityLevel } from "./quality";
import { planCelebration, coinMs, CONFETTI_MS, CONFETTI_AT, SHAKE_AT, RAY_COUNT, FLASH_MS, FLASH_COLOR } from "./tiers";
import { clampCountupMs, countValue, fmtInt, TICK_EVERY_MS } from "./countup";
import { clampShake } from "./shake";

export { createNullFx } from "./null";
export { createDomBackend, nullBackend, type FxBackend, type FxHandle } from "./backend";
export { createFlashGuard, type FlashGuard } from "./flashGuard";

/** Structural subset of the runtime `Clock` (gambling/src/types.ts). `frame` is only used for smooth count-up. */
export interface FxClock {
  now(): number;
  wait(ms: number): Promise<void>;
  frame?(cb: (dtMs: number) => void): () => void;
}

export interface FxOptions {
  backend: FxBackend;
  clock: FxClock;
  /** Presentation stream (e.g. createRng(seed, "pre:fx")): seeds of particle sprays and shakes. Never the result stream. */
  pre: Rng;
  /** Default: createFlashGuard({ reducedMotion }). */
  guard?: FlashGuard;
  /** Extra cap from the adaptive quality (default: none beyond the backend's own cap). */
  quality?: () => QualityLevel;
  sfx?: Sfx;
  haptics?: Haptics;
  /** prefers-reduced-motion: shake amplitude 0, flashes max 1/s. Everything else unchanged. */
  reducedMotion?: boolean;
  /** Number format of count-ups (default "12,345"). */
  fmt?: (n: number) => string;
}

/** Nominal one-shot sound lengths (ms) for the record; the synth decides the real envelope. */
export const SFX_MS: Readonly<Record<SfxName, number>> = {
  tap: 60, stop: 180, tick: 40, coin: 350, chip: 200, card: 220,
  win0: 700, win1: 1200, win2: 2000, win3: 3000, win4: 4200,
  omen: 2400, ticket: 500, level: 1200,
};
/** UI feedback, not stimuli of an outcome: not recorded (`tick` is covered by the `countup` record). */
const UNRECORDED: ReadonlySet<string> = new Set(["tap", "tick"]);

/** Default lifetimes of standalone `particles()` calls. */
export const PARTICLE_MS: Readonly<Record<string, number>> = { coins: 2300, confetti: 3600, rays: 2500, bubbles: 3200, tickets: 3000 };

export const HAPTIC_MAX_MS = 600;
/** Clip a vibrate pattern so the whole pattern (vibration + pauses) is at most 600 ms. */
export function clipPattern(p: number | readonly number[]): { pattern: number[]; vib: number; total: number } {
  const arr = (typeof p === "number" ? [p] : [...p]).map((x) => (Number.isFinite(x) && x > 0 ? Math.round(x) : 0));
  const out: number[] = [];
  let total = 0, vib = 0;
  for (let i = 0; i < arr.length && total < HAPTIC_MAX_MS; i++) {
    const v = Math.min(arr[i], HAPTIC_MAX_MS - total);
    out.push(v);
    total += v;
    if (i % 2 === 0) vib += v;
  }
  return { pattern: out, vib, total };
}

const DONE: FxRun = { done: Promise.resolve(), skip() {} };
const NULL_SFX: Sfx = { unlock: () => Promise.resolve(), play() {}, loop() {}, setMuted() {} };
const NULL_HAPTICS: Haptics = { pulse() {} };

interface Track { rec: FxRecord; at: number; planned: number; fixed: boolean; particle: boolean }
interface Job {
  kind: string;
  start: number;
  /** Planned end, ms after start (antic rise can extend it). */
  endAt: number;
  finished: boolean;
  tracks: Track[];
  byType: Map<string, Track>;
  cleanup: ((skipped: boolean) => void)[];
  into: FxRecord[] | null;
  run: FxRun;
  resolve: () => void;
}

function rafFrame(cb: (dtMs: number) => void): () => void {
  if (typeof requestAnimationFrame !== "function") return () => {};
  let id = 0, last = 0, on = true;
  const loop = (ts: number) => {
    if (!on) return;
    cb(last ? ts - last : 1000 / 60);
    last = ts;
    id = requestAnimationFrame(loop);
  };
  id = requestAnimationFrame(loop);
  return () => { on = false; cancelAnimationFrame(id); };
}

export function createFx(o: FxOptions): Fx {
  const { backend, clock, pre } = o;
  const rm = !!o.reducedMotion;
  const guard = o.guard ?? createFlashGuard({ reducedMotion: rm });
  const sfx = o.sfx ?? NULL_SFX;
  const haptics = o.haptics ?? NULL_HAPTICS;
  const fmt = o.fmt ?? fmtInt;
  const level = (): QualityLevel => (o.quality ? o.quality() : 2);
  const frame = (cb: (dt: number) => void) => (o.clock.frame ? o.clock.frame(cb) : rafFrame(cb));

  let into: FxRecord[] | null = null;
  let muted = false;
  const active = new Set<Job>();
  let idleWaiters: (() => void)[] = [];
  let lastCelebrate: Job | null = null;
  const riseJobs = new Map<unknown, { job: Job; handle: FxHandle; track: Track }>();
  const loops = new Map<string, { rec: FxRecord; at: number }>();

  // ---------------------------------------------------------------- jobs and records
  const push = (rec: FxRecord, target: FxRecord[] | null) => { if (target) target.push(rec); };

  function newJob(kind: string, endAt: number): Job {
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const job: Job = {
      kind, start: clock.now(), endAt, finished: false, tracks: [], byType: new Map(), cleanup: [], into,
      resolve, run: { done, skip: () => finish(job, true) },
    };
    active.add(job);
    return job;
  }

  function track(job: Job, type: string, planned: number, k: number, particle = false): Track {
    const rec: FxRecord = { type, ms: Math.round(planned), k };
    push(rec, job.into);
    const t: Track = { rec, at: clock.now(), planned, fixed: false, particle };
    job.tracks.push(t);
    job.byType.set(type, t);
    return t;
  }

  function finish(job: Job, skipped: boolean) {
    if (job.finished) return;
    job.finished = true;
    const now = clock.now();
    for (const t of job.tracks) {
      if (t.fixed) continue;
      t.fixed = true;
      t.rec.ms = Math.round(skipped ? Math.max(0, Math.min(t.planned, now - t.at)) : t.planned);
    }
    for (const c of job.cleanup) { try { c(skipped); } catch { /* drawing must never break the game */ } }
    active.delete(job);
    if (lastCelebrate === job) lastCelebrate = null;
    job.resolve();
    if (active.size === 0 && idleWaiters.length) {
      const w = idleWaiters;
      idleWaiters = [];
      for (const f of w) f();
    }
  }

  /** Runs `events` at their planned offsets (sequential waits on the clock), then ends the job at `job.endAt`. */
  function timeline(job: Job, events: { at: number; fn: () => void }[]) {
    events.sort((a, b) => a.at - b.at);
    void (async () => {
      try {
        let t = 0;
        for (const ev of events) {
          if (ev.at > t) { await clock.wait(ev.at - t); t = ev.at; }
          if (job.finished) return;
          ev.fn();
        }
        while (!job.finished && job.endAt > t) {
          const end = job.endAt;
          await clock.wait(end - t);
          t = end;
        }
        finish(job, false);
      } catch {
        finish(job, true);
      }
    })();
  }

  // ---------------------------------------------------------------- sound / haptics (recorded)
  function playSfx(name: SfxName, k: number, pitch: number | undefined, job: Job | null) {
    try { sfx.play(name, pitch === undefined ? { k } : { k, pitch }); } catch { /* ignore */ }
    if (muted || UNRECORDED.has(name)) return;
    const type = "sfx:" + name;
    if (job) {
      const prev = job.byType.get(type);
      if (prev) { prev.rec.k = Math.max(prev.rec.k, k); return; }
      track(job, type, SFX_MS[name] ?? 300, k);
    } else push({ type, ms: SFX_MS[name] ?? 300, k }, into);
  }

  function vibrate(p: number | readonly number[]) {
    const c = clipPattern(p);
    if (c.vib <= 0) return;
    try { haptics.pulse(c.pattern.length === 1 ? c.pattern[0] : c.pattern); } catch { /* ignore */ }
    if ((haptics as Haptics & { supported?: boolean }).supported === false) return;
    push({ type: "haptic", ms: c.total, k: c.vib }, into);
  }

  function loopInJob(job: Job, name: "heartbeat" | "rise", pitch?: number): Track | null {
    try { sfx.loop(name, true, pitch === undefined ? undefined : { pitch }); } catch { /* ignore */ }
    job.cleanup.push(() => { try { sfx.loop(name, false); } catch { /* ignore */ } });
    return muted ? null : track(job, "sfx:" + name, job.endAt, 1);
  }

  // ---------------------------------------------------------------- drawing helpers
  function emitIn(job: Job | null, kind: string, n: number, at: unknown, ms: number, seed: number): number {
    const q = level();
    let want: number;
    if (kind === "rays") want = q === "off" || !QUALITY[q].rays ? 0 : Math.floor(n);
    else want = Math.min(Math.floor(n), backend.cap(), particleCap(q));
    if (!(want > 0)) return 0;
    let got = 0;
    try { got = Math.max(0, Math.floor(backend.emit(kind, want, at, ms, seed))); } catch { got = 0; }
    if (got > 0 && job) {
      const type = "particles:" + kind;
      const prev = job.byType.get(type);
      if (prev && !prev.fixed) { prev.rec.k += got; prev.planned = Math.max(prev.planned, ms); prev.rec.ms = Math.round(prev.planned); }
      else track(job, type, ms, got, true);
    }
    return got;
  }

  /** Starts a count on `el`; returns the function that ends it (shows the final value). Idempotent. */
  function startCount(el: HTMLElement, from: number, to: number, ms: number, tick: boolean, mirror: boolean, f: (n: number) => string): () => void {
    const t0 = clock.now();
    let shown = NaN, lastTick = -Infinity, ended = false;
    const show = (v: number) => {
      if (v === shown) return;
      shown = v;
      const s = f(v);
      backend.setText(el, s);
      if (mirror) backend.bannerText(s);
    };
    show(Math.round(from));
    const unsub = frame(() => {
      if (ended) return;
      const e = clock.now() - t0;
      const v = countValue(from, to, e, ms);
      if (tick && v !== shown && e < ms && e - lastTick >= TICK_EVERY_MS) {
        lastTick = e;
        try { sfx.play("tick", { k: 0.3, pitch: 1 + 0.6 * Math.min(1, e / ms) }); } catch { /* ignore */ }
      }
      show(v);
    });
    return () => {
      if (ended) return;
      ended = true;
      unsub();
      show(Math.round(to));
    };
  }

  function flashIn(job: Job, el: unknown, color: string, ms: number, area: number): boolean {
    if (!guard.request(clock.now(), { area, red: isRedColor(color) })) return false;
    // Each flash is its own record (k = 1).
    const rec: FxRecord = { type: "flash", ms: Math.round(ms), k: 1 };
    push(rec, job.into);
    job.tracks.push({ rec, at: clock.now(), planned: ms, fixed: false, particle: false });
    try { backend.flash(el, color, ms); } catch { /* ignore */ }
    return true;
  }

  // Context lost / layer removed: particle records keep only the time they were really visible.
  backend.onDrop(() => {
    const now = clock.now();
    for (const job of [...active]) {
      for (const t of job.tracks) {
        if (!t.particle || t.fixed) continue;
        t.fixed = true;
        t.rec.ms = Math.round(Math.max(0, Math.min(t.planned, now - t.at)));
      }
      if (job.kind === "particles") finish(job, true);
    }
  });

  // ---------------------------------------------------------------- public sfx / haptics wrappers
  const sfxApi: Sfx = {
    unlock: () => sfx.unlock(),
    play(name, opt) { playSfx(name, opt?.k ?? 1, opt?.pitch, null); },
    loop(name, on, opt) {
      try { sfx.loop(name, on, opt); } catch { /* ignore */ }
      const cur = loops.get(name);
      if (on && !cur) {
        if (muted || !into) return;
        const rec: FxRecord = { type: "sfx:" + name, ms: 0, k: 1 };
        into.push(rec);
        loops.set(name, { rec, at: clock.now() });
      } else if (!on && cur) {
        cur.rec.ms = Math.round(Math.max(0, clock.now() - cur.at));
        loops.delete(name);
      }
    },
    setMuted(m) {
      muted = m;
      try { sfx.setMuted(m); } catch { /* ignore */ }
    },
  };
  const hapticsApi: Haptics = { pulse: (p) => vibrate(p) };

  const fx: Fx = {
    enabled: true,
    collect(arr) { into = arr; },
    idle() {
      if (active.size === 0) return Promise.resolve();
      return new Promise<void>((r) => idleWaiters.push(r));
    },

    celebrate(c) {
      const plan = planCelebration(c.amount, c.bet, { reducedMotion: rm });
      if (!plan) return DONE;   // loss: silent, nothing drawn, nothing recorded
      if (lastCelebrate) finish(lastCelebrate, true);
      // Seeds are drawn up front, always the same number, so the stream position never depends on the layer.
      const sCoins = pre.u32(), sConfetti = pre.u32(), sRays = pre.u32(), sShake = pre.u32();
      const st = plan.style, tier = plan.tier;
      const target = c.target, anchor = c.anchor ?? c.target;
      const job = newJob("celebrate", plan.totalMs);
      lastCelebrate = job;
      const ev: { at: number; fn: () => void }[] = [];

      ev.push({ at: 0, fn: () => {
        track(job, "tier", plan.tierMs, plan.k);
        if (tier === 0) {
          const h = backend.pulse(anchor, plan.countupMs);
          job.cleanup.push(() => h.stop());
        } else {
          const h = backend.banner(tier, st.bannerMs);
          job.cleanup.push(() => h.stop());
          ev.push({ at: st.bannerMs, fn: () => h.stop() });
        }
        track(job, "countup", plan.countupMs, plan.mult);
        const end = startCount(target, 0, c.amount, plan.countupMs, true, tier >= 2, fmt);
        job.cleanup.push(end);
        ev.push({ at: plan.countupMs, fn: end });
        playSfx(st.sfx, st.gain, undefined, job);
        vibrate(st.haptic);
        if (st.coins > 0) emitIn(job, "coins", st.coins, anchor, coinMs(tier), sCoins);
        if (st.rays) emitIn(job, "rays", RAY_COUNT, null, st.bannerMs, sRays);
        for (let i = 0; i < Math.min(tier, 4); i++) ev.push({ at: 140 + i * 260, fn: () => playSfx("coin", 0.45, 1 + 0.08 * i, job) });
        if (plan.shakePx > 0) {
          ev.push({ at: SHAKE_AT, fn: () => {
            const s = clampShake(plan.shakePx, st.shakeMs, rm);
            if (s.px <= 0) return;
            track(job, "shake", s.ms, s.px);
            const h = backend.shake(null, s.px, s.ms, sShake);
            job.cleanup.push((skipped) => { if (skipped) h.stop(); });
          } });
        }
        if (st.confetti > 0) ev.push({ at: CONFETTI_AT, fn: () => { emitIn(job, "confetti", st.confetti, null, CONFETTI_MS, sConfetti); } });
        for (const at of st.flashAt) {
          if (at === 0) flashIn(job, null, FLASH_COLOR, FLASH_MS, 1);
          else ev.push({ at, fn: () => { flashIn(job, null, FLASH_COLOR, FLASH_MS, 1); } });
        }
        // Events added above are picked up because the timeline re-sorts the remaining list.
        ev.sort((a, b) => a.at - b.at);
      } });
      job.cleanup.push((skipped) => { if (skipped) backend.fadeParticles(); });
      const offTap = backend.onTap(() => finish(job, true));
      job.cleanup.push(() => offTap());
      timelineDynamic(job, ev);
      return job.run;
    },

    countup(c) {
      const ms = clampCountupMs(c.ms);
      const f = c.fmt ?? fmt;
      if (ms === 0) { backend.setText(c.el, f(Math.round(c.to))); return DONE; }
      const job = newJob("countup", ms);
      track(job, "countup", ms, c.k ?? 0);
      const end = startCount(c.el, c.from, c.to, ms, !!c.tick, false, f);
      job.cleanup.push(end);
      timeline(job, []);
      return job.run;
    },

    particles(kind, p) {
      const ms = p.ms !== undefined && p.ms > 0 ? p.ms : (PARTICLE_MS[kind] ?? 2500);
      const seed = pre.u32();
      const job = newJob("particles", ms);
      const got = emitIn(job, kind, p.k, p.at ?? null, ms, seed);
      if (got === 0) { active.delete(job); job.finished = true; job.resolve(); return DONE; }
      job.cleanup.push((skipped) => { if (skipped) backend.fadeParticles(); });
      timeline(job, []);
      return job.run;
    },

    shake(s) {
      const seed = pre.u32();
      const c = clampShake(s.k, s.ms, rm);
      if (c.px <= 0) return DONE;
      const job = newJob("shake", c.ms);
      track(job, "shake", c.ms, c.px);
      const h = backend.shake(s.el, c.px, c.ms, seed);
      job.cleanup.push((skipped) => { if (skipped) h.stop(); });
      timeline(job, []);
      return job.run;
    },

    antic(a) {
      const ms = Math.max(0, a.ms);
      if (!(ms > 0)) return DONE;
      if (a.kind === "rise") {
        const cur = riseJobs.get(a.el);
        if (cur && !cur.job.finished) {
          // Same climb: retune instead of stacking records.
          const job = cur.job;
          job.endAt = Math.max(job.endAt, clock.now() - job.start + ms);
          cur.track.rec.k = Math.max(cur.track.rec.k, a.k);
          cur.track.planned = job.endAt;
          cur.track.rec.ms = Math.round(job.endAt);
          const lt = job.byType.get("sfx:rise");
          if (lt && !lt.fixed) { lt.planned = job.endAt; lt.rec.ms = Math.round(job.endAt); }
          cur.handle.update?.(a.k, ms);
          try { sfx.loop("rise", true, { pitch: a.k }); } catch { /* ignore */ }
          return job.run;
        }
      }
      const job = newJob("antic", ms);
      const t = track(job, "antic:" + a.kind, ms, a.k);
      let h: FxHandle = { stop() {} };
      try { h = backend.antic(a.el, a.kind, a.k, ms); } catch { /* ignore */ }
      job.cleanup.push(() => h.stop());
      if (a.kind === "reel") loopInJob(job, "heartbeat");
      else if (a.kind === "rise") {
        loopInJob(job, "rise", a.k);   // sfx contract: rise loop pitch = multiplier
        riseJobs.set(a.el, { job, handle: h, track: t });
        job.cleanup.push(() => { if (riseJobs.get(a.el)?.job === job) riseJobs.delete(a.el); });
      }
      timeline(job, []);
      return job.run;
    },

    flash(f) {
      const ms = Math.max(40, Math.min(1000, f.ms));
      if (!guard.request(clock.now(), { area: f.area, red: isRedColor(f.color) })) return DONE;
      const job = newJob("flash", ms);
      track(job, "flash", ms, 1);
      try { backend.flash(f.el, f.color, ms); } catch { /* ignore */ }
      timeline(job, []);
      return job.run;
    },

    sfx: sfxApi,
    haptics: hapticsApi,

    suspend() {
      try { backend.suspend(); } catch { /* ignore */ }
      try { (sfx as Sfx & { suspend?(): void }).suspend?.(); } catch { /* ignore */ }
    },
    resume() {
      try { backend.resume(); } catch { /* ignore */ }
      try { (sfx as Sfx & { resume?(): void }).resume?.(); } catch { /* ignore */ }
    },
  };

  /** Like `timeline`, but events may append further events while running (celebrate). */
  function timelineDynamic(job: Job, events: { at: number; fn: () => void }[]) {
    void (async () => {
      try {
        let t = 0;
        while (!job.finished) {
          events.sort((a, b) => a.at - b.at);
          const ev = events.shift();
          if (!ev) break;
          if (ev.at > t) { await clock.wait(ev.at - t); t = ev.at; }
          if (job.finished) return;
          ev.fn();
        }
        while (!job.finished && job.endAt > t) {
          const end = job.endAt;
          await clock.wait(end - t);
          t = end;
        }
        finish(job, false);
      } catch {
        finish(job, true);
      }
    })();
  }

  return fx;
}
