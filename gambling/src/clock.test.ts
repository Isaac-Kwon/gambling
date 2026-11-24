import { describe, expect, it } from "vitest";
import { createManualClock } from "./clock";

describe("ManualClock", () => {
  it("wait advances virtual time at once and drives frames", async () => {
    const c = createManualClock(100);
    const dts: number[] = [];
    const off = c.frame((d) => dts.push(d));
    await c.wait(250);
    expect(c.now()).toBe(350);
    expect(dts).toEqual([250]);
    off();
    await c.wait(10);
    expect(dts).toEqual([250]);
  });
  it("pause freezes time", async () => {
    const c = createManualClock();
    c.pause();
    await c.wait(500);
    expect(c.now()).toBe(0);
    c.resume();
    c.advance(5);
    expect(c.now()).toBe(5);
  });
});
