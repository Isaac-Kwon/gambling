// Number formatting for credits and multipliers (Intl.NumberFormat per language).
import { getLang, type Lang } from '@shared/i18n';

const cache = new Map<string, Intl.NumberFormat>();

function nf(lang: Lang, digits: number): Intl.NumberFormat {
  const key = `${lang}:${digits}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f;
}

/** Whole credits with grouping: 10000 -> "10,000" (ko/en), "10.000" (it). */
export function fmtCredits(n: number, lang: Lang = getLang()): string {
  return nf(lang, 0).format(Math.round(n));
}

/** Signed credits: +1,250 / −300 (true minus sign). 0 -> "0". */
export function fmtDelta(n: number, lang: Lang = getLang()): string {
  const v = Math.round(n);
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + fmtCredits(Math.abs(v), lang);
}

/** Multiplier: 2.5 -> "2.50×". */
export function fmtMult(x: number, lang: Lang = getLang(), digits = 2): string {
  return nf(lang, digits).format(x) + '×';
}
