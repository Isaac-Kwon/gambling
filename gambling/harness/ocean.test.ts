/**
 * ABYSS LEGEND on the headless harness (ARCHITECTURE §8, §11.1): ManualClock, real wallet/session/RoundApi/store,
 * the real fx director over nullBackend ("on") or the null fx ("off"), no DOM. The core is driven directly.
 *
 * What it proves: every round's outcome is exactly `oceanSpin` on the session's queue state; the queue lives in
 * the session store across unmount / remount and other games; bet changes, STOP and turbo never change a released
 * amount; `dec` / `out.omen` / `disp.omen` are logged as §8.3 says; fx on and off give identical outcomes over 300
 * spins (with triggered sequences) including the lump sum at CASH OUT, which the runtime pays exactly once.
 */
import { describe, expect, it } from "vitest";
import { createStreams } from "../../shared/rng";
import { OCEAN, oceanInit, oceanPending, oceanSpin, omenOf, ticketCount, type OceanState } from "../../shared/rules/ocean";
import type { Ev } from "../../shared/schema";
import {
  createOceanCore, decOf, headlessUi, outOf, STEPS, STORE_STATE, type OceanCore,
} from "../games/ocean/core";
import { OCEAN_STATE_KEY } from "../src/session";
import { createHeadlessCtx, type HeadlessCtx } from "./ctx";
import { runScript } from "./run";

// ------------------------------------------------------------------------------------------- helpers

interface Step { bet?: number; turbo?: boolean; stop?: boolean; gesture?: "tap" | "swipe" }

/** n manual spins: the bet step changes every 10 spins, STOP every 7th, turbo on spins 35..49 of every 50, swipe every 4th. */
function oceanBot(n: number): Step[] {
  const pattern = [0, 1, 2, 1, 3, 0, 2, 3, 1, 0];
  const out: Step[] = [];
  for (let i = 0; i < n; i++) {
    const st: Step = { gesture: i % 4 === 3 ? "swipe" : "tap" };
    if (i % 10 === 0) st.bet = pattern[(i / 10) % pattern.length];
    if (i % 50 === 0) st.turbo = false;
    if (i % 50 === 35) st.turbo = true;
    if (i % 7 === 6) st.stop = true;
    out.push(st);
  }
  return out;
}

async function play(core: OceanCore, steps: readonly Step[]): Promise<Ev[]> {
  const evs: Ev[] = [];
  const off = core.onSettle((e) => evs.push(e));
  for (const st of steps) {
    if (st.bet !== undefined) core.setBet(st.bet);
    if (st.turbo !== undefined) core.setTurbo(st.turbo);
    const p = core.spin({ gesture: st.gesture });
    if (st.stop) core.stop();
    const ev = await p;
    if (!ev) throw new Error("no round");
  }
  off();
  return evs;
}

const ocean = (h: HeadlessCtx) => h.ctxFor("ocean");
const evsOf = (h: HeadlessCtx) => h.rt.logger.session.events.filter((e) => e.game === "ocean");
const outcomes = (evs: readonly Ev[]) =>
  evs.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec }));

/** Rules-only replay of a seed: state after each round (bets do not change triggers, delays or chunk counts). */
function rulesRun(seed: string, n: number, bet: (i: number) => number = () => 20) {
  const res = createStreams(seed).res("ocean");
  let st = oceanInit();
  const rounds = [];
  for (let i = 1; i <= n; i++) {
    const o = oceanSpin(OCEAN, st, res.at(i), bet(i));
    rounds.push(o.result);
    st = o.state;
  }
  return { rounds, state: st };
}

function findSeed(prefix: string, ok: (seed: string) => boolean, tries = 4000): string {
  for (let k = 0; k < tries; k++) if (ok(prefix + k)) return prefix + k;
  throw new Error(`no seed for ${prefix}`);
}

// ------------------------------------------------------------------------------------------- tests

