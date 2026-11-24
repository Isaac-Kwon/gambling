import type { GameId } from "./config";
import type { Lang } from "./i18n";
import { SESSION_KEY } from "./logger";
import type { Ev, Session } from "./schema";

/** Maximum length of the whole `#s=<payload>` hash. */
export const HASH_MAX = 2000;
export const HASH_PREFIX = "#s=";

export type GameSummary = { n: number; bet: number; pay: number; cel: number; celNeg: number; dv: number; stop: number };

export type Summary = {
  v: 1; seed: string; mode: Session["mode"]; fx: Session["fx"]; display: Session["display"]; installed: boolean;
  startedAt: number; durMs: number; endReason: "bust" | "cashout";
  startCredits: number; finalCredits: number; peak: { bal: number; t: number }; maxWin: number;
  /** Sum of fx ms over rounds with net > 0 / net <= 0. */
  fxMsPos: number; fxMsNeg: number;
  /** Times the stake was raised in the same game right after a net-negative round. */
  chase: number;
  games: Partial<Record<GameId, GameSummary>>;
  /** n = rounds that showed an omen; after = ocean rounds played after the first omen round. */
  omen?: { n: number; after: number };
  // Carried so the analysis page still works when localStorage is unavailable.
  sv?: Session["sv"]; lang?: Lang; rm?: boolean;
  /** Ocean queue amount paid out as the end-of-session lump-sum flush. */
  unreleased?: number;
};

const GAME_ORDER: GameId[] = ["slot", "roulette", "blackjack", "crash", "ocean"];

function isFlush(e: Ev): boolean {
  return !!(e.dec && (e.dec as { flush?: unknown }).flush);
}

export function summarize(s: Session): Summary {
  const games: Summary["games"] = {};
  let fxMsPos = 0, fxMsNeg = 0, chase = 0, maxWin = 0;
  let peak = { bal: s.startCredits, t: 0 };
  let final = s.startCredits;
  let lastT = 0;
  const prev: Partial<Record<GameId, Ev>> = {};
  let omenN = 0, omenAfter = 0, omenSeen = false;

  for (const e of s.events) {
    const flush = isFlush(e);
    const g = (games[e.game] ??= { n: 0, bet: 0, pay: 0, cel: 0, celNeg: 0, dv: 0, stop: 0 });
    g.bet += e.bet; g.pay += e.payout;
    if (!flush) {
      g.n++;
      const d = e.disp as { celebrate?: unknown; dispVar?: unknown; omen?: unknown } | undefined;
      if (d?.celebrate) { g.cel++; if (e.payout < e.bet) g.celNeg++; }
      if (d?.dispVar) g.dv++;
      if (e.ctl?.stopPressed) g.stop++;
      if (d?.omen) { omenN++; omenSeen = true; } else if (omenSeen && e.game === "ocean") omenAfter++;
      const p = prev[e.game];
      if (p && p.net < 0 && e.bet > p.bet) chase++;
      prev[e.game] = e;
    }
    let ms = 0;
    for (const f of e.fx ?? []) ms += f.ms;
    if (e.net > 0) fxMsPos += ms; else fxMsNeg += ms;
    if (e.net > maxWin) maxWin = e.net;
    const t = e.te ?? e.t;
    if (e.balance > peak.bal) peak = { bal: e.balance, t };
    final = e.balance;
    if (t > lastT) lastT = t;
  }

  const out: Summary = {
    v: 1, seed: s.seed, mode: s.mode, fx: s.fx, display: s.display, installed: s.installed,
    startedAt: s.startedAt,
    durMs: s.endedAt !== undefined ? Math.max(0, s.endedAt - s.startedAt) : lastT,
    endReason: s.endReason ?? "cashout",
    startCredits: s.startCredits, finalCredits: final, peak, maxWin,
    fxMsPos, fxMsNeg, chase,
    games: {},
  };
  for (const id of GAME_ORDER) if (games[id]) out.games[id] = games[id];
  if (omenN > 0) out.omen = { n: omenN, after: omenAfter };
  if (s.sv) out.sv = s.sv;
  if (s.lang) out.lang = s.lang;
  if (s.rm) out.rm = true;
  if (s.unreleased) out.unreleased = s.unreleased;
  return out;
}

// ---- base64url + compression (no dependencies) ----

function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type StreamCtor = new (format: string) => { readable: ReadableStream; writable: WritableStream };

async function pipe(bytes: Uint8Array, Ctor: StreamCtor): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new Ctor("deflate-raw") as never);
  return new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer());
}

export async function encodeSummary(s: Summary): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  const CS = (globalThis as { CompressionStream?: StreamCtor }).CompressionStream;
  if (CS) {
    try { return "2." + toB64url(await pipe(bytes, CS)); } catch { /* fall through */ }
  }
  return "1." + toB64url(bytes);
}

function isSummary(x: unknown): x is Summary {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.v === 1 && typeof o.seed === "string" && typeof o.startedAt === "number"
    && typeof o.startCredits === "number" && typeof o.finalCredits === "number"
    && !!o.games && typeof o.games === "object";
}

export async function decodeSummary(payload: string): Promise<Summary | null> {
  try {
    const kind = payload.slice(0, 2);
    const raw = fromB64url(payload.slice(2));
    let bytes: Uint8Array;
    if (kind === "1.") bytes = raw;
    else if (kind === "2.") {
      const DS = (globalThis as { DecompressionStream?: StreamCtor }).DecompressionStream;
      if (!DS) return null;
      bytes = await pipe(raw, DS);
    } else return null;
    const obj: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isSummary(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** The location hash to navigate with: `#s=<payload>`. */
export async function summaryHash(s: Summary): Promise<string> {
  return HASH_PREFIX + (await encodeSummary(s));
}

export function loadSession(storage?: Pick<Storage, "getItem"> | null): Session | null {
  try {
    const st = storage === undefined ? (globalThis as { localStorage?: Storage }).localStorage : storage;
    if (!st) return null;
    const raw = st.getItem(SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<Session> | null;
    if (!o || typeof o !== "object" || o.v !== 1 || typeof o.seed !== "string" || !Array.isArray(o.events)) return null;
    return o as Session;
  } catch {
    return null;
  }
}

export type Handoff = { kind: "full"; session: Session } | { kind: "summary"; summary: Summary } | null;

function hashPayload(hash: string): string | null {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of h.split("&")) if (part.startsWith("s=")) return part.slice(2) || null;
  return null;
}

export async function resolveHandoff(hash: string, storage?: Pick<Storage, "getItem"> | null): Promise<Handoff> {
  const stored = loadSession(storage);
  const p = hashPayload(hash ?? "");
  const summary = p ? await decodeSummary(p) : null;
  if (stored && stored.endedAt !== undefined && (!summary || summary.startedAt === stored.startedAt)) {
    return { kind: "full", session: stored };
  }
  if (summary) return { kind: "summary", summary };
  return null;
}
