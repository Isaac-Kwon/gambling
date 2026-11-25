// Drives a job generator in time slices so the thread that runs it (the worker, or the main thread in the
// fallback) stays responsive: cancel messages get through between slices and progress is reported per slice.
//
// A job is a generator that yields its progress (0..1) every few thousand iterations (CHECK_EVERY) and returns
// its result. The scheduler is injected, so tests drive it with a fake clock and synchronous yields.

/** Iterations between two yields inside a job (ARCHITECTURE §10.3: "5,000회 단위로 끊어 취소를 확인한다"). */
export const CHECK_EVERY = 5000;
/** Target length of one slice of work; progress is posted once per slice. */
export const SLICE_MS = 50;

export type Job<T> = Generator<number, T, void>;

export interface Scheduler {
  /** Monotonic ms. */
  now(): number;
  /** Lets queued messages (cancel) run before the next slice. */
  yield(): Promise<void>;
}

export type DriveResult<T> = { ok: true; value: T } | { ok: false; cancelled: true };

export interface DriveOpts {
  sliceMs?: number;
  onProgress?: (p: number) => void;
  isCancelled?: () => boolean;
}

/**
 * Runs `job` to completion. Between slices: reports the last progress value, yields, then checks cancellation.
 * A cancelled job's generator is closed with `return()` (its `finally` blocks run).
 */
export async function drive<T>(job: Job<T>, s: Scheduler, o: DriveOpts = {}): Promise<DriveResult<T>> {
  const slice = o.sliceMs ?? SLICE_MS;
  const cancelled = o.isCancelled ?? (() => false);
  let p = 0;
  for (;;) {
    if (cancelled()) { job.return(undefined as never); return { ok: false, cancelled: true }; }
    const start = s.now();
    for (;;) {
      const r = job.next();
      if (r.done) { o.onProgress?.(1); return { ok: true, value: r.value }; }
      p = r.value;
      if (s.now() - start >= slice) break;
    }
    o.onProgress?.(p);
    await s.yield();
  }
}

/** Runs a job synchronously (node tests, scripts). Progress is reported at every yield. */
export function runSync<T>(job: Job<T>, onProgress?: (p: number) => void): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}

/** Real scheduler: performance.now + a MessageChannel macrotask (no setTimeout clamping), setTimeout fallback. */
export function realScheduler(): Scheduler {
  const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  if (typeof MessageChannel !== "undefined") {
    const ch = new MessageChannel();
    const queue: (() => void)[] = [];
    ch.port1.onmessage = () => { const f = queue.shift(); if (f) f(); };
    // node: an open port would keep the process alive
    (ch.port1 as unknown as { unref?: () => void }).unref?.();
    return {
      now,
      yield: () => new Promise<void>((r) => { queue.push(r); ch.port2.postMessage(null); }),
    };
  }
  return { now, yield: () => new Promise<void>((r) => setTimeout(r, 0)) };
}
