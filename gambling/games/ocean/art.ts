/**
 * ABYSS LEGEND reel symbols, drawn in code (ARCHITECTURE §3): the slot's symbol IDs with a sea skin.
 * 7 golden pearl (top symbol), W treasure chest (WILD), B seahorse, R turtle, C octopus, H starfish,
 * s conch, h coral, c anchor, d water drop.
 *
 * Same technique as the slot: each symbol is a standalone SVG document (120×120) used as a CSS background
 * image (rasterised once per size at the device pixel ratio), plus a "streak" version with a vertical blur baked
 * in for fast-turning reels. Chunky sticker look: every part is drawn ink rim → colour → highlights.
 * The rules are scoped under `.ocean`, so they never touch the slot's skin.
 */
import type { Sym } from "../../../shared/rules/slot";
import { sparklePath, starPath } from "../../src/ui/svg";
import { symClass } from "../slot/art";

export const SYMBOLS: readonly Sym[] = ["7", "W", "B", "R", "C", "H", "s", "h", "c", "d"];

const INK = "#03101C";

type Stop = [number, string, number?];
const stops = (l: Stop[]) => l.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`).join("");
const lin = (id: string, l: Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(l)}</linearGradient>`;
const rad = (id: string, l: Stop[], cx = 0.5, cy = 0.5, r = 0.5) =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(l)}</radialGradient>`;

const GOLD: Stop[] = [[0, "#FFFBE6"], [0.25, "#FFE9A6"], [0.5, "#FFC83D"], [0.53, "#C98A1E"], [0.78, "#F0B93A"], [1, "#8A5410"]];
const glint = (x: number, y: number, r: number, op = 1) =>
  `<g opacity="${op}"><circle cx="${x}" cy="${y}" r="${r * 0.5}" fill="#fff" fill-opacity=".3"/><path d="${sparklePath(x, y, r)}" fill="#fff"/></g>`;
/** Filled path with ink rim → coloured rim → fill. */
const rimmed = (d: string, fill: string, rim: string, ink = 10, rw = 5) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${ink}" stroke-linejoin="round" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${rim}" stroke-width="${rw}" stroke-linejoin="round" stroke-linecap="round"/>` +
  `<path d="${d}" fill="${fill}"/>`;
/** Thick stroked limb: ink first (call for every limb), colour second. */
const inkLine = (d: string, w: number) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 7}" stroke-linecap="round" stroke-linejoin="round"/>`;
const colLine = (d: string, w: number, c: string) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const shadow = (cy = 109, rx = 32) => `<ellipse cx="60" cy="${cy}" rx="${rx}" ry="5" fill="#000" fill-opacity=".4"/>`;

