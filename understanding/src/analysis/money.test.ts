import { describe, expect, it } from "vitest";
import { KRW_PER_CREDIT, MIN_WAGE_KRW_PER_HOUR } from "./constants";
import { creditsToKrw, feltVsActual, krwToWageHours, moneyView } from "./money";

describe("money", () => {
  it("constants", () => {
    expect(KRW_PER_CREDIT).toBe(10);
    expect(MIN_WAGE_KRW_PER_HOUR).toBe(10_320);
  });
  it("credits to KRW at 10/credit", () => {
    expect(creditsToKrw(1)).toBe(10);
    expect(creditsToKrw(-250)).toBe(-2500);
    expect(creditsToKrw(3, 7)).toBe(21);
  });
  it("wage hours", () => {
    expect(krwToWageHours(10_320)).toBe(1);
    expect(krwToWageHours(-5_160)).toBe(0.5);
    expect(krwToWageHours(100, null)).toBeNull();
    expect(krwToWageHours(100, 0)).toBeNull();
    expect(krwToWageHours(Number.NaN)).toBeNull();
  });
  it("moneyView: loss and win", () => {
    const m = moneyView(-1032, 5160);
    expect(m.lossCredits).toBe(1032);
    expect(m.lossKrw).toBe(10_320);
    expect(m.lossWageHours).toBe(1);
    expect(m.netKrw).toBe(-10_320);
    expect(m.wageredKrw).toBe(51_600);
    expect(m.wageredWageHours).toBe(5);
    const w = moneyView(300, 100);
    expect(w.lossCredits).toBe(0);
    expect(w.lossKrw).toBe(0);
    expect(w.lossWageHours).toBe(0);
    expect(w.netKrw).toBe(3000);
  });
  it("feltVsActual", () => {
    const r = feltVsActual({ durMs: 600_000, net: -200 }, { minutes: 5, net: 100 });
    expect(r.actualMinutes).toBe(10);
    expect(r.feltMinutes).toBe(5);
    expect(r.minutesDiff).toBe(-5);
    expect(r.minutesRatio).toBe(2);
    expect(r.feltNet).toBe(100);
    expect(r.netDiff).toBe(300);
  });
  it("feltVsActual: missing / invalid answers", () => {
    const r = feltVsActual({ durMs: 60_000, net: 50 }, { minutes: null, net: undefined });
    expect(r.feltMinutes).toBeNull();
    expect(r.minutesDiff).toBeNull();
    expect(r.minutesRatio).toBeNull();
    expect(r.netDiff).toBeNull();
    expect(feltVsActual({ durMs: 60_000, net: 0 }, { minutes: 0 }).minutesRatio).toBeNull();
    expect(feltVsActual({ durMs: 60_000, net: 0 }, { minutes: Number.NaN }).feltMinutes).toBeNull();
    expect(feltVsActual({ durMs: -5, net: 0 }).actualMinutes).toBe(0);
    expect(feltVsActual({ durMs: 0, net: 0 }, null).feltNet).toBeNull();
  });
});
