import { describe, expect, it } from "vitest";
import { BET_STEPS } from "../config";
import { createRng, createStreams } from "../rng";
import type { Rng } from "../rng";
import {
  OCEAN, oceanExact, oceanFlush, oceanInit, oceanPending, oceanPresentation, oceanSpin, omenOf, ticketCount,
} from "./ocean";
import type { OceanResult, OceanState } from "./ocean";
import { SLOT_A, slotExact, slotPresentation } from "./slot";

const at = (seed: string) => { const res = createStreams(seed).res("ocean"); return (n: number) => res.at(n); };

/** Run rounds from..to (inclusive) from state st with a bet function. */
function run(seed: string, st: OceanState, from: number, to: number, bet: (n: number) => number, each?: (r: OceanResult, n: number, s: OceanState) => void) {
  const rngAt = at(seed);
  for (let n = from; n <= to; n++) {
    const o = oceanSpin(OCEAN, st, rngAt(n), bet(n));
    st = o.state;
    each?.(o.result, n, st);
  }
  return st;
}

describe("config", () => {
  it("uses variant a strips and lines, its own pay table", () => {
    expect(OCEAN.slot.strips).toBe(SLOT_A.strips);
    expect(OCEAN.slot.lines).toBe(SLOT_A.lines);
    expect(OCEAN.slot.id).toBe("ocean");
    expect(OCEAN.slot.pay["7"]).toEqual([100, 500, 2000]);
    expect(OCEAN.slot.pay.d).toEqual([6, 20, 60]);
  });
  it("bonus table: weights 1000, E[M] 21.75, E[M^2] 3767.5, cap is the max", () => {
    const w = OCEAN.bonus.reduce((t, b) => t + b.w, 0);
    expect(w).toBe(1000);
    expect(OCEAN.bonus.reduce((t, b) => t + b.w * b.mult, 0) / w).toBe(21.75);
    expect(OCEAN.bonus.reduce((t, b) => t + b.w * b.mult * b.mult, 0) / w).toBe(3767.5);
    expect(Math.max(...OCEAN.bonus.map((b) => b.mult))).toBe(OCEAN.cap);
  });
  it("creature is a function of the bonus size (clam / shark / whale bands)", () => {
    for (const m of [5, 10, 15]) expect(omenOf(OCEAN, m)).toBe("clam");
    for (const m of [30, 50, 100]) expect(omenOf(OCEAN, m)).toBe("shark");
    for (const m of [250, 500, 1250]) expect(omenOf(OCEAN, m)).toBe("whale");
    expect(() => omenOf(OCEAN, 7)).toThrow();
    expect(OCEAN.release).toEqual({ clam: [3, 5], shark: [4, 7], whale: [6, 10] });
  });
});

describe("oceanExact", () => {
  it("base pay table sum and total 0.9198 +- 0.0005", () => {
    expect(slotExact(OCEAN.slot).sumLinePay).toBe(20_131_740);
    const e = oceanExact(OCEAN);
    expect(e.base).toBe(20_131_740 / 32 ** 5);
    expect(e.bonus).toBe(21.75 / 68);
    expect(e.total).toBe(e.base + e.bonus);
    expect(Math.abs(e.total - 0.9198)).toBeLessThanOrEqual(0.0005);
  });
});

describe("oceanSpin", () => {
  it("draws in the documented order", () => {
    const real = createRng("order", "x");
    const calls: string[] = [];
    const rec: Rng = {
      u32: () => { calls.push("u32"); return real.u32(); },
      float: () => { calls.push("float"); return real.float(); },
      int: (n) => { calls.push("int" + n); return n === 68 ? 0 : real.int(n); },
      weighted: (w) => { calls.push("weighted" + w.length); return 8; },   // force the 1250x entry
      shuffle: (a) => a,
    };
    const { result, state } = oceanSpin(OCEAN, oceanInit(), rec, 20);
    const n = result.triggered!.chunks.length;
    expect(calls).toEqual(["int32", "int32", "int32", "int32", "int32", "int68", "weighted9", "int3", "int5", ...new Array(n).fill("float")]);
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(10);
    expect(result.triggered).toMatchObject({ id: 1, round: 1, bet: 20, mult: 1250, total: 25_000, omen: "whale", next: 0 });
    expect(result.triggered!.wait).toBe(result.triggered!.delay);
    expect(result.seqPay).toBe(0);
    expect(result.payout).toBe(result.basePay);
    expect(state).toMatchObject({ round: 1, nextId: 2 });
    expect(oceanPending(state)).toBe(25_000);
  });

  it("does not modify the input state", () => {
    let st = oceanInit();
    const rngAt = at("immut");
    for (let n = 1; n <= 5000; n++) {
      const snap = JSON.stringify(st);
      const o = oceanSpin(OCEAN, st, rngAt(n), 20);
      expect(JSON.stringify(st)).toBe(snap);
      st = o.state;
    }
  });

  it("rejects bets that are not a positive multiple of 20", () => {
    expect(() => oceanSpin(OCEAN, oceanInit(), createRng("a", "b"), 30)).toThrow();
    expect(() => oceanSpin(OCEAN, oceanInit(), createRng("a", "b"), 0)).toThrow();
  });
});

