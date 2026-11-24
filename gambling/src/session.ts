import { MIN_BET, MIN_BET_GLOBAL, START_CREDITS, type GameId, type SlotVariant } from "../../shared/config";
import type { Lang } from "../../shared/i18n";
import { createLogger, SAVE_INTERVAL_MS, type Logger } from "../../shared/logger";
import { createStreams, randomSeed, type Rng, type Streams } from "../../shared/rng";
import { loadSession } from "../../shared/handoff";
import { oceanFlush, oceanPending, type OceanState } from "../../shared/rules/ocean";
import type { Ev, Session } from "../../shared/schema";
import type { Fx, FxRecord } from "../fx/types";
import type { Env } from "./env";
import { createWallet, type WalletImpl } from "./wallet";
import type { Clock, GameCtx, GameStore, Round, RoundApi, Settings } from "./types";

export const RT_KEY = "eg.rt.v1";
/** A stored session older than this is not resumed. */
export const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;
/** GameStore key of the ocean OceanState (the ocean game uses it too). */
export const OCEAN_STATE_KEY = "ocean.state";

export type KV = Pick<Storage, "getItem" | "setItem">;

/** Written next to the session log whenever it is saved (`eg.rt.v1`). */
export interface RtSnapshot {
  id: string;
  balance: number;
  rounds: Partial<Record<GameId, number>>;
  xp: number;
  store: Record<string, unknown>;
}

export interface ResumePair { session: Session; rt: RtSnapshot }

/** Level n needs 500*n*(n+1) cumulative stake. */
export function levelOf(xp: number): number {
  let n = 0;
  while (xp >= 500 * (n + 1) * (n + 2)) n++;
  return n;
}

/**
 * Pure. Resume only when: unfinished, started within 6 h, `?seed=` absent or equal, the session id matches the
 * snapshot, the snapshot balance equals the last logged balance (both writes landed), and fx and sv equal the
 * stored session's (no mixing modes inside one session).
 */
export function decideResume(o: {
  session: Session | null; rt: RtSnapshot | null; now: number;
  seed: string | null; fx: "on" | "off"; sv: SlotVariant;
}): ResumePair | null {
  const { session: s, rt } = o;
  if (!s || !rt || !s.id || s.id !== rt.id) return null;
  if (s.endedAt !== undefined) return null;
  if (o.now - s.startedAt > RESUME_WINDOW_MS || o.now < s.startedAt) return null;
  if (o.seed !== null && o.seed !== s.seed) return null;
  if (s.fx !== o.fx || (s.sv ?? "a") !== o.sv) return null;
  const last = s.events.length ? s.events[s.events.length - 1].balance : s.startCredits;
  if (!Number.isSafeInteger(rt.balance) || rt.balance !== last) return null;
  return { session: s, rt };
}

