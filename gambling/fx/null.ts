/**
 * fx for `?fx=off` (ARCHITECTURE §6.5): same interface, does nothing, records nothing, uses no randomness,
 * makes no sound. The one exception: `countup` writes the final value into `el` right away.
 * Must not import anything under fx/gl (and does not import the DOM backend).
 */
import type { Fx, FxRun, Haptics, Sfx } from "./types";
import { fmtInt } from "./countup";

export function createNullFx(o: { fmt?: (n: number) => string } = {}): Fx {
  const fmt = o.fmt ?? fmtInt;
  const done: FxRun = { done: Promise.resolve(), skip() {} };
  const sfx: Sfx = { unlock: () => Promise.resolve(), play() {}, loop() {}, setMuted() {} };
  const haptics: Haptics = { pulse() {} };
  return {
    enabled: false,
    collect() {},
    idle: () => Promise.resolve(),
    celebrate: () => done,
    countup(c) {
      const f = c.fmt ?? fmt;
      const text = f(Math.round(c.to));
      if (c.el && c.el.textContent !== text) c.el.textContent = text;
      return done;
    },
    particles: () => done,
    shake: () => done,
    antic: () => done,
    flash: () => done,
    sfx,
    haptics,
    suspend() {},
    resume() {},
  };
}
