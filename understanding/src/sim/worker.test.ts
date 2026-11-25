// Chunking, progress, cancellation and the message protocol, without a real Worker.
import { describe, expect, it } from "vitest";
import { drive, runSync, type Job, type Scheduler } from "./scheduler";
import { createHost, transferList } from "./jobs";
import { createSimClient, SimCancelled, type WorkerLike } from "./client";
import { scaleFor, scaled, type FromWorker, type ToWorker } from "./protocol";
import { bankrollJob, type BankrollParams } from "./bankroll";

/** Fake clock: every now() call advances by `tick` ms. yield() resolves on the microtask queue. */
function fakeScheduler(tick = 10): Scheduler & { yields: number } {
  let t = 0;
  const s = { yields: 0, now: () => (t += tick), yield: () => { s.yields++; return Promise.resolve(); } };
  return s;
}

function* counter(n: number, log: string[]): Job<number> {
  try {
    for (let i = 1; i <= n; i++) yield i / n;
    return n;
  } finally {
    log.push("closed");
  }
}

describe("drive", () => {
  it("runs to completion, reporting progress once per slice and 1 at the end", async () => {
    const s = fakeScheduler(10);
    const ps: number[] = [];
    const log: string[] = [];
    const r = await drive(counter(100, log), s, { sliceMs: 50, onProgress: (p) => ps.push(p) });
    expect(r).toEqual({ ok: true, value: 100 });
    // ~5 steps per 50 ms slice → ~20 slices, far fewer reports than the 100 yields of the job
    expect(ps.length).toBeGreaterThan(10);
    expect(ps.length).toBeLessThan(40);
    expect(ps[ps.length - 1]).toBe(1);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    expect(s.yields).toBe(ps.length - 1);
    expect(log).toEqual(["closed"]);
  });

  it("stops at the next slice boundary once cancelled and closes the job", async () => {
    const s = fakeScheduler(10);
    const log: string[] = [];
    let cancelled = false, reports = 0;
    const r = await drive(counter(1000, log), s, { sliceMs: 50, isCancelled: () => cancelled, onProgress: () => { reports++; cancelled = true; } });
    expect(r).toEqual({ ok: false, cancelled: true });
    expect(reports).toBe(1);
    expect(log).toEqual(["closed"]);
  });

  it("results do not depend on slicing", async () => {
    const p: BankrollParams = { edge: 0.027, rounds: 300, system: "fibonacci", bankroll: 500, baseBet: 5, players: 300, seed: "slice" };
    const a = runSync(bankrollJob(p));
    const b = await drive(bankrollJob(p), fakeScheduler(1), { sliceMs: 0 });
    const c = await drive(bankrollJob(p), fakeScheduler(1), { sliceMs: 1e9 });
    if (!b.ok || !c.ok) throw new Error("not ok");
    expect(Array.from(b.value.finals)).toEqual(Array.from(a.finals));
    expect(Array.from(c.value.finals)).toEqual(Array.from(a.finals));
  });
});

describe("device scaling", () => {
  it("hardwareConcurrency ≤ 4 → 0.3×", () => {
    expect(scaleFor(2)).toBe(0.3);
    expect(scaleFor(4)).toBe(0.3);
    expect(scaleFor(8)).toBe(1);
    expect(scaleFor(undefined)).toBe(1);
    expect(scaled(10000, 0.3)).toBe(3000);
    expect(scaled(1, 0.3)).toBe(1);
  });
});

function hostHarness(scale = 1, tick = 10) {
  const msgs: { msg: FromWorker; transfer: ArrayBuffer[] }[] = [];
  const host = createHost((msg, transfer) => msgs.push({ msg, transfer }), { scale, scheduler: fakeScheduler(tick), sliceMs: 50 });
  return { host, msgs };
}
const small: BankrollParams = { edge: 0.027, rounds: 200, system: "martingale", bankroll: 1000, baseBet: 10, players: 1000, seed: "h" };

