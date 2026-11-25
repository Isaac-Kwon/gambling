/**
 * ORO SEVENS reel symbols, drawn in code (ARCHITECTURE §7.1): 7 flaming seven (top symbol), W wild star,
 * B gold bell, R ruby, C clover, H horseshoe, s h c d neon suits.
 *
 * Each symbol is a standalone SVG document (120×120) used as a CSS background image, so the browser
 * rasterises it once per size at the device pixel ratio and reels only move bitmaps (cheap to paint, crisp
 * at DPR 2). A second "streak" version (vertical blur baked into the SVG) is shown while a reel turns fast.
 * No text glyphs (an SVG image cannot use page fonts): WILD is drawn with strokes.
 */
import type { Sym } from "../../../shared/rules/slot";
import { BELL, starPath, sparklePath } from "../../src/ui/svg";

export const SYMBOLS: readonly Sym[] = ["7", "W", "B", "R", "C", "H", "s", "h", "c", "d"];

const INK = "#1E0612";

type Stop = [number, string, number?];
const stops = (l: Stop[]) => l.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`).join("");
const lin = (id: string, l: Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(l)}</linearGradient>`;
const rad = (id: string, l: Stop[], cx = 0.5, cy = 0.5, r = 0.5, fx?: number, fy?: number) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${fx === undefined ? "" : ` fx="${fx}" fy="${fy}"`}>${stops(l)}</radialGradient>`;

const GOLD: Stop[] = [[0, "#FFFBE6"], [0.25, "#FFE9A6"], [0.5, "#F5C542"], [0.52, "#C98A1E"], [0.75, "#F0B93A"], [1, "#9A5F10"]];
const glint = (x: number, y: number, r: number, op = 1) =>
  `<g opacity="${op}"><circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="#fff" fill-opacity=".28"/><path d="${sparklePath(x, y, r)}" fill="#fff"/></g>`;
/** Path drawn as ink rim → coloured rim → fill: a chunky sticker outline. */
const rimmed = (d: string, fill: string, rim: string, ink = 11, rw = 6.5, extra = "") =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${ink}" stroke-linejoin="round" stroke-linecap="round"${extra}/>` +
  `<path d="${d}" fill="none" stroke="${rim}" stroke-width="${rw}" stroke-linejoin="round" stroke-linecap="round"${extra}/>` +
  `<path d="${d}" fill="${fill}"${extra}/>`;
/** Soft contact shadow under a symbol. */
const shadow = (cy = 108, rx = 34) => `<ellipse cx="60" cy="${cy}" rx="${rx}" ry="5" fill="#000" fill-opacity=".38"/>`;

function seven(): string {
  const flame = "M60 4C70 22 96 30 96 62C96 88 78 106 60 106C40 106 22 90 22 64C22 46 34 38 38 22C44 32 50 36 52 40C54 26 56 16 60 4Z";
  const inner = "M60 30C66 44 82 50 82 68C82 84 72 94 60 94C46 94 36 84 36 70C36 60 42 54 46 46C50 54 54 56 56 58C58 50 58 40 60 30Z";
  const seven = "M23 15H97V30L70 106H45L71 32H39V40H23Z";
  return `<defs>${rad("fl", [[0, "#FFF7C0"], [0.35, "#FFD23F"], [0.7, "#FF7A1A"], [1, "#D7261E"]], 0.5, 0.72, 0.62)}` +
    `${rad("fi", [[0, "#FFFFFF"], [0.45, "#FFF3A0"], [1, "#FFB020"]], 0.5, 0.7, 0.6)}` +
    `${lin("sv", [[0, "#FFB3C2"], [0.3, "#FF3D62"], [0.62, "#E0183C"], [1, "#7A0018"]])}${lin("gd", GOLD)}</defs>` +
    shadow(110, 30) +
    `<path d="${flame}" fill="url(#fl)" stroke="#5A0A00" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="${inner}" fill="url(#fi)" opacity=".85"/>` +
    rimmed(seven, "url(#sv)", "url(#gd)", 12, 7) +
    `<path d="M28 18.5H93V23H28Z" fill="#fff" fill-opacity=".55"/>` +
    `<path d="M66 36L49 101H54L70 37Z" fill="#fff" fill-opacity=".28"/>` +
    glint(94, 12, 11) + glint(30, 92, 6, 0.8);
}

