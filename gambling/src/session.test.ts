import { describe, expect, it } from "vitest";
import { START_CREDITS } from "../../shared/config";
import { createStreams } from "../../shared/rng";
import type { OceanSeq, OceanState } from "../../shared/rules/ocean";
import { createStubFx, HEADLESS_ENV } from "../harness/ctx";
import { createManualClock } from "./clock";
import {
  bindVisibility, createSession, decideResume, findResume, levelOf, OCEAN_STATE_KEY, RESUME_WINDOW_MS, RT_KEY,
  type KV, type SessionOpts, type SessionRuntime,
} from "./session";

const E0 = 1_700_000_000_000;

function memStore(): KV & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
}

function make(o: Partial<SessionOpts> & { fxOn?: boolean; now?: { v: number } } = {}) {
  const clock = createManualClock();
  const now = o.now ?? { v: E0 };
  const fx = createStubFx(o.fxOn ?? true);
  const rt = createSession({
    seed: "s1", fx, fxMode: o.fxOn === false ? "off" : "on", env: HEADLESS_ENV, clock,
    epoch: () => now.v, storage: null, id: "id1", ...o,
  });
  return { rt, clock, fx, now };
}

function queueOf(total: number): OceanState {
  const seq: OceanSeq = {
    id: 7, round: 1, bet: 20, mult: total / 20, total, omen: "clam", delay: 1,
    chunks: [Math.floor(total / 2), total - Math.floor(total / 2)], next: 0, wait: 2,
  };
  return { round: 1, nextId: 8, queue: [seq] };
}

const spin = (rt: SessionRuntime, bet: number, payout: number, game: "slot" | "ocean" | "roulette" = "slot") => {
  const r = rt.roundsFor(game).begin({ bet });
  return r.settle({ payout });
};

describe("round lifecycle", () => {
  it("begin debits, numbers rounds, settle credits and records an Ev", () => {
    const { rt } = make();
    const api = rt.roundsFor("slot");
    expect(api.count()).toBe(0);
    const r = api.begin({ bet: 100, ctl: { turbo: true } });
    expect(r.n).toBe(1);
    expect(rt.wallet.balance).toBe(START_CREDITS - 100);
    expect(api.active).toBe(r);
    r.ctl({ stopPressed: true });
    r.addBet(50);
    const ev = r.settle({ payout: 400, out: { stops: [1] }, dec: { x: 1 }, disp: { y: 2 } });
    expect(ev).toMatchObject({
      game: "slot", round: 1, bet: 150, payout: 400, net: 250, balance: START_CREDITS + 250,
      ctl: { turbo: true, stopPressed: true }, out: { stops: [1] }, dec: { x: 1 }, disp: { y: 2 },
    });
    expect(rt.logger.session.events).toEqual([ev]);
    expect(api.count()).toBe(1);
    expect(api.active).toBeNull();
    const r2 = api.begin({ bet: 20 });
    expect(r2.n).toBe(2);
    expect(() => api.begin({ bet: 20 })).toThrow();
    expect(() => r.settle({ payout: 0 })).toThrow();
  });

  it("res/pre come from the per-round streams, independent of call order", () => {
    const { rt } = make();
    const r = rt.roundsFor("slot").begin({ bet: 20 });
    const ref = createStreams("s1");
    expect(r.res.u32()).toBe(ref.res("slot").at(1).u32());
    expect(r.pre.u32()).toBe(ref.pre("slot").at(1).u32());
    r.settle({ payout: 0 });
    spin(rt, 20, 0, "roulette"); // other game does not disturb slot numbering
    expect(rt.roundsFor("slot").begin({ bet: 20 }).n).toBe(2);
  });

  it("rejects bad bets/payouts and an insufficient wallet without side effects", () => {
    const { rt } = make({ startCredits: 50 });
    const api = rt.roundsFor("slot");
    expect(() => api.begin({ bet: 0 })).toThrow();
    expect(() => api.begin({ bet: 1.5 })).toThrow();
    expect(() => api.begin({ bet: 60 })).toThrow();
    expect(api.active).toBeNull();
    expect(rt.wallet.balance).toBe(50);
    const r = api.begin({ bet: 20 });
    expect(() => r.settle({ payout: -1 })).toThrow();
  });

  it("fx records attach to the round until the next begin", () => {
    const { rt, fx } = make();
    const api = rt.roundsFor("slot");
    const r = api.begin({ bet: 100 });
    const ev = r.settle({ payout: 300 });
    expect(ev.fx).toEqual([]);
    fx.celebrate({ amount: 300, bet: 100, target: null as never }); // after settlement
    expect(ev.fx).toHaveLength(1);
    const r2 = api.begin({ bet: 100 });
    fx.celebrate({ amount: 5, bet: 100, target: null as never });
    expect(ev.fx).toHaveLength(1);
    const ev2 = r2.settle({ payout: 0 });
    expect(ev2.fx).toHaveLength(1);
  });

  it("fx off leaves Ev.fx empty", () => {
    const { rt, fx } = make({ fxOn: false });
    const ev = spin(rt, 100, 300);
    fx.celebrate({ amount: 300, bet: 100, target: null as never });
    expect(ev.fx).toEqual([]);
  });

  it("settings.muted logs aux and drives sfx", () => {
    const { rt } = make();
    rt.settings.muted = true;
    rt.settings.muted = true;
    expect(rt.logger.session.aux).toMatchObject([{ kind: "mute", d: { on: true } }]);
  });

  it("level thresholds are 500*n*(n+1)", () => {
    expect([0, 999, 1000, 2999, 3000, 6000].map(levelOf)).toEqual([0, 0, 1, 1, 2, 3]);
    const { rt } = make();
    const seen: number[] = [];
    rt.onNotice((n) => { if (n.kind === "level") seen.push(n.n); });
    spin(rt, 400, 400);
    spin(rt, 400, 400);
    spin(rt, 400, 400);
    expect(seen).toEqual([1]);
    expect(rt.logger.session.aux?.some((a) => a.kind === "level")).toBe(true);
  });
});

