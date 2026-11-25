// Demo session generator (ARCHITECTURE 10.4), library part: imported by scripts/gen-demo.ts (CLI) and its test.
//
// Runs the real game cores on the headless harness (real wallet, session, RoundApi, fx director over nullBackend,
// ManualClock virtual time) with deterministic "plausible human" bots. Bots only read what the screen shows (balance,
// last result); they never touch outcomes, and the games' own streams are not consumed by them.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_BET_GLOBAL, type GameId } from "../shared/config";
import { createRng, type Rng } from "../shared/rng";
import { handValue, optimalAction, type Action, type Card } from "../shared/rules/blackjack";
import { RED, type RouletteBet } from "../shared/rules/roulette";
import type { Ev, Session } from "../shared/schema";
import { createFx, nullBackend } from "../gambling/fx/index";
import { createBjCore, headlessUi as bjUi } from "../gambling/games/blackjack/core";
import { createCrashCore, headlessUi as crashUi } from "../gambling/games/crash/core";
import { createOceanCore, headlessUi as oceanUi } from "../gambling/games/ocean/core";
import { createRouletteCore, headlessUi as rouletteUi, TABLE_MAX } from "../gambling/games/roulette/core";
import { createSlotCore, headlessUi as slotUi } from "../gambling/games/slot/core";
import { hotGames, LOBBY_N_KEY, tickerItem, TICKER_MS } from "../gambling/src/lobby";
import { createHeadlessCtx } from "../gambling/harness/ctx";

import type { Fx } from "../gambling/fx/types";
import type { HeadlessCtx } from "../gambling/harness/ctx";
import type { Clock } from "../gambling/src/types";

export const DEMO_SEED = "OROBELLE-DEMO-1";
/** Rounds per game, in play order. */
export const PLAN = { slot: 180, roulette: 40, blackjack: 60, crash: 30, ocean: 150 } as const;
export const DEMO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../understanding/src/demo/session.json");

const START = 10_000;

// ------------------------------------------------------------------------------------------- fx clock

/**
 * Clock for the fx director. Outside a crash flight it is the game's ManualClock (a wait advances time at once, as for
 * every other game in the harness). During a crash flight waits follow game time instead, so a build-up started
 * mid-flight cannot jump the climb (see crash.test.ts `followClock`).
 */
function hybridClock(get: () => HeadlessCtx["clock"]): { clock: Clock; follow(on: boolean): void } {
  const waiters = new Set<{ at: number; res: () => void }>();
  let following = false;
  let hooked: HeadlessCtx["clock"] | null = null;
  const hook = () => {
    const base = get();
    if (hooked !== base) {
      hooked = base;
      base.frame(() => { for (const w of [...waiters]) if (base.now() >= w.at) { waiters.delete(w); w.res(); } });
    }
    return base;
  };
  const clock: Clock = {
    now: () => get().now(),
    wait: (ms) => {
      const base = hook();
      if (!following) return base.wait(ms);
      return new Promise<void>((res) => { if (!(ms > 0)) res(); else waiters.add({ at: base.now() + ms, res }); });
    },
    frame: (cb) => hook().frame(cb),
    pause: () => undefined,
    resume: () => undefined,
  };
  return { clock, follow: (on) => { following = on; } };
}

// ------------------------------------------------------------------------------------------- bots

const pick = <T>(r: Rng, a: readonly T[]): T => a[r.int(a.length)];
const chance = (r: Rng, p: number): boolean => r.float() < p;

/** Highest index i of `steps` with steps[i] <= cap (0 when none). */
function stepFor(steps: readonly number[], cap: number): number {
  let k = 0;
  for (let i = 0; i < steps.length; i++) if (steps[i] <= cap) k = i;
  return k;
}

interface World {
  h: HeadlessCtx;
  bot: Rng;
  follow(on: boolean): void;
  /** Idle time of a human (reading the result, deciding). */
  think(minMs: number, maxMs: number): void;
}

const bal = (w: World): number => w.h.rt.wallet.balance;

