import { describe, expect, it } from "vitest";
import type { GameId } from "./config";
import { decodeSummary, encodeSummary, loadSession, resolveHandoff, summarize, summaryHash, HASH_MAX } from "./handoff";
import { SESSION_KEY } from "./logger";
import type { Ev, Session } from "./schema";

function ev(game: GameId, round: number, bet: number, payout: number, balance: number, extra: Partial<Ev> = {}): Ev {
  return { t: round * 1000, te: round * 1000 + 500, game, round, bet, payout, net: payout - bet, balance, ...extra };
}

function session(over: Partial<Session> = {}): Session {
  return {
    v: 1, seed: "seed123456", mode: "class", fx: "on", display: "standalone", installed: true,
    device: { w: 390, h: 800, dpr: 3, touch: true, orient: "portrait" },
    startedAt: 1_700_000_000_000, endedAt: 1_700_000_100_000, endReason: "cashout",
    startCredits: 10_000, sv: "b", lang: "ko", unreleased: 120,
    nav: [], aux: [],
    events: [
      ev("slot", 1, 20, 0, 9_980, { fx: [{ type: "a", ms: 300, k: 1 }], ctl: { stopPressed: true } }),
      ev("slot", 2, 40, 400, 10_340, { disp: { celebrate: true }, fx: [{ type: "b", ms: 900, k: 2 }] }),
      ev("slot", 3, 20, 10, 10_330, { disp: { celebrate: true, dispVar: {} } }),
      ev("ocean", 1, 20, 0, 10_310, { disp: { omen: "clam" } }),
      ev("ocean", 2, 20, 0, 10_290),
      ev("ocean", 3, 0, 120, 10_410, { dec: { bonusSeqId: 1, flush: true } }),
    ],
    ...over,
  };
}

function mem(s?: Session) {
  return { getItem: (k: string) => (k === SESSION_KEY && s ? JSON.stringify(s) : null) };
}

describe("summarize", () => {
  it("computes the fields", () => {
    const m = summarize(session());
    expect(m.durMs).toBe(100_000);
    expect(m.finalCredits).toBe(10_410);
    expect(m.peak).toEqual({ bal: 10_410, t: 3_500 });
    expect(m.maxWin).toBe(360);
    expect(m.fxMsPos).toBe(900);
    expect(m.fxMsNeg).toBe(300);
    expect(m.chase).toBe(1); // slot r2 raised bet after a loss
    expect(m.games.slot).toEqual({ n: 3, bet: 80, pay: 410, cel: 2, celNeg: 1, dv: 1, stop: 1 });
    expect(m.games.ocean!.n).toBe(2); // flush not counted as a round
    expect(m.games.ocean!.pay).toBe(120);
    expect(m.omen).toEqual({ n: 1, after: 1 });
    expect(m.sv).toBe("b");
    expect(m.unreleased).toBe(120);
  });
});

describe("encode/decode", () => {
  it("roundtrips", async () => {
    const m = summarize(session());
    const p = await encodeSummary(m);
    expect(p.startsWith("2.") || p.startsWith("1.")).toBe(true);
    expect(await decodeSummary(p)).toEqual(m);
  });

  it("decodes the uncompressed form and rejects junk", async () => {
    const m = summarize(session());
    const b64 = btoa(JSON.stringify(m)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await decodeSummary("1." + b64)).toEqual(m);
    expect(await decodeSummary("garbage")).toBeNull();
    expect(await decodeSummary("2.!!!")).toBeNull();
    expect(await decodeSummary("1." + btoa("{}"))).toBeNull();
  });

  it("worst-case hash stays within 2,000 chars", async () => {
    const big = 123_456_789.5;
    const g = { n: 99_999, bet: big, pay: big, cel: 99_999, celNeg: 99_999, dv: 99_999, stop: 99_999 };
    const m = summarize(session());
    m.games = { slot: g, roulette: g, blackjack: g, crash: g, ocean: g };
    m.seed = "Zz9Zz9Zz9Z"; m.fxMsPos = big; m.fxMsNeg = big; m.omen = { n: 99_999, after: 99_999 };
    const h = await summaryHash(m);
    expect(h.startsWith("#s=")).toBe(true);
    expect(h.length).toBeLessThanOrEqual(HASH_MAX);
    // even uncompressed it fits for a real-sized summary
    expect(("#s=1." + btoa(JSON.stringify(summarize(session())))).length).toBeLessThanOrEqual(HASH_MAX);
  });
});

describe("resolveHandoff", () => {
  it("full: ended stored session, no hash or matching hash", async () => {
    const s = session();
    expect((await resolveHandoff("", mem(s)))?.kind).toBe("full");
    const h = await summaryHash(summarize(s));
    expect((await resolveHandoff(h, mem(s)))?.kind).toBe("full");
  });

  it("summary: storage missing or session mismatched/unended", async () => {
    const s = session();
    const h = await summaryHash(summarize(s));
    const r = await resolveHandoff(h, null);
    expect(r?.kind).toBe("summary");
    const other = session({ startedAt: 5 });
    expect((await resolveHandoff(h, mem(other)))?.kind).toBe("summary");
    const open = session(); delete open.endedAt;
    expect((await resolveHandoff(h, mem(open)))?.kind).toBe("summary");
  });

  it("null: nothing usable", async () => {
    expect(await resolveHandoff("", null)).toBeNull();
    expect(await resolveHandoff("#s=zzz", mem())).toBeNull();
    const open = session(); delete open.endedAt;
    expect(await resolveHandoff("", mem(open))).toBeNull();
  });

  it("loadSession rejects bad data", () => {
    expect(loadSession({ getItem: () => "{not json" })).toBeNull();
    expect(loadSession({ getItem: () => JSON.stringify({ v: 2, seed: "x", events: [] }) })).toBeNull();
    expect(loadSession({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
  });
});
