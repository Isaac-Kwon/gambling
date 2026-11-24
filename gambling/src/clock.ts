import type { Clock } from "./types";

interface Waiter { at: number; resolve: () => void; handle?: ReturnType<typeof setTimeout> }

export interface ClockHost {
  perfNow: () => number;
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (h: ReturnType<typeof setTimeout>) => void;
  raf: (cb: (t: number) => void) => number;
  cancelRaf: (id: number) => void;
}

function defaultHost(): ClockHost {
  const g = globalThis as unknown as {
    performance?: { now(): number };
    requestAnimationFrame?: (cb: (t: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  return {
    perfNow: () => (g.performance ? g.performance.now() : Date.now()),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h),
    raf: (cb) => (g.requestAnimationFrame ? g.requestAnimationFrame(cb) : (setTimeout(() => cb(Date.now()), 16) as unknown as number)),
    cancelRaf: (id) => (g.cancelAnimationFrame ? g.cancelAnimationFrame(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>)),
  };
}

/** Real clock. While paused, now() stands still and pending waits stop counting down. */
export function createClock(host: ClockHost = defaultHost()): Clock {
  let paused = false;
  let pausedAt = 0;
  let pausedTotal = 0;
  const base = host.perfNow();
  const now = (): number => (paused ? pausedAt : host.perfNow() - base - pausedTotal);
  const waiters = new Set<Waiter>();

  const arm = (w: Waiter): void => {
    w.handle = host.setTimeout(() => { waiters.delete(w); w.resolve(); }, Math.max(0, w.at - now()));
  };

  return {
    now,
    wait(ms) {
      return new Promise<void>((resolve) => {
        const w: Waiter = { at: now() + Math.max(0, ms), resolve };
        waiters.add(w);
        if (!paused) arm(w);
      });
    },
    frame(cb) {
      let id = 0;
      let last = host.perfNow();
      let live = true;
      const tick = (t: number): void => {
        if (!live) return;
        const dt = Math.max(0, t - last);
        last = t;
        if (!paused) cb(Math.min(dt, 100));
        id = host.raf(tick);
      };
      id = host.raf(tick);
      return () => { live = false; host.cancelRaf(id); };
    },
    pause() {
      if (paused) return;
      pausedAt = now();
      paused = true;
      for (const w of waiters) if (w.handle !== undefined) { host.clearTimeout(w.handle); w.handle = undefined; }
    },
    resume() {
      if (!paused) return;
      pausedTotal += host.perfNow() - base - pausedTotal - pausedAt;
      paused = false;
      for (const w of waiters) arm(w);
    },
  };
}

/**
 * Deterministic clock for node and the harness. `wait(ms)` advances virtual time at once and resolves
 * (frame callbacks get one call with the elapsed ms). `advance(ms)` does the same without a promise.
 * While paused, time does not move and wait() just resolves.
 */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  readonly paused: boolean;
}

export function createManualClock(start = 0): ManualClock {
  let t = start;
  let paused = false;
  const frames = new Set<(dt: number) => void>();
  const advance = (ms: number): void => {
    if (paused || !(ms > 0)) return;
    t += ms;
    for (const f of [...frames]) f(ms);
  };
  return {
    now: () => t,
    wait(ms) { advance(ms); return Promise.resolve(); },
    frame(cb) { frames.add(cb); return () => { frames.delete(cb); }; },
    pause() { paused = true; },
    resume() { paused = false; },
    advance,
    get paused() { return paused; },
  };
}
