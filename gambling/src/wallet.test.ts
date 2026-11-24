import { describe, expect, it } from "vitest";
import { createWallet } from "./wallet";

describe("wallet", () => {
  it("debit/credit with change events", () => {
    const w = createWallet(1000);
    const seen: [number, number][] = [];
    const off = w.onChange((b, d) => seen.push([b, d]));
    w.debit(300);
    w.credit(50);
    expect(w.balance).toBe(750);
    expect(seen).toEqual([[700, -300], [750, 50]]);
    off();
    w.credit(1);
    expect(seen).toHaveLength(2);
  });
  it("throws when insufficient and leaves balance alone", () => {
    const w = createWallet(100);
    expect(() => w.debit(101)).toThrow();
    expect(w.balance).toBe(100);
  });
  it("rejects non-integers and negatives", () => {
    const w = createWallet(100);
    expect(() => w.debit(0.5)).toThrow();
    expect(() => w.credit(-1)).toThrow();
    expect(() => w.credit(NaN)).toThrow();
    expect(() => createWallet(1.5)).toThrow();
  });
  it("canBet", () => {
    const w = createWallet(100);
    expect(w.canBet(100)).toBe(true);
    expect(w.canBet(101)).toBe(false);
    expect(w.canBet(0)).toBe(false);
  });
  it("restore notifies with the delta", () => {
    const w = createWallet(100);
    let d = 0;
    w.onChange((_b, x) => { d = x; });
    w.restore(40);
    expect(w.balance).toBe(40);
    expect(d).toBe(-60);
  });
});