describe("ocean rounds are the rules engine", () => {
  it("each round equals oceanSpin on the stored queue (outcome, dec, payout, balance); the store holds the final queue", async () => {
    const seed = findSeed("rules-", (s) => rulesRun(s, 120).rounds.filter((r) => r.triggered).length >= 2);
    const h = createHeadlessCtx({ seed, fx: "on", game: "ocean", startCredits: 1_000_000 });
    const evs = await play(createOceanCore(h.ctx, headlessUi()), oceanBot(120));
    expect(evs).toHaveLength(120);
    const res = createStreams(seed).res("ocean");
    let st: OceanState = oceanInit();
    let bal = 1_000_000;
    for (const e of evs) {
      const { state, result } = oceanSpin(OCEAN, st, res.at(e.round), e.bet);
      expect(e.out).toEqual(outOf(result));
      expect(e.dec).toEqual(decOf(result));
      expect(e.payout).toBe(result.payout);
      expect(e.payout).toBe(result.basePay + result.seqPay);
      bal += e.payout - e.bet;
      expect(e.balance).toBe(bal);
      st = state;
    }
    expect(h.rt.store.get(OCEAN_STATE_KEY)).toEqual(st);
    expect(STORE_STATE).toBe(OCEAN_STATE_KEY);
    expect(evs.some((e) => (e.dec as { releasedFromSeq?: boolean } | undefined)?.releasedFromSeq)).toBe(true);
  });

  it("dec / out.omen / disp.omen follow §8.3: trigger, omen, releases (fx on shows the creature, fx off does not)", async () => {
    const seed = findSeed("log-", (s) => {
      const r = rulesRun(s, 60).rounds;
      return r.some((x) => x.triggered) && r.some((x) => x.omen) && r.some((x) => x.released);
    });
    for (const fx of ["on", "off"] as const) {
      const h = createHeadlessCtx({ seed, fx, game: "ocean", startCredits: 100_000 });
      const evs = await play(createOceanCore(h.ctx, headlessUi()), Array.from({ length: 60 }, () => ({})));
      const seqs = new Map<number, { total: number; omen: string; paid: number; omenRound?: number; trigRound: number }>();
      for (const e of evs) {
        const dec = e.dec as { bonusSeqId?: number; queued?: number; releasedFromSeq?: boolean; trig?: { bonusSeqId: number; queued: number } } | undefined;
        const out = e.out as { seqPay: number; omen?: string };
        const disp = e.disp as { omen?: string; tier: number };
        const trig = dec?.trig ?? (dec && !dec.releasedFromSeq ? { bonusSeqId: dec.bonusSeqId!, queued: dec.queued! } : null);
        if (trig) {
          const mult = trig.queued / e.bet;
          seqs.set(trig.bonusSeqId, { total: trig.queued, omen: omenOf(OCEAN, mult), paid: 0, trigRound: e.round });
        }
        if (out.omen) {
          // the omen belongs to the oldest unfinished sequence, and its creature is fixed by the sequence's size
          const head = [...seqs.values()].find((s) => s.paid < s.total)!;
          expect(head.omenRound).toBeUndefined();
          expect(out.omen).toBe(head.omen);
          head.omenRound = e.round;
          expect(e.round - head.trigRound).toBeGreaterThanOrEqual(1);
          expect(e.round - head.trigRound).toBeLessThanOrEqual(3);
          if (fx === "on") {
            expect(disp.omen).toBe(out.omen);
            expect((e.fx ?? []).some((r) => r.type === "sfx:omen")).toBe(true);
          } else expect(disp.omen).toBeUndefined();
          expect(out.seqPay).toBe(0);
        } else expect(disp.omen).toBeUndefined();
        if (dec?.releasedFromSeq) {
          const s = seqs.get(dec.bonusSeqId!)!;
          expect(s.omenRound).toBeLessThan(e.round);
          s.paid += out.seqPay;
          expect(out.seqPay).toBeGreaterThan(0);
          expect(dec.queued).toBe(s.total - s.paid);
        } else expect(out.seqPay).toBe(0);
      }
      expect(seqs.size).toBeGreaterThan(0);
      const st = h.rt.store.get<OceanState>(OCEAN_STATE_KEY)!;
      let pending = 0;
      for (const s of seqs.values()) pending += s.total - s.paid;
      expect(oceanPending(st)).toBe(pending);
      if (fx === "off") for (const e of evs) expect(e.disp).toEqual({ tier: (e.disp as { tier: number }).tier });
    }
  });
});

