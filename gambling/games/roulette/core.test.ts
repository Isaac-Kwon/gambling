import { describe, expect, it } from "vitest";
import { MIN_BET, tierOf } from "../../../shared/config";
import { isValid, settle, spinWheel, WHEEL_ORDER, type Placed, type RouletteBet } from "../../../shared/rules/roulette";
import { createHeadlessCtx } from "../../harness/ctx";
import {
  betKey, checkLayout, colorOf, createRouletteCore, headlessUi, HISTORY_LEN, limitOf, QUICK_MS, resolveNumberTap, resolveZeroTap,
  SPIN_MS, stackChip, STORE_HIST, STORE_LAST, streaks, TABLE_MAX, TURBO_MS, type RouletteUi,
} from "./core";
import {
  ballDeg, ballRadius, ballXY, DROP_AT, makeAnim, pocketDeg, pocketIndex, pocketUnder, POCKET_R, POCKETS, STEP, TRACK_R, wheelDeg,
} from "./wheel";

const straight = (n: number): RouletteBet => ({ kind: "straight", n });
const red: RouletteBet = { kind: "red" };

describe("layout rules", () => {
  it("rejects invalid bets and amounts", () => {
    const bad: Placed[][] = [
      [{ bet: straight(37), amt: 10 }],
      [{ bet: straight(-1), amt: 10 }],
      [{ bet: { kind: "split", a: 1, b: 5 }, amt: 10 }],       // not adjacent
      [{ bet: { kind: "split", a: 3, b: 4 }, amt: 10 }],       // row wrap
      [{ bet: { kind: "split", a: 0, b: 4 }, amt: 10 }],
      [{ bet: { kind: "dozen", i: 4 as 1 }, amt: 10 }],
      [{ bet: red, amt: 0 }],
      [{ bet: red, amt: -10 }],
      [{ bet: red, amt: 10.5 }],
    ];
    for (const l of bad) expect(checkLayout(l)).toEqual({ ok: false, reason: "invalid" });
    expect(checkLayout([])).toEqual({ ok: false, reason: "empty" });
    expect(isValid({ kind: "split", a: 0, b: 2 })).toBe(true);
    expect(isValid({ kind: "split", a: 35, b: 36 })).toBe(true);
  });

  it("per-bet limits and the table maximum", () => {
    expect(limitOf(straight(5))).toBe(500);
    expect(limitOf({ kind: "split", a: 1, b: 2 })).toBe(1000);
    expect(limitOf({ kind: "dozen", i: 1 })).toBe(2000);
    expect(limitOf({ kind: "column", i: 3 })).toBe(2000);
    expect(limitOf(red)).toBe(5000);
    expect(checkLayout([{ bet: straight(5), amt: 500 }])).toEqual({ ok: true, total: 500 });
    expect(checkLayout([{ bet: straight(5), amt: 510 }])).toEqual({ ok: false, reason: "limit" });
    // the same spot placed twice adds up against its limit
    expect(checkLayout([{ bet: straight(5), amt: 300 }, { bet: straight(5), amt: 300 }])).toEqual({ ok: false, reason: "limit" });
    const full: Placed[] = [{ bet: red, amt: 5000 }, { bet: { kind: "black" }, amt: 5000 }];
    expect(checkLayout(full)).toEqual({ ok: true, total: TABLE_MAX });
    expect(checkLayout([...full, { bet: straight(1), amt: 10 }])).toEqual({ ok: false, reason: "table" });
  });

  it("bet keys identify a spot (split order does not matter)", () => {
    expect(betKey({ kind: "split", a: 14, b: 17 })).toBe(betKey({ kind: "split", a: 17, b: 14 }));
    expect(new Set([betKey(red), betKey({ kind: "dozen", i: 1 }), betKey({ kind: "column", i: 1 }), betKey(straight(1))]).size).toBe(4);
  });

  it("colours and streaks", () => {
    expect(colorOf(0)).toBe("green");
    expect(colorOf(1)).toBe("red");
    expect(colorOf(2)).toBe("black");
    expect(streaks([1, 3, 5, 2, 4, 0, 6, 8, 10, 12])).toEqual([
      { from: 0, to: 2, color: "red", len: 3 },
      { from: 6, to: 8, color: "black", len: 3 },
    ]);
    expect(streaks([1, 3, 2, 4, 6, 8, 10])).toEqual([{ from: 2, to: 6, color: "black", len: 5 }]);
    expect(streaks([1, 3, 0, 5, 7])).toEqual([]);
    expect(streaks([])).toEqual([]);
  });

  it("taps near a shared edge become splits, in the middle a straight; every result is a valid bet", () => {
    expect(resolveNumberTap(17, 0.5, 0.5)).toEqual(straight(17));
    expect(resolveNumberTap(17, 0.05, 0.5)).toEqual({ kind: "split", a: 16, b: 17 });
    expect(resolveNumberTap(17, 0.95, 0.5)).toEqual({ kind: "split", a: 17, b: 18 });
    expect(resolveNumberTap(17, 0.5, 0.03)).toEqual({ kind: "split", a: 14, b: 17 });
    expect(resolveNumberTap(17, 0.5, 0.97)).toEqual({ kind: "split", a: 17, b: 20 });
    // outer edges have no neighbour: straight
    expect(resolveNumberTap(16, 0.03, 0.5)).toEqual(straight(16));
    expect(resolveNumberTap(18, 0.97, 0.5)).toEqual(straight(18));
    expect(resolveNumberTap(34, 0.5, 0.99)).toEqual(straight(34));   // last row: nothing below
    expect(resolveNumberTap(2, 0.5, 0.02)).toEqual({ kind: "split", a: 0, b: 2 });   // top row touches zero
    expect(resolveNumberTap(1, 0.3, 0.5)).toEqual(straight(1));
    for (let n = 1; n <= 36; n++) {
      for (const fx of [0, 0.1, 0.5, 0.9, 1]) for (const fy of [0, 0.1, 0.5, 0.9, 1]) expect(isValid(resolveNumberTap(n, fx, fy))).toBe(true);
    }
    expect(resolveZeroTap(0.5, 0.5)).toEqual(straight(0));
    expect(resolveZeroTap(0.1, 0.98)).toEqual({ kind: "split", a: 0, b: 1 });
    expect(resolveZeroTap(0.5, 0.98)).toEqual({ kind: "split", a: 0, b: 2 });
    expect(resolveZeroTap(0.95, 0.98)).toEqual({ kind: "split", a: 0, b: 3 });
  });

  it("the stack shows the largest chip not above its value", () => {
    expect([10, 40, 50, 99, 100, 499, 500, 4000].map(stackChip)).toEqual([10, 10, 50, 50, 100, 100, 500, 500]);
  });
});

