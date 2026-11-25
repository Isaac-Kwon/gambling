import { describe, expect, it } from "vitest";
import { CRASH } from "@shared/rules/crash";
import { SLOTS, slotFormula } from "@shared/rules/slot";
import { BLACKJACK_EDGE } from "./constants";
import { edgeOf, oceanReturn, returnTable } from "./edges";

describe("edges", () => {
  it("slot return comes from the variant", () => {
    expect(returnTable("a").slot).toBe(slotFormula(SLOTS.a).ret);
    expect(returnTable("b").slot).toBe(slotFormula(SLOTS.b).ret);
    expect(returnTable("a").slot).toBeCloseTo(0.94, 2);
    expect(returnTable("b").slot).toBeCloseTo(0.94, 2);
  });
  it("default variant is a; other games do not depend on the variant", () => {
    expect(returnTable()).toBe(returnTable("a"));
    for (const g of ["ocean", "roulette", "crash", "blackjack"] as const) expect(returnTable("a")[g]).toBe(returnTable("b")[g]);
  });
  it("ocean is about 0.9198", () => {
    expect(oceanReturn()).toBeCloseTo(0.9198, 3);
  });
  it("roulette 36/37, crash 1-edge, blackjack from constants", () => {
    const t = returnTable("a");
    expect(t.roulette).toBeCloseTo(36 / 37, 12);
    expect(t.crash).toBe(1 - CRASH.edge);
    expect(t.blackjack).toBe(1 - BLACKJACK_EDGE);
  });
  it("edgeOf = 1 - return; table is cached and frozen", () => {
    expect(edgeOf("slot", "b")).toBeCloseTo(1 - returnTable("b").slot, 12);
    expect(edgeOf("ocean")).toBeCloseTo(0.0802, 3);
    expect(returnTable("b")).toBe(returnTable("b"));
    expect(Object.isFrozen(returnTable("a"))).toBe(true);
  });
});