describe("bust and ocean flush", () => {
  it("bust emits cashout(bust) after the settlement check", async () => {
    const { rt } = make({ startCredits: 30 });
    const reasons: string[] = [];
    rt.onCashout((r) => reasons.push(r));
    spin(rt, 25, 0);
    expect(reasons).toEqual([]); // not before fx.idle
    await rt.whenSettled();
    expect(reasons).toEqual(["bust"]);
    expect(rt.cashoutRequested).toBe("bust");
  });

  it("balance >= 10 is not bust; insufficient() reports the per-game case", async () => {
    const { rt } = make({ startCredits: 45 });
    const reasons: string[] = [];
    rt.onCashout((r) => reasons.push(r));
    spin(rt, 30, 0); // 15 left
    await rt.whenSettled();
    expect(reasons).toEqual([]);
    expect(rt.insufficient("slot")).toBe(true); // min 20
    expect(rt.insufficient("roulette")).toBe(false); // min 10
  });

  it("flushes the ocean queue first; session continues when the balance recovers", async () => {
    const { rt } = make({ startCredits: 30 });
    rt.store.set(OCEAN_STATE_KEY, queueOf(2000));
    const reasons: string[] = [];
    const notices: unknown[] = [];
    rt.onCashout((r) => reasons.push(r));
    rt.onNotice((n) => notices.push(n));
    spin(rt, 25, 0, "roulette");
    await rt.whenSettled();
    expect(reasons).toEqual([]);
    expect(rt.wallet.balance).toBe(5 + 2000);
    const ev = rt.logger.session.events.at(-1)!;
    expect(ev).toMatchObject({ game: "ocean", bet: 0, payout: 2000, net: 2000, dec: { bonusSeqId: 7, flush: true }, fx: [] });
    expect(rt.logger.session.unreleased).toBe(2000);
    expect(notices).toEqual([{ kind: "bonus", amount: 2000, balance: 2005 }]);
    // no round was consumed
    expect(rt.roundsFor("ocean").count()).toBe(0);
    expect(rt.store.get<OceanState>(OCEAN_STATE_KEY)!.queue).toEqual([]);
  });

  it("re-checks bust after the flush when the queue is too small", async () => {
    const { rt } = make({ startCredits: 30 });
    rt.store.set(OCEAN_STATE_KEY, queueOf(4)); // 5 + 4 = 9 < 10
    const reasons: string[] = [];
    rt.onCashout((r) => reasons.push(r));
    spin(rt, 25, 0, "roulette");
    await rt.whenSettled();
    expect(rt.wallet.balance).toBe(9);
    expect(reasons).toEqual(["bust"]);
    expect(rt.logger.session.events.at(-1)?.dec).toMatchObject({ flush: true });
  });

  it("does not flush for the per-game insufficient case", async () => {
    const { rt } = make({ startCredits: 45 });
    rt.store.set(OCEAN_STATE_KEY, queueOf(2000));
    spin(rt, 30, 0);
    await rt.whenSettled();
    expect(rt.wallet.balance).toBe(15);
    expect(rt.logger.session.unreleased).toBeUndefined();
  });

  it("CASH OUT flushes at finish and records the end; finish is idempotent", () => {
    const { rt } = make();
    rt.store.set(OCEAN_STATE_KEY, queueOf(1000));
    spin(rt, 100, 0);
    const s = rt.finish("cashout");
    expect(s.endReason).toBe("cashout");
    expect(s.unreleased).toBe(1000);
    expect(rt.wallet.balance).toBe(START_CREDITS - 100 + 1000);
    expect(s.events.filter((e) => (e.dec as { flush?: boolean } | undefined)?.flush)).toHaveLength(1);
    rt.finish("bust");
    expect(s.endReason).toBe("cashout");
    expect(() => rt.roundsFor("slot").begin({ bet: 20 })).toThrow();
  });

  it("cash-out requested mid-round waits for settlement", async () => {
    const { rt } = make();
    const reasons: string[] = [];
    rt.onCashout((r) => reasons.push(r));
    const r = rt.roundsFor("slot").begin({ bet: 100 });
    rt.requestCashout();
    await rt.whenSettled();
    expect(reasons).toEqual([]);
    r.settle({ payout: 0 });
    await rt.whenSettled();
    expect(reasons).toEqual(["cashout"]);
  });

  it("ocean flush with several queued sequences logs seqs", () => {
    const { rt } = make();
    const st = queueOf(100);
    st.queue.push({ ...st.queue[0], id: 8 });
    rt.store.set(OCEAN_STATE_KEY, st);
    const ev = rt.flushOcean()!;
    expect(ev.payout).toBe(200);
    expect(ev.dec).toEqual({ bonusSeqId: 7, flush: true, seqs: [{ id: 7, amount: 100 }, { id: 8, amount: 100 }] });
    expect(rt.flushOcean()).toBeNull();
  });
});