describe("the queue belongs to the session", () => {
  it("survives unmount, another game and remount, and keeps releasing in later ocean rounds as if never left", async () => {
    const seed = findSeed("keep-", (s) => {
      const r = rulesRun(s, 50).rounds;
      const t = r.findIndex((x) => x.triggered);
      return t >= 0 && t < 30 && r.slice(t + 1).some((x) => x.released);
    });
    const N = 50;
    const trigAt = rulesRun(seed, N).rounds.findIndex((x) => x.triggered) + 1;
    const steps = oceanBot(N);

    const solo = createHeadlessCtx({ seed, fx: "on", game: "ocean", startCredits: 1_000_000 });
    await play(createOceanCore(solo.ctx, headlessUi()), steps);

    const h = createHeadlessCtx({ seed, fx: "on", game: "ocean", startCredits: 1_000_000 });
    const first = createOceanCore(ocean(h), headlessUi());
    await play(first, steps.slice(0, trigAt));
    first.dispose();
    const queued = h.rt.store.get<OceanState>(OCEAN_STATE_KEY)!;
    expect(queued.queue.length).toBeGreaterThan(0);
    // another game in between (lobby → roulette → back)
    expect(await runScript("roulette", h.ctxFor("roulette"), { kind: "stub", rounds: 12 })).toHaveLength(12);
    expect(h.rt.store.get(OCEAN_STATE_KEY)).toEqual(queued);
    // the remounted core restores the bet step and turbo from the store
    const second = createOceanCore(ocean(h), headlessUi());
    expect(second.state.bet).toBe(first.state.bet);
    await play(second, steps.slice(trigAt));

    expect(outcomes(evsOf(h)).map(({ balance: _b, ...o }) => o)).toEqual(outcomes(evsOf(solo)).map(({ balance: _b, ...o }) => o));
    const after = evsOf(h).filter((e) => e.round > trigAt);
    expect(after.some((e) => (e.dec as { releasedFromSeq?: boolean } | undefined)?.releasedFromSeq)).toBe(true);
  });

  it("leaving mid-spin settles the round with its fixed outcome and stores the queue", async () => {
    const seed = findSeed("mid-", (s) => !!rulesRun(s, 1).rounds[0].triggered);
    const ref = rulesRun(seed, 1);
    const h = createHeadlessCtx({ seed, fx: "on", game: "ocean" });
    const ctx = { ...h.ctx, clock: { ...h.ctx.clock, wait: () => new Promise<void>(() => undefined) } };
    const core = createOceanCore(ctx, headlessUi());
    void core.spin();
    expect(core.canLeave()).toBe(false);
    core.dispose();
    const evs = evsOf(h);
    expect(evs).toHaveLength(1);
    expect(evs[0].out).toEqual(outOf(ref.rounds[0]));
    expect(h.rt.store.get(OCEAN_STATE_KEY)).toEqual(ref.state);
    expect(h.ctx.rounds.active).toBeNull();
  });
});