describe("wheel motion", () => {
  const seed = { wheelTurn: 200, ballStart: 123, revs: 6 };
  it("pocket order matches the rules engine and the ball ends on the result pocket for every number", () => {
    expect(POCKETS).toBe(37);
    for (let n = 0; n <= 36; n++) {
      expect(WHEEL_ORDER[pocketIndex(n)]).toBe(n);
      for (const rest of [0, 77.5, 301]) {
        const a = makeAnim(n, rest, seed);
        expect(WHEEL_ORDER[pocketUnder(a, 1)]).toBe(n);
        const rel = (((ballDeg(a, 1) - wheelDeg(a, 1) - pocketDeg(n)) % 360) + 360) % 360;
        expect(Math.min(rel, 360 - rel)).toBeLessThan(1e-6);
        expect(ballXY(a, 1).r).toBeCloseTo(POCKET_R, 6);
      }
    }
  });

  it("the ball runs counter-clockwise, slowing down, on the track first and drops into the pocket ring after", () => {
    const a = makeAnim(17, 10, seed);
    expect(a.bTurn).toBeLessThan(-360 * 6);
    let prev = ballDeg(a, 0), prevV = Infinity;
    for (let i = 1; i <= 140; i++) {
      const p = (i / 140) * DROP_AT;
      const d = ballDeg(a, p), v = prev - d;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(prevV + 1e-9);
      prev = d; prevV = v;
    }
    expect(ballRadius(0)).toBe(TRACK_R);
    expect(ballRadius(DROP_AT)).toBe(TRACK_R);
    expect(ballRadius(1)).toBeCloseTo(POCKET_R, 6);
    for (let i = 0; i <= 100; i++) {
      const r = ballRadius(i / 100);
      expect(r).toBeGreaterThanOrEqual(POCKET_R - 1e-9);
      expect(r).toBeLessThanOrEqual(TRACK_R + 1e-9);
    }
    expect(wheelDeg(a, 0)).toBe(10);
    expect(wheelDeg(a, 1)).toBe(210);
    expect(STEP * POCKETS).toBeCloseTo(360, 9);
  });
});

