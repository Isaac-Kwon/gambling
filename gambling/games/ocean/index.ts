/** ABYSS LEGEND game module (lazy chunk): view (DOM) + core (round logic). */
import type { GameCtx, GameModule } from "../../src/types";
import { createOceanCore, type OceanCore } from "./core";
import { createOceanView, type OceanView } from "./view";

export function createGame(): GameModule {
  let view: OceanView | null = null;
  let core: OceanCore | null = null;
  let host: HTMLElement | null = null;
  return {
    id: "ocean",
    mount(root: HTMLElement, ctx: GameCtx) {
      if (view) this.unmount();
      host = root;
      root.dataset.game = "ocean";
      view = createOceanView(root, ctx);
      core = createOceanCore(ctx, view);
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
    /** Leaving waits until the reels are at rest (the queue itself lives in the session store). */
    canLeave: () => (core ? core.canLeave() : true),
    onSuspend() { core?.suspend(); },
    onResume() { /* nothing resumes by itself */ },
  };
}

export default createGame;