describe("player actions during a queue", () => {
  it("bet changes, STOP and turbo after the trigger do not change any released amount of that sequence", async () => {
    const seed = findSeed("act-", (s) => {
      const r = rulesRun(s, 40).rounds;
      const t = r.findIndex((x) => x.triggered);
      return t >= 0 && t < 15;
    });
    const trigAt = rulesRun(seed, 40).rounds.findIndex((x) => x.triggered) + 1;
    const flat: Step[] = Array.from({ length: 40 }, (_, i) => (i === 0 ? { bet: 0, turbo: false } : {}));
    const busy: Step[] = Array.from({ length: 40 }, (_, i) => {
      if (i === 0) return { bet: 0, turbo: false };
      if (i < trigAt) return {};
      return { bet: (i % 3) + 1, turbo: i % 2 === 0, stop: i % 3 !== 1, gesture: i % 2 ? "swipe" : "tap" };
    });
    const runs = [];
    for (const steps of [flat, busy]) {
      const h = createHeadlessCtx({ seed, fx: "on", game: "ocean", startCredits: 1_000_000 });
      runs.push(await play(createOceanCore(h.ctx, headlessUi()), steps));
    }
    const [a, b] = runs;
    const firstId = (a[trigAt - 1].dec as { bonusSeqId: number }).bonusSeqId;
    const rel = (evs: Ev[]) => evs.filter((e) => {
      const d = e.dec as { bonusSeqId?: number; releasedFromSeq?: boolean } | undefined;
      return d?.releasedFromSeq && d.bonusSeqId === firstId;
    }).map((e) => ({ round: e.round, seqPay: (e.out as { seqPay: number }).seqPay, left: (e.dec as { queued: number }).queued }));
    expect(rel(a).length).toBeGreaterThan(0);
    expect(rel(b)).toEqual(rel(a));
    // the busy run really did change things
    expect(b.slice(trigAt).some((e) => e.bet !== 20)).toBe(true);
    expect(b.slice(trigAt).some((e) => e.ctl?.stopPressed && e.ctl.turbo)).toBe(true);
    // omen round is the same round in both runs
    const omenRound = (evs: Ev[]) => evs.find((e) => (e.out as { omen?: string }).omen)?.round;
    expect(omenRound(b)).toBe(omenRound(a));
  });
});

