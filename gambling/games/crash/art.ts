/**
 * SKYROCKET art, drawn in code: the night sky (stars, moon glow, city skyline), the rocket and the crash puff.
 * The sky (stars, skyline) is made of standalone SVG documents shown as background images; the rocket and
 * the puff are SVG strings used with innerHTML on elements the view owns. Positions come from a tiny seeded
 * generator, so the sky is the same on every visit and never calls Math.random.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** CSS `url()` of a standalone SVG document. */
export const svgUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Twinkle groups: each is its own image layer whose opacity loops on the compositor (see `.cr-stars__l--t`). */
export const TWINKLE_GROUPS = 3;

/**
 * Stars: three depths, viewBox 0 0 400 600. Standalone SVG documents used as background images (an inline
 * SVG in the stage was laid out again on every flight frame, and per-star opacity loops on SVG circles
 * re-styled and repainted the whole sky each frame). `base` holds the still stars; `tw[g]` the stars of
 * twinkle group g, whose layer fades .25 ↔ 1 (>= 1 s, ease-in-out). Positions come from the same seeded
 * generator as before, so the sky is unchanged.
 */
export function starsSvgs(): { base: string; tw: string[] } {
  const r = lcg(20261125);
  const base: string[] = [];
  const tw: string[][] = Array.from({ length: TWINKLE_GROUPS }, () => []);
  for (let i = 0; i < 70; i++) {
    const x = (r() * 400).toFixed(1), y = (r() * 470).toFixed(1);
    const big = r() < 0.18;
    const rad = big ? 1.5 + r() * 0.9 : 0.6 + r() * 0.7;
    const isTw = r() < 0.4;
    const col = r() < 0.3 ? "#9FF3FF" : r() < 0.5 ? "#FFB3E1" : "#FFFFFF";
    const dly = r() * 4;
    r();   // former per-star opacity draw: the stylesheet always overrode it with .8, kept so later draws stay put
    const into = isTw ? tw[Math.floor((dly / 4) * TWINKLE_GROUPS) % TWINKLE_GROUPS] : base;
    into.push(`<circle cx="${x}" cy="${y}" r="${rad.toFixed(2)}" fill="${col}" fill-opacity=".8"/>`);
    if (big) base.push(`<path d="M${x} ${(+y - rad * 3.2).toFixed(1)}L${(+x + rad * 0.55).toFixed(1)} ${y}L${x} ${(+y + rad * 3.2).toFixed(1)}L${(+x - rad * 0.55).toFixed(1)} ${y}Z" fill="#fff" fill-opacity=".55"/>`);
  }
  const doc = (body: string[]) =>
    `<svg xmlns="${SVG_NS}" width="400" height="600" viewBox="0 0 400 600" preserveAspectRatio="xMidYMin slice">${body.join("")}</svg>`;
  return { base: doc(base), tw: tw.map(doc) };
}

/** City skyline silhouette with lit windows and neon roof signs. viewBox 0 0 400 120, sits at the bottom edge. Standalone document (background image). */
export function skylineSvg(): string {
  const r = lcg(777);
  const bld: string[] = [];
  const win: string[] = [];
  let x = -6;
  while (x < 410) {
    const w = 22 + Math.floor(r() * 30);
    const h = 28 + Math.floor(r() * 66);
    const y = 120 - h;
    bld.push(`<rect x="${x}" y="${y}" width="${w}" height="${h + 2}" rx="1.5"/>`);
    if (r() < 0.35) bld.push(`<rect x="${x + w / 2 - 1}" y="${y - 12}" width="2" height="12"/>`);
    for (let wy = y + 6; wy < 114; wy += 8) {
      for (let wx = x + 5; wx < x + w - 5; wx += 7) {
        const q = r();
        if (q < 0.22) win.push(`<rect x="${wx}" y="${wy}" width="3" height="4" fill="${q < 0.08 ? "#FF3DA5" : q < 0.15 ? "#29E6FF" : "#FFD84A"}" fill-opacity="${(0.55 + r() * 0.4).toFixed(2)}"/>`);
      }
    }
    x += w + 2 + Math.floor(r() * 5);
  }
  return `<svg xmlns="${SVG_NS}" width="400" height="120" viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice">` +
    `<defs><linearGradient id="skl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A1450"/><stop offset="1" stop-color="#0B0612"/></linearGradient></defs>` +
    `<g fill="url(#skl)">${bld.join("")}</g><g>${win.join("")}</g></svg>`;
}

