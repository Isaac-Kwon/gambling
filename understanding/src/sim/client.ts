// Page-side client for the simulation worker: one lazily created module worker, promise per job, progress
// callbacks, cancellation (explicit, AbortSignal, or "latest run per key" for sliders).
//
// If a Worker cannot be created (or fails to load), jobs run inline on the page through the same host and
// chunked scheduler, so the page still yields every ~50 ms; only slotStats' enumeration is heavier there.

import {
  isResult, scaleFor, type FromWorker, type JobName, type ParamsOf, type ResultOf, type ToWorker,
} from "./protocol";
import { realScheduler } from "./scheduler";

/** The part of `Worker` the client uses (tests pass a fake). */
export interface WorkerLike {
  postMessage(msg: ToWorker): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  terminate(): void;
}

export class SimCancelled extends Error {
  constructor() { super("cancelled"); this.name = "SimCancelled"; }
}

export interface RunOpts {
  /** 0..1, at most every ~50 ms of work, and 1 at the end. */
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** Skip the low-concurrency 0.3× scaling. */
  noScale?: boolean;
}
export interface SimRun<T> {
  id: number;
  /** Rejects with SimCancelled when cancelled, Error on failure. */
  promise: Promise<T>;
  cancel(): void;
}
export interface SimClient {
  run<J extends JobName>(job: J, params: ParamsOf<J>, o?: RunOpts): SimRun<ResultOf<J>>;
  /** Like run, but first cancels the previous run started with the same key (e.g. while a slider moves). */
  latest<J extends JobName>(key: string, job: J, params: ParamsOf<J>, o?: RunOpts): SimRun<ResultOf<J>>;
  /** Iteration scale the worker applies on this device (1 or 0.3), for labels before a result arrives. */
  readonly scale: number;
  dispose(): void;
}

function hwConcurrency(): number | undefined {
  const n = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator;
  return n?.hardwareConcurrency;
}

/** The real worker. Kept in its own function so Vite sees the `new Worker(new URL(...))` pattern literally. */
export function spawnWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

/**
 * Same host as the worker, on this thread. Messages are delivered asynchronously like a real worker's.
 * The simulation code is loaded with a dynamic import, so it is not part of the page's own chunk.
 */
export function inlineWorker(scale = scaleFor(hwConcurrency())): WorkerLike {
  let host: Promise<{ onMessage(m: ToWorker): unknown }> | null = null;
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      host ??= import("./jobs").then((j) => j.createHost((m) => { w.onmessage?.({ data: m }); }, { scale, scheduler: realScheduler() }));
      host.then((h) => { void h.onMessage(msg); }, (err) => w.onerror?.(err));
    },
    terminate() { w.onmessage = null; },
  };
  return w;
}

interface Pending { resolve(v: unknown): void; reject(e: unknown): void; onProgress?: (p: number) => void }

export function createSimClient(o: { spawn?: () => WorkerLike; fallback?: () => WorkerLike } = {}): SimClient {
  const spawn = o.spawn ?? (typeof Worker !== "undefined" ? spawnWorker : undefined);
  const fallback = o.fallback ?? (() => inlineWorker());
  let w: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const keyed = new Map<string, SimRun<unknown>>();

  const onMessage = (e: { data: FromWorker }) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;   // cancelled or unknown: ignore late messages
    if (!isResult(m)) { p.onProgress?.(m.p); return; }
    pending.delete(m.id);
    if (m.ok) p.resolve(m.data);
    else p.reject(m.cancelled ? new SimCancelled() : new Error(m.error));
  };

  const attach = (x: WorkerLike): WorkerLike => {
    x.onmessage = onMessage;
    x.onerror = (err) => {
      // the worker failed to load or crashed: fail what was in flight, run later jobs inline
      for (const [, p] of pending) p.reject(err instanceof Error ? err : new Error("simulation worker failed"));
      pending.clear();
      try { x.terminate(); } catch { /* already gone */ }
      w = attach(fallback());
    };
    return x;
  };

  const ensure = (): WorkerLike => {
    if (w) return w;
    let x: WorkerLike | null = null;
    if (spawn) { try { x = spawn(); } catch { x = null; } }
    w = attach(x ?? fallback());
    return w;
  };

  const client: SimClient = {
    scale: scaleFor(hwConcurrency()),
    run(job, params, ro = {}) {
      const id = nextId++;
      const worker = ensure();
      let cancel = () => {};
      const promise = new Promise<never>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: ro.onProgress });
        cancel = () => {
          if (!pending.delete(id)) return;
          try { worker.postMessage({ id, cancel: true }); } catch { /* worker gone */ }
          reject(new SimCancelled());
        };
      });
      if (ro.signal) {
        if (ro.signal.aborted) cancel();
        else ro.signal.addEventListener("abort", () => cancel(), { once: true });
      }
      if (pending.has(id)) worker.postMessage({ id, job, params, noScale: ro.noScale });
      return { id, promise, cancel: () => cancel() };
    },
    latest(key, job, params, ro) {
      keyed.get(key)?.cancel();
      const r = client.run(job, params, ro);
      keyed.set(key, r as SimRun<unknown>);
      const clear = () => { if (keyed.get(key) === (r as SimRun<unknown>)) keyed.delete(key); };
      r.promise.then(clear, clear);
      return r;
    },
    dispose() {
      for (const [, p] of pending) p.reject(new SimCancelled());
      pending.clear();
      keyed.clear();
      if (w) { try { w.terminate(); } catch { /* ignore */ } w = null; }
    },
  };
  return client;
}