describe("visibility", () => {
  it("hidden pauses the clock, suspends fx, logs bg/fg; idempotent", () => {
    const { rt, clock } = make();
    const states: string[] = [];
    rt.onVisibility((s) => states.push(s));
    const doc = { visibilityState: "visible", cbs: [] as (() => void)[], addEventListener(_t: "visibilitychange", cb: () => void) { this.cbs.push(cb); }, removeEventListener() {} };
    bindVisibility(doc, rt);
    doc.visibilityState = "hidden";
    doc.cbs[0](); doc.cbs[0]();
    expect(clock.paused).toBe(true);
    doc.visibilityState = "visible";
    doc.cbs[0](); doc.cbs[0]();
    expect(clock.paused).toBe(false);
    expect(states).toEqual(["hidden", "visible"]);
    expect(rt.logger.session.aux?.map((a) => a.kind)).toEqual(["bg", "fg"]);
  });
});

describe("resume", () => {
  const base = { session: null, rt: null, now: E0 + 1000, seed: null, fx: "on", sv: "a" } as const;

  function played(opts: { fx?: boolean; sv?: "a" | "b"; seed?: string } = {}) {
    const storage = memStore();
    const now = { v: E0 };
    const { rt } = make({ storage, now, fxOn: opts.fx ?? true, sv: opts.sv ?? "a", seed: opts.seed ?? "s1" });
    spin(rt, 100, 250);
    spin(rt, 20, 0, "roulette");
    rt.store.set("k", { a: 1 });
    spin(rt, 40, 0);
    rt.save();
    return { storage, rt, now };
  }

  it("resumes: balance, counts, store, same round numbers replay identically", () => {
    const { storage, rt } = played();
    const hit = findResume({ storage, now: E0 + 5000, seed: null, fx: "on", sv: "a" });
    expect(hit).not.toBeNull();
    const r2 = createSession({
      seed: "ignored", fx: createStubFx(true), fxMode: "on", env: HEADLESS_ENV, clock: createManualClock(),
      epoch: () => E0 + 5000, storage, resume: hit!,
    });
    expect(r2.resumed).toBe(true);
    expect(r2.wallet.balance).toBe(rt.wallet.balance);
    expect(r2.roundsFor("slot").count()).toBe(2);
    expect(r2.roundsFor("roulette").count()).toBe(1);
    expect(r2.store.get("k")).toEqual({ a: 1 });
    expect(r2.logger.session.seed).toBe("s1");
    expect(r2.logger.session.aux?.at(-1)?.kind).toBe("resume");
    const next = r2.roundsFor("slot").begin({ bet: 20 });
    const ref = createStreams("s1").res("slot").at(3);
    expect(next.n).toBe(3);
    expect(next.res.u32()).toBe(ref.u32());
  });

  it("an in-flight round is void: snapshot is the last settled state", () => {
    const { storage, rt } = played();
    const settled = rt.wallet.balance;
    rt.roundsFor("slot").begin({ bet: 500 }); // debited, not settled
    rt.suspend(); // saves
    const hit = findResume({ storage, now: E0 + 5000, seed: null, fx: "on", sv: "a" });
    expect(hit).not.toBeNull();
    expect(hit!.rt.balance).toBe(settled);
    expect(hit!.rt.rounds.slot).toBe(2);
  });

  it("fx or sv mismatch means a new session", () => {
    const { storage } = played();
    expect(findResume({ storage, now: E0 + 1, seed: null, fx: "off", sv: "a" })).toBeNull();
    expect(findResume({ storage, now: E0 + 1, seed: null, fx: "on", sv: "b" })).toBeNull();
    const b = played({ sv: "b" });
    expect(findResume({ storage: b.storage, now: E0 + 1, seed: null, fx: "on", sv: "b" })).not.toBeNull();
  });

  it("seed rule, 6 h window, ended session, id and balance mismatch", () => {
    const { storage } = played();
    const f = (o: Partial<Parameters<typeof findResume>[0]>) => findResume({ storage, now: E0 + 1, seed: null, fx: "on", sv: "a", ...o });
    expect(f({ seed: "s1" })).not.toBeNull();
    expect(f({ seed: "other" })).toBeNull();
    expect(f({ now: E0 + RESUME_WINDOW_MS })).not.toBeNull();
    expect(f({ now: E0 + RESUME_WINDOW_MS + 1 })).toBeNull();

    const hit = f({})!;
    const s = hit.session;
    expect(decideResume({ ...base, session: { ...s, endedAt: E0 + 10 }, rt: hit.rt, fx: "on" })).toBeNull();
    expect(decideResume({ ...base, session: s, rt: { ...hit.rt, id: "zzz" }, fx: "on" })).toBeNull();
    expect(decideResume({ ...base, session: s, rt: { ...hit.rt, balance: hit.rt.balance + 1 }, fx: "on" })).toBeNull();
    expect(decideResume({ ...base, session: s, rt: null, fx: "on" })).toBeNull();
  });

  it("an ended session is not resumed, and finish keeps the key readable", () => {
    const { storage, rt } = played();
    rt.finish("cashout");
    expect(storage.map.has(RT_KEY)).toBe(true);
    expect(findResume({ storage, now: E0 + 1, seed: null, fx: "on", sv: "a" })).toBeNull();
  });

  it("persistence failure never throws", () => {
    const bad: KV = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    const { rt } = make({ storage: bad });
    expect(() => spin(rt, 100, 0)).not.toThrow();
    expect(() => rt.save()).not.toThrow();
  });
});
