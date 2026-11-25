/** SKYROCKET game module (lazy chunk): view (DOM/SVG) + core (round logic). */
import type { GameCtx, GameModule } from "../../src/types";
import { createCrashCore, type CrashCore } from "./core";
import { createCrashView, type CrashView } from "./view";

export function createGame(): GameModule {
  let view: CrashView | null = null;
  let core: CrashCore | null = null;
  let host: HTMLElement | null = null;
  return {
    id: "crash",
    mount(root: HTMLElement, ctx: GameCtx) {
      if (view) this.unmount();
      host = root;
      root.dataset.game = "crash";
      view = createCrashView(root, ctx);
      core = createCrashCore(ctx, view);
      view.bind(core);
    },
    unmount() {
      core?.dispose();
      view?.destroy();
      core = null;
      view = null;
      if (host) delete host.dataset.game;
      host = null;
    },
    /** Leaving is allowed in the countdown (cancelled) and once the round is settled; not while a bet is flying. */
    canLeave: () => (core ? core.canLeave() : true),
    onSuspend() { core?.suspend(); },
    onResume() { /* the clock was paused by the runtime: the climb simply continues */ },
  };
}

export default createGame;
