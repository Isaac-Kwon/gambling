/**
 * Small, static entry to the Pixi decoration layer (ARCHITECTURE §4.3). Does not import Pixi.
 * `gl/stage.ts` (the only file that imports 'pixi.js') is reached through the single `import()` below,
 * so Pixi lands in its own dynamic chunk and is fetched only when `loadGfx` runs (after the gate tap,
 * never with `?fx=off`).
 */
import type { Rng } from "../../../shared/rng";
import type { Quality, QualityLevel } from "../quality";

/** Rectangle in CSS px relative to `#frame`. */
export interface GfxRect { x: number; y: number; w: number; h: number }

export interface GfxState { b: "gl" | "none"; q?: Quality; why?: "slow" | "lost" | "init" }

export interface GfxLayer {
  /** false while the WebGL context is lost or after destroy. */
  readonly alive: boolean;
  /** true while anything is on screen or a final clear is pending (the frame loop may stop when false). */
  readonly busy: boolean;
  readonly quality: QualityLevel;
  /** Set by the DOM backend: called when live particles are dropped (context lost / layer removed). */
  onDrop: (() => void) | null;
  /** Emits up to `n` of `kind`; returns the count actually emitted (cap, quality). `seed` makes the spray deterministic. */
  emit(kind: string, n: number, at: GfxRect | null, ms: number, seed?: number): number;
  /** Additive focus glow at `at` (null = centre), intensity 0..1; repeated calls move and extend it. */
  glow(at: GfxRect | null, k: number, ms: number): void;
  /** Simulate and render; does nothing (no render) when idle. */
  frame(dtMs: number): void;
  resize(cssW: number, cssH: number): void;
  setQuality(q: Quality): void;
  suspend(): void;
  resume(): void;
  /** Quick fade of everything on screen (~250 ms). */
  stop(): void;
  destroy(): void;
}

export interface LoadGfxOptions {
  /** Starting quality (default 2). */
  quality?: Quality;
  /** Presentation stream used when an emit carries no seed. */
  pre: Rng;
  /** The layer is gone for good (context lost too long / too often, or too slow): clear the reference. */
  onLost(): void;
  /** Layer state for `aux("gfx", …)`: on load, on quality change, and when it goes away. */
  onChange?(s: GfxState): void;
}

/** Resolves to the layer, or null when WebGL is unavailable or init fails. Never rejects. */
export async function loadGfx(host: HTMLElement, o: LoadGfxOptions): Promise<GfxLayer | null> {
  try {
    if (typeof WebGLRenderingContext === "undefined" || typeof document === "undefined") {
      o.onChange?.({ b: "none", why: "init" });
      return null;
    }
    const m = await import("./stage");
    const layer = await m.createStage(host, o);
    if (!layer) o.onChange?.({ b: "none", why: "init" });
    return layer;
  } catch {
    try { o.onChange?.({ b: "none", why: "init" }); } catch { /* ignore */ }
    return null;
  }
}