describe("fx on / off parity and the lump sum at CASH OUT", () => {
  it("300 spins (bet changes, STOP every 7th, some turbo) with sequences: identical outcomes, then CASH OUT pays the rest once", async () => {
    const seed = findSeed("par-", (s) => {
      const r = rulesRun(s, 300);
      return r.rounds.filter((x) => x.triggered).length >= 3 && r.rounds.some((x) => x.omen) && oceanPending(r.state) > 0;
    });
    const runs: HeadlessCtx[] = [];
    for (const fx of ["on", "off"] as const) {
      const h = createHeadlessCtx({ seed, fx, game: "ocean", startCredits: 1_000_000 });
      const core = createOceanCore(h.ctx, headlessUi());
      await play(core, oceanBot(300));
      await h.rt.whenSettled();
      core.dispose();
      const pendingBefore = oceanPending(h.rt.store.get<OceanState>(OCEAN_STATE_KEY)!);
      expect(pendingBefore).toBeGreaterThan(0);
      const bal = h.rt.wallet.balance;
      h.rt.finish("cashout");
      h.rt.finish("cashout");                      // idempotent: no second payment
      expect(h.rt.flushOcean()).toBeNull();
      const evs = h.rt.logger.session.events;
      expect(evs).toHaveLength(301);
      const last = evs[300];
      expect(last).toMatchObject({ game: "ocean", round: 300, bet: 0, payout: pendingBefore, net: pendingBefore });
      expect((last.dec as { flush?: boolean }).flush).toBe(true);
      expect(h.rt.wallet.balance).toBe(bal + pendingBefore);
      expect(h.rt.store.get<OceanState>(OCEAN_STATE_KEY)!.queue).toEqual([]);
      expect(h.rt.logger.session.unreleased).toBe(pendingBefore);
      runs.push(h);
    }
    const [on, off] = runs;
    const evOn = on.rt.logger.session.events, evOff = off.rt.logger.session.events;
    expect(outcomes(evOn)).toEqual(outcomes(evOff));
    expect(on.rt.wallet.balance).toBe(off.rt.wallet.balance);

    // conservation: everything triggered was paid, by release rounds or by the lump sum
    let triggered = 0, released = 0;
    for (const e of evOn) {
      const d = e.dec as { bonusSeqId?: number; queued?: number; releasedFromSeq?: boolean; flush?: boolean; trig?: { queued: number } } | undefined;
      if (d?.flush) continue;
      if (d?.trig) triggered += d.trig.queued;
      else if (d && !d.releasedFromSeq && d.queued) triggered += d.queued;
      released += (e.out as { seqPay: number }).seqPay;
    }
    expect(released + evOn[300].payout).toBe(triggered);

    // off records nothing and shows only the tier; on records stimuli and shows the creatures
    const rounds = evOff.slice(0, 300);
    expect(rounds.every((e) => Array.isArray(e.fx) && e.fx.length === 0)).toBe(true);
    expect(rounds.every((e) => Object.keys(e.disp ?? {}).join() === "tier")).toBe(true);
    const omens = evOn.slice(0, 300).filter((e) => (e.out as { omen?: string }).omen);
    expect(omens.length).toBeGreaterThan(0);
    for (const e of omens) {
      expect((e.disp as { omen?: string }).omen).toBe((e.out as { omen: string }).omen);
      expect(e.fx!.some((r) => r.type === "sfx:omen")).toBe(true);
    }
    for (const e of evOn.slice(0, 300)) {
      const d = e.disp as { tier: number; celebrate?: boolean; ticket?: number };
      expect(d.celebrate === true).toBe(e.payout > 0);
      expect(d.ticket ?? 0).toBe(ticketCount(e.payout, e.bet));
      expect((e.fx ?? []).filter((r) => r.type === "sfx:ticket").length).toBe(d.ticket ?? 0);
    }

    // controls are logged on both sides
    const script = oceanBot(300);
    let turbo = false;
    for (const [i, st] of script.entries()) {
      if (st.turbo !== undefined) turbo = st.turbo;
      for (const e of [evOn[i], evOff[i]]) {
        expect(e.ctl?.stopPressed === true).toBe(st.stop === true);
        expect(e.ctl?.gesture).toBe(st.gesture);
        expect(e.ctl?.turbo === true).toBe(turbo);
        expect(e.bet).toBe(STEPS[[0, 1, 2, 1, 3, 0, 2, 3, 1, 0][Math.floor(i / 10) % 10]]);
      }
    }
  });

  it("big wins print tickets (fx on only); the count follows the payout", async () => {
    const seed = findSeed("tk-", (s) => rulesRun(s, 80).rounds.some((r) => ticketCount(r.payout, 20) > 0));
    for (const fx of ["on", "off"] as const) {
      const h = createHeadlessCtx({ seed, fx, game: "ocean", startCredits: 100_000 });
      const evs = await play(createOceanCore(h.ctx, headlessUi()), Array.from({ length: 80 }, () => ({})));
      const big = evs.filter((e) => ticketCount(e.payout, e.bet) > 0);
      expect(big.length).toBeGreaterThan(0);
      for (const e of big) {
        const n = (e.disp as { ticket?: number }).ticket;
        if (fx === "on") {
          expect(n).toBe(ticketCount(e.payout, e.bet));
          expect(e.fx!.filter((r) => r.type === "sfx:ticket")).toHaveLength(n!);
          expect(e.fx!.some((r) => r.type === "particles:tickets")).toBe(true);
        } else expect(n).toBeUndefined();
      }
    }
  });

  it("a bust with a queue pays the queue first; the session goes on when that covers the minimum", async () => {
    const seed = findSeed("bust-", (s) => {
      const r = rulesRun(s, 8).rounds;
      return !!r[0].triggered && r[0].basePay === 0 && r[0].triggered.total >= 100;
    });
    const h = createHeadlessCtx({ seed, fx: "on", game: "ocean", startCredits: 25 });
    const core = createOceanCore(h.ctx, headlessUi());
    const ev = (await core.spin())!;
    expect(ev.balance).toBe(5);
    await h.rt.whenSettled();
    const evs = h.rt.logger.session.events;
    expect(evs).toHaveLength(2);
    expect((evs[1].dec as { flush?: boolean }).flush).toBe(true);
    expect(h.rt.ended).toBe(false);
    expect(h.rt.cashoutRequested).toBeNull();
    expect(h.rt.wallet.balance).toBe(5 + evs[1].payout);
    // later rounds are the same as without the flush (round numbers and draws untouched)
    const next = (await core.spin())!;
    expect(next.round).toBe(2);
    const ref = oceanSpin(OCEAN, { ...rulesRun(seed, 1).state, queue: [] }, createStreams(seed).res("ocean").at(2), 20);
    expect(next.out).toEqual(outOf(ref.result));
  });
});