describe("host (worker side)", () => {
  it("posts progress then a result whose typed arrays are in the transfer list; applies the device scale", async () => {
    const { host, msgs } = hostHarness(0.3);
    await host.onMessage({ id: 7, job: "bankroll", params: small });
    const prog = msgs.filter((m) => !("ok" in m.msg));
    const res = msgs[msgs.length - 1];
    expect(prog.length).toBeGreaterThan(1);
    expect(res.msg).toMatchObject({ id: 7, ok: true });
    const data = (res.msg as { data: { players: number; requested: number; scale: number; finals: Float64Array } }).data;
    expect(data.players).toBe(300);
    expect(data.requested).toBe(1000);
    expect(data.scale).toBe(0.3);
    expect(res.transfer).toContain(data.finals.buffer);
    expect(res.transfer.length).toBe(new Set(res.transfer).size);
    expect(host.running).toBe(0);
  });

  it("noScale runs the requested count", async () => {
    const { host, msgs } = hostHarness(0.3);
    await host.onMessage({ id: 1, job: "crashTargets", params: { n: 2000, seed: "x" }, noScale: true });
    expect((msgs[msgs.length - 1].msg as { data: { n: number } }).data.n).toBe(2000);
  });

  it("cancel stops a running job", async () => {
    const { host, msgs } = hostHarness();
    const done = host.onMessage({ id: 3, job: "bankroll", params: { ...small, players: 100000 } });
    host.onMessage({ id: 3, cancel: true });
    await done;
    expect(msgs[msgs.length - 1].msg).toEqual({ id: 3, ok: false, error: "cancelled", cancelled: true });
    expect(msgs.length).toBeLessThan(5);
  });

  it("reports errors and unknown jobs", async () => {
    const { host, msgs } = hostHarness();
    await host.onMessage({ id: 4, job: "bankroll", params: { ...small, rounds: -1 } });
    await host.onMessage({ id: 5, job: "nope" as never, params: {} as never });
    expect(msgs.map((m) => m.msg)).toEqual([
      { id: 4, ok: false, error: expect.stringContaining("rounds") },
      { id: 5, ok: false, error: "unknown job nope" },
    ]);
  });

  it("slotStats returns copies (the cache survives a transfer)", async () => {
    const { host, msgs } = hostHarness(1, 0);
    await host.onMessage({ id: 9, job: "slotStats", params: { variants: ["a"] } });
    const r = msgs[msgs.length - 1];
    const d = (r.msg as { data: { a: { m: Float64Array; ret: number } } }).data.a;
    expect(d.ret).toBeGreaterThan(0.93);
    expect(r.transfer).toContain(d.m.buffer);
    // simulate the transfer detaching the buffers, then ask again
    for (const b of r.transfer) structuredClone(b, { transfer: [b] });
    await host.onMessage({ id: 10, job: "slotStats", params: { variants: ["a"] } });
    const d2 = (msgs[msgs.length - 1].msg as { data: { a: { m: Float64Array } } }).data.a;
    expect(d2.m.length).toBeGreaterThan(100);
  });

  it("transferList walks nested objects and dedupes", () => {
    const a = new Float64Array(3);
    expect(transferList({ x: a, y: [a, { z: new Uint32Array(2) }], n: 1, s: "s" })).toHaveLength(2);
  });
});

/** A fake worker wired to a host on this thread, with async delivery both ways. */
function fakeWorker(scale = 1): WorkerLike & { sent: ToWorker[] } {
  const w = {
    sent: [] as ToWorker[],
    onmessage: null as WorkerLike["onmessage"],
    onerror: null as WorkerLike["onerror"],
    postMessage(m: ToWorker) { w.sent.push(m); queueMicrotask(() => { void host.onMessage(m); }); },
    terminate() { /* nothing */ },
  };
  const host = createHost((msg) => queueMicrotask(() => w.onmessage?.({ data: msg })), { scale, scheduler: fakeScheduler(10), sliceMs: 50 });
  return w;
}

describe("client", () => {
  it("resolves with the result and forwards progress", async () => {
    const fw = fakeWorker();
    const client = createSimClient({ spawn: () => fw });
    const ps: number[] = [];
    const r = await client.run("bankroll", small, { onProgress: (p) => ps.push(p) }).promise;
    expect(r.players).toBe(1000);
    expect(ps.length).toBeGreaterThan(1);
    expect(ps[ps.length - 1]).toBe(1);
    client.dispose();
  });

  it("cancel rejects with SimCancelled and tells the worker", async () => {
    const fw = fakeWorker();
    const client = createSimClient({ spawn: () => fw });
    const run = client.run("bankroll", { ...small, players: 100000 });
    run.cancel();
    await expect(run.promise).rejects.toBeInstanceOf(SimCancelled);
    expect(fw.sent.map((m) => ("cancel" in m ? "cancel" : m.job))).toEqual(["bankroll", "cancel"]);
  });

  it("AbortSignal and latest() cancel earlier runs", async () => {
    const fw = fakeWorker();
    const client = createSimClient({ spawn: () => fw });
    const ac = new AbortController();
    const a = client.run("crashTargets", { n: 100000, seed: "a" }, { signal: ac.signal });
    ac.abort();
    await expect(a.promise).rejects.toBeInstanceOf(SimCancelled);
    const first = client.latest("slider", "crashTargets", { n: 200000, seed: "1" });
    const second = client.latest("slider", "crashTargets", { n: 2000, seed: "2" });
    await expect(first.promise).rejects.toBeInstanceOf(SimCancelled);
    expect((await second.promise).n).toBe(2000);
  });

  it("errors reject with the worker's message", async () => {
    const client = createSimClient({ spawn: () => fakeWorker() });
    await expect(client.run("strategy", { game: "poker" as never, model: null, n: 10, seed: "e" }).promise).rejects.toThrow(/unknown game/);
  });

  it("falls back when the worker cannot be created or fails", async () => {
    const fb = fakeWorker();
    const client = createSimClient({ spawn: () => { throw new Error("no workers"); }, fallback: () => fb });
    expect((await client.run("crashTargets", { n: 1000, seed: "f" }).promise).n).toBe(1000);

    const broken: WorkerLike = { onmessage: null, onerror: null, postMessage() { /* never answers */ }, terminate() { /* */ } };
    const fb2 = fakeWorker();
    const c2 = createSimClient({ spawn: () => broken, fallback: () => fb2 });
    const lost = c2.run("crashTargets", { n: 1000, seed: "f" });
    broken.onerror!(new Error("load failed"));
    await expect(lost.promise).rejects.toThrow("load failed");
    expect((await c2.run("crashTargets", { n: 1000, seed: "f" }).promise).n).toBe(1000);
  });
});