/** The rocket, nose to the right (viewBox 0 0 96 48). The flame is a separate group so CSS can flicker it. */
export function rocketSvg(): string {
  return `<svg viewBox="0 0 96 48" aria-hidden="true" focusable="false">` +
    `<defs>` +
    `<linearGradient id="rkB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#E9E4F2"/><stop offset="1" stop-color="#9C8FBF"/></linearGradient>` +
    `<linearGradient id="rkN" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8AA3"/><stop offset=".5" stop-color="#E0183C"/><stop offset="1" stop-color="#8E0721"/></linearGradient>` +
    `<radialGradient id="rkW" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#C9F8FF"/><stop offset=".55" stop-color="#29E6FF"/><stop offset="1" stop-color="#0A5BB5"/></radialGradient>` +
    `<linearGradient id="rkF" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#FFF7C0"/><stop offset=".4" stop-color="#FFB020"/><stop offset="1" stop-color="#FF2D55" stop-opacity="0"/></linearGradient>` +
    `</defs>` +
    `<g class="rk-flame"><path d="M28 24C20 18 10 20 0 24C10 28 20 30 28 24Z" fill="url(#rkF)"/><path d="M28 24C22 21.5 15 22.5 8 24C15 25.5 22 26.5 28 24Z" fill="#FFFBE6" fill-opacity=".9"/></g>` +
    `<path d="M30 10L18 2L16 8L30 18Z" fill="url(#rkN)" stroke="#3A0612" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M30 38L18 46L16 40L30 30Z" fill="url(#rkN)" stroke="#3A0612" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M28 14C28 14 52 6 80 24C52 42 28 34 28 34C24 34 24 14 28 14Z" fill="url(#rkB)" stroke="#3A0612" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M62 12.4C70 14.6 76.6 19 80 24C76.6 29 70 33.4 62 35.6C65.6 29 65.6 19 62 12.4Z" fill="url(#rkN)" stroke="#3A0612" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M40 14.6C46 13 53 13 58 14.4" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="48" cy="24" r="6.4" fill="url(#rkW)" stroke="#3A0612" stroke-width="2"/>` +
    `<path d="M44.6 21.6C46 20 48 19.6 49.6 20.4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".9"/>` +
    `<rect x="31.5" y="17" width="3.4" height="14" rx="1.2" fill="#F5C542" stroke="#3A0612" stroke-width="1"/>` +
    `</svg>`;
}

/** Crash puff: a ring, a hot core and a few shards (one-shot CSS animation). viewBox 0 0 100 100. */
export function puffSvg(): string {
  const shards: string[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const x1 = 50 + Math.cos(a) * 16, y1 = 50 + Math.sin(a) * 16;
    const x2 = 50 + Math.cos(a) * (36 + (i % 3) * 7), y2 = 50 + Math.sin(a) * (36 + (i % 3) * 7);
    shards.push(`<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${i % 2 ? "#FF3DA5" : "#FFB020"}" stroke-width="3.2" stroke-linecap="round"/>`);
  }
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
    `<circle cx="50" cy="50" r="30" fill="none" stroke="#FF2D55" stroke-opacity=".6" stroke-width="5"/>` +
    `<circle cx="50" cy="50" r="14" fill="#FFB020" fill-opacity=".85"/><circle cx="50" cy="50" r="7" fill="#FFF7C0"/>` +
    `${shards.join("")}</svg>`;
}
