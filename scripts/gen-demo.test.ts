import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_PATH, DEMO_SEED, generateDemo, PLAN, serialize } from "./gen-demo-lib";

describe("gen-demo", () => {
  it("is deterministic (two runs are byte-identical) and has the planned shape", async () => {
    const a = await generateDemo();
    const b = await generateDemo();
    expect(serialize(a)).toBe(serialize(b));

    expect(a.seed).toBe(DEMO_SEED);
    expect(a.fx).toBe("on");
    expect(a.sv ?? "a").toBe("a");
    expect(a.endReason).toBe("cashout");
    const bets = a.events.filter((e) => e.bet > 0);
    for (const g of Object.keys(PLAN) as (keyof typeof PLAN)[]) expect(bets.filter((e) => e.game === g)).toHaveLength(PLAN[g]);
    expect(bets).toHaveLength(Object.values(PLAN).reduce((x, y) => x + y, 0));
    // anything beyond the planned rounds is the lump-sum flush Ev(s) of the ocean queue
    for (const e of a.events.filter((e) => e.bet === 0)) expect(e.dec).toMatchObject({ flush: true });
    expect(a.events.at(-1)!.balance).toBeGreaterThanOrEqual(10);
    expect(a.aux?.some((x) => x.kind === "ticker")).toBe(true);
    expect(a.aux?.some((x) => x.kind === "hot")).toBe(true);
    expect(a.aux?.some((x) => x.kind === "crowd")).toBe(true);
  }, 60_000);

  it("the committed understanding/src/demo/session.json is current", async () => {
    expect(readFileSync(DEMO_PATH, "utf8")).toBe(serialize(await generateDemo()));
  }, 60_000);
});
