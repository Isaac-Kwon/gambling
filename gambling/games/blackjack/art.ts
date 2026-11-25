/**
 * BLACKJACK 21 card art, drawn in code. Faces for all 13 ranks x 4 suits (pip layouts, and original double-ended
 * K / Q / J busts), plus the OROBELLE card back.
 *
 * Everything is an inline SVG string (100x140 user units) that references one shared sprite
 * (`spriteSvg()`: gradients, suit and figure symbols, the lettering ring). The view mounts the sprite once.
 * Inline SVG (not a CSS image) so the page font (Lilita One) draws the rank letters.
 * Card ids follow shared/rules/blackjack.ts: rank = c % 13 (0 = A), suit = floor(c / 13) in "shdc".
 */
import type { Card } from "../../../shared/rules/blackjack";
import { BELL, starPath } from "../../src/ui/svg";

export const SUIT_KEYS = ["s", "h", "d", "c"] as const;
export const RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

export const isRed = (c: Card): boolean => {
  const s = Math.floor(c / 13);
  return s === 1 || s === 2;
};

const INK = "#1E0612";
const SKIN = "#F8D9B8";

// ------------------------------------------------------------------------------------------- sprite

const SUIT_PATHS: Record<string, string> = {
  s: "M50 5C62 24 93 39 93 62C93 79 78 87 66 82C62 80 59 78 56 74C57 84 60 92 69 96H31C40 92 43 84 44 74C41 78 38 80 34 82C22 87 7 79 7 62C7 39 38 24 50 5Z",
  h: "M50 91C21 68 6 50 6 31C6 17 17 8 29 8C39 8 46 14 50 23C54 14 61 8 71 8C83 8 94 17 94 31C94 50 79 68 50 91Z",
  d: "M50 3C60 26 74 40 93 50C74 60 60 74 50 97C40 74 26 60 7 50C26 40 40 26 50 3Z",
  c: "M50 6A21 21 0 0 1 71 27C71 33 69 38 65 42A22 22 0 1 1 74 82C66 82 60 79 56 75C57 85 60 92 69 96H31C40 92 43 85 44 75C40 79 34 82 26 82A22 22 0 1 1 35 42C31 38 29 33 29 27A21 21 0 0 1 50 6Z",
};

const stopsOf = (l: [number, string][]): string => l.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
const lin = (id: string, l: [number, string][], y2 = 1): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="${y2}">${stopsOf(l)}</linearGradient>`;

/** Hidden sprite shared by every card (defs only; mount once per screen). */
export function spriteSvg(): string {
  const suits = SUIT_KEYS.map((k) => `<symbol id="bj-su-${k}" viewBox="0 0 100 100"><path d="${SUIT_PATHS[k]}"/></symbol>`).join("");
  return `<svg class="bj-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>` +
    lin("bj-red", [[0, "#FF5A78"], [0.45, "#D6102F"], [1, "#7E0820"]]) +
    lin("bj-blk", [[0, "#5B4B7D"], [0.45, "#241838"], [1, "#0B0612"]]) +
    lin("bj-gold", [[0, "#FFFBE6"], [0.28, "#FFE9A6"], [0.5, "#F5C542"], [0.52, "#C98A1E"], [0.78, "#F0B93A"], [1, "#9A5F10"]]) +
    lin("bj-crim", [[0, "#FF8AA3"], [0.4, "#FF2D55"], [1, "#8E0721"]]) +
    lin("bj-paper", [[0, "#FFFFFF"], [0.6, "#FFF9EA"], [1, "#F3E6C4"]]) +
    lin("bj-panel", [[0, "#FFF6DA"], [0.5, "#FBE7B0"], [1, "#F2D486"]]) +
    lin("bj-back", [[0, "#4A1D8F"], [0.5, "#2A1058"], [1, "#150833"]]) +
    `<pattern id="bj-lat" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<path d="M0 0H10M0 0V10" stroke="#F5C542" stroke-opacity=".38" stroke-width=".7" fill="none"/>` +
    `<circle cx="5" cy="5" r="1.1" fill="#FF3DA5" fill-opacity=".6"/></pattern>` +
    `<path id="bj-ring" d="M50 70m-33 0a33 33 0 1 1 66 0a33 33 0 1 1-66 0"/>` +
    suits + figureSymbol("K") + figureSymbol("Q") + figureSymbol("J") +
    `</defs></svg>`;
}

