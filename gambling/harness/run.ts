/**
 * Headless runner (ARCHITECTURE §11.1): drives a game's core.ts directly — no DOM, no view, virtual time.
 * Scripts are deterministic, so two runs with the same seed must produce the same outcomes whatever the fx mode.
 * Later games add their own `kind` here (P3-B1).
 */
import type { GameId } from "../../shared/config";
import type { Ev } from "../../shared/schema";
import { createSlotCore, headlessUi, type SlotCore } from "../games/slot/core";
import type { GameCtx } from "../src/types";

/** One slot action. `bet` is a step index; `auto` runs that many auto spins instead of one manual spin. */
export interface SlotStep {
  bet?: number;
  turbo?: boolean;
  /** Press STOP right after the reels start. */
  stop?: boolean;
  gesture?: "tap" | "swipe";
  auto?: number;
}

export type Script =
  | { kind: "slot"; steps: readonly SlotStep[]; onCore?: (core: SlotCore) => void }
  /** Trivial other game: flat bet 10, wins 3x on a third of the draws. Only for game-order tests. */
  | { kind: "stub"; rounds: number };

/** Runs `script` on `ctx` (whose `game` must match); resolves with the Evs settled during the run. */
export async function runScript(game: GameId, ctx: GameCtx, script: Script): Promise<Ev[]> {
  if (ctx.game !== game) throw new Error(`ctx is bound to ${ctx.game}, not ${game}`);
  if (script.kind === "stub") return runStub(ctx, script.rounds);
  if (game !== "slot") throw new Error(`no headless driver for ${game}`);
  const core = createSlotCore(ctx, headlessUi());
  script.onCore?.(core);
  const evs: Ev[] = [];
  const off = core.onSettle((e) => evs.push(e));
  try {
    for (const st of script.steps) {
      if (st.bet !== undefined) core.setBet(st.bet);
      if (st.turbo !== undefined) core.setTurbo(st.turbo);
      if (st.auto) {
        await core.startAuto(st.auto);
        continue;
      }
      const p = core.spin({ gesture: st.gesture });
      if (st.stop) core.stop();
      await p;
    }
    await ctx.fx.idle();
  } finally {
    off();
    core.dispose();
  }
  return evs;
}

async function runStub(ctx: GameCtx, rounds: number): Promise<Ev[]> {
  const evs: Ev[] = [];
  for (let i = 0; i < rounds; i++) {
    if (!ctx.wallet.canBet(10)) break;
    const r = ctx.rounds.begin({ bet: 10, ctl: { gesture: "tap" } });
    const n = r.res.int(37);
    const payout = n % 3 === 0 ? 30 : 0;
    await ctx.clock.wait(ctx.fx.enabled ? 3000 : 150);
    evs.push(r.settle({ payout, out: { n }, dec: { i } }));
    await ctx.fx.celebrate({ amount: payout, bet: 10, target: { textContent: "" } as unknown as HTMLElement }).done;
  }
  return evs;
}
