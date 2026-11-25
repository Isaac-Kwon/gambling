/**
 * Roulette through the headless harness (ARCHITECTURE §11.1): the same scripted 100 rounds with fx on and off give
 * identical outcomes; the bet layout is logged in `dec`; money moves exactly as the rules engine says.
 * (run.ts has no roulette driver yet; this file drives the core directly with createHeadlessCtx.)
 */
import { describe, expect, it } from "vitest";
import { tierOf } from "../../shared/config";
import { settle, type Placed, type RouletteBet } from "../../shared/rules/roulette";
import type { Ev } from "../../shared/schema";
import { createRouletteCore, headlessUi, type RouletteCore } from "../games/roulette/core";
import { createHeadlessCtx } from "./ctx";

const straight = (n: number): RouletteBet => ({ kind: "straight", n });

/** Deterministic player: what it does depends on the round index only, never on a result. */
function playerStep(core: RouletteCore, i: number): void {
  const put = (bet: RouletteBet, chip: number, times = 1) => { core.setChip(chip); for (let k = 0; k < times; k++) core.place(bet); };
  switch (i % 8) {
    case 0: core.clear(); put({ kind: "red" }, 50); break;
    case 1: core.clear(); put(straight(17), 10); put({ kind: "split", a: 14, b: 17 }, 10, 2); put({ kind: "split", a: 0, b: 2 }, 10); break;
    case 2: core.clear(); put({ kind: "dozen", i: 2 }, 100); put({ kind: "column", i: 3 }, 100); break;
    case 3: core.clear(); core.rebet(); break;                       // the layout of round 3's predecessor
    case 4: core.clear(); put({ kind: "black" }, 50, 2); put({ kind: "odd" }, 10, 2); put({ kind: "high" }, 10); core.undo(); break;
    case 5: put(straight(0), 10); put({ kind: "split", a: 35, b: 36 }, 50); break;   // adds to the layout of round 4
    case 6: core.clear(); put({ kind: "low" }, 500, 3); put(straight(36), 500); break;
    default: core.clear(); for (const n of [1, 5, 9, 12, 14, 16, 18, 19, 21, 23]) put(straight(n), 10); break;
  }
  if (i % 13 === 5) core.setTurbo(i % 26 === 5);
}

const outcomes = (evs: readonly Ev[]) =>
  evs.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec }));

async function play(seed: string, fx: "on" | "off", n = 100) {
  const h = createHeadlessCtx({ seed, fx, game: "roulette", startCredits: 1_000_000 });
  const core = createRouletteCore(h.ctx, headlessUi());
  const layouts: Placed[][] = [];
  for (let i = 0; i < n; i++) {
    playerStep(core, i);
    layouts.push(core.state.placed);
    const ev = await core.spin({ gesture: i % 5 === 4 ? "swipe" : "tap" });
    expect(ev).not.toBeNull();
  }
  await h.ctx.fx.idle();
  await h.rt.whenSettled();
  core.dispose();
  return { h, layouts };
}

describe("roulette headless runs", () => {
  it("100 scripted rounds: outcomes equal with fx on and off", async () => {
    const on = await play("rr-parity", "on");
    const off = await play("rr-parity", "off");
    const evOn = on.h.rt.logger.session.events, evOff = off.h.rt.logger.session.events;
    expect(evOn).toHaveLength(100);
    expect(outcomes(evOn)).toEqual(outcomes(evOff));
    expect(on.h.rt.wallet.balance).toBe(off.h.rt.wallet.balance);

    // off records nothing, on records stimuli
    expect(evOff.every((e) => Array.isArray(e.fx) && e.fx.length === 0)).toBe(true);
    expect(evOn.some((e) => (e.fx ?? []).length > 0)).toBe(true);
    for (const e of evOn) {
      const tier = (e.fx ?? []).filter((r) => r.type === "tier");
      expect(tier.length).toBe(e.payout > 0 ? 1 : 0);
      if (e.payout === 0) expect((e.fx ?? []).some((r) => /^(countup|particles|shake|flash|haptic)/.test(r.type))).toBe(false);
    }
    // presentation fields: tier and board always; celebrate only when shown
    for (const [i, e] of evOn.entries()) {
      const d = e.disp as { tier: number; celebrate?: boolean; board: number[] };
      expect(d.tier).toBe(tierOf(e.payout, e.bet));
      expect(d.celebrate === true).toBe(e.payout > 0);
      expect(d.board).toEqual((evOff[i].disp as { board: number[] }).board);
      expect((evOff[i].disp as Record<string, unknown>).celebrate).toBeUndefined();
    }
    expect(evOn.some((e) => e.payout > 0 && e.payout < e.bet)).toBe(true);   // celebrated although below the total bet
    expect(evOn.some((e) => e.payout === 0)).toBe(true);
  });

  it("dec holds the bet layout of every round and money moves as settle() says", async () => {
    const { h, layouts } = await play("rr-money", "on");
    let bal = 1_000_000;
    for (const [i, e] of h.rt.logger.session.events.entries()) {
      expect(e.game).toBe("roulette");
      expect(e.round).toBe(i + 1);
      const dec = e.dec as { bets: Placed[] };
      expect(dec.bets).toEqual(layouts[i]);
      for (const b of dec.bets) expect(Object.keys(b).sort()).toEqual(["amt", "bet"]);
      const n = (e.out as { n: number }).n;
      const s = settle(dec.bets, n);
      expect(e.bet).toBe(s.totalBet);
      expect(e.payout).toBe(s.payout);
      expect(e.net).toBe(s.net);
      bal += s.net;
      expect(e.balance).toBe(bal);
    }
    expect(h.rt.wallet.balance).toBe(bal);
  });

  it("the roulette stream is not disturbed by other games (roulette 50 → other game → roulette 50 = roulette 100)", async () => {
    const solo = await play("rr-order", "on", 100);
    const h = createHeadlessCtx({ seed: "rr-order", fx: "on", game: "roulette", startCredits: 1_000_000 });
    const core = createRouletteCore(h.ctx, headlessUi());
    for (let i = 0; i < 100; i++) {
      if (i === 50) {
        const other = h.ctxFor("slot");
        const r = other.rounds.begin({ bet: 20 });
        r.settle({ payout: 0 });
      }
      playerStep(core, i);
      await core.spin();
    }
    const pick = (evs: readonly Ev[]) => evs.filter((e) => e.game === "roulette").map((e) => ({ round: e.round, bet: e.bet, payout: e.payout, out: e.out, dec: e.dec }));
    expect(pick(h.rt.logger.session.events)).toEqual(pick(solo.h.rt.logger.session.events));
  });
});