async function playSlot(w: World, n: number, game: "slot" | "ocean"): Promise<void> {
  const ctx = w.h.ctxFor(game);
  const steps = game === "slot" ? [20, 40, 100, 200, 400, 1000] : [20, 40, 100, 200];
  const core = game === "slot" ? createSlotCore(ctx, slotUi()) : createOceanCore(ctx, oceanUi());
  const r = w.bot;
  let idx = game === "slot" ? 1 : 0;
  let turbo = false;
  let lossRun = 0;
  let done = 0;
  const maxIdx = (): number => stepFor(steps, Math.floor(bal(w) * (game === "slot" ? 0.02 : 0.02)));
  core.setBet(Math.min(idx, maxIdx()));
  while (done < n) {
    // an auto run now and then (slot only), at the current bet
    if (game === "slot" && "startAuto" in core && (done === 60 || done === 130)) {
      const k = Math.min(10, n - done);
      await core.startAuto(k);
      done = w.h.rt.logger.session.events.filter((e) => e.game === "slot" && e.bet > 0).length;
      continue;
    }
    // bet changes: sometimes raise after losses (chasing), sometimes drift, sometimes drop after a win
    let want = idx;
    if (lossRun >= 4 && chance(r, 0.3)) want = idx + 1;
    else if (lossRun === 0 && chance(r, 0.12)) want = idx - 1;
    else if (chance(r, 0.06)) want = idx + (chance(r, 0.5) ? 1 : -1);
    want = Math.max(0, Math.min(want, maxIdx()));
    if (want !== idx) { idx = want; core.setBet(idx); }
    if (chance(r, 0.05)) { turbo = !turbo; core.setTurbo(turbo); }
    const swipe = chance(r, 0.22);
    const p = core.spin({ gesture: swipe ? "swipe" : "tap" });
    if (chance(r, 0.18)) core.stop();
    const ev = await p;
    if (!ev) throw new Error(`${game}: round did not start (balance ${bal(w)})`);
    done = w.h.rt.logger.session.events.filter((e) => e.game === game && e.bet > 0).length;
    lossRun = ev.payout < ev.bet ? lossRun + 1 : 0;
    w.think(turbo ? 200 : 500, turbo ? 900 : 2600);
  }
  await ctx.fx.idle();
  core.dispose();
}

const CHIPS_R = [500, 100, 50, 10] as const;
async function playRoulette(w: World, n: number): Promise<void> {
  const ctx = w.h.ctxFor("roulette");
  const core = createRouletteCore(ctx, rouletteUi());
  const r = w.bot;
  let side: "red" | "black" = "red";
  let stake = 50;
  const put = (bet: RouletteBet, amt: number): void => {
    let left = amt;
    for (const c of CHIPS_R) {
      while (left >= c) {
        core.setChip(c);
        const res = core.place(bet);
        if (!res.ok) return;
        left -= c;
      }
    }
  };
  for (let i = 0; i < n; i++) {
    core.clear();
    const cap = Math.min(TABLE_MAX, Math.floor(bal(w) * 0.1));
    stake = Math.max(10, Math.min(stake, Math.floor(cap / 10) * 10));
    put({ kind: side }, stake);
    if (i % 7 === 3) put({ kind: "straight", n: 17 }, 10);
    if (i % 9 === 5) put({ kind: "straight", n: pick(r, [7, 13, 23, 29, 32]) }, 10);
    if (i % 11 === 8) put({ kind: pick(r, ["dozen", "column"] as const), i: pick(r, [1, 2, 3] as const) }, 50);
    if (i === 12 || i === 27) core.setTurbo(i === 12);
    const ev = await core.spin({ gesture: chance(r, 0.2) ? "swipe" : "tap" });
    if (!ev) throw new Error(`roulette: round did not start (balance ${bal(w)})`);
    const hitN = (ev.out as { n: number }).n;
    const sideWon = side === "red" ? RED.has(hitN) : hitN !== 0 && !RED.has(hitN);
    // martingale-ish on the colour: double after a loss up to 3 steps, reset after a win; sometimes flip colour
    if (sideWon) stake = 50;
    else stake = stake >= 200 ? 50 : stake * 2;
    if (chance(r, 0.12)) side = side === "red" ? "black" : "red";
    w.think(600, 2800);
  }
  await ctx.fx.idle();
  core.dispose();
}

const CHIPS_B = [500, 100, 20] as const;
function deviate(r: Rng, opt: Action, legal: readonly Action[], total: number): Action {
  if (!chance(r, 0.07)) return opt;
  const alt: Action = opt === "H" ? "S" : opt === "S" ? (total <= 16 ? "H" : "S") : opt === "D" ? "H" : "H";
  return legal.includes(alt) ? alt : opt;
}
async function playBlackjack(w: World, n: number): Promise<void> {
  const ctx = w.h.ctxFor("blackjack");
  const core = createBjCore(ctx, bjUi());
  const r = w.bot;
  let base = 100;
  for (let i = 0; i < n; i++) {
    const cap = Math.max(20, Math.floor(bal(w) * 0.03 / 20) * 20);
    const want = Math.min(cap, chance(r, 0.15) ? base * 2 : chance(r, 0.1) ? 40 : base);
    core.clearBet();
    let left = want;
    for (const c of CHIPS_B) while (left >= c && core.addChip(c)) left -= c;
    if (core.state.bet < 20) throw new Error("blackjack: no bet");
    let ev: Ev | null = await core.deal();
    for (let g = 0; !ev && g < 40; g++) {
      const d = core.decision();
      if (!d) break;
      const opt = optimalAction(d.hand, d.up);
      const total = handValue(d.hand.cards as readonly Card[]).total;
      w.think(500, 2200);
      ev = await core.act(deviate(r, opt, d.legal, total));
    }
    if (!ev) throw new Error("blackjack: round did not finish");
    const lost = ev.payout < ev.bet;
    base = lost && chance(r, 0.25) ? Math.min(200, base + 20) : !lost && chance(r, 0.2) ? 100 : base;
    w.think(500, 2200);
  }
  await ctx.fx.idle();
  core.dispose();
}

