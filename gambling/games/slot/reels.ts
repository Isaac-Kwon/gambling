/**
 * Reel renderer (DOM). Each reel is a clipped column showing 3 rows plus a 35 % peek cell above and below
 * (§7.5). A reel owns 7 recycled cell elements inside one strip; while turning, only the strip's transform
 * changes per frame (compositor only), and a cell gets a new symbol class when it wraps around.
 *
 * Coordinates: `u` = strip index at the top edge of the window (rows go down as the index grows; the reel
 * turns downward, so `u` decreases). At rest the final window (peek above, rows 0..2, peek below) sits at
 * indices L..L+4 with u = L + 0.65.
 *
 * Timing comes from the core (`at[i]` = clock time the reel is at rest, bounce included). Frames come from
 * `clock.frame` and positions from `clock.now()`, so everything freezes while the app is in the background.
 */
import type { Sym } from "../../../shared/rules/slot";
import type { Clock } from "../../src/types";
import { symClass } from "./art";
import { TAPE_LEN, type SpinPlan } from "./core";

const CELLS = 7;
const PEEK = 0.35;
const TOP = 1 - PEEK;          // u at rest = L + TOP
const WIND_MS = 150;
const STAGGER_MS = 45;
const V_MAX = 26;              // cells / s
const V_TURBO = 30;
const V_SLOW = 9.5;            // build-up crawl
const ACCEL = 0.16;            // cells/s per ms
const LAND_MIN_MS = 380;
const SNAP_MS = 170;
const BOUNCE_MS = 170;
const SNAP_BOUNCE_MS = 110;
const OVERSHOOT = 0.16;
const BLUR_V = 11;            // slowed reels (build-up) crawl by sharp, so passing 7s can be seen

type Mode = "rest" | "wind" | "spin" | "land";

interface Cell { el: HTMLElement; sym: HTMLElement; idx: number; s: string }
interface Reel {
  el: HTMLElement;
  strip: HTMLElement;
  cells: Cell[];
  u: number;
  mode: Mode;
  v: number;
  vTarget: number;
  t0: number;
  at: number;
  snap: boolean;
  /** Symbols at indices 0..4 when the spin started (the previous window). */
  prev: Sym[];
  final: Sym[];
  tape: Sym[];
  L: number | null;
  land: { t0: number; tm: number; t1: number; u0: number; uT: number; ov: number } | null;
  /** Must not start landing yet: a build-up may still extend this reel (released when the trigger reel rests). */
  hold: boolean;
  blur: boolean;
  drawnU: number;
}

