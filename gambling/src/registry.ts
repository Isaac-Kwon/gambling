import type { GameId } from "../../shared/config";
import type { GameModule } from "./types";

export const GAME_IDS: readonly GameId[] = ["slot", "roulette", "blackjack", "crash", "ocean"];

/** Each game's `index.ts` exports a factory (named `createGame`, also the default export). */
export type GameFactory = () => GameModule;
export type GameLoader = () => Promise<{ createGame: GameFactory }>;

/** One lazy chunk per game. */
export const LOADERS: Record<GameId, GameLoader> = {
  slot: () => import("../games/slot/index"),
  roulette: () => import("../games/roulette/index"),
  blackjack: () => import("../games/blackjack/index"),
  crash: () => import("../games/crash/index"),
  ocean: () => import("../games/ocean/index"),
};

export interface Registry {
  /** Loads (once) and instantiates the game module. */
  load(id: GameId): Promise<GameModule>;
  has(id: string): id is GameId;
}

export function createRegistry(loaders: Record<GameId, GameLoader> = LOADERS): Registry {
  const cache = new Map<GameId, Promise<{ createGame: GameFactory }>>();
  return {
    has: (id): id is GameId => (GAME_IDS as readonly string[]).includes(id),
    async load(id) {
      let p = cache.get(id);
      if (!p) {
        p = loaders[id]();
        cache.set(id, p);
        p.catch(() => cache.delete(id));
      }
      return (await p).createGame();
    },
  };
}
