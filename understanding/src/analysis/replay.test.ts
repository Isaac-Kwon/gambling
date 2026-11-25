import { describe, expect, it } from "vitest";
import { replayRows } from "./replay";
import { flushEv, mk, SESSION_OFF, SESSION_ON, SESSION_SVB } from "./__fixtures__/helpers";

describe("replayRows", () => {
  for (const [name, s] of [["on", SESSION_ON], ["off", SESSION_OFF], ["svb", SESSION_SVB]] as const) {
    it(`${name}: one row per Ev, numbering skips the flush`, () => {
      const rows = replayRows(s);
      expect(rows).toHaveLength(s.events.length);
      expect(rows.filter((r) => r.flush)).toHaveLength(1);
      expect(rows.filter((r) => !r.flush).map((r) => r.n)).toEqual(rows.filter((r) => !r.flush).map((_, k) => k + 1));
      const f = rows.find((r) => r.flush)!;
      const prev = rows[f.i - 1];
      expect(f.n).toBe(prev.n);
      expect(rows.reduce((a, r) => a + r.net, 0)).toBe(s.events.at(-1)!.balance - s.startCredits);
      expect(rows.at(-1)!.balance).toBe(s.events.at(-1)!.balance);
    });
  }
  it("empty session", () => {
    expect(replayRows(mk([]))).toEqual([]);
  });
  it("only a flush: n stays 0", () => {
    const rows = replayRows(mk([flushEv(50)]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n: 0, flush: true, payout: 50, net: 50 });
  });
  it("time is settlement time, falling back to start", () => {
    const s = mk([{ game: "slot", bet: 20, payout: 0 }]);
    expect(replayRows(s)[0].t).toBe(s.events[0].te);
    delete s.events[0].te;
    expect(replayRows(s)[0].t).toBe(s.events[0].t);
  });
});
