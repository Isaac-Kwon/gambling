import { describe, expect, it } from "vitest";
import { createRouter, parseHash, toHash, type RouterHost } from "./router";

function fakeHost(initial = ""): RouterHost & { hash: string; fire(): void } {
  let cb: (() => void) | null = null;
  const h = {
    hash: initial,
    getHash: () => h.hash,
    setHash(x: string) { if (x !== h.hash) { h.hash = x; queueMicrotask(() => cb?.()); } },
    listen(f: () => void) { cb = f; return () => { cb = null; }; },
    fire() { cb?.(); },
  };
  return h;
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("hash parsing", () => {
  it("routes", () => {
    expect(parseHash("")).toEqual({ kind: "lobby" });
    expect(parseHash("#/")).toEqual({ kind: "lobby" });
    expect(parseHash("#/g/slot")).toEqual({ kind: "game", id: "slot" });
    expect(parseHash("#/g/nope")).toEqual({ kind: "lobby" });
    expect(toHash({ kind: "game", id: "crash" })).toBe("#/g/crash");
  });
});

describe("router", () => {
  it("logs nav on start and each committed route; mounts in order", async () => {
    const host = fakeHost("#/g/slot");
    const nav: string[] = [];
    const mounted: string[] = [];
    const r = createRouter({ host, logNav: (t) => nav.push(t), canLeave: () => true, onRoute: (x) => { mounted.push(x.kind === "game" ? x.id : "lobby"); } });
    await r.start();
    await r.go({ kind: "lobby" });
    await r.go({ kind: "game", id: "ocean" });
    await r.go({ kind: "game", id: "ocean" }); // same route: ignored
    expect(nav).toEqual(["slot", "lobby", "ocean"]);
    expect(mounted).toEqual(nav);
    expect(host.hash).toBe("#/g/ocean");
  });
  it("hashchange from the browser (back button) navigates", async () => {
    const host = fakeHost("#/");
    const nav: string[] = [];
    const r = createRouter({ host, logNav: (t) => nav.push(t), canLeave: () => true, onRoute: () => undefined });
    await r.start();
    await r.go({ kind: "game", id: "slot" });
    host.hash = "#/";
    host.fire();
    await tick();
    expect(nav).toEqual(["lobby", "slot", "lobby"]);
  });
  it("defers while canLeave is false, restores the hash, then proceeds", async () => {
    const host = fakeHost("#/");
    const nav: string[] = [];
    let can = true;
    const r = createRouter({ host, logNav: (t) => nav.push(t), canLeave: () => can, onRoute: () => undefined });
    await r.start();
    await r.go({ kind: "game", id: "crash" });
    can = false;
    host.hash = "#/";
    host.fire();
    await tick();
    expect(host.hash).toBe("#/g/crash");
    expect(r.deferred).toEqual({ kind: "lobby" });
    expect(nav).toEqual(["lobby", "crash"]);
    can = true;
    await r.retryDeferred();
    await tick();
    expect(nav).toEqual(["lobby", "crash", "lobby"]);
    expect(r.deferred).toBeNull();
  });
  it("lock ignores navigation", async () => {
    const host = fakeHost("#/");
    const nav: string[] = [];
    const r = createRouter({ host, logNav: (t) => nav.push(t), canLeave: () => true, onRoute: () => undefined });
    await r.start();
    r.lock();
    await r.go({ kind: "game", id: "slot" });
    expect(nav).toEqual(["lobby"]);
  });
});
