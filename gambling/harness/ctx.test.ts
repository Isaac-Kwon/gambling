import { describe, expect, it } from "vitest";
import type { OceanSeq, OceanState } from "../../shared/rules/ocean";
import type { GameCtx } from "../src/types";
import { OCEAN_STATE_KEY } from "../src/session";
import { createHeadlessCtx } from "./ctx";

/** A trivial fake game core: only ctx, no DOM, no wall-clock. Outcome comes from round.res; fx is decoration. */
async function playFake(ctx: GameCtx, rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const bet = [20, 40, 100][i % 3];
    if (!ctx.wallet.canBet(bet)) break;
    const r = ctx.rounds.begin({ bet, ctl: i % 7 === 0 ? { stopPressed: true } : undefined });
    const win = r.res.int(4) === 0;
    const payout = win ? bet * (2 + r.res.int(5)) : 0;
    r.pre.int(10); // presentation draw
    await ctx.clock.wait(150 + (ctx.fx.enabled ? 800 : 0)); // fx-dependent display time must not matter
    const ev = r.settle({ payout, out: { win }, dec: { i } });
    const run = ctx.fx.celebrate({ amount: payout, bet, target: null as never });
    await run.done;
    void ev;
  }
}

const outcomes = (h: ReturnType<typeof createHeadlessCtx>) =>
  h.rt.logger.session.events.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec }));

describe("createHeadlessCtx", () => {
  it("fx on and fx off produce identical outcomes; only Ev.fx differs", async () => {
    const on = createHeadlessCtx({ seed: "par1", fx: "on" });
    const off = createHeadlessCtx({ seed: "par1", fx: "off" });
    await playFake(on.ctx, 120);
    await playFake(off.ctx, 120);
    await on.rt.whenSettled();
    await off.rt.whenSettled();
    expect(outcomes(on)).toEqual(outcomes(off));
    expect(outcomes(on).length).toBeGreaterThan(50);
    expect(off.rt.logger.session.events.every((e) => (e.fx ?? []).length === 0)).toBe(true);
    expect(on.rt.logger.session.events.some((e) => (e.fx ?? []).length > 0)).toBe(true);
  });

  it("is reproducible for a seed and differs across seeds", async () => {
    const a = createHeadlessCtx({ seed: "x", fx: "off" });
    const b = createHeadlessCtx({ seed: "x", fx: "off" });
    const c = createHeadlessCtx({ seed: "y", fx: "off" });
    for (const h of [a, b, c]) await playFake(h.ctx, 40);
    expect(outcomes(a)).toEqual(outcomes(b));
    expect(outcomes(a)).not.toEqual(outcomes(c));
    expect(a.rt.logger.session.events.map((e) => e.t)).toEqual(b.rt.logger.session.events.map((e) => e.t));
  });

  it("game order does not change another game's outcomes", async () => {
    const solo = createHeadlessCtx({ seed: "ord", fx: "on" });
    const mixed = createHeadlessCtx({ seed: "ord", fx: "on" });
    await playFake(solo.ctxFor("slot"), 20);
    await playFake(mixed.ctxFor("slot"), 10);
    await playFake(mixed.ctxFor("roulette"), 5);
    await playFake(mixed.ctxFor("slot"), 10);
    const slotOuts = (h: typeof solo) => h.rt.logger.session.events.filter((e) => e.game === "slot").map((e) => e.out);
    expect(slotOuts(mixed)).toEqual(slotOuts(solo));
  });

  it("flush on CASH OUT is the same Ev with fx on and off", async () => {
    const run = async (fx: "on" | "off") => {
      const h = createHeadlessCtx({ seed: "fl", fx });
      const seq: OceanSeq = { id: 1, round: 1, bet: 20, mult: 100, total: 2000, omen: "shark", delay: 1, chunks: [700, 1300], next: 0, wait: 1 };
      h.rt.store.set(OCEAN_STATE_KEY, { round: 1, nextId: 2, queue: [seq] } satisfies OceanState);
      await playFake(h.ctx, 10);
      h.rt.finish("cashout");
      return h;
    };
    const on = await run("on"), off = await run("off");
    expect(outcomes(on)).toEqual(outcomes(off));
    expect(on.rt.logger.session.unreleased).toBe(2000);
    expect(off.rt.logger.session.endReason).toBe("cashout");
  });
});
