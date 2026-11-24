import type { Session } from "../../shared/schema";

export interface Env {
  display: Session["display"];
  installed: boolean;
  device: Session["device"];
  /** prefers-reduced-motion */
  reducedMotion: boolean;
  touch: boolean;
}

/** The subset of window/navigator that detection reads; inject a fake in node. */
export interface EnvGlobals {
  matchMedia?: (q: string) => { matches: boolean };
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
  navigator?: { standalone?: boolean; maxTouchPoints?: number; language?: string };
  /** true when `"ontouchstart" in window` */
  hasTouchEvent?: boolean;
}

export function globalsFromWindow(w: unknown = (globalThis as { window?: unknown }).window): EnvGlobals {
  if (!w) return {};
  const win = w as Window & typeof globalThis;
  return {
    matchMedia: typeof win.matchMedia === "function" ? (q) => win.matchMedia(q) : undefined,
    innerWidth: win.innerWidth,
    innerHeight: win.innerHeight,
    devicePixelRatio: win.devicePixelRatio,
    navigator: win.navigator as EnvGlobals["navigator"],
    hasTouchEvent: "ontouchstart" in win,
  };
}

export function detectEnv(g: EnvGlobals = globalsFromWindow()): Env {
  const mq = (q: string): boolean => {
    try { return !!g.matchMedia && g.matchMedia(q).matches; } catch { return false; }
  };
  let display: Env["display"] = "browser";
  if (mq("(display-mode: fullscreen)")) display = "fullscreen";
  else if (mq("(display-mode: standalone)") || g.navigator?.standalone === true) display = "standalone";
  const touch = !!g.hasTouchEvent || (g.navigator?.maxTouchPoints ?? 0) > 0 || mq("(pointer: coarse)");
  const w = Math.round(g.innerWidth ?? 0), h = Math.round(g.innerHeight ?? 0);
  return {
    display,
    installed: display !== "browser",
    device: { w, h, dpr: g.devicePixelRatio ?? 1, touch, orient: w > h ? "landscape" : "portrait" },
    reducedMotion: mq("(prefers-reduced-motion: reduce)"),
    touch,
  };
}