describe("sequence progression and conservation (1e6 rounds)", () => {
  it("chunks, timing, conservation with a flush at arbitrary rounds", () => {
    const seed = "conserve";
    const N = 1_000_000;
    const stopAt = new Set([1, 68, 500, 7_777, 123_456, 400_001, 654_321, 999_999, N]);
    let released = 0, triggered = 0, triggers = 0, flushes = 0;
    const omenRound = new Map<number, number>();
    const relRounds = new Map<number, number[]>();
    const expectTiming = new Map<number, { omen: number; first: number; n: number }>();
    let prevQueueLen = 0;
    const bad: string[] = [];
    const check = (ok: boolean, msg: string) => { if (!ok && bad.length < 10) bad.push(msg); };
    run(seed, oceanInit(), 1, N, () => 20, (r, n, st) => {
      check(r.payout === r.basePay + r.seqPay, `payout ${n}`);
      released += r.seqPay;
      if (r.released) {
        check(r.released.amount === r.seqPay && r.seqPay >= 1, `release ${n}`);
        const l = relRounds.get(r.released.seqId) ?? []; l.push(n); relRounds.set(r.released.seqId, l);
      } else check(r.seqPay === 0, `seqPay ${n}`);
      if (r.omen) {
        const head = st.queue[0];
        check(!r.released && head?.omen === r.omen && head.wait === -1, `omen ${n}`);
        omenRound.set(head.id, n);
      }
      if (r.triggered) {
        const t = r.triggered;
        triggers++;
        triggered += t.total;
        const [lo, hi] = OCEAN.release[t.omen];
        check(t.total === t.mult * 20 && t.omen === omenOf(OCEAN, t.mult), `total/omen ${n}`);
        check(t.delay >= 1 && t.delay <= 3 && t.wait === t.delay && t.round === n, `delay ${n}`);
        check(t.chunks.length >= lo && t.chunks.length <= hi, `release count ${n}`);
        check(t.chunks.reduce((a, b) => a + b, 0) === t.total, `chunk sum ${n}`);
        check(t.chunks.every((c, i) => c >= 1 && (i === 0 || c >= t.chunks[i - 1])), `chunk order ${n}`);
        // a sequence that enters an empty queue: omen at r + d, paid at r + d + 1 .. r + d + n
        const wasEmpty = prevQueueLen === 0 || (prevQueueLen === 1 && r.released !== undefined && r.released.remaining === 0);
        if (wasEmpty) expectTiming.set(t.id, { omen: n + t.delay, first: n + t.delay + 1, n: t.chunks.length });
      }
      prevQueueLen = st.queue.length;
      if (stopAt.has(n)) {
        const f = oceanFlush(st);
        const amount = f ? f.amount : 0;
        expect(released + amount).toBe(triggered);
        expect(oceanPending(st)).toBe(amount);
        if (f) {
          flushes++;
          expect(f.state.queue).toEqual([]);
          expect(oceanPending(f.state)).toBe(0);
          expect(f.state.round).toBe(st.round);
          expect(f.state.nextId).toBe(st.nextId);
          expect(f.seqId).toBe(st.queue[0].id);
          expect(f.seqs.map((s) => s.id)).toEqual(st.queue.map((s) => s.id));
          expect(f.seqs.reduce((a, s) => a + s.amount, 0)).toBe(f.amount);
        }
      }
    });
    expect(bad).toEqual([]);
    expect(triggers).toBeGreaterThan(N / 68 * 0.95);
    expect(flushes).toBeGreaterThan(0);
    let checked = 0;
    for (const [id, want] of expectTiming) {
      const rel = relRounds.get(id);
      if (!rel || rel.length < want.n) continue; // cut off by the end of the run
      expect(omenRound.get(id)).toBe(want.omen);
      expect(rel).toEqual(Array.from({ length: want.n }, (_, i) => want.first + i));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);

  it("rounds after a flush match the same-numbered rounds without one", () => {
    const seed = "flush-indep";
    for (const k of [137, 2_222, 9_001]) {
      let st = run(seed, oceanInit(), 1, k, () => 20);
      // make sure the queue is non-empty at k by searching forward
      while (st.queue.length === 0) { st = run(seed, st, st.round + 1, st.round + 1, () => 20); }
      const f = oceanFlush(st)!;
      expect(f).not.toBeNull();
      const a: OceanResult[] = [], b: OceanResult[] = [];
      const from = st.round + 1;
      run(seed, st, from, from + 3000, () => 20, (r) => a.push(r));
      run(seed, f.state, from, from + 3000, () => 20, (r) => b.push(r));
      const view = (r: OceanResult) => ({ stops: r.stops, basePay: r.basePay, mult: r.mult, trig: r.triggered && { mult: r.triggered.mult, total: r.triggered.total, delay: r.triggered.delay, chunks: r.triggered.chunks, id: r.triggered.id } });
      expect(b.map(view)).toEqual(a.map(view));
      // nothing from the flushed sequences is paid again
      const flushed = new Set(f.seqs.map((s) => s.id));
      expect(b.some((r) => r.released && flushed.has(r.released.seqId))).toBe(false);
    }
  });

  it("empty queue: pending 0, flush null", () => {
    expect(oceanPending(oceanInit())).toBe(0);
    expect(oceanFlush(oceanInit())).toBeNull();
  });
});

describe("bet changes, STOP, turbo", () => {
  it("queued amounts are fixed in credits at the trigger round; later bets do not change them", () => {
    const seed = "bets";
    const N = 30_000;
    const steps = BET_STEPS.ocean;
    const fixed: OceanResult[] = [], varied: OceanResult[] = [];
    const paid = new Map<number, number>(), want = new Map<number, number>();
    run(seed, oceanInit(), 1, N, () => 20, (r) => fixed.push(r));
    const end = run(seed, oceanInit(), 1, N, (n) => steps[(n * 7) % steps.length], (r, n) => {
      varied.push(r);
      if (r.triggered) { want.set(r.triggered.id, r.triggered.total); expect(r.triggered.total).toBe(r.triggered.mult * steps[(n * 7) % steps.length]); }
      if (r.released) paid.set(r.released.seqId, (paid.get(r.released.seqId) ?? 0) + r.released.amount);
    });
    const f = oceanFlush(end);
    for (const s of f?.seqs ?? []) paid.set(s.id, (paid.get(s.id) ?? 0) + s.amount);
    expect(paid).toEqual(want);
    // randomness and timing do not depend on the bet
    for (let i = 0; i < N; i++) {
      const a = fixed[i], b = varied[i];
      expect(b.stops).toEqual(a.stops);
      expect(b.mult).toBe(a.mult);
      expect(b.omen).toBe(a.omen);
      expect(b.released?.seqId).toBe(a.released?.seqId);
      expect(b.triggered?.mult).toBe(a.triggered?.mult);
      expect(b.triggered?.chunks.length).toBe(a.triggered?.chunks.length);
    }
  });

  it("presentation calls (fx, STOP, turbo use only the pre stream) never change results", () => {
    const seed = "pres";
    const streams = createStreams(seed);
    let a = oceanInit(), b = oceanInit();
    for (let n = 1; n <= 20_000; n++) {
      const ra = oceanSpin(OCEAN, a, streams.res("ocean").at(n), 40);
      const rb = oceanSpin(OCEAN, b, streams.res("ocean").at(n), 40);
      const pre = streams.pre("ocean").at(n);
      const p = oceanPresentation(rb.result, 40, pre);
      slotPresentation(OCEAN.slot, rb.result, pre);
      if (n % 7 === 0) pre.float(); // STOP / turbo timing draws
      expect(rb).toEqual(ra);
      expect(p.omen).toBe(ra.result.omen);
      a = ra.state; b = rb.state;
    }
  });
});

describe("presentation helpers", () => {
  it("ticket count", () => {
    expect(ticketCount(199, 20)).toBe(0);
    expect(ticketCount(200, 20)).toBe(2);
    expect(ticketCount(500, 20)).toBe(5);
    expect(ticketCount(100_000, 20)).toBe(12);
  });
  it("omen only when the result has one; serial only with tickets", () => {
    const pre = createRng("p", "q");
    const base: OceanResult = { stops: [0, 0, 0, 0, 0], wins: [], mult: 0, payout: 0, top5: false, basePay: 0, seqPay: 0 };
    expect(oceanPresentation(base, 20, pre)).toEqual({});
    expect(oceanPresentation({ ...base, omen: "shark" }, 20, pre)).toEqual({ omen: "shark" });
    const t = oceanPresentation({ ...base, payout: 600, seqPay: 600 }, 20, pre);
    expect(t.ticket).toBe(6);
    expect(t.serial).toBeGreaterThanOrEqual(0);
    expect(t.serial).toBeLessThan(1_000_000);
  });
});
