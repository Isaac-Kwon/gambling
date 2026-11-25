/** BLACKJACK 21 game module (lazy chunk): view (DOM) + core (round logic). */
import type { GameCtx, GameModule } from "../../src/types";
import { createBjCore, type BjCore } from "./core";
import { createBjView, type BjView } from "./view";

export function createGame(): GameModule {
  let view: BjView | null = null;
  let core: BjCore | null = null;
  let host: HTMLElement | null = null;
  return {
    id: "blackjack",
    mount(root: HTMLElement, ctx: GameCtx) {
      if (view) this.unmount();
      host = root;
      root.dataset.game = "blackjack";
      view = createBjView(root, ctx);
      core = createBjCore(ctx, view);
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
    /** A round in progress holds the lobby and CASH OUT back until it is settled (§6.2). */
    canLeave: () => (core ? core.canLeave() : true),
    onSuspend() { core?.suspend(); },
  };
}

export default createGame;