const CRASH_BETS = [100, 200, 500, 1000, 2000];
async function playCrash(w: World, n: number): Promise<void> {
  const ctx = w.h.ctxFor("crash");
  const core = createCrashCore(ctx, crashUi());
  const r = w.bot;
  const targets = [1.5, 2, 2, 3, 5, 10];
  let betI = 1;
  for (let i = 0; i < n; i++) {
    const cap = Math.max(100, Math.floor(bal(w) * 0.05));
    betI = Math.max(0, Math.min(betI, stepFor(CRASH_BETS, cap)));
    core.setBet(CRASH_BETS[betI]);
    const manual = i % 3 === 2 || chance(r, 0.15);
    let tapAt: number | undefined;
    if (manual) { core.setAuto(false); tapAt = 1500 + r.int(9000); }
    else { core.setTarget(pick(r, targets)); core.setAuto(true); tapAt = chance(r, 0.15) ? 2500 + r.int(5000) : undefined; }
    const off = core.onTick((ms) => { if (tapAt !== undefined && ms >= tapAt) { tapAt = undefined; core.cashout(); } });
    w.follow(true);
    const ev = await core.start();
    off();
    if (!ev) throw new Error(`crash: round did not start (balance ${bal(w)})`);
    // drain the celebration on game time, then back to the plain clock
    let idle = false;
    void ctx.fx.idle().then(() => { idle = true; });
    for (let k = 0; k < 600 && !idle; k++) { w.h.clock.advance(100); for (let j = 0; j < 4; j++) await Promise.resolve(); }
    w.follow(false);
    betI = ev.payout < ev.bet ? Math.min(betI + (chance(r, 0.4) ? 1 : 0), CRASH_BETS.length - 1) : chance(r, 0.3) ? Math.max(0, betI - 1) : betI;
    w.think(800, 3000);
  }
  await ctx.fx.idle();
  core.dispose();
}

// ------------------------------------------------------------------------------------------- lobby (aux like the real lobby)

/** What lobby.ts does on screen: nav, a HOT draw, then a ticker line every TICKER_MS. */
async function visitLobby(w: World, lines: number): Promise<void> {
  const { rt, clock } = w.h;
  rt.logger.nav("lobby");
  const next = (): Rng => {
    const k = (rt.store.get<number>(LOBBY_N_KEY) ?? 0) + 1;
    rt.store.set(LOBBY_N_KEY, k);
    return rt.streams.pre("lobby").at(k);
  };
  rt.logger.aux("hot", { games: hotGames(next()) });
  for (let i = 0; i < lines; i++) {
    const it = tickerItem(next());
    rt.logger.aux("ticker", { name: it.name, game: it.game, amt: it.amt });
    await clock.wait(i === lines - 1 ? 1500 + w.bot.int(1500) : TICKER_MS);
  }
}

// ------------------------------------------------------------------------------------------- the demo

export async function generateDemo(): Promise<Session> {
  let h: HeadlessCtx | null = null;
  const hy = hybridClock(() => h!.clock);
  const fx: Fx = createFx({ backend: nullBackend, clock: hy.clock, pre: createRng(DEMO_SEED, "pre:fx") });
  h = createHeadlessCtx({ seed: DEMO_SEED, fx: "on", sv: "a", lang: "ko", startCredits: START, fxImpl: fx, startEpoch: 1_760_000_000_000 });
  const world: World = {
    h, bot: createRng(DEMO_SEED, "bot:demo"), follow: hy.follow,
    think: (a, b) => h!.clock.advance(a + world.bot.int(b - a + 1)),
  };
  const go = async (g: GameId, play: () => Promise<void>): Promise<void> => {
    await visitLobby(world, 2 + world.bot.int(3));
    h!.rt.logger.nav(g);
    world.think(1200, 2500);
    await play();
    await h!.rt.whenSettled();
  };
  await go("slot", () => playSlot(world, PLAN.slot, "slot"));
  await go("roulette", () => playRoulette(world, PLAN.roulette));
  await go("blackjack", () => playBlackjack(world, PLAN.blackjack));
  await go("crash", () => playCrash(world, PLAN.crash));
  await go("ocean", () => playSlot(world, PLAN.ocean, "ocean"));
  // back to the lobby, then CASH OUT exactly as the runtime does (nav, finish: flushes the ocean queue as one Ev)
  await visitLobby(world, 2);
  await h.rt.whenSettled();
  h.rt.logger.nav("cashout");
  const session = h.rt.finish("cashout");
  if (bal(world) < MIN_BET_GLOBAL) throw new Error("demo busted");
  return session;
}

/** Stable serialisation: insertion order of the (deterministic) run, compact, trailing newline. */
export function serialize(s: Session): string {
  return JSON.stringify(s) + "\n";
}
