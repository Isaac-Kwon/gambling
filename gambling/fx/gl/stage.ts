// gambling/fx/gl/stage.ts — the only file in the repo that imports 'pixi.js' (ARCHITECTURE §4.2).
// Reached only through the dynamic import in gl/loader.ts.
import { WebGLRenderer, Container, Sprite, Texture, Rectangle, ParticleContainer, Particle } from "pixi.js";
import "pixi.js/particle-container";
import { bakeAtlas, type Atlas, type AtlasRect } from "./atlas";
import type { GfxLayer, GfxRect, LoadGfxOptions } from "./loader";
import {
  createParticleSim, envelope, envelopeMs, isAdditive, KIND_ID, MAX_PARTICLES,
  K_COIN, K_CONFETTI, K_BUBBLE, K_TICKET, K_EXHAUST, type EmitKind,
} from "../particles";
import { QUALITY, qualityInit, qualityStep, type Quality } from "../quality";
import { jitter } from "../shake";

const RAY_TINTS = [0xf5c542, 0xffe9a6] as const;
const FADE_MS = 250;
/** Additive particles (sparks, exhaust) prepared at warm-up; their live count stays well below this. */
const ADD_WARM = 200;
/** Max alpha change per ms of the focus glow (full swing >= 220 ms: never a flash, §6.6). */
const GLOW_RATE = 1 / 220;

interface RayFx {
  cont: Container;
  sprites: Sprite[];
  glows: Sprite[];
  t: number;
  ms: number;
  spin: number;
  peak: number;
  stopAt: number;      // -1 = running
  stopAlpha: number;
}

