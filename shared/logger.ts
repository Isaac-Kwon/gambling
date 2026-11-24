import type { Aux, Ev, Session } from "./schema";

export const SESSION_KEY = "eg.session.v1";

/** Minimum gap between throttled saves. */
export const SAVE_INTERVAL_MS = 1500;

export type SessionMeta = Omit<Session, "events" | "nav" | "aux" | "endedAt" | "endReason">;

export interface Logger {
  readonly session: Session;
  /** Integer ms elapsed since `session.startedAt`. */
  now(): number;
  push(ev: Ev): void;
  nav(to: string): void;
  aux(kind: string, d?: Record<string, unknown>): void;
  /** Records endedAt and endReason, then saves immediately. */
  end(reason: "bust" | "cashout"): void;
  /** try/catch inside; returns only whether the write succeeded. Never throws. */
  save(): boolean;
  /** At most one write per 1.5 s (trailing). */
  scheduleSave(): void;
}

type LogStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LogStorage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function createLogger(
  meta: SessionMeta,
  o: { storage?: LogStorage | null; clock?: () => number; resume?: Session } = {},
): Logger {
  const storage = o.storage === undefined ? defaultStorage() : o.storage;
  const clock = o.clock ?? (() => Date.now());
  const session: Session = o.resume
    ? o.resume
    : { ...meta, events: [], nav: [], aux: [] };
  if (!session.events) session.events = [];
  if (!session.nav) session.nav = [];
  if (!session.aux) session.aux = [];

  let lastSave = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const now = () => Math.max(0, Math.round(clock() - session.startedAt));

  const save = (): boolean => {
    lastSave = clock();
    if (timer !== null) {
      try { clearTimeout(timer); } catch { /* ignore */ }
      timer = null;
    }
    try {
      if (!storage) return false;
      // Serialized at call time: Ev.fx keeps filling after settlement.
      storage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch {
      return false;
    }
  };

  const scheduleSave = (): void => {
    try {
      if (timer !== null) return;
      const wait = Math.max(0, SAVE_INTERVAL_MS - (clock() - lastSave));
      if (wait === 0) { save(); return; }
      timer = setTimeout(() => { timer = null; save(); }, wait);
    } catch {
      /* never throws to the game */
    }
  };

  return {
    session,
    now,
    push(ev) { session.events.push(ev); },
    nav(to) { session.nav.push({ t: now(), to }); },
    aux(kind, d) {
      const a: Aux = d === undefined ? { t: now(), kind } : { t: now(), kind, d };
      (session.aux as Aux[]).push(a);
    },
    end(reason) {
      session.endedAt = Math.round(clock());
      session.endReason = reason;
      save();
    },
    save,
    scheduleSave,
  };
}