// ------------------------------------------------------------------ 7 golden pearl in an open shell
function pearl(): string {
  const fan = "M12 70C10 34 34 12 60 12C86 12 110 34 108 70Z";
  const ribs = [-62, -40, -20, 0, 20, 40, 62].map((a) => {
    const r = (a * Math.PI) / 180, x = 60 + Math.sin(r) * 44, y = 70 - Math.cos(r) * 52;
    return `M60 70L${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join("");
  const cup = "M8 68C14 98 40 108 60 108C80 108 106 98 112 68C96 76 80 80 60 80C40 80 24 76 8 68Z";
  return `<defs>${rad("pg", [[0, "#FFFFFF"], [0.22, "#FFF6C8"], [0.55, "#FFC83D"], [0.82, "#D8891A"], [1, "#7A4204"]], 0.36, 0.32, 0.72)}` +
    `${lin("fn", [[0, "#FFD6CF"], [0.5, "#FF8E7E"], [1, "#C2403A"]])}${lin("cp", [[0, "#FF9A8B"], [1, "#9C2A2A"]])}` +
    `${rad("hl", [[0, "#FFF3B0", 0.95], [0.55, "#FFC83D", 0.35], [1, "#FFC83D", 0]])}</defs>` +
    shadow(111, 34) +
    rimmed(fan, "url(#fn)", "#FFE3DC", 10, 4) +
    `<path d="${ribs}" stroke="#8E2C26" stroke-width="2.4" stroke-opacity=".55" stroke-linecap="round"/>` +
    `<circle cx="60" cy="60" r="42" fill="url(#hl)"/>` +
    rimmed(cup, "url(#cp)", "#FFC2B8", 10, 4) +
    `<circle cx="60" cy="62" r="27" fill="none" stroke="${INK}" stroke-width="9"/>` +
    `<circle cx="60" cy="62" r="27" fill="url(#pg)" stroke="#FFF3C4" stroke-width="2.5"/>` +
    `<ellipse cx="51" cy="51" rx="10" ry="6.5" fill="#fff" fill-opacity=".85" transform="rotate(-30 51 51)"/>` +
    `<path d="M40 72C46 84 64 88 76 80" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>` +
    glint(86, 34, 12) + glint(30, 40, 7, 0.8);
}

// ------------------------------------------------------------------ W treasure chest (WILD)
function chest(): string {
  const lid = "M20 52L26 26C40 16 80 16 94 26L100 52Z";
  const box = "M18 52H102V96C102 100 99 102 95 102H25C21 102 18 100 18 96Z";
  const ribbon = "M8 72H112L106 84L112 96H8L14 84Z";
  const letters = "M27 77L32 92L37 82L42 92L47 77M54 77V92M61 77V92H71M78 77V92H83Q93 92 93 84.5Q93 77 83 77Z";
  return `<defs>${lin("wd", [[0, "#C47A3A"], [0.5, "#8A4A1A"], [1, "#4A220A"]])}${lin("gd", GOLD)}` +
    `${rad("gl", [[0, "#FFF3B0", 1], [0.5, "#FFC83D", 0.55], [1, "#19D3C5", 0]], 0.5, 0.6, 0.55)}` +
    `${lin("rb", [[0, "#7FFFF4"], [0.45, "#19D3C5"], [1, "#06566A"]])}</defs>` +
    shadow(110, 40) +
    `<circle cx="60" cy="46" r="44" fill="url(#gl)"/>` +
    rimmed(lid, "url(#wd)", "#E0A060", 10, 4) +
    `<path d="M24 40H96" stroke="url(#gd)" stroke-width="5"/>` +
    // coins spilling over the rim
    [[38, 50], [52, 46], [66, 47], [80, 51], [46, 54], [72, 55]].map(([x, y]) =>
      `<ellipse cx="${x}" cy="${y}" rx="9" ry="6" fill="url(#gd)" stroke="${INK}" stroke-width="2.5"/><path d="M${x - 4} ${y - 1}h8" stroke="#FFF8D8" stroke-width="1.6"/>`).join("") +
    rimmed(box, "url(#wd)", "#E0A060", 10, 4) +
    `<path d="M18 62H102M36 52V102M84 52V102" stroke="url(#gd)" stroke-width="6"/>` +
    `<rect x="52" y="56" width="16" height="16" rx="3" fill="url(#gd)" stroke="${INK}" stroke-width="3"/>` +
    `<circle cx="60" cy="63" r="2.6" fill="${INK}"/>` +
    rimmed(ribbon, "url(#rb)", "#CFFFFA", 8, 3) +
    `<path d="${letters}" fill="none" stroke="${INK}" stroke-width="8.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<path d="${letters}" fill="none" stroke="#FFF6D0" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    glint(98, 22, 11) + glint(26, 30, 7, 0.8);
}

// ------------------------------------------------------------------ B seahorse
function seahorse(): string {
  const body = "M70 40C86 50 86 70 70 84";
  const tail = "M70 84C62 94 60 104 70 106C80 108 84 98 76 94";
  const snout = "M54 30L34 32";
  const fin = "M82 52C96 54 98 66 86 72Z";
  const crown = "M58 16L62 6L66 15L72 8L72 19";
  const ink = inkLine(body, 24) + inkLine(tail, 11) + inkLine(snout, 9) +
    `<path d="${fin}" fill="${INK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="${crown}" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<ellipse cx="64" cy="30" rx="15" ry="13" fill="${INK}" stroke="${INK}" stroke-width="7"/>`;
  return `<defs>${lin("bd", [[0, "#FFE9A6"], [0.45, "#FFB33D"], [1, "#C2560E"]], 0, 0, 1, 1)}${lin("fn", [[0, "#7FFFF4"], [1, "#0E8C8F"]])}</defs>` +
    shadow(112, 26) + ink +
    `<path d="${fin}" fill="url(#fn)"/>` +
    `<path d="${crown}" fill="none" stroke="#FFC83D" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` +
    colLine(body, 24, "url(#bd)") + colLine(tail, 11, "#F59A2A") + colLine(snout, 9, "#FFB33D") +
    `<ellipse cx="64" cy="30" rx="15" ry="13" fill="url(#bd)"/>` +
    // belly ridges
    [48, 56, 64, 72, 80].map((y, i) => `<path d="M${62 - (i === 2 ? 2 : 0)} ${y}q8 3 16 0" fill="none" stroke="#B24A0A" stroke-width="2.2" stroke-opacity=".7" stroke-linecap="round"/>`).join("") +
    `<path d="M74 44C80 52 80 64 76 72" fill="none" stroke="#FFF3C4" stroke-width="3" stroke-opacity=".7" stroke-linecap="round"/>` +
    `<circle cx="67" cy="27" r="5" fill="#fff" stroke="${INK}" stroke-width="2"/><circle cx="68" cy="27" r="2.6" fill="${INK}"/>` +
    `<circle cx="69" cy="25.8" r="1" fill="#fff"/>` +
    glint(30, 60, 8, 0.85) + glint(96, 96, 6, 0.7);
}

// ------------------------------------------------------------------ R sea turtle (top view)
function turtle(): string {
  const flip = (x: number, y: number, a: number) => `<ellipse cx="${x}" cy="${y}" rx="17" ry="9" transform="rotate(${a} ${x} ${y})"`;
  const flippers = [flip(26, 42, -35), flip(94, 42, 35), flip(32, 88, 30), flip(88, 88, -30)];
  const hex = "M60 44L72 51V65L60 72L48 65V51Z";
  return `<defs>${rad("sh", [[0, "#B8FF9A"], [0.5, "#3FBF5A"], [1, "#0D5A2C"]], 0.42, 0.35, 0.7)}${lin("sk", [[0, "#9FF0D0"], [1, "#2E9A78"]])}</defs>` +
    shadow(111, 34) +
    flippers.map((f) => `${f} fill="${INK}" stroke="${INK}" stroke-width="7"/>`).join("") +
    `<circle cx="60" cy="18" r="11" fill="${INK}" stroke="${INK}" stroke-width="7"/>` +
    `<path d="M60 96L55 108L65 108Z" fill="${INK}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>` +
    flippers.map((f) => `${f} fill="url(#sk)"/>`).join("") +
    `<circle cx="60" cy="18" r="11" fill="url(#sk)"/>` +
    `<path d="M60 96L56 106L64 106Z" fill="#2E9A78"/>` +
    `<circle cx="55.5" cy="15" r="2.2" fill="${INK}"/><circle cx="64.5" cy="15" r="2.2" fill="${INK}"/>` +
    `<ellipse cx="60" cy="60" rx="32" ry="38" fill="none" stroke="${INK}" stroke-width="10"/>` +
    `<ellipse cx="60" cy="60" rx="32" ry="38" fill="url(#sh)" stroke="#D9FFC4" stroke-width="3"/>` +
    `<path d="${hex}M60 44V24M72 51L88 42M72 65L88 76M60 72V96M48 65L32 76M48 51L32 42" fill="none" stroke="#0B4A24" stroke-width="2.6" stroke-linejoin="round" stroke-opacity=".8"/>` +
    `<path d="${hex}" fill="#7DE07A" fill-opacity=".5"/>` +
    `<ellipse cx="48" cy="38" rx="11" ry="6" fill="#fff" fill-opacity=".45" transform="rotate(-35 48 38)"/>` +
    glint(96, 20, 9);
}

// ------------------------------------------------------------------ C octopus
function octopus(): string {
  const arms = [
    "M40 60C30 74 20 76 14 88C10 96 18 102 24 96",
    "M50 66C46 82 38 92 34 104",
    "M60 68C60 84 56 96 60 106",
    "M70 66C74 82 82 92 86 104",
    "M80 60C90 74 100 76 106 88C110 96 102 102 96 96",
  ];
  const head = "M60 10C84 10 96 28 94 46C92 62 80 70 60 70C40 70 28 62 26 46C24 28 36 10 60 10Z";
  return `<defs>${rad("hd", [[0, "#FFD3F0"], [0.45, "#E35BC3"], [1, "#6A1A7A"]], 0.4, 0.3, 0.75)}</defs>` +
    shadow(111, 34) +
    arms.map((d) => inkLine(d, 11)).join("") +
    `<path d="${head}" fill="${INK}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>` +
    arms.map((d) => colLine(d, 11, "#C844A8")).join("") +
    arms.map((d) => `<path d="${d}" fill="none" stroke="#FFC2EC" stroke-width="3" stroke-dasharray="1 6" stroke-linecap="round"/>`).join("") +
    `<path d="${head}" fill="url(#hd)"/>` +
    `<circle cx="47" cy="44" r="9" fill="#fff" stroke="${INK}" stroke-width="2.5"/><circle cx="73" cy="44" r="9" fill="#fff" stroke="${INK}" stroke-width="2.5"/>` +
    `<circle cx="49" cy="46" r="4.6" fill="${INK}"/><circle cx="71" cy="46" r="4.6" fill="${INK}"/>` +
    `<circle cx="50.5" cy="44" r="1.6" fill="#fff"/><circle cx="72.5" cy="44" r="1.6" fill="#fff"/>` +
    `<path d="M54 59Q60 63 66 59" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<ellipse cx="46" cy="24" rx="12" ry="6" fill="#fff" fill-opacity=".5" transform="rotate(-24 46 24)"/>` +
    glint(98, 22, 10);
}

// ------------------------------------------------------------------ H starfish
function starfish(): string {
  const star = starPath(60, 58, 50, 21);
  const dots = [[60, 22], [60, 34], [93, 47], [82, 51], [80, 92], [73, 80], [40, 92], [47, 80], [27, 47], [38, 51]];
  return `<defs>${rad("sf", [[0, "#FFF0B0"], [0.45, "#FF9A3D"], [1, "#C2380E"]], 0.45, 0.4, 0.65)}</defs>` +
    shadow(110, 34) +
    `<path d="${star}" fill="none" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>` +
    `<path d="${star}" fill="url(#sf)" stroke="#FFD08A" stroke-width="4" stroke-linejoin="round"/>` +
    dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#FFF3D0" stroke="#B2400E" stroke-width="1.2"/>`).join("") +
    `<circle cx="60" cy="58" r="7" fill="#FF6B5E" stroke="#8A1E10" stroke-width="2"/>` +
    `<path d="M52 30L56 46" stroke="#fff" stroke-opacity=".6" stroke-width="4" stroke-linecap="round"/>` +
    glint(96, 20, 10);
}

// ------------------------------------------------------------------ s conch
function conch(): string {
  const shell = "M26 100C14 82 20 50 46 30C62 18 84 12 100 14C104 34 98 60 82 80C68 96 46 108 26 100Z";
  const mouth = "M30 94C30 78 40 64 56 58C62 70 58 86 44 96Z";
  const bands = "M40 40C54 52 66 66 72 86M54 28C68 42 78 56 86 72M70 20C80 32 88 44 94 56";
  return `<defs>${lin("cs", [[0, "#FFF1DA"], [0.5, "#F4C08A"], [1, "#B8692A"]], 0, 0, 1, 1)}${rad("mo", [[0, "#FFE0EC"], [0.6, "#FF8FB0"], [1, "#C2406A"]], 0.6, 0.4, 0.7)}</defs>` +
    shadow(110, 32) +
    rimmed(shell, "url(#cs)", "#FFF6E8", 10, 4) +
    `<path d="${bands}" fill="none" stroke="#C2622A" stroke-width="5" stroke-linecap="round" stroke-opacity=".75"/>` +
    `<path d="M86 20L96 14L92 26M76 26L86 16" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${mouth}" fill="url(#mo)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M62 34C74 30 86 28 94 24" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3.5" stroke-linecap="round"/>` +
    glint(30, 30, 9, 0.9);
}

// ------------------------------------------------------------------ h coral
function coral(): string {
  const br = [
    "M60 104V62", "M60 84C44 76 38 62 38 44", "M60 74C78 66 84 52 82 34", "M40 58C30 52 26 42 26 30",
    "M82 48C94 44 98 34 98 24", "M60 64C60 48 62 32 62 18", "M38 46C44 38 46 30 46 22",
  ];
  const tips = [[38, 44], [82, 34], [26, 30], [98, 24], [62, 18], [46, 22]];
  return `<defs>${lin("rk", [[0, "#5B6A88"], [1, "#1E2840"]])}</defs>` +
    shadow(112, 34) +
    br.map((d) => inkLine(d, 11)).join("") +
    `<path d="M30 112C30 100 44 96 60 96C76 96 90 100 90 112Z" fill="url(#rk)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    br.map((d) => colLine(d, 11, "#D23A52")).join("") +
    br.map((d) => `<path d="${d}" fill="none" stroke="#FF7E72" stroke-width="7" stroke-linecap="round" transform="translate(-1.5 -1)"/>`).join("") +
    br.map((d) => `<path d="${d}" fill="none" stroke="#FFD6CF" stroke-width="2.4" stroke-linecap="round" stroke-opacity=".8" transform="translate(-3 -1)"/>`).join("") +
    tips.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#FFF0E8"/>`).join("") +
    `<circle cx="72" cy="88" r="3" fill="#7FFFF4"/><circle cx="48" cy="72" r="2.4" fill="#7FFFF4"/>` +
    glint(100, 60, 8, 0.8);
}

// ------------------------------------------------------------------ c anchor
function anchor(): string {
  const parts = "M60 30V100M38 42H82M22 72C26 94 46 102 60 102C74 102 94 94 98 72";
  const flukes = "M14 78L22 64L32 76ZM106 78L98 64L88 76Z";
  return `<defs>${lin("st", [[0, "#E8FFFF"], [0.45, "#7FD8E6"], [1, "#1A6A82"]], 0, 0, 1, 1)}</defs>` +
    shadow(111, 36) +
    `<circle cx="60" cy="19" r="10" fill="none" stroke="${INK}" stroke-width="15"/>` +
    `<path d="${parts}" fill="none" stroke="${INK}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${flukes}" fill="${INK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
    `<circle cx="60" cy="19" r="10" fill="none" stroke="#B8EEF6" stroke-width="7"/>` +
    `<path d="${parts}" fill="none" stroke="#8FDCEA" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${flukes}" fill="#8FDCEA"/>` +
    `<path d="M57 34V96M24 74C28 90 42 98 56 99" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M30 80C40 70 50 76 56 66C62 56 70 60 78 50" fill="none" stroke="#FFC83D" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="5 4"/>` +
    glint(94, 26, 9);
}

// ------------------------------------------------------------------ d water drop
function drop(): string {
  const d = "M60 10C72 34 94 52 94 76C94 96 79 108 60 108C41 108 26 96 26 76C26 52 48 34 60 10Z";
  return `<defs>${rad("dr", [[0, "#E8FFFF"], [0.35, "#6FE8FF"], [0.75, "#1A8CD8"], [1, "#0A3A8A"]], 0.4, 0.55, 0.7)}</defs>` +
    shadow(112, 28) +
    rimmed(d, "url(#dr)", "#D8FBFF", 10, 4) +
    `<path d="M44 58C40 70 42 84 52 92" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="6" stroke-linecap="round"/>` +
    `<circle cx="72" cy="86" r="7" fill="#fff" fill-opacity=".22" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>` +
    `<circle cx="80" cy="70" r="3.5" fill="#fff" fill-opacity=".6"/>` +
    glint(92, 26, 9, 0.9);
}

const BODY: Record<Sym, () => string> = {
  "7": pearl, W: chest, B: seahorse, R: turtle, C: octopus, H: starfish, s: conch, h: coral, c: anchor, d: drop,
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

export { symClass };

let css: string | null = null;
/** Background-image rules for every symbol (sharp) and its streak version, scoped to the ocean screen. */
export function symbolCss(): string {
  if (css) return css;
  css = SYMBOLS.map((s) => `.ocean .${symClass(s)}{background-image:${svgUrl(symbolSvg(s))}}` +
    `.ocean .is-blur .${symClass(s)}{background-image:${svgUrl(symbolSvg(s, true))}}`).join("\n");
  return css;
}