function wild(): string {
  const star = starPath(60, 52, 50, 22);
  const ribbon = "M10 60H110L104 72L110 84H10L16 72Z";
  const letters = "M27 64L32 80L37 69L42 80L47 64M54 64V80M61 64V80H71M78 64V80H83Q93 80 93 72Q93 64 83 64Z";
  return `<defs>${rad("hl", [[0, "#FF3DA5", 0.85], [0.6, "#7A3CFF", 0.35], [1, "#7A3CFF", 0]])}${lin("gd", GOLD)}` +
    `${lin("rb", [[0, "#FF8AA3"], [0.4, "#FF2D55"], [1, "#8E0721"]])}</defs>` +
    `<circle cx="60" cy="56" r="56" fill="url(#hl)"/>` +
    rimmed(star, "url(#gd)", "#FFF3C4", 9, 4) +
    `<path d="${starPath(56, 46, 26, 11)}" fill="#fff" fill-opacity=".35"/>` +
    rimmed(ribbon, "url(#rb)", "#FFE9A6", 8, 3.5) +
    `<path d="${letters}" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${letters}" fill="none" stroke="#FFF3C4" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
    glint(98, 18, 10);
}

function bell(): string {
  const k = 0.25, tx = 60 - 256 * k, ty = 58 - 262 * k;
  const ink = { s: INK, w: 26 };
  const { lip, loop, clapper } = BELL;
  return `<defs>${lin("gd", GOLD)}${lin("lp", [[0, "#FFE9A6"], [0.5, "#F5C542"], [0.52, "#B8791A"], [1, "#F0B93A"]])}</defs>` +
    shadow(109, 32) +
    `<g transform="translate(${tx} ${ty}) scale(${k})">` +
    `<circle cx="${loop.cx}" cy="${loop.cy}" r="${loop.r}" fill="none" stroke="${ink.s}" stroke-width="40"/>` +
    `<circle cx="${loop.cx}" cy="${loop.cy}" r="${loop.r}" fill="none" stroke="url(#gd)" stroke-width="20"/>` +
    `<circle cx="${clapper.cx}" cy="${clapper.cy}" r="${clapper.r}" fill="url(#gd)" stroke="${ink.s}" stroke-width="${ink.w}"/>` +
    `<path d="${BELL.body}" fill="url(#gd)" stroke="${ink.s}" stroke-width="${ink.w}" stroke-linejoin="round"/>` +
    `<path d="${BELL.body}" fill="none" stroke="#FFF3C4" stroke-width="7" stroke-linejoin="round" stroke-opacity=".7"/>` +
    `<path d="${BELL.shine}" fill="#fff" fill-opacity=".65"/>` +
    `<path d="M300 170C330 196 344 232 346 270L350 316C342 306 336 290 334 270L330 232C328 210 316 186 300 170Z" fill="#fff" fill-opacity=".22"/>` +
    `<rect x="${lip.x}" y="${lip.y}" width="${lip.w}" height="${lip.h}" rx="${lip.r}" fill="url(#lp)" stroke="${ink.s}" stroke-width="${ink.w}"/>` +
    `</g>` + glint(88, 30, 10);
}

function ruby(): string {
  const P = { tl: [38, 22], tr: [82, 22], l: [14, 48], r: [106, 48], ml: [46, 48], mr: [74, 48], b: [60, 106] } as const;
  const pt = (k: keyof typeof P) => `${P[k][0]} ${P[k][1]}`;
  const poly = (ks: (keyof typeof P)[], fill: string) => `<path d="M${ks.map(pt).join("L")}Z" fill="${fill}"/>`;
  const outline = `M${pt("tl")}L${pt("tr")}L${pt("r")}L${pt("b")}L${pt("l")}Z`;
  return `<defs>${lin("c", [[0, "#FFD0DA"], [1, "#FF4D6D"]])}${lin("p", [[0, "#FF2D55"], [1, "#6A0016"]])}</defs>` +
    shadow(110, 26) +
    `<path d="${outline}" fill="none" stroke="${INK}" stroke-width="11" stroke-linejoin="round"/>` +
    poly(["tl", "tr", "mr", "ml"], "url(#c)") +
    poly(["l", "tl", "ml"], "#FF2D55") +
    poly(["tr", "r", "mr"], "#B00A2C") +
    poly(["l", "ml", "b"], "#E0183C") +
    poly(["ml", "mr", "b"], "url(#p)") +
    poly(["mr", "r", "b"], "#7A0018") +
    `<path d="M${pt("tl")}L${pt("ml")}L${pt("b")}L${pt("mr")}L${pt("tr")}M${pt("l")}L${pt("r")}" fill="none" stroke="#FFD0DA" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="${outline}" fill="none" stroke="#FFC2CF" stroke-width="2.4" stroke-linejoin="round" stroke-opacity=".9"/>` +
    `<path d="M44 27H62L56 43H48Z" fill="#fff" fill-opacity=".75"/>` +
    `<path d="M24 52L40 52L52 86Z" fill="#fff" fill-opacity=".22"/>` +
    glint(40, 26, 12) + glint(84, 66, 6, 0.8);
}

function clover(): string {
  const leaf = "M0 -4C-6 -12 -24 -16 -24 -30C-24 -41 -12 -45 0 -34C12 -45 24 -41 24 -30C24 -16 6 -12 0 -4Z";
  const cx = 60, cy = 54;
  const leaves = [45, 135, 225, 315].map((a) => `<g transform="translate(${cx} ${cy}) rotate(${a})">` +
    `<path d="${leaf}" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/></g>`).join("") +
    [45, 135, 225, 315].map((a) => `<g transform="translate(${cx} ${cy}) rotate(${a})">` +
      `<path d="${leaf}" fill="url(#lf)" stroke="#C8FFD0" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<path d="M0 -10V-30" stroke="#0B5A22" stroke-width="2" stroke-linecap="round" stroke-opacity=".55"/>` +
      `<ellipse cx="-11" cy="-31" rx="6" ry="4" fill="#fff" fill-opacity=".45" transform="rotate(-30 -11 -31)"/></g>`).join("");
  const stem = "M62 60C66 78 74 92 86 104";
  return `<defs>${rad("lf", [[0, "#E4FFDA"], [0.45, "#4EE36A"], [1, "#0B7A2E"]], 0.5, 0.25, 0.85)}</defs>` +
    shadow(110, 28) +
    `<path d="${stem}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>` +
    `<path d="${stem}" fill="none" stroke="#2FBF55" stroke-width="6" stroke-linecap="round"/>` +
    leaves +
    `<circle cx="${cx}" cy="${cy}" r="5" fill="#9BF5A8" stroke="${INK}" stroke-width="2.5"/>` +
    glint(92, 22, 9);
}