export interface Reels {
  readonly el: HTMLElement;
  /** Cell height in px (call when the layout changes). */
  resize(cellH: number): void;
  /** Show a window at rest without animation. */
  show(cells: Sym[][]): void;
  start(plan: SpinPlan, at: readonly number[]): void;
  retime(at: readonly number[], snap: boolean): void;
  /** The core says reel i must be at rest now. */
  rest(i: number): void;
  antic(from: number): void;
  /** Win emphasis: [reel, row] cells; lines as polylines of [reel, row]. Empty clears. */
  highlight(cells: [number, number][]): void;
  destroy(): void;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function createReels(clock: Clock, initial: Sym[][]): Reels {
  const el = document.createElement("div");
  el.className = "slot-reels";
  let ch = 80;
  let stopFrame: (() => void) | null = null;
  let quick = false;
  let holdFrom = Infinity;

  const reels: Reel[] = initial.map((win) => {
    const r = document.createElement("div");
    r.className = "slot-reel";
    const strip = document.createElement("div");
    strip.className = "slot-strip";
    r.appendChild(strip);
    const cells: Cell[] = [];
    for (let k = 0; k < CELLS; k++) {
      const c = document.createElement("div");
      c.className = "slot-cell";
      const sym = document.createElement("i");
      sym.className = "slot-sym";
      c.appendChild(sym);
      strip.appendChild(c);
      cells.push({ el: c, sym, idx: NaN, s: "" });
    }
    el.appendChild(r);
    return {
      el: r, strip, cells, u: TOP, mode: "rest", v: 0, vTarget: V_MAX, t0: 0, at: 0, snap: false,
      prev: [...win], final: [...win], tape: [...win], L: 0, land: null, hold: false, blur: false, drawnU: NaN,
    };
  });

  const symAt = (r: Reel, i: number): Sym => {
    if (r.L !== null && i >= r.L && i < r.L + 5) return r.final[i - r.L];
    if (i >= 0 && i < 5) return r.prev[i];
    return r.tape[mod(i, TAPE_LEN)];
  };

  const place = (r: Reel, force = false): void => {
    if (!force && r.u === r.drawnU) return;
    r.drawnU = r.u;
    r.strip.style.transform = `translate3d(0,${(-r.u * ch).toFixed(2)}px,0)`;
    const lo = Math.floor(r.u) - 1;
    // keep cells whose index is in [lo, lo + CELLS), reuse the others for the missing indices
    const want = new Set<number>();
    for (let i = lo; i < lo + CELLS; i++) want.add(i);
    const free: Cell[] = [];
    for (const c of r.cells) {
      if (want.has(c.idx)) want.delete(c.idx);
      else free.push(c);
    }
    for (const i of want) {
      const c = free.pop()!;
      c.idx = i;
      c.el.style.transform = `translate3d(0,${(i * ch).toFixed(2)}px,0)`;
      c.el.dataset.i = String(i);
      setSym(c, symAt(r, i));
    }
  };
  const setSym = (c: Cell, s: Sym): void => {
    if (c.s === s) return;
    c.s = s;
    c.sym.className = `slot-sym ${symClass(s)}`;
  };
  const refreshCells = (r: Reel): void => { for (const c of r.cells) if (Number.isFinite(c.idx)) setSym(c, symAt(r, c.idx)); };
  const setBlur = (r: Reel, on: boolean): void => {
    if (r.blur === on) return;
    r.blur = on;
    r.el.classList.toggle("is-blur", on);
  };

  /** Rest: re-index the final window to 0..4 (keeps numbers small). */
  const toRest = (r: Reel): void => {
    r.mode = "rest";
    r.land = null;
    r.prev = [...r.final];
    r.L = 0;
    r.u = TOP;
    r.v = 0;
    setBlur(r, false);
    r.el.classList.remove("is-antic", "is-hot");
    for (const c of r.cells) c.idx = NaN;
    place(r, true);
  };

  /** Landing time at the reel's cruising speed: long enough that the final cells come in from above unseen. */
  const landDur = (r: Reel): number => (r.snap ? SNAP_MS : Math.max(LAND_MIN_MS, (11 / Math.max(r.vTarget, 1)) * 1000));
  const bounceDur = (r: Reel): number => (r.snap ? SNAP_BOUNCE_MS : BOUNCE_MS);

  const beginLand = (r: Reel, now: number): void => {
    const B = bounceDur(r);
    const D = Math.max(90, Math.min(landDur(r), r.at - B - now));
    const fl = Math.floor(r.u);
    const ov = r.snap ? OVERSHOOT * 0.6 : OVERSHOOT;
    const reach = r.snap ? 0 : (r.v * D) / 2000;
    const L = Math.min(fl - 5, Math.floor(r.u - reach - TOP + ov));
    r.L = L;
    refreshCells(r);
    r.land = { t0: now, tm: now + D, t1: now + D + B, u0: r.u, uT: L + TOP, ov };
    r.mode = "land";
  };

  const step = (r: Reel, now: number, dt: number): boolean => {
    switch (r.mode) {
      case "rest":
        return false;
      case "wind": {
        const e = now - r.t0;
        if (e < 0) return true;
        if (e < WIND_MS) { r.u = TOP + 0.14 * Math.sin((Math.PI * e) / WIND_MS); break; }
        r.u = TOP;
        r.mode = "spin";
        r.v = 2;
      }
      // falls through
      case "spin": {
        if (r.v < r.vTarget) r.v = Math.min(r.vTarget, r.v + ACCEL * dt);
        else if (r.v > r.vTarget) r.v = Math.max(r.vTarget, r.v - ACCEL * 0.6 * dt);
        r.u -= (r.v * dt) / 1000;
        setBlur(r, r.v > BLUR_V);
        if (!r.hold && now >= r.at - landDur(r) - bounceDur(r)) beginLand(r, now);
        break;
      }
      case "land": {
        const l = r.land!;
        if (now < l.tm) {
          const p = (now - l.t0) / (l.tm - l.t0);
          const e = 1 - (1 - p) * (1 - p);
          r.u = l.u0 - (l.u0 - (l.uT - l.ov)) * e;
          setBlur(r, p < 0.45 && r.v > BLUR_V);
        } else if (now < l.t1) {
          const q = (now - l.tm) / (l.t1 - l.tm);
          r.u = l.uT - l.ov * (1 - q) * (1 - q);
          setBlur(r, false);
        } else {
          toRest(r);
          return false;
        }
        break;
      }
    }
    place(r);
    return true;
  };

  const loop = (dt: number): void => {
    const now = clock.now();
    let busy = false;
    for (const r of reels) if (step(r, now, dt)) busy = true;
    if (!busy) { stopFrame?.(); stopFrame = null; }
  };
  const kick = (): void => { if (!stopFrame) stopFrame = clock.frame(loop); };

  const api: Reels = {
    el,
    resize(h) {
      if (!(h > 0) || Math.abs(h - ch) < 0.01) return;
      ch = h;
      for (const r of reels) {
        for (const c of r.cells) c.idx = NaN;
        place(r, true);
      }
    },
    show(cells) {
      reels.forEach((r, i) => { r.final = [...cells[i]]; toRest(r); });
    },
    start(plan, at) {
      quick = plan.quick;
      holdFrom = plan.antic > 0 ? reels.length - plan.antic : Infinity;
      const now = clock.now();
      reels.forEach((r, i) => {
        r.final = [...plan.cells[i]];
        r.tape = plan.tape[i];
        r.at = at[i];
        r.snap = false;
        r.vTarget = plan.turbo ? V_TURBO : V_MAX;
        r.land = null;
        r.hold = i >= holdFrom;
        if (quick) return;   // no spin: the window changes when the reel's time comes
        r.L = null;
        r.mode = "wind";
        r.t0 = now + i * (plan.turbo ? STAGGER_MS / 2 : STAGGER_MS);
        refreshCells(r);
      });
      if (!quick) kick();
    },
    retime(at, snap) {
      const now = clock.now();
      reels.forEach((r, i) => {
        if (r.mode === "rest") return;
        if (r.mode === "land") {
          // already landing: only a STOP may make it quicker, never slower
          if (!snap || r.at <= at[i]) return;
          r.snap = true;
          r.at = at[i];
          r.v = Math.max(r.v, V_MAX);
          beginLand(r, now);
          return;
        }
        r.at = at[i];
        if (snap) r.hold = false;
        if (snap) { r.snap = true; if (r.mode === "wind") { r.mode = "spin"; r.v = V_MAX; } }
      });
      kick();
    },
    rest(i) {
      const r = reels[i];
      if (r.mode === "rest") { if (quick) { toRest(r); } return; }
      if (r.mode === "land" && clock.now() < r.land!.t1 + 120) return;   // finishing its bounce
      toRest(r);
    },
    antic(from) {
      reels.forEach((r, i) => {
        r.hold = false;
        if (i < from || r.mode === "rest") return;
        r.vTarget = V_SLOW;
        r.el.classList.add("is-antic");
        r.el.classList.toggle("is-hot", i === from);
      });
    },
    highlight(cells) {
      const on = new Set(cells.map(([reel, row]) => `${reel}:${row + 1}`));
      el.classList.toggle("has-win", cells.length > 0);
      const any = cells.length > 0;
      reels.forEach((r, i) => {
        for (const c of r.cells) {
          const win = on.has(`${i}:${c.idx}`);
          c.el.classList.toggle("is-win", win);
          c.el.classList.toggle("is-dim", any && !win && c.idx >= 1 && c.idx <= 3);   // peeks are not dimmed
        }
      });
    },
    destroy() {
      stopFrame?.();
      stopFrame = null;
      el.remove();
    },
  };
  // hot reel moves on as reels come to rest
  const origRest = api.rest;
  api.rest = (i) => {
    origRest(i);
    if (i === holdFrom - 1) for (const r of reels) r.hold = false;
    const next = reels[i + 1];
    if (next && next.el.classList.contains("is-antic")) next.el.classList.add("is-hot");
  };
  return api;
}
