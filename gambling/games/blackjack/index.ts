import type { GameCtx, GameModule } from "../../src/types";

/** Empty shell. The real game (core.ts + view.ts) replaces the body; the factory shape stays. */
export function createGame(): GameModule {
  let root: HTMLElement | null = null;
  return {
    id: "blackjack",
    mount(el: HTMLElement, _ctx: GameCtx) {
      root = el;
      el.dataset.game = "blackjack";
    },
    unmount() {
      if (root) delete root.dataset.game;
      root = null;
    },
    canLeave: () => true,
  };
}

export default createGame;
