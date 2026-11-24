/**
 * Drawing side of fx (ARCHITECTURE §6.5). The director (`index.ts`) decides what and for how long;
 * a backend only draws. `createDomBackend` draws banners, count-up digits, rings, dim, flash and shake in
 * the DOM (`#fx-dom`, transform/opacity only) and hands particles, rays and glow to the Pixi layer when
 * `gfx.current` is set. `nullBackend` draws nothing (headless tests, harness).
 *
 * Sound and vibration are not here: the director calls the injected `Sfx` / `Haptics`.
 */
import "./glow.css";
import type { GfxLayer, GfxRect } from "./gl/loader";
import { MAX_PARTICLES } from "./particles";
import { particleCap } from "./quality";
import { shakeFrames } from "./shake";
import { TIER_LABEL } from "./tiers";
import { riseGlow, riseSparkRate, DIM_RAMP_MS } from "./anticipation";

/** A lasting effect. `stop` ends it early (idempotent); `update` retunes a running antic. */
export interface FxHandle {
  stop(): void;
  update?(k: number, ms: number): void;
}

export interface FxBackend {
  /** Tier banner (1..4) for `ms`. The handle's stop plays the exit. */
  banner(tier: number, ms: number): FxHandle;
  /** Amount line of the banner (empty string hides it). */
  bannerText(text: string): void;
  setText(el: unknown, text: string): void;
  /** Win emphasis around `el` (static glow layer, opacity pulse). */
  pulse(el: unknown, ms: number): FxHandle;
  /** Particles of `kind` ("coins" | "confetti" | "rays" | "bubbles" | "tickets" | "sparks"). Returns the count actually emitted (0 without a layer). */
  emit(kind: string, n: number, at: unknown, ms: number, seed?: number): number;
  /** Additive glow at `at` (null = screen centre), intensity k 0..1. */
  glow(at: unknown, k: number, ms: number): void;
  shake(el: unknown, px: number, ms: number, seed: number): FxHandle;
  antic(el: unknown, kind: string, k: number, ms: number): FxHandle;
  flash(el: unknown, color: string, ms: number): void;
  /** Quick fade of every live particle / ray / glow (skip). */
  fadeParticles(): void;
  /** Current concurrent-particle cap (0 without a layer). */
  cap(): number;
  /** One-shot listener for a tap anywhere on the frame. Returns an unsubscribe. */
  onTap(cb: () => void): () => void;
  /** Called when the decoration layer drops its particles (context lost, layer removed). */
  onDrop(cb: () => void): () => void;
  suspend(): void;
  resume(): void;
  stop(): void;
}

const NOOP_HANDLE: FxHandle = { stop() {}, update() {} };
const noop = () => {};

/**
 * Draws nothing. `emit` returns the requested count as-is so decisions and records happen as in the browser.
 * `setText` still writes `textContent` (like the null fx's count-up), so headless state matches the screen.
 */
export const nullBackend: FxBackend = {
  banner: () => NOOP_HANDLE,
  bannerText: noop,
  setText(el, text) {
    if (el && typeof el === "object" && "textContent" in el) (el as { textContent: string | null }).textContent = text;
  },
  pulse: () => NOOP_HANDLE,
  emit: (_kind, n) => Math.max(0, Math.floor(n)),
  glow: noop,
  shake: () => NOOP_HANDLE,
  antic: () => NOOP_HANDLE,
  flash: noop,
  fadeParticles: noop,
  cap: () => MAX_PARTICLES,
  onTap: () => noop,
  onDrop: () => noop,
  suspend: noop,
  resume: noop,
  stop: noop,
};

// ---------------------------------------------------------------------------------------------- DOM

export interface DomBackendOptions {
  /** `#frame`: coordinate origin, tap target, default shake target. */
  frame: HTMLElement;
  /** Filled by `loadGfx` once the Pixi layer is ready; null until then (and with no WebGL). */
  gfx: { current: GfxLayer | null };
  /** Overlay for banners / rings / flash. Default: `#fx-dom` inside the frame (created if missing). */
  layer?: HTMLElement;
  /** Translator for banner captions (`tier.1`..`tier.4`). Missing keys fall back to English. */
  t?: (key: string) => string;
  /** Element moved by a celebration shake (default: the frame). */
  shakeTarget?: HTMLElement;
}

