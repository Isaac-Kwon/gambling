import { describe, expect, it } from "vitest";
import { skylineSvg, starsSvgs, svgUrl, TWINKLE_GROUPS } from "./art";

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("crash sky art (background-image documents)", () => {
  it("stars: 70 stars split into a still layer and the twinkle groups, deterministic", () => {
    const a = starsSvgs(), b = starsSvgs();
    expect(a).toEqual(b);
    expect(a.tw).toHaveLength(TWINKLE_GROUPS);
    const circles = count(a.base, /<circle /g) + a.tw.reduce((n, s) => n + count(s, /<circle /g), 0);
    expect(circles).toBe(70);
    for (const s of a.tw) expect(count(s, /<circle /g)).toBeGreaterThan(0);
  });

  it("every layer is a standalone SVG document (no classes or styles that need the page stylesheet)", () => {
    const { base, tw } = starsSvgs();
    for (const s of [base, ...tw, skylineSvg()]) {
      expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(s).not.toMatch(/class=|style=/);
      expect(svgUrl(s)).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/);
    }
  });
});
