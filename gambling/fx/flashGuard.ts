/**
 * Flash rate limiter (pure, no DOM). Every flash in gambling goes through `request` (ARCHITECTURE §6.6).
 *
 * - Grant only if fewer than `maxPerSec` grants fall in the half-open window (now - windowMs, now].
 *   Hence no 1 s window ever contains more than `maxPerSec` granted flashes.
 * - A red flash covering more than 25 % of the screen is always refused.
 * - reduced motion: maxPerSec = 1.
 */
export interface FlashGuard {
  request(nowMs: number, o?: { area?: number; red?: boolean }): boolean;
}

/** Screen fraction above which a red flash is refused outright. */
export const RED_AREA_MAX = 0.25;

export function createFlashGuard(o: { maxPerSec?: number; windowMs?: number; reducedMotion?: boolean } = {}): FlashGuard {
  const max = o.reducedMotion ? 1 : Math.max(0, Math.floor(o.maxPerSec ?? 3));
  const windowMs = o.windowMs ?? 1000;
  const granted: number[] = [];   // ascending grant times inside the current window
  let last = -Infinity;

  return {
    request(nowMs, opt = {}) {
      if (!Number.isFinite(nowMs)) return false;
      // Missing area counts as full screen (fail-safe).
      const area = opt.area ?? 1;
      if (opt.red === true && area > RED_AREA_MAX) return false;
      // A clock that runs backwards must not reopen the window: measure against the latest time seen.
      const now = Math.max(nowMs, last);
      last = now;
      while (granted.length > 0 && granted[0] <= now - windowMs) granted.shift();
      if (granted.length >= max) return false;
      granted.push(now);
      return true;
    },
  };
}

const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255], black: [0, 0, 0], gold: [255, 215, 0], yellow: [255, 255, 0],
  red: [255, 0, 0], crimson: [220, 20, 60], darkred: [139, 0, 0], firebrick: [178, 34, 34],
  orangered: [255, 69, 0], tomato: [255, 99, 71], maroon: [128, 0, 0], magenta: [255, 0, 255],
  cyan: [0, 255, 255], blue: [0, 0, 255], green: [0, 128, 0], orange: [255, 165, 0], transparent: [0, 0, 0],
};
/** Palette variables of gambling/src/ui/theme.css (ARCHITECTURE §2.2). */
const VARS: Record<string, string> = {
  "--bg": "#0B0612", "--surface": "#1A0F2B", "--surface-2": "#2A1745",
  "--gold-1": "#FFE9A6", "--gold-2": "#F5C542", "--gold-3": "#B8791A",
  "--red": "#E0183C", "--crimson": "#FF2D55", "--magenta": "#FF3DA5", "--cyan": "#29E6FF",
  "--violet": "#7A3CFF", "--win": "#3DFF8A", "--text": "#FFF6E0", "--muted": "#A99BC2",
};

function parseRgb(color: string): [number, number, number] | null {
  const c = color.trim().toLowerCase();
  const v = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(c);
  if (v) {
    const known = VARS[v[1]];
    if (known) return parseRgb(known);
    return v[2] ? parseRgb(v[2]) : null;
  }
  if (NAMED[c]) return NAMED[c];
  const h = /^#([0-9a-f]{3,8})$/.exec(c);
  if (h) {
    const s = h[1];
    if (s.length === 3 || s.length === 4) return [0, 1, 2].map((i) => parseInt(s[i] + s[i], 16)) as [number, number, number];
    if (s.length === 6 || s.length === 8) return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
    return null;
  }
  const rgb = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(c);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hsl = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(c);
  if (hsl) {
    const hh = ((Number(hsl[1]) % 360) + 360) % 360, s = Number(hsl[2]) / 100, l = Number(hsl[3]) / 100;
    const k = (n: number) => (n + hh / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  }
  return null;
}

/**
 * Whether a CSS color counts as "red" for the flash rule: hue within ±30° of red and clearly saturated.
 * Colors that cannot be parsed count as red (fail-safe: a large unknown-colored flash is refused).
 */
export function isRedColor(color: string): boolean {
  const rgb = parseRgb(color);
  if (!rgb) return true;
  const [r, g, b] = rgb.map((x) => Math.max(0, Math.min(255, x)) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  if (mx < 0.25 || d < 0.2) return false;          // dark or grey
  if (mx !== r) return false;
  let hue = 60 * (((g - b) / d) % 6);
  if (hue < 0) hue += 360;
  const sat = d / mx;
  return sat >= 0.45 && (hue <= 30 || hue >= 330);
}
