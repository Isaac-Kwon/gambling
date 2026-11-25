/** ORO SEVENS game module (lazy chunk): view (DOM) + core (round logic). */
import type { GameCtx, GameModule } from "../../src/types";
import { createSlotCore, type SlotCore } from "./core";
import { createSlotView, type SlotView } from "./view";

export function createGame(): GameModule {
  let view: SlotView | null = null;
  let core: SlotCore | null = null;
  let host: HTMLElement | null = null;
  return {
    id: "slot",
    mount(root: HTMLElement, ctx: GameCtx) {
      if (view) this.unmount();
      host = root;
      root.dataset.game = "slot";
      view = createSlotView(root, ctx);
      core = createSlotCore(ctx, view);
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
    /** Asking to leave is a leave intent: auto spin stops; leaving waits until the reels are at rest. */
    canLeave: () => (core ? core.canLeave() : true),
    onSuspend() { core?.suspend(); },
    onResume() { /* auto spin is not resumed after the background (§6.3) */ },
  };
}

export default createGame;
