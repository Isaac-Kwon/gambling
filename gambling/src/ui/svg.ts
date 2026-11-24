// Code-drawn art helpers: SVG element factory, gradients, layered neon strokes, sparkles, stars,
// and the OROBELLE bell emblem (same geometry as public/icons/icon.svg).
// No SVG filters: glows are stacked strokes with decreasing opacity (cheap, and renders the same
// in every engine and in PNG rasterisers).

export const SVG_NS = 'http://www.w3.org/2000/svg';

export type Attrs = Record<string, string | number | undefined>;
type Child = SVGElement | null | undefined | false;

/** Create an SVG element with attributes (undefined values are skipped) and children. */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Child[] = []): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.appendChild(c);
  return el;
}

/** Root <svg> with viewBox; decorative by default (aria-hidden). */
export function svgRoot(viewBox: string, children: Child[] = [], attrs: Attrs = {}): SVGSVGElement {
  return s('svg', { viewBox, 'aria-hidden': 'true', focusable: 'false', ...attrs }, children);
}

let seq = 0;
/** Document-unique id for gradient defs (several copies of the same art can share a page). */
export function uid(prefix = 'u'): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}`;
}

export type Stop = [offset: number, color: string, opacity?: number];

function stops(list: Stop[]): SVGStopElement[] {
  return list.map(([o, c, a]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }));
}

/** Vertical by default (top -> bottom). Coordinates are objectBoundingBox fractions. */
export function linearGrad(id: string, list: Stop[], dir: { x1?: number; y1?: number; x2?: number; y2?: number } = {}): SVGLinearGradientElement {
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = dir;
  return s('linearGradient', { id, x1, y1, x2, y2 }, stops(list));
}

export function radialGrad(id: string, list: Stop[], at: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {}): SVGRadialGradientElement {
  const { cx = 0.5, cy = 0.5, r = 0.5, fx, fy } = at;
  return s('radialGradient', { id, cx, cy, r, fx, fy }, stops(list));
}

/** Polished gold with a hard "horizon" band for a metallic read. */
export const GOLD_STOPS: Stop[] = [
  [0, '#FFF8DC'],
  [0.22, '#FFE9A6'],
  [0.48, '#F5C542'],
  [0.5, '#C98A1E'],
  [0.72, '#F0B93A'],
  [1, '#B8791A'],
];
export const CRIMSON_STOPS: Stop[] = [
  [0, '#FF8AA3'],
  [0.35, '#FF2D55'],
  [1, '#9E0A26'],
];

/**
 * Neon tube: the same path drawn 4 times (wide faint halo -> mid glow -> tube -> white-hot core).
 * `w` is the tube width in user units.
 */
export function neonStroke(d: string, color: string, w = 4, extra: Attrs = {}): SVGGElement {
  const base = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...extra };
  return s('g', { class: 'ui-neon-stroke' }, [
    s('path', { ...base, stroke: color, 'stroke-width': w * 4.5, 'stroke-opacity': 0.12 }),
    s('path', { ...base, stroke: color, 'stroke-width': w * 2.4, 'stroke-opacity': 0.28 }),
    s('path', { ...base, stroke: color, 'stroke-width': w }),
    s('path', { ...base, stroke: '#FFFFFF', 'stroke-width': Math.max(0.6, w * 0.35), 'stroke-opacity': 0.85 }),
  ]);
}

/** Circle path data (for neonStroke). */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/** n-point star path centred on (cx, cy), first point straight up. */
export function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += `${i === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + 'Z';
}

/** Four-point glint path (concave diamond) centred on (cx, cy). */
export function sparklePath(cx: number, cy: number, r: number): string {
  const k = r * 0.18;
  return (
    `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}` +
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}` +
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`
  );
}

/** A glint with a soft halo dot behind it. */
export function sparkle(cx: number, cy: number, r: number, color = '#FFFFFF'): SVGGElement {
  return s('g', { class: 'ui-sparkle' }, [
    s('circle', { cx, cy, r: r * 0.55, fill: color, 'fill-opacity': 0.25 }),
    s('path', { d: sparklePath(cx, cy, r), fill: color }),
  ]);
}

// ---- Bell emblem (512 user units, same as public/icons/icon.svg) ----

export const BELL = {
  body: 'M256 126C190 126 154 176 150 248L144 314C141 340 124 356 100 366H412C388 356 371 340 368 314L362 248C358 176 322 126 256 126Z',
  shine: 'M188 182C172 204 166 232 164 262L160 312C170 300 176 284 178 262L182 226C184 208 186 194 188 182Z',
  lip: { x: 88, y: 360, w: 336, h: 34, r: 17 },
  loop: { cx: 256, cy: 104, r: 24 },
  clapper: { cx: 256, cy: 418, r: 24 },
  star: starPath(256, 268, 66, 28),
} as const;

/**
 * Gold bell with a crimson star (transparent background).
 * `ring` adds the magenta neon ring used by the app icon.
 */
export function bellEmblem(o: { ring?: boolean; className?: string } = {}): SVGSVGElement {
  const g = uid('bell');
  const gold = `${g}g`, crim = `${g}c`, lipG = `${g}l`;
  const ink = '#3A1606';
  const outline = { stroke: ink, 'stroke-width': 10, 'stroke-linejoin': 'round' };
  const { lip, loop, clapper } = BELL;
  return svgRoot('0 0 512 512', [
    s('defs', {}, [
      linearGrad(gold, GOLD_STOPS),
      linearGrad(crim, CRIMSON_STOPS),
      linearGrad(lipG, [[0, '#FFE9A6'], [0.5, '#F5C542'], [0.52, '#B8791A'], [1, '#F0B93A']]),
    ]),
    o.ring ? neonStroke(circlePath(256, 262, 214), '#FF3DA5', 9) : null,
    s('circle', { cx: loop.cx, cy: loop.cy, r: loop.r, fill: 'none', stroke: ink, 'stroke-width': 22 }),
    s('circle', { cx: loop.cx, cy: loop.cy, r: loop.r, fill: 'none', stroke: `url(#${gold})`, 'stroke-width': 11 }),
    s('circle', { cx: clapper.cx, cy: clapper.cy, r: clapper.r, fill: `url(#${gold})`, ...outline }),
    s('path', { d: BELL.body, fill: `url(#${gold})`, ...outline }),
    s('path', { d: BELL.shine, fill: '#FFFFFF', 'fill-opacity': 0.55 }),
    s('rect', { x: lip.x, y: lip.y, width: lip.w, height: lip.h, rx: lip.r, fill: `url(#${lipG})`, ...outline }),
    s('path', { d: BELL.star, fill: `url(#${crim})`, ...outline, 'stroke-width': 8 }),
    s('path', { d: starPath(250, 256, 30, 12), fill: '#FFFFFF', 'fill-opacity': 0.35 }),
    sparkle(352, 168, 26),
    sparkle(150, 392, 14, '#29E6FF'),
  ], { class: o.className ?? 'ui-emblem' });
}
