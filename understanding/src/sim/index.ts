// Page-side entry for sections: the worker client, the model builder and the result types.
// The simulation code itself (bankroll/strategy/slotDist) is only imported as types here, so it stays in the
// worker chunk.

export { createSimClient, SimCancelled, type SimClient, type SimRun, type RunOpts } from "./client";
export { buildModel, type StrategyModel, type BjModel, type RouletteModel, type CrashModel } from "./model";
export { scaleFor, type JobName, type ParamsOf, type ResultOf, type ScaleInfo, type SlotStatsResult } from "./protocol";
export type { BankrollParams, BankrollResult, BetSystem, Payoff } from "./bankroll";
export type { StrategyParams, StrategyResult, ArmResult, ArmId, StrategyGame, CrashTargetsParams, CrashTargetsResult } from "./strategy";
export type { SlotDist } from "./slotDist";
export type { DistSummary } from "./stats";