function isEl(x: unknown): x is HTMLElement {
  return !!x && typeof (x as HTMLElement).getBoundingClientRect === "function";
}

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export function createDomBackend(o: DomBackendOptions): FxBackend {
  const frame = o.frame;
  const layer: HTMLElement = o.layer ?? (frame.querySelector<HTMLElement>("#fx-dom") ?? (() => {
    const d = mk("div", "", frame);
    d.id = "fx-dom";
    return d;
  })());
  layer.classList.add("fx-dom");
  layer.setAttribute("aria-hidden", "true");

  const label = (tier: number): string => {
    const key = `tier.${tier}`;
    const s = o.t?.(key);
    return s && s !== key ? s : TIER_LABEL[Math.max(1, Math.min(4, tier)) as 1 | 2 | 3 | 4];
  };

  /** Rect of `el` relative to the frame (null = whole frame). */
  const rectOf = (el: unknown): GfxRect | null => {
    if (!isEl(el)) return null;
    const r = el.getBoundingClientRect();
    const f = layer.getBoundingClientRect();
    return { x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height };
  };
  const frameRect = (): GfxRect => {
    const f = layer.getBoundingClientRect();
    return { x: 0, y: 0, w: f.width, h: f.height };
  };
  const place = (d: HTMLElement, r: GfxRect, pad = 0) => {
    d.style.left = `${r.x - pad}px`;
    d.style.top = `${r.y - pad}px`;
    d.style.width = `${r.w + 2 * pad}px`;
    d.style.height = `${r.h + 2 * pad}px`;
  };

  // ------------------------------------------------------------------ frame loop (only while busy)
  type Follower = (dtMs: number, nowMs: number) => boolean;   // false = done
  const followers = new Set<Follower>();
  let raf = 0, lastTs = 0, suspended = false;
  const dropCbs = new Set<() => void>();
  let hooked: GfxLayer | null = null;

  const gfx = (): GfxLayer | null => {
    const g = o.gfx.current;
    if (!g || !g.alive) return null;
    if (g !== hooked) {
      hooked = g;
      g.onDrop = () => { for (const cb of [...dropCbs]) cb(); };
    }
    return g;
  };
  const tick = (ts: number) => {
    raf = 0;
    const dt = lastTs ? Math.max(0, ts - lastTs) : 1000 / 60;
    lastTs = ts;
    for (const fl of [...followers]) if (!fl(dt, ts)) followers.delete(fl);
    const g = gfx();
    if (g) g.frame(dt);
    if (!suspended && (followers.size > 0 || (g && g.busy))) raf = requestAnimationFrame(tick);
    else lastTs = 0;
  };
  const kick = () => {
    if (raf || suspended || typeof requestAnimationFrame !== "function") return;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  };

  // ------------------------------------------------------------------ banner
  let bn: { root: HTMLDivElement; title: HTMLDivElement; glow: HTMLSpanElement; face: HTMLSpanElement; shineWin: HTMLSpanElement; shineText: HTMLSpanElement; amt: HTMLDivElement } | null = null;
  let bnAnims: Animation[] = [];
  let bnToken = 0;
  let amtText = "";

  const ensureBanner = () => {
    if (bn) return bn;
    const root = mk("div", "fx-banner", layer);
    mk("div", "fx-banner-burst", root);
    const title = mk("div", "fx-banner-title", root);
    const glow = mk("span", "fx-banner-glow", title);
    const face = mk("span", "fx-banner-face", title);
    const shineWin = mk("span", "fx-banner-shinewin", title);
    const shineText = mk("span", "fx-banner-shinetext", shineWin);
    const amt = mk("div", "fx-banner-amt", root);
    bn = { root, title, glow, face, shineWin, shineText, amt };
    return bn;
  };

  const setDigits = (box: HTMLElement, text: string) => {
    // Fixed-width cells (§2.4) so the number does not jitter while counting. Cells are reused.
    const cells = box.children;
    while (cells.length > text.length) box.lastChild!.remove();
    while (cells.length < text.length) mk("span", "fx-d", box);
    for (let i = 0; i < text.length; i++) {
      const c = cells[i] as HTMLElement, ch = text[i];
      if (c.textContent !== ch) {
        c.textContent = ch;
        c.className = ch >= "0" && ch <= "9" ? "fx-d" : "fx-d fx-sep";
      }
    }
  };

  const banner = (tier: number, _ms: number): FxHandle => {
    const b = ensureBanner();
    const my = ++bnToken;
    for (const a of bnAnims) a.cancel();
    bnAnims = [];
    const text = label(tier);
    b.glow.textContent = text;
    b.face.textContent = text;
    b.shineText.textContent = text;
    b.root.dataset.tier = String(tier);
    amtText = "";
    b.amt.replaceChildren();
    b.root.classList.add("fx-on");
    if (typeof b.root.animate === "function") {
      bnAnims.push(b.root.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1.14)", opacity: 1, offset: 0.55 },
          { transform: "translate(-50%, -50%) scale(0.97)", opacity: 1, offset: 0.78 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)", fill: "both" },
      ));
      // Shine sweep: the window moves right while its text moves left by the same amount (transform only).
      const w = b.title.offsetWidth || 240;
      const band = w * 0.42;
      const from = -band * 1.2, to = w + band * 0.2;
      const timing: KeyframeAnimationOptions = { duration: 1700, delay: 450, iterations: Infinity, easing: "ease-in-out" };
      bnAnims.push(b.shineWin.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], timing));
      bnAnims.push(b.shineText.animate([{ transform: `translateX(${-from}px)` }, { transform: `translateX(${-to}px)` }], timing));
    }
    let stopped = false;
    return {
      stop() {
        if (stopped || my !== bnToken) return;
        stopped = true;
        const done = () => {
          if (my !== bnToken) return;
          for (const a of bnAnims) a.cancel();
          bnAnims = [];
          b.root.classList.remove("fx-on");
        };
        if (typeof b.root.animate === "function") {
          const ex = b.root.animate(
            [
              { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
              { transform: "translate(-50%, -50%) scale(1.2)", opacity: 0 },
            ],
            { duration: 300, easing: "ease-in", fill: "forwards" },
          );
          bnAnims.push(ex);
          ex.onfinish = done;
        } else done();
      },
    };
  };

  // ------------------------------------------------------------------ rings (win emphasis, reel antic)
  const ring = (el: unknown, cls: string, ms: number): FxHandle => {
    const r = rectOf(el) ?? frameRect();
    const d = mk("div", `fx-ring ${cls}`, layer);
    place(d, r, 4);
    let t: ReturnType<typeof setTimeout> | undefined;
    const h: FxHandle = {
      stop() {
        if (t !== undefined) clearTimeout(t);
        t = undefined;
        if (!d.isConnected) return;
        if (typeof d.animate === "function") {
          // >= 200 ms fade: a slow change, not a flash.
          const a = d.animate([{ opacity: getComputedStyle(d).opacity }, { opacity: 0 }], { duration: 260, fill: "forwards" });
          a.onfinish = () => d.remove();
        } else d.remove();
      },
      update(_k, ms2) {
        if (t !== undefined) clearTimeout(t);
        t = setTimeout(() => h.stop(), ms2);
      },
    };
    h.update!(0, ms);
    return h;
  };

  // ------------------------------------------------------------------ antic
  const antic = (el: unknown, kind: string, k: number, ms: number): FxHandle => {
    if (kind === "dim") {
      const r = rectOf(el) ?? frameRect();
      const d = mk("div", "fx-dim", layer);
      place(d, r);
      const depth = Math.max(0, Math.min(0.9, k));
      const total = Math.max(ms, 2 * DIM_RAMP_MS);
      const edge = DIM_RAMP_MS / total;
      let a: Animation | null = null;
      if (typeof d.animate === "function") {
        a = d.animate(
          [{ opacity: 0 }, { opacity: depth, offset: edge }, { opacity: depth, offset: 1 - edge }, { opacity: 0 }],
          { duration: total, easing: "linear", fill: "forwards" },
        );
        a.onfinish = () => d.remove();
      } else setTimeout(() => d.remove(), total);
      return {
        stop() {
          if (!d.isConnected || !a) return d.remove();
          a.pause();
          const cur = getComputedStyle(d).opacity;
          a.cancel();
          const out = d.animate([{ opacity: cur }, { opacity: 0 }], { duration: DIM_RAMP_MS, fill: "forwards" });
          out.onfinish = () => d.remove();
        },
      };
    }

    if (kind === "reel") {
      const rg = ring(el, "fx-ring--antic", ms);
      let until = performance.now() + ms, acc = 0, side = 0;
      const fl: Follower = (dt, now) => {
        if (now > until) return false;
        const g = gfx();
        if (!g) return true;
        acc += (46 * dt) / 1000;
        const n = Math.floor(acc);
        if (n > 0) {
          acc -= n;
          const r = rectOf(el);
          if (r) {
            for (let i = 0; i < n; i++) {
              side = (side + 1) % 4;
              const e: GfxRect = side === 0 ? { x: r.x, y: r.y - 2, w: r.w, h: 4 } : side === 1 ? { x: r.x + r.w - 2, y: r.y, w: 4, h: r.h }
                : side === 2 ? { x: r.x, y: r.y + r.h - 2, w: r.w, h: 4 } : { x: r.x - 2, y: r.y, w: 4, h: r.h };
              g.emit("sparks", 1, e, 600);
            }
          }
        }
        // No additive glow over the reel window itself: it would wash out the symbols (game information).
        return true;
      };
      followers.add(fl);
      kick();
      return {
        stop() { until = 0; rg.stop(); },
        update(_k, ms2) { until = performance.now() + ms2; rg.update!(0, ms2); },
      };
    }

    if (kind === "rise") {
      let kk = k, until = performance.now() + ms, acc = 0;
      const fl: Follower = (dt, now) => {
        if (now > until) return false;
        const g = gfx();
        if (!g) return true;
        const r = rectOf(el);
        if (!r) return true;
        acc += (riseSparkRate(kk) * dt) / 1000;
        const n = Math.floor(acc);
        if (n > 0) { acc -= n; g.emit("exhaust", n, r, 520); }
        g.glow(r, riseGlow(kk), 200);
        return true;
      };
      followers.add(fl);
      kick();
      return {
        stop() { until = 0; },
        update(k2, ms2) { kk = k2; until = performance.now() + ms2; },
      };
    }
    return NOOP_HANDLE;
  };

  // ------------------------------------------------------------------ the backend
  const backend: FxBackend = {
    banner,
    bannerText(text) {
      if (!bn || text === amtText) return;
      amtText = text;
      setDigits(bn.amt, text);
    },
    setText(el, text) {
      if (isEl(el) && el.textContent !== text) el.textContent = text;
    },
    pulse: (el, ms) => ring(el, "fx-ring--win", ms),
    emit(kind, n, at, ms, seed) {
      const g = gfx();
      if (!g || !(n > 0)) return 0;
      const got = g.emit(kind, n, rectOf(at), ms, seed);
      if (got > 0) kick();
      return got;
    },
    glow(at, k, ms) {
      const g = gfx();
      if (!g) return;
      g.glow(rectOf(at), k, ms);
      kick();
    },
    shake(el, px, ms, seed) {
      const target = isEl(el) ? el : (o.shakeTarget ?? frame);
      if (typeof target.animate !== "function" || !(px > 0)) return NOOP_HANDLE;
      const kf = shakeFrames(px, ms, seed).map((p) => ({ transform: `translate(${p.x}px, ${p.y}px) rotate(${p.r}deg)` }));
      let a: Animation;
      try {
        a = target.animate(kf, { duration: ms, easing: "linear", composite: "add" });
      } catch {
        a = target.animate(kf, { duration: ms, easing: "linear" });
      }
      return { stop: () => a.cancel() };
    },
    antic,
    flash(el, color, ms) {
      const r = rectOf(el) ?? frameRect();
      const d = mk("div", "fx-flash", layer);
      place(d, r);
      d.style.background = color;
      if (typeof d.animate !== "function") { d.remove(); return; }
      const a = d.animate([{ opacity: 0 }, { opacity: 0.72, offset: 0.22 }, { opacity: 0 }], { duration: Math.max(60, ms), easing: "ease-out", fill: "forwards" });
      a.onfinish = () => d.remove();
    },
    fadeParticles() {
      o.gfx.current?.stop();
    },
    cap() {
      const g = gfx();
      return g ? particleCap(g.quality) : 0;
    },
    onTap(cb) {
      let on = true;
      const h = () => { if (!on) return; off(); cb(); };
      const off = () => { on = false; frame.removeEventListener("pointerdown", h, true); };
      frame.addEventListener("pointerdown", h, { capture: true, passive: true });
      return off;
    },
    onDrop(cb) {
      dropCbs.add(cb);
      return () => { dropCbs.delete(cb); };
    },
    suspend() {
      suspended = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastTs = 0;
      o.gfx.current?.suspend();
    },
    resume() {
      suspended = false;
      o.gfx.current?.resume();
      kick();
    },
    stop() {
      bnToken++;
      for (const a of bnAnims) a.cancel();
      bnAnims = [];
      bn?.root.classList.remove("fx-on");
      followers.clear();
      for (const d of [...layer.querySelectorAll(".fx-ring, .fx-dim, .fx-flash")]) d.remove();
      o.gfx.current?.stop();
    },
  };
  return backend;
}