export async function createStage(host: HTMLElement, o: LoadGfxOptions): Promise<GfxLayer | null> {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;pointer-events:none;";
  let W = Math.max(1, host.clientWidth || 390);
  let H = Math.max(1, host.clientHeight || 800);
  let q: Quality = o.quality ?? 2;
  const dpr = () => (typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
  let res = Math.min(dpr(), QUALITY[q].scale);

  const renderer = new WebGLRenderer();
  try {
    await renderer.init({
      canvas, width: W, height: H, resolution: res,
      backgroundAlpha: 0, antialias: false, preserveDrawingBuffer: false,
      hello: false, skipExtensionImports: true, autoDensity: false,
    });
  } catch {
    try { renderer.destroy(); } catch { /* ignore */ }
    return null;
  }

  let atlas: Atlas;
  try {
    atlas = bakeAtlas();
  } catch {
    renderer.destroy();
    return null;
  }
  const base = Texture.from(atlas.canvas);
  const tex = (r: AtlasRect) => new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
  const T = {
    coin: atlas.coin.map(tex),
    confetti: atlas.confetti.map(tex),
    spark: tex(atlas.spark),
    bubble: tex(atlas.bubble),
    ticket: tex(atlas.ticket),
    glow: tex(atlas.glow),
    glowTight: tex(atlas.glowTight),
    ray: tex(atlas.ray),
  };

  // Scene: rays + glows (additive sprites) → normal particles → additive particles. 3–5 draw calls.
  const stage = new Container();
  const raysLayer = new Container();
  const glowLayer = new Container();
  const dyn = { position: true, rotation: true, vertex: true, uvs: true, color: true };
  const pcNormal = new ParticleContainer({ dynamicProperties: dyn, texture: T.coin[0] });
  const pcAdd = new ParticleContainer({ dynamicProperties: dyn, texture: T.spark });
  pcAdd.blendMode = "add";
  stage.addChild(raysLayer, glowLayer, pcNormal, pcAdd);

  const sim = createParticleSim(QUALITY[q].cap, W, H);
  const normPool: Particle[] = [], addPool: Particle[] = [];
  const normTint = new Uint32Array(MAX_PARTICLES).fill(0xffffff), addTint = new Uint32Array(MAX_PARTICLES).fill(0xffffff);
  const normOn: Particle[] = [], addOn: Particle[] = [];
  const rays: RayFx[] = [];

  // Focus glow (crash exhaust, antic): one soft sprite + one tight core.
  const focusSoft = new Sprite(T.glow), focusCore = new Sprite(T.glowTight);
  for (const s of [focusSoft, focusCore]) {
    s.anchor.set(0.5);
    s.blendMode = "add";
    s.alpha = 0;
    s.visible = false;
    glowLayer.addChild(s);
  }
  focusSoft.tint = 0xff9a3d;
  focusCore.tint = 0xffe9a6;
  let focusA = 0, focusTarget = 0, focusUntil = 0, clock = 0;

  let alive = true, dead = false, suspended = false, needsClear = false;
  let qs = qualityInit(q);
  let losses = 0;
  let lostTimer: ReturnType<typeof setTimeout> | undefined;

  // Emits whose anchor is read lazily: born at the start of the next frame (count reserved now).
  const pending: { kind: EmitKind; n: number; at: () => GfxRect | null; ms: number; rnd: () => number }[] = [];
  let reserved = 0;
  const flushPending = (): void => {
    if (!pending.length) return;
    const list = pending.splice(0);
    reserved = 0;
    for (const p of list) {
      let r: GfxRect | null = null;
      try { r = p.at(); } catch { r = null; }
      sim.spawn(p.kind, p.n, r, p.ms, p.rnd);
    }
  };
  const dropPending = (): void => { pending.length = 0; reserved = 0; };

  const layer: GfxLayer = {
    get alive() { return alive && !dead; },
    get busy() { return !dead && (sim.count > 0 || pending.length > 0 || rays.length > 0 || focusA > 0 || clock < focusUntil || needsClear); },
    get quality() { return dead ? "off" : q; },
    onDrop: null,

    emit(kind, n, at, ms, seed) {
      if (!alive || dead || !(n > 0) || !(ms > 0)) return 0;
      const rnd = seed !== undefined ? jitter(seed) : () => o.pre.float();
      if (kind === "rays") return addRays(Math.min(16, Math.floor(n)), typeof at === "function" ? at() : at, ms);
      if (!(kind in KIND_ID)) return 0;
      if (typeof at !== "function") return sim.spawn(kind as EmitKind, n, at, ms, rnd);
      const m = Math.min(Math.floor(n), Math.max(0, sim.cap - sim.count - reserved));
      if (m <= 0) return 0;
      pending.push({ kind: kind as EmitKind, n: m, at, ms, rnd });
      reserved += m;
      return m;
    },

    glow(at, k, ms) {
      if (!alive || dead) return;
      const gq = QUALITY[q].glow;
      const r: GfxRect = at ?? { x: W / 2 - 40, y: H * 0.4 - 40, w: 80, h: 80 };
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const size = Math.max(70, Math.max(r.w, r.h) * 1.7);
      focusSoft.position.set(cx, cy);
      focusCore.position.set(cx, cy);
      focusSoft.scale.set((size * 1.6) / atlas.glow.w);
      focusCore.scale.set(size / atlas.glowTight.w);
      focusTarget = Math.max(0, Math.min(1, k)) * gq;
      focusUntil = clock + Math.max(0, ms);
    },

    frame(dtMs) {
      if (dead || !alive || suspended) return;
      const dt = Math.min(100, Math.max(0, dtMs));
      clock += dt;
      flushPending();
      const has = sim.count > 0 || rays.length > 0 || focusA > 0 || clock < focusUntil;
      if (!has) {
        if (needsClear) { safeRender(); needsClear = false; }
        return;
      }
      sim.step(dt);
      stepRays(dt);
      stepFocus(dt);
      drawParticles();
      safeRender();
      needsClear = true;
      // Only frames actually rendered feed the quality machine.
      const next = qualityStep(qs, dtMs);
      qs = next;
      if (next.changed !== undefined) {
        if (next.changed === "off") kill("slow");
        else { applyQuality(next.changed); o.onChange?.({ b: "gl", q }); }
      }
    },

    resize(cssW, cssH) {
      if (dead) return;
      W = Math.max(1, cssW); H = Math.max(1, cssH);
      res = Math.min(dpr(), QUALITY[q].scale);   // zoom / moving to another screen changes the DPR too
      sim.setBounds(W, H);
      try { renderer.resize(W, H, res); } catch { /* lost context: Pixi resizes on restore */ }
      needsClear = true;
    },

    setQuality(nq) {
      if (dead || nq === q) return;
      applyQuality(nq);
      qs = qualityInit(nq);
    },

    suspend() { suspended = true; },
    resume() { suspended = false; },

    stop() {
      dropPending();
      sim.fade(FADE_MS);
      for (const r of rays) if (r.stopAt < 0) { r.stopAt = r.t; r.stopAlpha = rayAlpha(r); }
      focusUntil = clock;
      focusTarget = 0;
    },

    destroy() {
      if (dead) return;
      dead = true;
      alive = false;
      if (lostTimer !== undefined) clearTimeout(lostTimer);
      ro?.disconnect();
      dropPending();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      sim.clear();
      try { stage.destroy({ children: true }); } catch { /* ignore */ }
      try { base.destroy(true); } catch { /* ignore */ }
      try { renderer.destroy({ removeView: true }); } catch { /* ignore */ }
      canvas.remove();
    },
  };

  function safeRender() {
    try { renderer.render(stage); } catch { /* context loss mid-frame: skip */ }
  }

  function applyQuality(nq: Quality) {
    q = nq;
    sim.setCap(QUALITY[q].cap);
    res = Math.min(dpr(), QUALITY[q].scale);
    try { renderer.resize(W, H, res); } catch { /* ignore */ }
    if (!QUALITY[q].rays) for (const r of rays) if (r.stopAt < 0) { r.stopAt = r.t; r.stopAlpha = rayAlpha(r); }
    needsClear = true;
  }

  function addRays(n: number, at: GfxRect | null, ms: number): number {
    if (!QUALITY[q].rays || n <= 0) return 0;
    const cx = at ? at.x + at.w / 2 : W / 2, cy = at ? at.y + at.h / 2 : H * 0.4;
    const len = Math.hypot(W, H) * 0.8;
    const cont = new Container();
    cont.position.set(cx, cy);
    const sprites: Sprite[] = [];
    for (let i = 0; i < n; i++) {
      const s = new Sprite(T.ray);
      s.anchor.set(0.5, 1);
      s.blendMode = "add";
      s.rotation = (i / n) * Math.PI * 2;
      s.scale.set(((2 * Math.PI * len) / n) * 0.5 / atlas.ray.w, len / atlas.ray.h);
      s.tint = RAY_TINTS[i % 2];
      s.alpha = 0;
      cont.addChild(s);
      sprites.push(s);
    }
    // Central bloom behind the banner: soft gold disc + tight cream core.
    const g1 = new Sprite(T.glow), g2 = new Sprite(T.glowTight);
    g1.anchor.set(0.5); g2.anchor.set(0.5);
    g1.blendMode = "add"; g2.blendMode = "add";
    g1.tint = 0xf5c542; g2.tint = 0xfff1c2;
    g1.scale.set((Math.min(W, H) * 1.25) / atlas.glow.w);
    g2.scale.set((Math.min(W, H) * 0.55) / atlas.glowTight.w);
    g1.alpha = 0; g2.alpha = 0;
    cont.addChild(g1, g2);
    raysLayer.addChild(cont);
    rays.push({ cont, sprites, glows: [g1, g2], t: 0, ms: envelopeMs(ms), spin: (rays.length % 2 ? -1 : 1) * 0.22, peak: 0.55, stopAt: -1, stopAlpha: 0 });
    return n;
  }

  function rayAlpha(r: RayFx): number {
    if (r.stopAt >= 0) return r.stopAlpha * Math.max(0, 1 - (r.t - r.stopAt) / FADE_MS);
    return envelope(r.t, r.ms);
  }

  function stepRays(dt: number) {
    const gq = QUALITY[q].glow;
    for (let i = rays.length - 1; i >= 0; i--) {
      const r = rays[i];
      r.t += dt;
      const a = rayAlpha(r);
      const over = r.stopAt >= 0 ? r.t - r.stopAt >= FADE_MS : r.t >= r.ms;
      if (over) {
        raysLayer.removeChild(r.cont);
        r.cont.destroy({ children: true });
        rays.splice(i, 1);
        continue;
      }
      r.cont.rotation += (r.spin * dt) / 1000;
      for (let j = 0; j < r.sprites.length; j++) {
        // Gentle per-ray shimmer, slow (period > 1 s) and small.
        r.sprites[j].alpha = a * r.peak * (0.8 + 0.2 * Math.sin(r.t / 900 + j * 1.7));
      }
      r.glows[0].alpha = a * 0.55 * gq;
      r.glows[1].alpha = a * 0.6 * gq;
    }
  }

  function stepFocus(dt: number) {
    const target = clock < focusUntil ? focusTarget : 0;
    const d = target - focusA, step = GLOW_RATE * dt;
    focusA = Math.abs(d) <= step ? target : focusA + Math.sign(d) * step;
    const vis = focusA > 0.002;
    focusSoft.visible = vis; focusCore.visible = vis;
    focusSoft.alpha = focusA * 0.7;
    focusCore.alpha = focusA;
  }

  function drawParticles() {
    let nN = 0, nA = 0;
    const f = sim.f;
    for (let i = 0; i < sim.count; i++) {
      const a = sim.alpha(i);
      if (a <= 0.004) continue;
      const k = sim.kind[i];
      const add = isAdditive(k);
      let p: Particle;
      let idx: number;
      if (add) {
        idx = nA++;
        p = addPool[idx] ??= new Particle({ texture: T.spark, anchorX: 0.5, anchorY: 0.5 });
        addOn[idx] = p;
        if (addTint[idx] !== sim.tint[i]) { addTint[idx] = sim.tint[i]; p.tint = sim.tint[i]; }
      } else {
        idx = nN++;
        p = normPool[idx] ??= new Particle({ texture: T.coin[0], anchorX: 0.5, anchorY: 0.5 });
        normOn[idx] = p;
        if (normTint[idx] !== sim.tint[i]) { normTint[idx] = sim.tint[i]; p.tint = sim.tint[i]; }
      }
      const s = f.size[i];
      p.x = f.x[i];
      p.y = f.y[i];
      p.rotation = f.rot[i];
      switch (k) {
        case K_COIN:
          p.texture = T.coin[sim.frame[i]];
          p.scaleX = s; p.scaleY = s;
          break;
        case K_CONFETTI:
          p.texture = T.confetti[sim.frame[i]];
          p.scaleX = s; p.scaleY = s * Math.cos(f.phase[i]);       // 3D flip
          break;
        case K_TICKET:
          p.texture = T.ticket;
          p.scaleX = s; p.scaleY = s * (0.3 + 0.7 * Math.abs(Math.cos(f.phase[i])));
          break;
        case K_BUBBLE:
          p.texture = T.bubble;
          p.scaleX = s; p.scaleY = s;
          break;
        case K_EXHAUST: {
          const u = Math.min(1, Math.max(0, f.age[i] / Math.max(1, f.life[i])));
          p.texture = u < 0.35 ? T.spark : T.glowTight;
          const sc = u < 0.35 ? s : (s * (0.25 + u * 0.5) * 40) / atlas.glowTight.w;
          p.scaleX = sc; p.scaleY = sc;
          break;
        }
        default:
          p.texture = T.spark;
          p.scaleX = s; p.scaleY = s;
      }
      p.alpha = a;
    }
    if (normOn.length !== nN) { normOn.length = nN; }
    if (addOn.length !== nA) { addOn.length = nA; }
    pcNormal.particleChildren = normOn;
    pcAdd.particleChildren = addOn;
    pcNormal.update();
    pcAdd.update();
  }

  function onLost() {
    if (dead) return;
    alive = false;
    sim.clear();
    dropPending();
    for (const r of rays) { raysLayer.removeChild(r.cont); r.cont.destroy({ children: true }); }
    rays.length = 0;
    focusA = 0; focusUntil = 0;
    try { layer.onDrop?.(); } catch { /* ignore */ }
    losses++;
    if (lostTimer !== undefined) clearTimeout(lostTimer);
    if (losses >= 3) { kill("lost"); return; }
    lostTimer = setTimeout(() => kill("lost"), 5000);
  }
  function onRestored() {
    if (dead) return;
    if (lostTimer !== undefined) clearTimeout(lostTimer);
    lostTimer = undefined;
    alive = true;
    needsClear = true;
  }
  function kill(why: "slow" | "lost") {
    if (dead) return;
    const wasAlive = alive;
    alive = false;
    if (wasAlive) { try { layer.onDrop?.(); } catch { /* ignore */ } }
    layer.destroy();
    try { o.onChange?.({ b: "none", why }); } catch { /* ignore */ }
    try { o.onLost(); } catch { /* ignore */ }
  }
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const ro: ResizeObserver | null = typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        const r = entries[entries.length - 1]?.contentRect;
        if (r && r.width > 0 && r.height > 0 && (Math.round(r.width) !== Math.round(W) || Math.round(r.height) !== Math.round(H))) {
          layer.resize(r.width, r.height);
        }
      })
    : null;
  ro?.observe(host);

  host.appendChild(canvas);
  safeRender();
  o.onChange?.({ b: "gl", q });
  scheduleWarmUp();
  return layer;

  /**
   * The first frame that draws particles / additive sprites compiles their shader programs, generates the
   * uniform-sync and particle-update functions and uploads the atlas: ~15 ms on a desktop, 50+ ms on a
   * throttled phone, landing exactly on the first frame of a celebration. Do it once, invisibly, while
   * the player is still in the lobby: one idle slice per pipeline (particles, then sprites).
   */
  function scheduleWarmUp(): void {
    const steps: (() => void)[] = [
      () => {
        // ParticleContainer pipe: both blend modes, both containers' buffers.
        const pn = new Particle({ texture: T.coin[0], x: -64, y: -64, alpha: 0 });
        const pa = new Particle({ texture: T.spark, x: -64, y: -64, alpha: 0 });
        pcNormal.particleChildren = [pn]; pcAdd.particleChildren = [pa];
        pcNormal.update(); pcAdd.update();
        safeRender();
        pcNormal.particleChildren = normOn; pcAdd.particleChildren = addOn;
        pcNormal.update(); pcAdd.update();
      },
      () => {
        // Full particle pools, and the containers' GPU buffers sized for them (invisible, off canvas): the
        // first EPIC celebration (350 particles in one frame) otherwise creates every Particle and grows
        // both buffers inside its first frame.
        while (normPool.length < MAX_PARTICLES) normPool.push(new Particle({ texture: T.coin[0], anchorX: 0.5, anchorY: 0.5 }));
        while (addPool.length < ADD_WARM) addPool.push(new Particle({ texture: T.spark, anchorX: 0.5, anchorY: 0.5 }));
        for (const p of normPool) { p.x = -64; p.y = -64; p.alpha = 0; }
        for (const p of addPool) { p.x = -64; p.y = -64; p.alpha = 0; }
        pcNormal.particleChildren = normPool; pcAdd.particleChildren = addPool;
        pcNormal.update(); pcAdd.update();
        safeRender();
        pcNormal.particleChildren = normOn; pcAdd.particleChildren = addOn;
        pcNormal.update(); pcAdd.update();
      },
      () => {
        // Batcher (sprites) with additive blend. alpha 0 would be culled from the build, so use a sliver.
        const s = new Sprite(T.ray);
        s.blendMode = "add"; s.alpha = 0.001; s.position.set(-64, -64);
        raysLayer.addChild(s);
        safeRender();
        raysLayer.removeChild(s);
        s.destroy();
      },
    ];
    const idle = (fn: () => void): void => {
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === "function") ric(fn, { timeout: 1500 });
      else setTimeout(fn, 120);
    };
    const next = (): void => {
      const step = steps.shift();
      if (!step) return;
      idle(() => {
        // Busy or gone: a real frame will compile what it needs; skip the remaining steps.
        if (dead || !alive || sim.count > 0 || pending.length > 0 || rays.length > 0 || focusA > 0) return;
        try { step(); } catch { /* warm-up is best effort */ }
        safeRender();   // leave a cleared canvas
        next();
      });
    };
    next();
  }
}