function recUi(): RouletteUi & { log: string[] } {
  const base = headlessUi();
  const log: string[] = [];
  return {
    ...base, log,
    spinStart: (p) => log.push(`start:${p.n}:${p.durationMs}`),
    result: (p) => log.push(`result:${p.n}`),
    reject: (why) => log.push(`reject:${why}`),
    short: (k) => log.push(`short:${k}`),
  };
}

/** Puts `amt` credits on a spot in chip-sized taps. */
function stack(core: ReturnType<typeof createRouletteCore>, bet: RouletteBet, amt: number): void {
  let left = amt;
  while (left > 0) {
    const c = left >= 500 ? 500 : left >= 100 ? 100 : left >= 50 ? 50 : 10;
    core.setChip(c);
    core.place(bet);
    left -= c;
  }
}

const layoutA: Placed[] = [
  { bet: straight(17), amt: 50 }, { bet: { kind: "split", a: 14, b: 17 }, amt: 100 }, { bet: red, amt: 200 },
  { bet: { kind: "dozen", i: 2 }, amt: 100 }, { bet: { kind: "column", i: 1 }, amt: 10 }, { bet: { kind: "low" }, amt: 20 },
];

describe("core", () => {
  it("placing, removing, undo, clear; chips merge on the same spot; nothing is debited before the spin", () => {
    const h = createHeadlessCtx({ seed: "place", fx: "on", game: "roulette" });
    const core = createRouletteCore(h.ctx, recUi());
    core.setChip(100);
    expect(core.place(red)).toEqual({ ok: true });
    expect(core.place(red)).toEqual({ ok: true });
    core.setChip(10);
    core.place(straight(5));
    core.place({ kind: "split", a: 5, b: 4 });
    expect(core.state.total).toBe(220);
    expect(core.state.placed).toEqual([{ bet: red, amt: 200 }, { bet: straight(5), amt: 10 }, { bet: { kind: "split", a: 4, b: 5 }, amt: 10 }]);
    expect(h.rt.wallet.balance).toBe(10_000);
    expect(core.undo()).toBe(true);
    expect(core.state.total).toBe(210);
    expect(core.remove(red)).toBe(true);
    expect(core.state.placed).toEqual([{ bet: straight(5), amt: 10 }]);
    expect(core.remove(red)).toBe(false);
    expect(core.undo()).toBe(true);
    expect(core.undo()).toBe(false);
    core.place(red);
    expect(core.clear()).toBe(true);
    expect(core.state.placed).toEqual([]);
    expect(core.clear()).toBe(false);
    expect(h.rt.logger.session.events).toHaveLength(0);
  });

  it("limits and the table maximum reject a chip without changing anything", () => {
    const h = createHeadlessCtx({ seed: "limit", fx: "on", game: "roulette", startCredits: 1_000_000 });
    const ui = recUi();
    const core = createRouletteCore(h.ctx, ui);
    core.setChip(500);
    expect(core.place(straight(1))).toEqual({ ok: true });
    expect(core.place(straight(1))).toEqual({ ok: false, reason: "limit" });
    for (let i = 0; i < 10; i++) core.place(red);
    expect(core.state.placed.find((p) => p.bet.kind === "red")!.amt).toBe(5000);
    expect(core.place(red)).toEqual({ ok: false, reason: "limit" });
    for (let i = 0; i < 9; i++) core.place({ kind: "black" });
    expect(core.state.total).toBe(500 + 5000 + 4500);
    expect(core.place({ kind: "high" })).toEqual({ ok: false, reason: "table" });
    expect(core.place({ kind: "split", a: 1, b: 9 })).toEqual({ ok: false, reason: "invalid" });
    expect(core.state.total).toBe(10_000);
    expect(ui.log.filter((x) => x.startsWith("reject:"))).toEqual(["reject:limit", "reject:limit", "reject:table", "reject:invalid"]);
  });

  it("chips beyond the balance are refused", () => {
    const h = createHeadlessCtx({ seed: "funds", fx: "on", game: "roulette", startCredits: 120 });
    const core = createRouletteCore(h.ctx, recUi());
    core.setChip(100);
    expect(core.place(red).ok).toBe(true);
    expect(core.place({ kind: "black" })).toEqual({ ok: false, reason: "funds" });
    core.setChip(10);
    expect(core.place({ kind: "black" }).ok).toBe(true);
    expect(core.state.free).toBe(10);
  });

  it("a spin settles exactly as settle() says: debit at spin, number from the result stream, dec = layout", async () => {
    const h = createHeadlessCtx({ seed: "settle", fx: "on", game: "roulette", startCredits: 100_000 });
    const ui = recUi();
    const core = createRouletteCore(h.ctx, ui);
    for (const p of layoutA) stack(core, p.bet, p.amt);
    expect(core.state.placed).toEqual(layoutA);
    for (let i = 0; i < 25; i++) {
      const before = h.rt.wallet.balance;
      const p = core.spin({ gesture: "tap" });
      expect(core.state.phase).toBe("spin");
      expect(h.rt.wallet.balance).toBe(before - 480);   // debited at spin
      const ev = (await p)!;
      const n = spinWheel(h.ctx.rng.res("roulette").at(i + 1));
      const s = settle(layoutA, n);
      expect(ev.out).toEqual({ n });
      expect(ev.bet).toBe(480);
      expect(ev.payout).toBe(s.payout);
      expect(ev.net).toBe(s.net);
      expect(ev.round).toBe(i + 1);
      expect(ev.balance).toBe(before - 480 + s.payout);
      expect(ev.dec).toEqual({ bets: layoutA });
      const disp = ev.disp as { tier: number; celebrate?: boolean; board: number[] };
      expect(disp.tier).toBe(tierOf(s.payout, 480));
      expect(disp.celebrate === true).toBe(s.payout > 0);
      expect(disp.board.at(-1)).toBe(n);
      expect(disp.board.length).toBe(Math.min(i + 1, HISTORY_LEN));
      expect(ev.ctl).toEqual({ gesture: "tap" });
      expect(core.state.placed).toEqual(layoutA);   // the layout stays on the table after the spin
    }
    expect(ui.log.filter((x) => x.startsWith("start:")).every((x) => x.endsWith(`:${SPIN_MS}`))).toBe(true);
    expect(h.ctx.store.get(STORE_HIST)).toHaveLength(HISTORY_LEN);
    expect(h.ctx.store.get(STORE_LAST)).toEqual(layoutA);
  });

  it("wins celebrate by payout / total bet; a loss records no effect at all", async () => {
    // a seed whose first number is 17 (straight pays 36x) and one whose first number is 0 (outside bets lose)
    let win = "", lose = "";
    for (let k = 0; k < 3000 && !(win && lose); k++) {
      const n = spinWheel(createHeadlessCtx({ seed: "c" + k, fx: "on" }).ctx.rng.res("roulette").at(1));
      if (n === 17 && !win) win = "c" + k;
      if (n === 0 && !lose) lose = "c" + k;
    }
    const a = createHeadlessCtx({ seed: win, fx: "on", game: "roulette" });
    const ca = createRouletteCore(a.ctx, headlessUi());
    ca.setChip(100);
    ca.place(straight(17));
    ca.place({ kind: "black" });   // 17 is black
    const eva = (await ca.spin())!;
    await a.ctx.fx.idle();
    expect(eva.payout).toBe(3600 + 200);
    expect(eva.disp).toMatchObject({ tier: tierOf(3800, 200), celebrate: true });
    expect(eva.fx!.find((r) => r.type === "tier")!.k).toBe(3);   // 19x the total bet = MEGA
    expect(eva.fx!.some((r) => r.type === "countup")).toBe(true);

    const b = createHeadlessCtx({ seed: lose, fx: "on", game: "roulette" });
    const cb = createRouletteCore(b.ctx, headlessUi());
    cb.setChip(100);
    cb.place(red);
    cb.place({ kind: "even" });
    const evb = (await cb.spin())!;
    expect(evb.out).toEqual({ n: 0 });
    expect(evb.payout).toBe(0);
    expect(evb.net).toBe(-200);
    for (const r of evb.fx ?? []) expect(/^(tier|countup|particles|shake|flash|haptic)/.test(r.type)).toBe(false);
    expect((evb.disp as Record<string, unknown>).celebrate).toBeUndefined();
  });

  it("without the presentation layer the number comes after 150 ms and nothing is shown or recorded", async () => {
    const h = createHeadlessCtx({ seed: "off", fx: "off", game: "roulette" });
    const ui = recUi();
    const core = createRouletteCore(h.ctx, ui);
    core.setChip(50);
    core.place(red);
    const ev = (await core.spin())!;
    expect(ui.log[0]).toMatch(new RegExp(`^start:\\d+:${QUICK_MS}$`));
    expect(ev.fx).toEqual([]);
    expect((ev.disp as Record<string, unknown>).celebrate).toBeUndefined();
  });

  it("turbo shortens the wheel to 2.5 s and is logged", async () => {
    const h = createHeadlessCtx({ seed: "turbo", fx: "on", game: "roulette" });
    const ui = recUi();
    const core = createRouletteCore(h.ctx, ui);
    core.setTurbo(true);
    core.setChip(10);
    core.place(red);
    const ev = (await core.spin())!;
    expect(ui.log[0].endsWith(`:${TURBO_MS}`)).toBe(true);
    expect(ev.ctl).toEqual({ gesture: "tap", turbo: true });
  });

  it("an empty table starts no round; the layout shrinks to what the balance covers after a spin", async () => {
    const h = createHeadlessCtx({ seed: "none", fx: "on", game: "roulette", startCredits: 300 });
    const ui = recUi();
    const core = createRouletteCore(h.ctx, ui);
    expect(await core.spin()).toBeNull();
    expect(ui.log).toContain("reject:empty");
    core.setChip(100);
    core.place(red); core.place(red); core.place(red);
    expect(core.state.total).toBe(300);
    expect(h.rt.logger.session.events).toHaveLength(0);
    await core.spin();
    expect(core.state.total).toBeLessThanOrEqual(h.rt.wallet.balance);
    const low = createHeadlessCtx({ seed: "low", fx: "on", game: "roulette", startCredits: MIN_BET.roulette + 5 });
    const c2 = createRouletteCore(low.ctx, recUi());
    c2.setChip(10);
    c2.place(red);
    expect(c2.place(red)).toEqual({ ok: false, reason: "funds" });
  });

  it("rebet puts the last layout back on an empty table (as far as the balance allows)", async () => {
    const h = createHeadlessCtx({ seed: "rebet", fx: "on", game: "roulette", startCredits: 100_000 });
    const core = createRouletteCore(h.ctx, headlessUi());
    expect(core.state.canRebet).toBe(false);
    core.setChip(100);
    core.place(red); core.place(straight(3));
    await core.spin();
    expect(core.state.canRebet).toBe(false);   // the layout is still on the table
    core.clear();
    expect(core.state.canRebet).toBe(true);
    expect(core.rebet()).toBe(true);
    expect(core.state.placed).toEqual([{ bet: red, amt: 100 }, { bet: straight(3), amt: 100 }]);
    expect(core.rebet()).toBe(false);
    // a new core (the player left and came back) still knows it
    core.dispose();
    const again = createRouletteCore(h.ctx, headlessUi());
    expect(again.state.placed).toEqual([]);
    expect(again.state.canRebet).toBe(true);
    expect(again.state.history).toHaveLength(1);
  });

  it("dispose during a spin settles the round with its fixed outcome; the session is free again", async () => {
    const ref = createHeadlessCtx({ seed: "disp", fx: "on", game: "roulette" });
    const rc = createRouletteCore(ref.ctx, headlessUi());
    rc.setChip(50); rc.place(red);
    const refEv = (await rc.spin())!;

    const h = createHeadlessCtx({ seed: "disp", fx: "on", game: "roulette" });
    // a clock whose waits never resolve keeps the spin in flight
    const ctx = { ...h.ctx, clock: { ...h.ctx.clock, wait: () => new Promise<void>(() => undefined) } };
    const core = createRouletteCore(ctx, headlessUi());
    core.setChip(50); core.place(red);
    void core.spin();
    expect(core.canLeave()).toBe(false);
    core.dispose();
    const evs = h.rt.logger.session.events;
    expect(evs).toHaveLength(1);
    expect(evs[0].out).toEqual(refEv.out);
    expect(evs[0].payout).toBe(refEv.payout);
    expect(h.ctx.rounds.active).toBeNull();
  });
});
