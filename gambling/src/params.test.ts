import { describe, expect, it } from "vitest";
import { parseParams } from "./params";

describe("parseParams", () => {
  it("defaults", () => {
    expect(parseParams("")).toEqual({ seed: null, fx: "on", sv: "a", lang: null });
  });
  it("reads seed, fx, sv, lang (leading ? optional)", () => {
    expect(parseParams("?seed=abc&fx=off&sv=b&lang=it")).toEqual({ seed: "abc", fx: "off", sv: "b", lang: "it" });
    expect(parseParams("seed=x")).toMatchObject({ seed: "x" });
  });
  it("is strict about fx and sv", () => {
    expect(parseParams("?fx=0").fx).toBe("on");
    expect(parseParams("?fx=OFF").fx).toBe("off");
    expect(parseParams("?sv=c").sv).toBe("a");
    expect(parseParams("?sv=B").sv).toBe("b");
  });
  it("ignores empty seed and unknown lang; accepts en-US", () => {
    expect(parseParams("?seed=&lang=xx").seed).toBeNull();
    expect(parseParams("?seed=%20").seed).toBeNull();
    expect(parseParams("?lang=xx").lang).toBeNull();
    expect(parseParams("?lang=en-US").lang).toBe("en");
  });
});