function horseshoe(): string {
  const u = "M30 22V58A30 30 0 0 0 90 58V22";
  const nails = [[30, 32], [30, 50], [37, 74], [60, 87], [83, 74], [90, 50], [90, 32]];
  return `<defs>${lin("st", [[0, "#FFFFFF"], [0.35, "#D5DEEC"], [0.55, "#8C9AB6"], [0.58, "#6C7A96"], [1, "#C9D3E6"]])}${lin("gd", GOLD)}</defs>` +
    shadow(110, 32) +
    `<path d="${u}" fill="none" stroke="${INK}" stroke-width="31" stroke-linecap="square"/>` +
    `<path d="${u}" fill="none" stroke="url(#st)" stroke-width="22" stroke-linecap="square"/>` +
    `<path d="M24 22V58A36 36 0 0 0 42 89" fill="none" stroke="#fff" stroke-width="3" stroke-opacity=".7" stroke-linecap="round"/>` +
    `<path d="${u}" fill="none" stroke="#3C4660" stroke-width="2" stroke-opacity=".5" stroke-dasharray="3 9"/>` +
    nails.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.8" fill="url(#gd)" stroke="${INK}" stroke-width="1.8"/>`).join("") +
    `<rect x="17" y="9" width="26" height="9" rx="3" fill="url(#gd)" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="77" y="9" width="26" height="9" rx="3" fill="url(#gd)" stroke="${INK}" stroke-width="3"/>` +
    glint(98, 30, 9);
}

/** Neon-rimmed glossy suit: halo strokes → tube rim → gradient body (covers inner rim parts) → gloss. */
function suit(shapes: string[], c: { hi: string; mid: string; lo: string }): string {
  const each = (f: (d: string) => string) => shapes.map(f).join("");
  return `<defs>${lin("bd", [[0, c.hi], [0.45, c.mid], [1, c.lo]])}</defs>` +
    shadow(110, 26) +
    each((d) => `<path d="${d}" fill="none" stroke="${c.mid}" stroke-width="18" stroke-opacity=".16" stroke-linejoin="round"/>`) +
    each((d) => `<path d="${d}" fill="none" stroke="${c.mid}" stroke-width="10" stroke-opacity=".38" stroke-linejoin="round"/>`) +
    each((d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`) +
    each((d) => `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linejoin="round"/>`) +
    each((d) => `<path d="${d}" fill="url(#bd)"/>`) +
    `<ellipse cx="48" cy="40" rx="13" ry="7" fill="#fff" fill-opacity=".42" transform="rotate(-28 48 40)"/>`;
}

const SPADE = "M60 14C74 34 96 44 96 64C96 79 82 88 68 79C70 90 75 98 82 104H38C45 98 50 90 52 79C38 88 24 79 24 64C24 44 46 34 60 14Z";
const HEART = "M60 102C44 88 18 72 18 46C18 30 30 20 43 20C52 20 58 26 60 33C62 26 68 20 77 20C90 20 102 30 102 46C102 72 76 88 60 102Z";
const CLUB = [
  "M60 20a17 17 0 1 0 0.01 0Z",
  "M38 48a17 17 0 1 0 0.01 0Z",
  "M82 48a17 17 0 1 0 0.01 0Z",
  "M60 56C61 78 67 94 80 104H40C53 94 59 78 60 56Z",
];
const DIAMOND = "M60 12L96 58L60 104L24 58Z";

const BODY: Record<Sym, () => string> = {
  "7": seven,
  W: wild,
  B: bell,
  R: ruby,
  C: clover,
  H: horseshoe,
  s: () => suit([SPADE], { hi: "#D9FBFF", mid: "#29E6FF", lo: "#086A85" }),
  h: () => suit([HEART], { hi: "#FFD6EC", mid: "#FF3DA5", lo: "#8E0A50" }),
  c: () => suit(CLUB, { hi: "#DBFFE8", mid: "#3DFF8A", lo: "#0C7038" }),
  d: () => suit([DIAMOND], { hi: "#ECE2FF", mid: "#9B6BFF", lo: "#43189E" }),
};

/** Standalone SVG document for a symbol; `streak` bakes a vertical motion blur in. */
export function symbolSvg(sym: Sym, streak = false): string {
  const body = BODY[sym]();
  const inner = streak
    ? `<filter id="mb" x="-10%" y="-35%" width="120%" height="170%"><feGaussianBlur stdDeviation="0 7"/></filter><g filter="url(#mb)" opacity=".92">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${inner}</svg>`;
}

export const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** CSS class name of a symbol (`7` → `sym-7`, `s` → `sym-s` …). Neutral, stable names. */
export const symClass = (s: Sym): string => `sym-${s}`;

let css: string | null = null;
/** Background-image rules for every symbol (sharp) and its streak version under `.is-blur`. */
export function symbolCss(): string {
  if (css) return css;
  css = SYMBOLS.map((s) => `.slot .${symClass(s)}{background-image:${svgUrl(symbolSvg(s))}}` +
    `.slot .is-blur .${symClass(s)}{background-image:${svgUrl(symbolSvg(s, true))}}`).join("\n");
  return css;
}
