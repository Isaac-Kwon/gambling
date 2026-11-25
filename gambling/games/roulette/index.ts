/** RUBY ROULETTE game module (lazy chunk): view (DOM) + core (round logic). */
import type { GameCtx, GameModule } from "../../src/types";
import { createRouletteCore, type RouletteCore } from "./core";
import { createRouletteView, type RouletteView } from "./view";

export function createGame(): GameModule {
  let view: RouletteView | null = null;
  let core: RouletteCore | null = null;
  let host: HTMLElement | null = null;
  return {
    id: "roulette",
    mount(root: HTMLElement, ctx: GameCtx) {
      if (view) this.unmount();
      host = root;
      root.dataset.game = "roulette";
      view = createRouletteView(root, ctx);
      core = createRouletteCore(ctx, view);
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
    /** Leaving waits until the ball is at rest and the round is settled. */
    canLeave: () => (core ? core.canLeave() : true),
    onSuspend() { core?.suspend(); },
    onResume() { /* nothing to resume */ },
  };
}

export default createGame;
