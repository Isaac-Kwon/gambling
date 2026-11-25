import { START_CREDITS, type GameId, type SlotVariant } from "../../shared/config";
import type { Lang } from "../../shared/i18n";
import { createRng } from "../../shared/rng";
import { createFx, createNullFx, nullBackend } from "../fx/index";
import type { Fx, FxRecord, FxRun } from "../fx/types";
import { createManualClock, type ManualClock } from "../src/clock";
import type { Env } from "../src/env";
import { createSession, type SessionRuntime } from "../src/session";
import type { GameCtx } from "../src/types";

/**
 * fx of a headless run (ARCHITECTURE §4.7, §11.1): "on" is the real director (`createFx`) over `nullBackend`
 * (decisions, presentation-stream draws and records happen as in the browser; nothing is drawn, no Pixi, no
 * DOM), "off" is `createNullFx()`. The fx presentation stream is the sequential `pre:fx` stream of the seed.
 */
export function createHeadlessFx(o: { fx: "on" | "off"; seed: string; clock: ManualClock; reducedMotion?: boolean }): Fx {
  if (o.fx === "off") return createNullFx();
  return createFx({ backend: nullBackend, clock: o.clock, pre: createRng(o.seed, "pre:fx"), reducedMotion: o.reducedMotion });
}

const DONE: FxRun = { done: Promise.resolve(), skip: () => undefined };

/**
 * Minimal fx stub for runtime unit tests that only need "records exist when on" (session.test.ts):
 * no DOM, consumes no randomness, one record per celebration. Headless game runs use `createHeadlessFx`.
 */
export function createStubFx(enabled: boolean): Fx {
  let into: FxRecord[] | null = null;
  const rec = (type: string, ms: number, k: number): void => { if (enabled && into) into.push({ type, ms, k }); };
  return {
    enabled,
    collect(a) { into = a; },
    idle: () => Promise.resolve(),
    celebrate(o) { if (o.amount > 0) rec("tier", 0, o.amount >= o.bet ? 1 : 0); return DONE; },
    countup() { return DONE; },
    particles(kind, o) { rec("particles:" + kind, o.ms ?? 0, o.k); return DONE; },
    shake(o) { rec("shake", o.ms, o.k); return DONE; },
    antic(o) { rec("antic:" + o.kind, o.ms, o.k); return DONE; },
    flash(o) { rec("flash", o.ms, o.area); return DONE; },
    sfx: { unlock: () => Promise.resolve(), play: () => undefined, loop: () => undefined, setMuted: () => undefined },
    haptics: { pulse: () => undefined },
    suspend: () => undefined,
    resume: () => undefined,
  };
}

export const HEADLESS_ENV: Env = {
  display: "browser", installed: false, reducedMotion: false, touch: false,
  device: { w: 390, h: 844, dpr: 1, touch: false, orient: "portrait" },
};

export interface HeadlessOpts {
  seed: string;
  fx: "on" | "off";
  sv?: SlotVariant;
  lang?: Lang;
  startCredits?: number;
  /** Game of the default `ctx`. */
  game?: GameId;
  /** Fixed epoch so logs are reproducible. */
  startEpoch?: number;
  /** Test override of the Fx. */
  fxImpl?: Fx;
}

export interface HeadlessCtx {
  rt: SessionRuntime;
  clock: ManualClock;
  fx: Fx;
  /** Context of `opts.game` (default "slot"). */
  ctx: GameCtx;
  ctxFor(game: GameId): GameCtx;
}

/**
 * Real wallet, session, RoundApi and Streams over a ManualClock (wait() advances virtual time at once), no
 * storage and no DOM. Driving two of these identically (same seed, fx on vs off) must yield the same outcomes.
 */
export function createHeadlessCtx(o: HeadlessOpts): HeadlessCtx {
  const clock = createManualClock(0);
  const base = o.startEpoch ?? 1_700_000_000_000;
  const fx = o.fxImpl ?? createHeadlessFx({ fx: o.fx, seed: o.seed, clock });
  const rt = createSession({
    seed: o.seed, mode: "class", fx, fxMode: o.fx, sv: o.sv ?? "a", lang: o.lang ?? "en",
    env: HEADLESS_ENV, clock, epoch: () => base + clock.now(), storage: null,
    startCredits: o.startCredits ?? START_CREDITS, id: "headless",
  });
  return { rt, clock, fx, ctx: rt.makeCtx(o.game ?? "slot"), ctxFor: (g) => rt.makeCtx(g) };
}
