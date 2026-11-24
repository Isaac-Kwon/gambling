import { describe, expect, it } from "vitest";
import { detectEnv } from "./env";

const mm = (on: string[]) => (q: string) => ({ matches: on.includes(q) });

describe("detectEnv", () => {
  it("empty globals -> browser", () => {
    const e = detectEnv({});
    expect(e.display).toBe("browser");
    expect(e.installed).toBe(false);
    expect(e.touch).toBe(false);
  });
  it("standalone via media query or iOS flag", () => {
    expect(detectEnv({ matchMedia: mm(["(display-mode: standalone)"]) })).toMatchObject({ display: "standalone", installed: true });
    expect(detectEnv({ navigator: { standalone: true } }).display).toBe("standalone");
    expect(detectEnv({ matchMedia: mm(["(display-mode: fullscreen)"]) }).display).toBe("fullscreen");
  });
  it("device, touch, orientation, reduced motion", () => {
    const e = detectEnv({
      matchMedia: mm(["(prefers-reduced-motion: reduce)"]), innerWidth: 844, innerHeight: 390, devicePixelRatio: 3,
      navigator: { maxTouchPoints: 5 },
    });
    expect(e.device).toEqual({ w: 844, h: 390, dpr: 3, touch: true, orient: "landscape" });
    expect(e.reducedMotion).toBe(true);
    expect(detectEnv({ innerWidth: 390, innerHeight: 844 }).device.orient).toBe("portrait");
  });
  it("survives a throwing matchMedia", () => {
    expect(detectEnv({ matchMedia: () => { throw new Error("x"); } }).display).toBe("browser");
  });
});
