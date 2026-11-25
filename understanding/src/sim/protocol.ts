// Message protocol between the page (client.ts) and the simulation worker (worker.ts), ARCHITECTURE §10.3:
//   request  {id, job, params}      progress {id, p}      result {id, ok, data} / {id, ok: false, error}
//   cancel   {id, cancel: true}
// Typed arrays in results are transferred, not copied.

import type { SlotVariant } from "@shared/config";
import type { BankrollParams, BankrollResult } from "./bankroll";
import type { CrashTargetsParams, CrashTargetsResult, StrategyParams, StrategyResult } from "./strategy";
import type { SlotDist } from "./slotDist";

export interface SlotStatsParams { variants?: SlotVariant[] }
export type SlotStatsResult = Partial<Record<SlotVariant, SlotDist>>;

/** Added to every Monte Carlo result: how the iteration count was scaled for this device. */
export interface ScaleInfo {
  /** 1, or 0.3 when navigator.hardwareConcurrency ≤ 4. */
  scale: number;
  /** The count the caller asked for (players / n); the result's own field holds the count actually run. */
  requested: number;
}

export interface JobSpec {
  /** Exact distribution of slot variants a/b (32^5 enumeration each, cached in the worker). */
  slotStats: { params: SlotStatsParams; result: SlotStatsResult };
  /** Players × rounds bankroll Monte Carlo. `players` is scaled. */
  bankroll: { params: BankrollParams; result: BankrollResult & ScaleInfo };
  /** Yours / random / optimal arms. `n` is scaled. */
  strategy: { params: StrategyParams; result: StrategyResult & ScaleInfo };
  /** Return per crash target. `n` is scaled. */
  crashTargets: { params: CrashTargetsParams; result: CrashTargetsResult & ScaleInfo };
}
export type JobName = keyof JobSpec;
export type ParamsOf<J extends JobName> = JobSpec[J]["params"];
export type ResultOf<J extends JobName> = JobSpec[J]["result"];

export const JOB_NAMES: readonly JobName[] = ["slotStats", "bankroll", "strategy", "crashTargets"];

export interface RunRequest<J extends JobName = JobName> {
  id: number;
  job: J;
  params: ParamsOf<J>;
  /** Run the requested count even on low-concurrency devices (tests, explicit user choice). */
  noScale?: boolean;
}
export interface CancelRequest { id: number; cancel: true }
export type ToWorker = RunRequest | CancelRequest;

export interface ProgressMsg { id: number; p: number }
export type ResultMsg = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string; cancelled?: true };
export type FromWorker = ProgressMsg | ResultMsg;

export const isCancel = (m: ToWorker): m is CancelRequest => (m as CancelRequest).cancel === true;
export const isResult = (m: FromWorker): m is ResultMsg => "ok" in m;

/** ARCHITECTURE §10.3: hardwareConcurrency ≤ 4 → 0.3× iterations. Unknown concurrency → full count. */
export function scaleFor(hardwareConcurrency: number | undefined): number {
  return typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= 4 ? 0.3 : 1;
}
export const scaled = (n: number, scale: number): number => Math.max(1, Math.round(n * scale));
