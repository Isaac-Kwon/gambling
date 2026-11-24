import type { GameId } from "../../shared/config";

export type Route = { kind: "lobby" } | { kind: "game"; id: GameId };

const IDS: readonly GameId[] = ["slot", "roulette", "blackjack", "crash", "ocean"];

/** `#/` is the lobby, `#/g/<id>` a game; anything else falls back to the lobby. */
export function parseHash(hash: string): Route {
  const m = /^#?\/g\/([a-z]+)\/?$/.exec(hash ?? "");
  if (m && (IDS as readonly string[]).includes(m[1])) return { kind: "game", id: m[1] as GameId };
  return { kind: "lobby" };
}

export function toHash(r: Route): string {
  return r.kind === "game" ? `#/g/${r.id}` : "#/";
}

/** Value logged in `nav[].to`. */
export function navTarget(r: Route): string {
  return r.kind === "game" ? r.id : "lobby";
}

export interface RouterHost {
  getHash(): string;
  setHash(h: string): void;
  /** hashchange subscription; returns unsubscribe. */
  listen(cb: () => void): () => void;
}

export function windowHost(w: Window = window): RouterHost {
  return {
    getHash: () => w.location.hash,
    setHash: (h) => { w.location.hash = h; },
    listen: (cb) => { w.addEventListener("hashchange", cb); return () => w.removeEventListener("hashchange", cb); },
  };
}

export interface Router {
  readonly current: Route;
  /** The route the player tried to reach while canLeave() was false, if any. */
  readonly deferred: Route | null;
  /** Applies the current hash (logs nav, calls onRoute). Call once, after the gate. */
  start(): Promise<void>;
  go(r: Route): Promise<void>;
  /** Retry a deferred navigation (call after settlement). */
  retryDeferred(): Promise<void>;
  /** While locked (cash-out cover) every navigation is ignored. */
  lock(): void;
  dispose(): void;
}

export function createRouter(o: {
  host: RouterHost;
  logNav: (to: string) => void;
  canLeave: () => boolean;
  onRoute: (r: Route, from: Route | null) => void | Promise<void>;
}): Router {
  let current: Route = { kind: "lobby" };
  let started = false;
  let locked = false;
  let deferred: Route | null = null;
  let chain: Promise<void> = Promise.resolve();

  const same = (a: Route, b: Route): boolean => toHash(a) === toHash(b);

  const commit = (r: Route): Promise<void> => {
    const from = started ? current : null;
    current = r;
    started = true;
    deferred = null;
    o.logNav(navTarget(r));
    chain = chain.then(() => o.onRoute(r, from)).catch(() => undefined);
    return chain;
  };

  const request = (r: Route): Promise<void> => {
    if (locked || (started && same(r, current))) return chain;
    if (started && !o.canLeave()) {
      deferred = r;
      if (o.host.getHash() !== toHash(current)) o.host.setHash(toHash(current));
      return chain;
    }
    if (o.host.getHash() !== toHash(r)) o.host.setHash(toHash(r));
    return commit(r);
  };

  const unlisten = o.host.listen(() => { void request(parseHash(o.host.getHash())); });

  return {
    get current() { return current; },
    get deferred() { return deferred; },
    start() {
      const r = parseHash(o.host.getHash());
      if (o.host.getHash() !== toHash(r)) o.host.setHash(toHash(r));
      return commit(r);
    },
    go: (r) => request(r),
    retryDeferred() { return deferred ? request(deferred) : chain; },
    lock() { locked = true; },
    dispose() { unlisten(); },
  };
}