export function loadRt(storage?: Pick<Storage, "getItem"> | null): RtSnapshot | null {
  try {
    const st = storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage : storage;
    const raw = st?.getItem(RT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<RtSnapshot> | null;
    if (!o || typeof o.id !== "string" || typeof o.balance !== "number" || typeof o.xp !== "number") return null;
    return { id: o.id, balance: o.balance, rounds: o.rounds ?? {}, xp: o.xp, store: o.store ?? {} };
  } catch {
    return null;
  }
}

export function findResume(o: {
  storage?: Pick<Storage, "getItem"> | null; now: number; seed: string | null; fx: "on" | "off"; sv: SlotVariant;
}): ResumePair | null {
  return decideResume({ session: loadSession(o.storage), rt: loadRt(o.storage), now: o.now, seed: o.seed, fx: o.fx, sv: o.sv });
}

export type Notice =
  | { kind: "bonus"; amount: number; balance: number }
  | { kind: "level"; n: number };

export interface SessionOpts {
  seed: string;
  /** "class" when the seed came from `?seed=`. */
  mode?: Session["mode"];
  fx: Fx;
  fxMode: "on" | "off";
  sv?: SlotVariant;
  lang?: Lang;
  env: Env;
  clock: Clock;
  /** Epoch ms. Default Date.now. */
  epoch?: () => number;
  /** null disables persistence (harness). Default localStorage. */
  storage?: KV | null;
  t?: GameCtx["t"];
  startCredits?: number;
  id?: string;
  resume?: ResumePair;
}

export interface SessionRuntime {
  readonly logger: Logger;
  readonly wallet: WalletImpl;
  readonly streams: Streams;
  readonly store: GameStore;
  readonly settings: Settings;
  readonly xp: number;
  readonly level: number;
  readonly ended: boolean;
  readonly resumed: boolean;
  /** Builds the context for one game. */
  makeCtx(game: GameId): GameCtx;
  /** Round API bound to a game (count() without an argument counts that game). */
  roundsFor(game: GameId): RoundApi;
  /** Pays out the whole ocean queue as one Ev (ARCHITECTURE 6.2). null when nothing is queued. */
  flushOcean(): Ev | null;
  /** True when the balance is at least the global minimum but below this game's minimum bet. */
  insufficient(game: GameId): boolean;
  /** Resolves when the post-settlement check (after fx.idle) has run. */
  whenSettled(): Promise<void>;
  /** Cash-out request; deferred until the active round settles (and its effects end). */
  requestCashout(reason?: "bust" | "cashout"): void;
  readonly cashoutRequested: "bust" | "cashout" | null;
  onCashout(cb: (reason: "bust" | "cashout") => void): () => void;
  onNotice(cb: (n: Notice) => void): () => void;
  /** main/router supply how `ctx.nav.toLobby()` navigates. */
  bindNav(nav: { toLobby(): void }): void;
  /** Flushes the ocean queue, ends the log, saves. Idempotent. */
  finish(reason: "bust" | "cashout"): Session;
  /** Background / foreground. Idempotent. */
  suspend(): void;
  resume(): void;
  onVisibility(cb: (state: "hidden" | "visible") => void): () => void;
  /** Writes the log and the resume snapshot now. */
  save(): void;
  snapshot(): RtSnapshot;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createSession(o: SessionOpts): SessionRuntime {
  const epoch = o.epoch ?? (() => Date.now());
  const storage: KV | null = o.storage === undefined
    ? ((): KV | null => {
      try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
    })()
    : o.storage;
  const { fx, clock } = o;
  const resumed = !!o.resume;
  const sv: SlotVariant = o.resume ? (o.resume.session.sv ?? "a") : (o.sv ?? "a");
  const seed = o.resume ? o.resume.session.seed : o.seed;
  const startCredits = o.startCredits ?? START_CREDITS;

  const logger = o.resume
    ? createLogger(o.resume.session, { storage, clock: epoch, resume: o.resume.session })
    : createLogger({
      v: 1, seed, mode: o.mode ?? "free", fx: o.fxMode,
      display: o.env.display, installed: o.env.installed, device: o.env.device,
      startedAt: epoch(), startCredits,
      id: o.id ?? randomSeed(), sv, ...(o.lang ? { lang: o.lang } : {}), ...(o.env.reducedMotion ? { rm: true } : {}),
    }, { storage, clock: epoch });
  const session = logger.session;
  const id = session.id as string;

  const wallet = createWallet(o.resume ? o.resume.rt.balance : startCredits);
  const streams = createStreams(seed);
  const counts: Partial<Record<GameId, number>> = o.resume ? { ...o.resume.rt.rounds } : {};
  let xp = o.resume ? o.resume.rt.xp : 0;
  let level = levelOf(xp);
  const data = new Map<string, unknown>(o.resume ? Object.entries(o.resume.rt.store) : []);

  const store: GameStore = {
    get: <T>(k: string) => data.get(k) as T | undefined,
    set(k, v) { if (v === undefined) data.delete(k); else data.set(k, clone(v)); },
  };

  let muted = false;
  const settings: Settings = {
    fx: o.fxMode, lang: o.lang ?? "ko", reducedMotion: o.env.reducedMotion, sv,
    get muted() { return muted; },
    set muted(m: boolean) {
      if (m === muted) return;
      muted = m;
      fx.sfx.setMuted(m);
      logger.aux("mute", { on: m });
    },
  };

  const noticeSubs = new Set<(n: Notice) => void>();
  const cashoutSubs = new Set<(r: "bust" | "cashout") => void>();
  const visSubs = new Set<(s: "hidden" | "visible") => void>();
  const notify = (n: Notice): void => { for (const cb of [...noticeSubs]) cb(n); };
  let nav: { toLobby(): void } = { toLobby: () => undefined };

  let ended = false;
  let hidden = false;
  let active: Round | null = null;
  let cashoutRequested: "bust" | "cashout" | null = null;
  let deferredCashout: "bust" | "cashout" | null = null;
  let pending: Promise<void> = Promise.resolve();

  // ---- persistence: the log and eg.rt.v1 are always written together ----
  let lastPersist = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // The snapshot is always the state at the last settlement: an in-flight round is void and replays identically.
  const capture = () => ({ balance: wallet.balance, xp, rounds: { ...counts }, store: JSON.stringify(Object.fromEntries(data)) });
  let committed = capture();
  const commit = (): void => { committed = capture(); };
  const snapshot = (): RtSnapshot => ({
    id, balance: committed.balance, rounds: { ...committed.rounds }, xp: committed.xp,
    store: JSON.parse(committed.store) as Record<string, unknown>,
  });
  const saveNow = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    lastPersist = epoch();
    if (!storage) return;
    logger.save();
    try { storage.setItem(RT_KEY, JSON.stringify(snapshot())); } catch { /* storage may be full or blocked */ }
  };
  const persist = (): void => {
    if (!storage || ended) return;
    const wait = SAVE_INTERVAL_MS - (epoch() - lastPersist);
    if (wait <= 0) { saveNow(); return; }
    if (timer === null) timer = setTimeout(() => { timer = null; saveNow(); }, wait);
  };

  const addXp = (n: number): void => {
    xp += n;
    const l = levelOf(xp);
    if (l > level) {
      level = l;
      logger.aux("level", { n: l });
      notify({ kind: "level", n: l });
    }
  };

  // ---- ocean flush ----
  const flushOcean = (): Ev | null => {
    const st = store.get<OceanState>(OCEAN_STATE_KEY);
    if (!st) return null;
    const r = oceanFlush(st);
    if (!r) return null;
    store.set(OCEAN_STATE_KEY, r.state);
    wallet.credit(r.amount);
    const t = logger.now();
    const ev: Ev = {
      t, te: t, game: "ocean", round: counts.ocean ?? 0,
      bet: 0, payout: r.amount, net: r.amount, balance: wallet.balance,
      dec: r.seqs.length > 1 ? { bonusSeqId: r.seqId, flush: true, seqs: r.seqs } : { bonusSeqId: r.seqId, flush: true },
      fx: [],
    };
    logger.push(ev);
    commit();
    session.unreleased = (session.unreleased ?? 0) + r.amount;
    notify({ kind: "bonus", amount: r.amount, balance: wallet.balance });
    persist();
    return ev;
  };

  const emitCashout = (reason: "bust" | "cashout"): void => {
    if (ended || cashoutRequested) return;
    cashoutRequested = reason;
    for (const cb of [...cashoutSubs]) cb(reason);
  };
  const requestCashout = (reason: "bust" | "cashout" = "cashout"): void => {
    if (ended || cashoutRequested) return;
    if (active) { deferredCashout = deferredCashout === "bust" ? "bust" : reason; return; }
    emitCashout(reason);
  };

  const checkBust = (): void => {
    if (ended || active || cashoutRequested) return;
    if (wallet.balance >= MIN_BET_GLOBAL) return;
    flushOcean();
    if (wallet.balance < MIN_BET_GLOBAL) emitCashout("bust");
  };

  const afterSettle = (): void => {
    pending = Promise.all([pending, fx.idle()]).then(() => {
      if (deferredCashout) { const r = deferredCashout; deferredCashout = null; emitCashout(r); }
      else checkBust();
    }).catch(() => undefined);
  };

  // ---- rounds ----
  const beginRound = (game: GameId, b: { bet: number; ctl?: Ev["ctl"] }): Round => {
    if (ended) throw new Error("session has ended");
    if (active) throw new Error("a round is already in progress");
    if (!Number.isSafeInteger(b.bet) || b.bet <= 0) throw new RangeError(`bet must be a positive integer, got ${b.bet}`);
    wallet.debit(b.bet);
    const n = (counts[game] ?? 0) + 1;
    const rec: FxRecord[] = [];
    fx.collect(rec);
    let bet = b.bet;
    let ctl: NonNullable<Ev["ctl"]> = b.ctl ? { ...b.ctl } : {};
    let settled = false;
    const t0 = logger.now();
    addXp(b.bet);
    const res: Rng = streams.res(game).at(n);
    const pre: Rng = streams.pre(game).at(n);
    const round: Round = {
      n, res, pre,
      addBet(a) {
        if (settled) throw new Error("round already settled");
        if (!Number.isSafeInteger(a) || a <= 0) throw new RangeError(`bet must be a positive integer, got ${a}`);
        wallet.debit(a);
        bet += a;
        addXp(a);
      },
      ctl(patch) { ctl = { ...ctl, ...patch }; },
      settle(s) {
        if (settled) throw new Error("round already settled");
        if (!Number.isSafeInteger(s.payout) || s.payout < 0) throw new RangeError(`payout must be a non-negative integer, got ${s.payout}`);
        settled = true;
        if (s.payout > 0) wallet.credit(s.payout);
        const ev: Ev = {
          t: t0, te: logger.now(), game, round: n, bet, payout: s.payout, net: s.payout - bet, balance: wallet.balance,
        };
        if (Object.keys(ctl).length) ev.ctl = ctl;
        if (s.out) ev.out = s.out;
        if (s.dec) ev.dec = s.dec;
        if (s.disp) ev.disp = s.disp;
        ev.fx = rec; // keeps filling until the next begin
        logger.push(ev);
        counts[game] = n;
        active = null;
        commit();
        persist();
        afterSettle();
        return ev;
      },
    };
    active = round;
    return round;
  };

  const roundsFor = (game: GameId): RoundApi => ({
    count: (g) => counts[g ?? game] ?? 0,
    begin: (b) => beginRound(game, b),
    get active() { return active; },
  });

  const finish = (reason: "bust" | "cashout"): Session => {
    if (ended) return session;
    flushOcean();
    logger.end(reason);
    ended = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    fx.collect(null);
    return session;
  };

  const rt: SessionRuntime = {
    logger, wallet, streams, store, settings,
    get xp() { return xp; },
    get level() { return level; },
    get ended() { return ended; },
    resumed,
    makeCtx(game) {
      return {
        game, wallet, rounds: roundsFor(game), fx, rng: streams, clock,
        log: { aux: logger.aux, now: logger.now }, settings, store,
        t: o.t ?? ((k) => k),
        nav: { toLobby: () => nav.toLobby(), requestCashout },
      };
    },
    roundsFor,
    flushOcean,
    insufficient: (g) => wallet.balance >= MIN_BET_GLOBAL && wallet.balance < MIN_BET[g],
    whenSettled: () => pending,
    requestCashout,
    get cashoutRequested() { return cashoutRequested; },
    onCashout(cb) { cashoutSubs.add(cb); return () => { cashoutSubs.delete(cb); }; },
    onNotice(cb) { noticeSubs.add(cb); return () => { noticeSubs.delete(cb); }; },
    bindNav(n) { nav = n; },
    finish,
    suspend() {
      if (hidden || ended) return;
      hidden = true;
      clock.pause();
      fx.suspend();
      logger.aux("bg");
      saveNow();
      for (const cb of [...visSubs]) cb("hidden");
    },
    resume() {
      if (!hidden) return;
      hidden = false;
      clock.resume();
      fx.resume();
      logger.aux("fg");
      for (const cb of [...visSubs]) cb("visible");
    },
    onVisibility(cb) { visSubs.add(cb); return () => { visSubs.delete(cb); }; },
    save: saveNow,
    snapshot,
  };

  if (resumed) logger.aux("resume");
  return rt;
}

/** Ocean amount still queued (for the HUD / receipt); 0 when nothing is queued. */
export function oceanQueued(store: GameStore): number {
  const st = store.get<OceanState>(OCEAN_STATE_KEY);
  return st ? oceanPending(st) : 0;
}

/** Wires document visibility to the runtime; returns the unbind function. */
export function bindVisibility(
  doc: { visibilityState: string; addEventListener(t: "visibilitychange", cb: () => void): void; removeEventListener(t: "visibilitychange", cb: () => void): void },
  rt: Pick<SessionRuntime, "suspend" | "resume">,
): () => void {
  const cb = (): void => { if (doc.visibilityState === "hidden") rt.suspend(); else rt.resume(); };
  doc.addEventListener("visibilitychange", cb);
  return () => doc.removeEventListener("visibilitychange", cb);
}
