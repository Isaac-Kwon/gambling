/**
 * fx on/off parity (ARCHITECTURE §11.1): same seed, same script → identical outcomes; only what was shown differs.
 * "on" = real createFx over nullBackend, "off" = createNullFx (see ctx.ts).
 */
import { describe, expect, it } from "vitest";
import { tierOf, type SlotVariant } from "../../shared/config";
import { evaluate, SLOTS } from "../../shared/rules/slot";
import type { Ev } from "../../shared/schema";
import { LINES, type SlotCore } from "../games/slot/core";
import { slotBot, slotFlat } from "./bots";
import { createHeadlessCtx } from "./ctx";
import { runScript } from "./run";

const outcomes = (evs: readonly Ev[]) =>
  evs.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec }));

async function play(seed: string, fx: "on" | "off", sv: SlotVariant, n = 300) {
  const h = createHeadlessCtx({ seed, fx, sv, startCredits: 1_000_000 });
  await runScript("slot", h.ctx, { kind: "slot", steps: slotBot(n) });
  await h.rt.whenSettled();
  return h;
}

describe.each(["a", "b"] as const)("slot variant %s", (sv) => {
  it("300 spins (bet changes, STOP every 7th, some turbo): outcomes equal with fx on and off", async () => {
    const on = await play("parity-" + sv, "on", sv);
    const off = await play("parity-" + sv, "off", sv);
    const evOn = on.rt.logger.session.events, evOff = off.rt.logger.session.events;
    expect(evOn).toHaveLength(300);
    expect(outcomes(evOn)).toEqual(outcomes(evOff));
    expect(on.rt.wallet.balance).toBe(off.rt.wallet.balance);

    // off records nothing, on records stimuli
    expect(evOff.every((e) => Array.isArray(e.fx) && e.fx.length === 0)).toBe(true);
    expect(evOn.some((e) => (e.fx ?? []).length > 0)).toBe(true);
    for (const e of evOn) if (e.payout > 0) expect((e.fx ?? []).some((r) => r.type === "tier")).toBe(true);
    for (const e of evOn) if (e.payout === 0) expect((e.fx ?? []).some((r) => r.type === "tier" || r.type === "countup")).toBe(false);

    // presentation fields: tier always, the rest only when shown (never with fx off)
    for (const [i, e] of evOn.entries()) {
      const d = e.disp as { tier: number; celebrate?: boolean; dispVar?: unknown; antic?: number };
      expect(d.tier).toBe(tierOf(e.payout, e.bet));
      expect(d.celebrate === true).toBe(e.payout > 0);
      if (d.antic !== undefined) expect((e.fx ?? []).some((r) => r.type === "antic:reel" && r.k === d.antic)).toBe(true);
      const dOff = evOff[i].disp as Record<string, unknown>;
      expect(dOff).toEqual({ tier: d.tier });
    }
    const dv = evOn.filter((e) => (e.disp as { dispVar?: unknown }).dispVar).length;
    expect(dv).toBeGreaterThan(300 * 0.15);
    expect(dv).toBeLessThan(300 * 0.42);
    expect(evOn.some((e) => (e.disp as { antic?: number }).antic)).toBe(true);
    expect(evOn.some((e) => e.payout > 0 && e.payout < e.bet)).toBe(true);   // celebrated although below the bet

    // controls are logged on both sides
    const script = slotBot(300);
    let turbo = false;
    for (const [i, st] of script.entries()) {
      if (st.turbo !== undefined) turbo = st.turbo;
      for (const e of [evOn[i], evOff[i]]) {
        expect(e.ctl?.stopPressed === true).toBe(st.stop === true);
        expect(e.ctl?.gesture).toBe(st.gesture);
        expect(e.ctl?.turbo === true).toBe(turbo);
        expect(e.ctl?.auto).toBeUndefined();
      }
    }
  });

  it("bets are debited and payouts credited exactly as the rules engine says", async () => {
    const h = await play("money-" + sv, "on", sv, 200);
    const cfg = SLOTS[sv];
    let bal = 1_000_000;
    for (const e of h.rt.logger.session.events) {
      const out = e.out as { stops: number[]; mult: number };
      const lineBet = (e.dec as { lineBet: number }).lineBet;
      expect(e.bet).toBe(lineBet * LINES);
      const ev = evaluate(cfg, out.stops);
      expect(out.mult).toBe(ev.mult);
      expect(e.payout).toBe(ev.mult * lineBet);
      expect(e.net).toBe(e.payout - e.bet);
      bal += e.net;
      expect(e.balance).toBe(bal);
    }
    expect(h.rt.wallet.balance).toBe(bal);
  });
});

