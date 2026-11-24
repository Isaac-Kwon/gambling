import type { GameId, SlotVariant } from "./config";
import type { Lang } from "./i18n";

/**
 * Session log. All times (`t`, `te`, `nav.t`, `aux.t`) are integer ms elapsed since `startedAt`;
 * `startedAt` itself is epoch ms of the tap on the entry screen.
 */
export type Session = {
  v: 1; seed: string; mode: "free" | "class"; fx: "on" | "off";
  display: "browser" | "standalone" | "fullscreen"; installed: boolean;
  device: { w: number; h: number; dpr: number; touch: boolean; orient: "portrait" | "landscape" };
  startedAt: number; endedAt?: number; endReason?: "bust" | "cashout";
  startCredits: number; events: Ev[]; nav: { t: number; to: string }[];
  /** Session id (resume matching). */
  id?: string;
  lang?: Lang;
  /** Slot math variant (hidden URL param ?sv=). Absent means "a". */
  sv?: SlotVariant;
  /** prefers-reduced-motion */
  rm?: boolean;
  /** Display/state records that belong to no round. */
  aux?: Aux[];
  /** Record of the ocean queue amount paid out as a lump-sum flush (Ev with game "ocean", bet 0, dec.flush) at the end. Not forfeited. */
  unreleased?: number;
  /** Session generated at build time. */
  demo?: boolean;
};

/**
 * kind values: ticker{name,game,amt}, hot{games}, crowd{n}, level{n}, bg, fg, mute{on}, install{step}, resume.
 */
export type Aux = { t: number; kind: string; d?: Record<string, unknown> };

/**
 * One settled round. Field roles: `out` = honest outcome, `dec` = player choices,
 * A leftover-queue flush is a normal Ev: game "ocean", bet 0, payout = remaining, dec {bonusSeqId, flush: true}.
 * `ctl` = how it was operated, `disp` = what was shown, `fx` = stimuli that occurred.
 * `payout` is the total returned to the wallet including the stake; `net = payout - bet`.
 */
export type Ev = {
  t: number; game: GameId; round: number;
  bet: number; payout: number; net: number; balance: number;
  disp?: Record<string, unknown>;
  ctl?: { stopPressed?: boolean; turbo?: boolean; auto?: boolean; gesture?: "tap" | "swipe" };
  /** Mutable after settlement: the same array keeps receiving records until the next round begins. */
  fx?: { type: string; ms: number; k: number }[];
  dec?: Record<string, unknown>;
  /** Settlement time. */
  te?: number;
  /** Facts decided by the outcome stream (reel stops, roulette number, cards, crash point). */
  out?: Record<string, unknown>;
};

/** Values allowed in `nav.to`. */
export const NAV_TARGETS = ["gate", "lobby", "slot", "roulette", "blackjack", "crash", "ocean", "cashout"] as const;
