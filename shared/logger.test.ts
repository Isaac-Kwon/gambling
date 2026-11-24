import { describe, expect, it, vi } from "vitest";
import { SESSION_KEY, createLogger, type SessionMeta } from "./logger";

const meta: SessionMeta = {
  v: 1, seed: "abc", mode: "free", fx: "on", display: "browser", installed: false,
  device: { w: 390, h: 800, dpr: 3, touch: true, orient: "portrait" },
  startedAt: 1_000, startCredits: 10_000,
};

function mem() {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("logger", () => {
  it("records relative times and saves", () => {
    let t = 1_000;
    const st = mem();
    const log = createLogger(meta, { storage: st, clock: () => t });
    t = 1_250; log.nav("lobby"); log.aux("crowd", { n: 3 });
    expect(log.now()).toBe(250);
    expect(log.session.nav[0]).toEqual({ t: 250, to: "lobby" });
    expect(log.session.aux![0]).toEqual({ t: 250, kind: "crowd", d: { n: 3 } });
    t = 5_000; log.end("bust");
    const saved = JSON.parse(st.m.get(SESSION_KEY)!);
    expect(saved.endReason).toBe("bust");
    expect(saved.endedAt).toBe(5_000);
  });

  it("continues when setItem throws", () => {
    const bad = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    const log = createLogger(meta, { storage: bad, clock: () => 2_000 });
    expect(log.save()).toBe(false);
    expect(() => { log.scheduleSave(); log.end("cashout"); }).not.toThrow();
    expect(log.session.endReason).toBe("cashout");
    expect(createLogger(meta, { storage: null }).save()).toBe(false);
  });

  it("serializes at save time (late fx records included)", () => {
    const st = mem();
    const log = createLogger(meta, { storage: st, clock: () => 2_000 });
    const ev = { t: 1, game: "slot" as const, round: 1, bet: 20, payout: 0, net: -20, balance: 9_980, fx: [] as { type: string; ms: number; k: number }[] };
    log.push(ev);
    ev.fx.push({ type: "x", ms: 100, k: 1 });
    log.save();
    expect(JSON.parse(st.m.get(SESSION_KEY)!).events[0].fx).toHaveLength(1);
  });

  it("scheduleSave writes at most once per 1.5s", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const st = mem();
      const spy = vi.spyOn(st, "setItem");
      const log = createLogger(meta, { storage: st });
      log.scheduleSave(); // first: immediate
      log.scheduleSave(); log.scheduleSave(); // coalesced
      expect(spy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_500);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it("resumes an existing session", () => {
    const log = createLogger(meta, { storage: mem(), resume: { ...meta, events: [], nav: [], aux: [], id: "r" } });
    expect(log.session.id).toBe("r");
  });
});