describe("slot headless runs", () => {
  it("variant b uses SLOT_B and differs from variant a on the same seed", async () => {
    const a = await play("same", "off", "a", 60);
    const b = await play("same", "off", "b", 60);
    expect(outcomes(a.rt.logger.session.events)).not.toEqual(outcomes(b.rt.logger.session.events));
    for (const e of b.rt.logger.session.events) {
      const out = e.out as { stops: number[]; mult: number };
      expect(evaluate(SLOTS.b, out.stops).mult).toBe(out.mult);
    }
  });

  it("game order does not change slot outcomes (slot 50 → other game 20 → slot 50 = slot 100)", async () => {
    const steps = slotBot(100);
    const solo = createHeadlessCtx({ seed: "order", fx: "on", startCredits: 1_000_000 });
    await runScript("slot", solo.ctx, { kind: "slot", steps });
    const mixed = createHeadlessCtx({ seed: "order", fx: "on", startCredits: 1_000_000 });
    await runScript("slot", mixed.ctx, { kind: "slot", steps: steps.slice(0, 50) });
    const other = await runScript("roulette", mixed.ctxFor("roulette"), { kind: "stub", rounds: 20 });
    expect(other).toHaveLength(20);
    await runScript("slot", mixed.ctx, { kind: "slot", steps: steps.slice(50) });
    const slotOf = (h: typeof solo) => h.rt.logger.session.events.filter((e) => e.game === "slot")
      .map((e) => ({ round: e.round, bet: e.bet, payout: e.payout, out: e.out, dec: e.dec }));
    expect(slotOf(mixed)).toHaveLength(100);
    expect(slotOf(mixed)).toEqual(slotOf(solo));
  });

  it("auto spin stops when the balance no longer covers the bet", async () => {
    for (const fx of ["on", "off"] as const) {
      const h = createHeadlessCtx({ seed: "auto-short", fx, startCredits: 600 });
      let core: SlotCore | null = null;
      await runScript("slot", h.ctx, { kind: "slot", steps: [{ bet: 3, auto: 100 }], onCore: (c) => { core = c; } });
      const evs = h.rt.logger.session.events;
      expect(evs.length).toBeGreaterThan(0);
      expect(evs.length).toBeLessThan(100);
      expect(evs.every((e) => e.ctl?.auto === true && e.ctl.gesture === undefined)).toBe(true);
      expect(evs[evs.length - 1].balance).toBeLessThan(200);
      expect(core!.state.auto).toBe(0);
    }
  });

  it("auto spin stops on suspend (background) and is not resumed", async () => {
    const h = createHeadlessCtx({ seed: "auto-bg", fx: "on", startCredits: 100_000 });
    let n = 0;
    await runScript("slot", h.ctx, {
      kind: "slot", steps: [{ bet: 1, auto: 50 }],
      onCore: (c) => { c.onSettle(() => { if (++n === 3) c.suspend(); }); },
    });
    expect(h.rt.logger.session.events).toHaveLength(3);
  });

  it("auto spins of one script are identical with fx on and off", async () => {
    const run = async (fx: "on" | "off") => {
      const h = createHeadlessCtx({ seed: "auto-par", fx, startCredits: 50_000 });
      await runScript("slot", h.ctx, { kind: "slot", steps: [{ bet: 2, turbo: true, auto: 25 }, ...slotFlat(10, 1), { auto: 10 }] });
      return h.rt.logger.session.events;
    };
    const on = await run("on"), off = await run("off");
    expect(on).toHaveLength(45);
    expect(outcomes(on)).toEqual(outcomes(off));
  });
});
