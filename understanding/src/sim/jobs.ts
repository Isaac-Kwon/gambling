// Job registry and the message host that runs inside the worker (or inline as a fallback, or in tests).
// No DOM, no `self`: worker.ts wires it to the worker global.

import { SLOTS, type SlotConfig } from "@shared/rules/slot";
import { SLOT_VARIANTS } from "@shared/config";
import { bankrollJob } from "./bankroll";
import { crashTargetsJob, strategyJob } from "./strategy";
import { slotDistCached, type SlotDist } from "./slotDist";
import { drive, type Job, type Scheduler } from "./scheduler";
import {
  isCancel, scaled, type FromWorker, type JobName, type ParamsOf, type ResultOf, type SlotStatsParams,
  type SlotStatsResult, type ToWorker,
} from "./protocol";

const copyDist = (d: SlotDist): SlotDist => ({ ...d, m: d.m.slice(), count: d.count.slice(), tierFreq: d.tierFreq.slice() });

function* slotStatsJob(p: SlotStatsParams): Job<SlotStatsResult> {
  const vs = (p.variants ?? SLOT_VARIANTS).filter((v) => v in SLOTS);
  const out: SlotStatsResult = {};
  for (let i = 0; i < vs.length; i++) {
    const cfg: SlotConfig = SLOTS[vs[i]];
    const job = slotDistCached(cfg);
    let r = job.next();
    while (!r.done) { yield (i + r.value) / vs.length; r = job.next(); }
    out[vs[i]] = copyDist(r.value);   // the cache keeps its own arrays; the copy is transferred
  }
  return out;
}

type Factory<J extends JobName> = (params: ParamsOf<J>, scale: number) => Job<ResultOf<J>>;

function* withScale<T>(job: Job<T>, scale: number, requested: number): Job<T & { scale: number; requested: number }> {
  const r = yield* job;
  return { ...r, scale, requested };
}

/** Each factory applies the device scale to its own iteration count. */
export const JOBS: { [J in JobName]: Factory<J> } = {
  slotStats: (p) => slotStatsJob(p ?? {}),
  bankroll: (p, s) => withScale(bankrollJob({ ...p, players: scaled(p.players, s) }), s, p.players),
  strategy: (p, s) => withScale(strategyJob({ ...p, n: scaled(p.n, s) }), s, p.n),
  crashTargets: (p, s) => withScale(crashTargetsJob({ ...p, n: scaled(p.n, s) }), s, p.n),
};

/** Buffers of all typed arrays reachable through plain objects/arrays (deduplicated). */
export function transferList(x: unknown, out: ArrayBuffer[] = [], seen = new Set<unknown>()): ArrayBuffer[] {
  if (x === null || typeof x !== "object" || seen.has(x)) return out;
  seen.add(x);
  if (ArrayBuffer.isView(x)) {
    const b = x.buffer;
    if (b instanceof ArrayBuffer && !out.includes(b)) out.push(b);
    return out;
  }
  if (Array.isArray(x)) { for (const v of x) transferList(v, out, seen); return out; }
  for (const v of Object.values(x as Record<string, unknown>)) transferList(v, out, seen);
  return out;
}

export interface HostEnv {
  /** Iteration scale for this device (protocol.scaleFor). */
  scale: number;
  scheduler: Scheduler;
  sliceMs?: number;
}
export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;

/** Message handler for the worker side. Several jobs may be in flight; they interleave slice by slice. */
export function createHost(post: Post, env: HostEnv) {
  const live = new Map<number, { cancelled: boolean }>();
  return {
    /** Number of jobs currently running (tests). */
    get running(): number { return live.size; },
    onMessage(m: ToWorker): Promise<void> | void {
      if (isCancel(m)) { const j = live.get(m.id); if (j) j.cancelled = true; return; }
      const { id, job } = m;
      const factory = JOBS[job] as Factory<JobName> | undefined;
      if (!factory) { post({ id, ok: false, error: `unknown job ${String(job)}` }, []); return; }
      const state = { cancelled: false };
      live.set(id, state);
      let gen: Job<unknown>;
      try { gen = factory(m.params as never, m.noScale ? 1 : env.scale); }
      catch (e) { live.delete(id); post({ id, ok: false, error: String((e as Error)?.message ?? e) }, []); return; }
      return drive(gen, env.scheduler, {
        sliceMs: env.sliceMs,
        isCancelled: () => state.cancelled,
        onProgress: (p) => { if (!state.cancelled) post({ id, p }, []); },
      }).then(
        (r) => {
          if (r.ok) post({ id, ok: true, data: r.value }, transferList(r.value));
          else post({ id, ok: false, error: "cancelled", cancelled: true }, []);
        },
        (e) => post({ id, ok: false, error: String((e as Error)?.message ?? e) }, []),
      ).finally(() => live.delete(id));
    },
  };
}
