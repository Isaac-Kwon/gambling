/** Credits → KRW → minimum-wage hours, and felt-vs-actual comparison. Shared by debrief.ts and summary.ts. */
import { KRW_PER_CREDIT, MIN_WAGE_KRW_PER_HOUR } from "./constants";

export function creditsToKrw(credits: number, krwPerCredit: number = KRW_PER_CREDIT): number {
  return credits * krwPerCredit;
}

/** Hours of minimum-wage work worth `krw` (absolute value). null when the wage constant is missing or invalid. */
export function krwToWageHours(krw: number, wage: number | null = MIN_WAGE_KRW_PER_HOUR): number | null {
  if (wage === null || !Number.isFinite(wage) || wage <= 0 || !Number.isFinite(krw)) return null;
  return Math.abs(krw) / wage;
}

export interface MoneyView {
  /** Signed session result in credits (final − start). */
  netCredits: number;
  /** Credits lost (0 when the session ended up). */
  lossCredits: number;
  netKrw: number;
  lossKrw: number;
  /** Minimum-wage hours equal to the loss (null without a wage constant). */
  lossWageHours: number | null;
  wageredKrw: number;
  wageredWageHours: number | null;
}

export function moneyView(netCredits: number, wageredCredits: number): MoneyView {
  const loss = Math.max(0, -netCredits);
  return {
    netCredits, lossCredits: loss,
    netKrw: creditsToKrw(netCredits), lossKrw: creditsToKrw(loss), lossWageHours: krwToWageHours(creditsToKrw(loss)),
    wageredKrw: creditsToKrw(wageredCredits), wageredWageHours: krwToWageHours(creditsToKrw(wageredCredits)),
  };
}

/** Intro answers: felt minutes played and felt result in credits (+ win / − loss). Either may be missing. */
export interface FeltAnswers { minutes?: number | null; net?: number | null }
export interface FeltVsActual {
  actualMinutes: number;
  feltMinutes: number | null;
  /** felt − actual (negative = it felt shorter than it was). */
  minutesDiff: number | null;
  /** actual / felt (e.g. 2 = twice as long as it felt). null when felt is missing or ≤ 0. */
  minutesRatio: number | null;
  actualNet: number;
  feltNet: number | null;
  /** felt − actual (positive = it felt better than it was). */
  netDiff: number | null;
}

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

export function feltVsActual(actual: { durMs: number; net: number }, felt?: FeltAnswers | null): FeltVsActual {
  const actualMinutes = Math.max(0, actual.durMs) / 60_000;
  const fm = ok(felt?.minutes) ? felt!.minutes! : null;
  const fn = ok(felt?.net) ? felt!.net! : null;
  return {
    actualMinutes,
    feltMinutes: fm,
    minutesDiff: fm === null ? null : fm - actualMinutes,
    minutesRatio: fm === null || fm <= 0 ? null : actualMinutes / fm,
    actualNet: actual.net,
    feltNet: fn,
    netDiff: fn === null ? null : fn - actual.net,
  };
}