// ------------------------------------------------------------------------------------------- figures

const crownPath = "M16.2 11.6L15 4.6L21 8.6L26 1.4L31 8.6L37 4.6L35.8 11.6Z";

/** One half (top) of a court card, 52x51 units, cut at the centre line. Robe colour comes from `color` on <use>. */
function figureSymbol(r: "K" | "Q" | "J"): string {
  const robe = `<path d="M1 51C1 40 7 34 17 31H35C45 34 51 40 51 51Z" fill="currentColor" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M17 31L26 42L35 31" fill="none" stroke="url(#bj-gold)" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<path d="M17 31L26 42L35 31" fill="none" stroke="${INK}" stroke-width=".5"/>` +
    `<path d="${starPath(26, 46, 4.4, 1.9)}" fill="url(#bj-gold)" stroke="${INK}" stroke-width=".6" stroke-linejoin="round"/>` +
    `<path d="M5 51C6 44 9 39 13 36" fill="none" stroke="url(#bj-gold)" stroke-width="1.4" stroke-linecap="round"/>` +
    `<path d="M47 51C46 44 43 39 39 36" fill="none" stroke="url(#bj-gold)" stroke-width="1.4" stroke-linecap="round"/>`;
  const neck = `<path d="M22.6 25H29.4V33C27 34.5 25 34.5 22.6 33Z" fill="${SKIN}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`;
  const head = `<ellipse cx="26" cy="18.6" rx="8.6" ry="10" fill="${SKIN}" stroke="${INK}" stroke-width="1.1"/>` +
    `<path d="M17.6 18.6C16 18.6 16 22 18 22M34.4 18.6C36 18.6 36 22 34 22" fill="${SKIN}" stroke="${INK}" stroke-width=".9"/>`;
  const face = `<circle cx="22.6" cy="18.4" r=".95" fill="${INK}"/><circle cx="29.4" cy="18.4" r=".95" fill="${INK}"/>` +
    `<path d="M20.6 15.6Q22.6 14.6 24.4 15.6M27.6 15.6Q29.4 14.6 31.4 15.6" fill="none" stroke="${INK}" stroke-width=".8" stroke-linecap="round"/>` +
    `<path d="M26 19.4Q24.6 22 26.4 22.4" fill="none" stroke="${INK}" stroke-width=".7" stroke-linecap="round"/>` +
    `<path d="M23.6 25.2Q26 26.8 28.4 25.2" fill="none" stroke="#B2203A" stroke-width="1" stroke-linecap="round"/>` +
    `<ellipse cx="20.8" cy="22" rx="1.7" ry="1" fill="#FF8AA3" fill-opacity=".45"/><ellipse cx="31.2" cy="22" rx="1.7" ry="1" fill="#FF8AA3" fill-opacity=".45"/>`;
  const jewel = (x: number, y: number, c: string, rr = 1.15) => `<circle cx="${x}" cy="${y}" r="${rr}" fill="${c}" stroke="${INK}" stroke-width=".5"/>`;
  let body: string;
  if (r === "K") {
    body =
      `<path d="M17.2 12C14.8 19 15.8 25 18.4 28C18 22 18.6 17 19.8 12Z" fill="#D8D2E2" stroke="${INK}" stroke-width=".8"/>` +
      `<path d="M34.8 12C37.2 19 36.2 25 33.6 28C34 22 33.4 17 32.2 12Z" fill="#D8D2E2" stroke="${INK}" stroke-width=".8"/>` +
      robe + neck + head +
      `<path d="M17.6 20C17.6 33 34.4 33 34.4 20C32.6 24.6 30.4 25 26 25C21.6 25 19.4 24.6 17.6 20Z" fill="#E6E0EE" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<path d="M21.6 23.6Q26 21.6 30.4 23.6Q26 25.8 21.6 23.6Z" fill="#CFC8DA" stroke="${INK}" stroke-width=".6"/>` +
      face.replace(/<path d="M23.6 25.2[^>]*>/, "") +
      `<path d="${crownPath}" fill="url(#bj-gold)" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<rect x="16.2" y="9.6" width="19.6" height="3.4" rx="1" fill="url(#bj-gold)" stroke="${INK}" stroke-width=".9"/>` +
      jewel(26, 6.2, "#FF2D55") + jewel(19.2, 11.3, "#29E6FF", 1) + jewel(26, 11.3, "#FF2D55", 1) + jewel(32.8, 11.3, "#29E6FF", 1) +
      jewel(21, 7.2, "#FFF3A0", .7) + jewel(31, 7.2, "#FFF3A0", .7) +
      `<path d="M45 51V24" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/><path d="M45 51V24" stroke="url(#bj-gold)" stroke-width="1.8" stroke-linecap="round"/>` +
      `<circle cx="45" cy="21.5" r="3.4" fill="url(#bj-gold)" stroke="${INK}" stroke-width="1"/><path d="M45 15.6V18.4M42.2 21.5H47.8" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`;
  } else if (r === "Q") {
    body =
      `<path d="M14.6 17C12.6 5 39.4 5 37.4 17C41 28 38.4 38 43 46L32 40.4H20L9 46C13.6 38 11 28 14.6 17Z" fill="#E7A93A" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>` +
      `<path d="M13.6 24C14 32 12.6 38 10.6 43M38.4 24C38 32 39.4 38 41.4 43" fill="none" stroke="#B87814" stroke-width=".9" stroke-linecap="round"/>` +
      robe + neck + head +
      `<path d="M17.4 16.4C20 8.8 32 8.8 34.6 16.4C31.6 13 29.4 12.6 26.4 14.4C23.4 12.6 21 13 17.4 16.4Z" fill="#E7A93A" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
      face +
      `<path d="M17.6 11.6L18.8 4.4L22.4 8.2L26 1.8L29.6 8.2L33.2 4.4L34.4 11.6Z" fill="url(#bj-gold)" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<rect x="17.4" y="9.8" width="17.2" height="3.2" rx="1" fill="url(#bj-gold)" stroke="${INK}" stroke-width=".9"/>` +
      jewel(26, 6.4, "#29E6FF", 1.35) + jewel(19.4, 8.4, "#FF3DA5", .9) + jewel(32.6, 8.4, "#FF3DA5", .9) + jewel(22, 11.4, "#FFF3A0", .7) + jewel(30, 11.4, "#FFF3A0", .7) +
      `<path d="M42 51C42 44 43.4 40 45 37" fill="none" stroke="#1E8A4A" stroke-width="1.6" stroke-linecap="round"/>` +
      `<circle cx="45" cy="34.2" r="3.9" fill="#FF3D7A" stroke="${INK}" stroke-width=".9"/><circle cx="45" cy="34.2" r="2.1" fill="#FF9AB8" stroke="${INK}" stroke-width=".6"/><circle cx="45" cy="34.2" r=".8" fill="#B2203A"/>`;
  } else {
    body =
      robe + neck + head +
      `<path d="M17.2 17.4C16.4 7 35.6 7 34.8 17.4C33 13.6 28.6 12.4 26 13.6C23.4 12.4 19 13.6 17.2 17.4Z" fill="#6A3516" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<path d="M17.6 20.6C16.6 17.6 16.8 16 17.2 14.6M34.4 20.6C35.4 17.6 35.2 16 34.8 14.6" fill="none" stroke="#6A3516" stroke-width="2" stroke-linecap="round"/>` +
      face +
      `<path d="M14.4 12.6C12.4 3 33.6 -1.4 39.6 8.4C34.4 7.2 28.6 8 17.4 13.4Z" fill="currentColor" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
      `<path d="M15 12.4C14.6 10.6 15 9.6 15.6 8.8" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="1" stroke-linecap="round"/>` +
      `<path d="M14.4 12.6L17.6 14C21 11.4 30 8.8 38.6 9.2" fill="none" stroke="url(#bj-gold)" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M38 7.6C46 -1 51.4 6 47.6 17.4C46.6 12.4 43 9.2 38 7.6Z" fill="#29E6FF" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>` +
      `<path d="M39.6 8.2C44 6 47 8.6 47 14" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8" stroke-linecap="round"/>` +
      jewel(17.8, 11.6, "#FF2D55", 1.4) +
      `<path d="M6 51L10 36" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/><path d="M6 51L10 36" stroke="url(#bj-gold)" stroke-width="1.7" stroke-linecap="round"/>` +
      `<path d="M10 36L8 29L13 32Z" fill="url(#bj-gold)" stroke="${INK}" stroke-width=".9" stroke-linejoin="round"/>`;
  }
  return `<symbol id="bj-fig-${r}" viewBox="0 0 52 51" overflow="hidden">${body}</symbol>`;
}

// ------------------------------------------------------------------------------------------- faces

// Pip centres on the 100x140 card. Lower half pips are drawn upside down.
const X1 = 33, X2 = 50, X3 = 67;
const PIPS: Record<number, [number, number][]> = {
  1: [[X2, 70]],
  2: [[X2, 33], [X2, 107]],
  3: [[X2, 33], [X2, 70], [X2, 107]],
  4: [[X1, 33], [X3, 33], [X1, 107], [X3, 107]],
  5: [[X1, 33], [X3, 33], [X2, 70], [X1, 107], [X3, 107]],
  6: [[X1, 33], [X3, 33], [X1, 70], [X3, 70], [X1, 107], [X3, 107]],
  7: [[X1, 33], [X3, 33], [X2, 51], [X1, 70], [X3, 70], [X1, 107], [X3, 107]],
  8: [[X1, 33], [X3, 33], [X2, 51], [X1, 70], [X3, 70], [X2, 89], [X1, 107], [X3, 107]],
  9: [[X1, 31], [X3, 31], [X1, 57], [X3, 57], [X2, 70], [X1, 83], [X3, 83], [X1, 109], [X3, 109]],
  10: [[X1, 31], [X3, 31], [X2, 44], [X1, 57], [X3, 57], [X1, 83], [X3, 83], [X2, 96], [X1, 109], [X3, 109]],
};

const faceCache = new Map<number, string>();

const useSuit = (s: string, cx: number, cy: number, size: number, fill: string, flip: boolean): string => {
  const g = `<use href="#bj-su-${s}" x="${(cx - size / 2).toFixed(1)}" y="${(cy - size / 2).toFixed(1)}" width="${size}" height="${size}" fill="${fill}"/>`;
  return flip ? `<g transform="rotate(180 ${cx} ${cy})">${g}</g>` : g;
};

/** SVG markup of a card face (100x140). */
export function faceSvg(c: Card): string {
  const hit = faceCache.get(c);
  if (hit) return hit;
  const rank = c % 13, suit = SUIT_KEYS[Math.floor(c / 13)];
  const red = isRed(c);
  const fill = red ? "url(#bj-red)" : "url(#bj-blk)";
  const label = RANK_LABELS[rank];
  const txtFill = red ? "#C8102E" : "#1E1530";
  const fs = label.length > 1 ? 17 : 21;
  const idx = (rot: boolean): string => {
    const g = `<text x="11" y="22" text-anchor="middle" font-size="${fs}" fill="${txtFill}">${label}</text>` +
      `<use href="#bj-su-${suit}" x="5" y="26" width="12" height="12" fill="${fill}"/>`;
    return rot ? `<g transform="rotate(180 50 70)">${g}</g>` : g;
  };
  let mid = "";
  if (rank >= 10) {
    const robe = red ? "#C8102E" : "#33206B";
    const fig = (rot: boolean) => {
      const u = `<use href="#bj-fig-${label}" x="24.5" y="19.5" width="51" height="50" color="${robe}"/>`;
      return rot ? `<g transform="rotate(180 50 70)">${u}</g>` : u;
    };
    mid = `<rect x="23" y="18" width="54" height="104" rx="3" fill="url(#bj-panel)"/>` +
      `<path d="M23 70H77" stroke="url(#bj-gold)" stroke-width="1.3"/>` +
      fig(false) + fig(true) +
      `<rect x="23" y="18" width="54" height="104" rx="3" fill="none" stroke="url(#bj-gold)" stroke-width="1.8"/>` +
      `<rect x="21.6" y="16.6" width="56.8" height="106.8" rx="4" fill="none" stroke="${INK}" stroke-width=".7"/>` +
      useSuit(suit, 28.5, 29, 8, fill, false) + useSuit(suit, 71.5, 111, 8, fill, true);
  } else if (rank === 0) {
    mid = `<circle cx="50" cy="70" r="27" fill="none" stroke="url(#bj-gold)" stroke-width="1.2" stroke-dasharray="1.5 3.2" stroke-linecap="round"/>` +
      useSuit(suit, 50, 70, 40, fill, false);
  } else {
    mid = (PIPS[rank + 1] ?? []).map(([x, y]) => useSuit(suit, x, y, 21, fill, y > 70)).join("");
  }
  const out = `<svg viewBox="0 0 100 140" class="bj-face" aria-hidden="true"><rect width="100" height="140" fill="url(#bj-paper)"/>` +
    `<rect x="2.5" y="2.5" width="95" height="135" rx="6" fill="none" stroke="#E8D5A0" stroke-width=".8"/>` + idx(false) + idx(true) + mid + `</svg>`;
  faceCache.set(c, out);
  return out;
}

// ------------------------------------------------------------------------------------------- back

let backCache = "";

/** The OROBELLE card back (100x140): lattice, gold frame, bell medallion with lettering ring. */
export function backSvg(): string {
  if (backCache) return backCache;
  const { body, lip, loop, clapper } = BELL;
  const bell = `<g transform="translate(50 69) scale(.082) translate(-256 -262)">` +
    `<circle cx="${loop.cx}" cy="${loop.cy}" r="${loop.r}" fill="none" stroke="${INK}" stroke-width="22"/>` +
    `<circle cx="${loop.cx}" cy="${loop.cy}" r="${loop.r}" fill="none" stroke="url(#bj-gold)" stroke-width="11"/>` +
    `<circle cx="${clapper.cx}" cy="${clapper.cy}" r="${clapper.r}" fill="url(#bj-gold)" stroke="${INK}" stroke-width="10"/>` +
    `<path d="${body}" fill="url(#bj-gold)" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>` +
    `<rect x="${lip.x}" y="${lip.y}" width="${lip.w}" height="${lip.h}" rx="${lip.r}" fill="url(#bj-gold)" stroke="${INK}" stroke-width="10"/>` +
    `<path d="${BELL.star}" fill="url(#bj-crim)" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/></g>`;
  const corner = (x: number, y: number) => `<path d="${starPath(x, y, 4.2, 1.8)}" fill="url(#bj-gold)" stroke="${INK}" stroke-width=".4"/>`;
  backCache = `<svg viewBox="0 0 100 140" class="bj-backart" aria-hidden="true"><rect width="100" height="140" fill="#F8EFD4"/>` +
    `<rect x="4" y="4" width="92" height="132" rx="5" fill="url(#bj-back)" stroke="${INK}" stroke-width="1"/>` +
    `<rect x="4" y="4" width="92" height="132" rx="5" fill="url(#bj-lat)"/>` +
    `<rect x="8.5" y="8.5" width="83" height="123" rx="3" fill="none" stroke="url(#bj-gold)" stroke-width="1.6"/>` +
    `<rect x="11" y="11" width="78" height="118" rx="2" fill="none" stroke="#F5C542" stroke-opacity=".5" stroke-width=".6"/>` +
    corner(18, 18) + corner(82, 18) + corner(18, 122) + corner(82, 122) +
    `<circle cx="50" cy="70" r="40" fill="#12081F" fill-opacity=".72" stroke="url(#bj-gold)" stroke-width="1.6"/>` +
    `<circle cx="50" cy="70" r="26" fill="#1B0C33" stroke="#F5C542" stroke-width=".8"/>` +
    `<text font-size="7.2" fill="#FFE9A6" letter-spacing=".4"><textPath href="#bj-ring" startOffset="0" textLength="203" lengthAdjust="spacing">OROBELLE ✦ OROBELLE ✦ OROBELLE ✦</textPath></text>` +
    bell + `</svg>`;
  return backCache;
}

// ------------------------------------------------------------------------------------------- chips of the table

/** Greedy chip stack (largest first) for an amount, e.g. 620 -> [500, 100, 20]. */
export function chipsFor(amount: number, denoms: readonly number[] = [500, 100, 20]): number[] {
  const out: number[] = [];
  let left = amount;
  for (const d of denoms) {
    while (left >= d && out.length < 12) { out.push(d); left -= d; }
  }
  return out;
}
