/**
 * The omen (ARCHITECTURE §3): the cabinet screen darkens and a big creature passes. The creature is fixed by
 * the queued bonus (clam / shark / whale, by size); this module only draws it. Everything here is DOM + SVG with
 * transform/opacity animations (Web Animations API). The dim ramps in and out over 600 ms or more, so it is a
 * slow change, not a flash (§6.6).
 *
 * - clam: 30 % dim, a giant clam rises from the sea floor, opens and leaks pearl light (1.8 s)
 * - shark: 55 % dim, a silhouette darts across with a red eye glint (2.4 s)
 * - whale: 75 % dim, a silhouette larger than the screen glides by slowly (4 s)
 *
 * Inline SVG ids are prefixed (`om-`) so they never collide with other inline SVGs on the page.
 */
import type { Omen } from "../../../shared/rules/ocean";
import { OMEN_DIM } from "./core";

const INK = "#010A14";
const RAMP_MS = 600;

const svg = (vb: string, body: string, cls: string) =>
  `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`;

function whaleSvg(): string {
  const body = "M18 138C30 96 110 70 220 72C330 74 420 92 480 112C510 120 530 122 548 112L592 66C586 98 578 116 568 128C580 142 588 162 596 196L548 152C520 148 500 154 470 166C400 196 300 208 200 202C110 196 40 178 18 138Z";
  const fin = "M156 178C186 204 226 238 272 252C254 226 226 196 198 180Z";
  const pleats = [0, 1, 2, 3, 4, 5].map((i) => `M${34 + i * 4} ${150 + i * 6}C${90 + i * 6} ${172 + i * 5} ${160 + i * 4} ${186 + i * 3} ${226 - i * 4} ${194 + i}`).join("");
  const spots = [[140, 118, 2.6], [176, 110, 2], [214, 124, 3], [252, 112, 2.2], [290, 128, 2.8], [330, 116, 2], [366, 130, 2.6], [402, 122, 2], [440, 132, 2.4], [250, 146, 1.8], [320, 150, 2.2]];
  return svg("0 0 600 260",
    `<defs><linearGradient id="om-wb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E4466"/><stop offset=".45" stop-color="#052A44"/><stop offset="1" stop-color="#01101E"/></linearGradient>` +
    `<radialGradient id="om-we" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#CFFFFA"/><stop offset=".4" stop-color="#19D3C5" stop-opacity=".8"/><stop offset="1" stop-color="#19D3C5" stop-opacity="0"/></radialGradient></defs>` +
    `<path d="${body}" fill="none" stroke="#19D3C5" stroke-opacity=".16" stroke-width="16" stroke-linejoin="round"/>` +
    `<path d="${body}" fill="url(#om-wb)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${fin}" fill="#04243A" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M160 180C190 204 226 234 262 246" fill="none" stroke="#7FFFF4" stroke-opacity=".35" stroke-width="2.5"/>` +
    `<path d="${pleats}" fill="none" stroke="#7FFFF4" stroke-opacity=".22" stroke-width="2.2"/>` +
    `<path d="M24 132C40 100 120 76 220 76C320 78 410 94 476 114" fill="none" stroke="#9FFFF6" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>` +
    spots.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * 3}" fill="url(#om-we)" opacity=".55"/><circle cx="${x}" cy="${y}" r="${r}" fill="#B8FFF8"/>`).join("") +
    `<circle cx="92" cy="140" r="16" fill="url(#om-we)"/><circle cx="92" cy="140" r="5" fill="#E8FFFD"/>` +
    `<path d="M560 116L588 78M564 130L590 184" stroke="#7FFFF4" stroke-opacity=".3" stroke-width="2" stroke-linecap="round"/>`,
    "om-whale");
}

function sharkSvg(): string {
  const body = "M410 94C390 76 340 62 280 60L240 58L222 6C214 30 200 50 186 60C140 64 100 70 64 80L12 20C24 60 30 82 36 96L8 152C44 122 70 110 96 108C140 112 180 118 220 120L238 162C250 142 260 128 280 122C340 118 390 108 410 94Z";
  const gills = [0, 1, 2, 3].map((i) => `M${300 - i * 9} ${74 + i}C${296 - i * 9} ${88} ${296 - i * 9} ${100} ${302 - i * 9} ${110 - i}`).join("");
  return svg("0 0 420 170",
    `<defs><linearGradient id="om-sb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A4458"/><stop offset=".5" stop-color="#122434"/><stop offset="1" stop-color="#050C14"/></linearGradient>` +
    `<radialGradient id="om-se" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFE0DA"/><stop offset=".35" stop-color="#FF2D55" stop-opacity=".9"/><stop offset="1" stop-color="#FF2D55" stop-opacity="0"/></radialGradient></defs>` +
    `<path d="${body}" fill="none" stroke="#FF6B5E" stroke-opacity=".18" stroke-width="12" stroke-linejoin="round"/>` +
    `<path d="${body}" fill="url(#om-sb)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M404 92C384 78 336 66 280 64L242 62M222 12C216 32 204 50 190 60" fill="none" stroke="#9FD8F0" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="${gills}" fill="none" stroke="#050C14" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M370 106C382 112 396 108 406 98" fill="none" stroke="#050C14" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M372 107l4 5l4-4l4 5l4-5l4 4" fill="none" stroke="#E8F4FF" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="360" cy="82" r="14" fill="url(#om-se)"/><circle cx="360" cy="82" r="3.6" fill="#FFF0EC"/>`,
    "om-shark");
}

function clamSvg(): string {
  // scalloped edge between x 24..336 at y 168 (lid bottom / shell top)
  const n = 9, x0 = 24, x1 = 336, w = (x1 - x0) / n;
  let edgeUp = `M${x0} 168`, edgeDn = `M${x0} 168`;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w, m = a + w / 2, b = a + w;
    edgeUp += `Q${m.toFixed(1)} 150 ${b.toFixed(1)} 168`;
    edgeDn += `Q${m.toFixed(1)} 186 ${b.toFixed(1)} 168`;
  }
  const shell = `${edgeDn}C340 214 280 252 180 252C80 252 20 214 24 168Z`;
  const lid = `${edgeUp}C340 112 280 60 180 60C80 60 20 112 24 168Z`;
  const ribs = (y0: number, y1: number) => [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => `M${180 + k * 10} ${y0}L${180 + k * 36} ${y1}`).join("");
  const rays = [-60, -38, -18, 0, 18, 38, 60].map((a) => {
    const r = (a * Math.PI) / 180, L = 220, s = 0.09;
    const p = (ang: number) => `${(180 + Math.sin(ang) * L).toFixed(1)} ${(166 - Math.cos(ang) * L).toFixed(1)}`;
    return `M180 166L${p(r - s)}L${p(r + s)}Z`;
  }).join("");
  return svg("0 -60 360 320",
    `<defs><linearGradient id="om-cs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFB0C8"/><stop offset=".5" stop-color="#C2408A"/><stop offset="1" stop-color="#4A0E44"/></linearGradient>` +
    `<linearGradient id="om-cl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7A2A8A"/><stop offset=".6" stop-color="#E07AB8"/><stop offset="1" stop-color="#FFD0E4"/></linearGradient>` +
    `<radialGradient id="om-cp" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#FFF6C8"/><stop offset=".7" stop-color="#FFC83D"/><stop offset="1" stop-color="#B8741A"/></radialGradient>` +
    `<radialGradient id="om-cg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF6C8" stop-opacity=".95"/><stop offset=".45" stop-color="#FFC83D" stop-opacity=".45"/><stop offset="1" stop-color="#FFC83D" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="om-cr" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFF3B0" stop-opacity=".85"/><stop offset="1" stop-color="#FFF3B0" stop-opacity="0"/></linearGradient></defs>` +
    `<g class="om-clam__rays"><path d="${rays}" fill="url(#om-cr)"/></g>` +
    `<ellipse class="om-clam__glow" cx="180" cy="160" rx="150" ry="110" fill="url(#om-cg)"/>` +
    `<ellipse cx="180" cy="172" rx="148" ry="40" fill="#2A0626"/>` +
    `<ellipse cx="180" cy="176" rx="132" ry="30" fill="#8A2A70"/>` +
    `<circle cx="180" cy="158" r="30" fill="none" stroke="${INK}" stroke-width="7"/>` +
    `<circle cx="180" cy="158" r="30" fill="url(#om-cp)" stroke="#FFF3C4" stroke-width="2.5"/>` +
    `<ellipse cx="170" cy="146" rx="10" ry="6" fill="#fff" fill-opacity=".85" transform="rotate(-30 170 146)"/>` +
    `<path d="${shell}" fill="url(#om-cs)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="${ribs(250, 178)}" stroke="#4A0E44" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M40 190C60 226 120 244 180 244" fill="none" stroke="#FFD0E4" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>` +
    `<g class="om-clam__lid"><path d="${lid}" fill="url(#om-cl)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
    `<path d="${ribs(64, 160)}" stroke="#3A0A40" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M50 140C70 96 120 70 180 68" fill="none" stroke="#FFD0E4" stroke-opacity=".55" stroke-width="3.5" stroke-linecap="round"/></g>`,
    "om-clam");
}

const ART: Record<Omen, () => string> = { whale: whaleSvg, shark: sharkSvg, clam: clamSvg };
const cache: Partial<Record<Omen, string>> = {};

export interface OmenLayer {
  readonly el: HTMLElement;
  /** Starts the crossing of `kind`, lasting `ms` (dim included). Replaces a running one. */
  play(kind: Omen, ms: number): void;
  /** Ends whatever is running (fade). */
  clear(): void;
  destroy(): void;
}

type Anim = Animation | null;
const anim = (el: Element, k: Keyframe[], o: KeyframeAnimationOptions): Anim =>
  typeof (el as HTMLElement).animate === "function" ? (el as HTMLElement).animate(k, o) : null;

/** Omen layer over the cabinet screen: a dim veil and a creature lane above it. */
export function createOmenLayer(): OmenLayer {
  const el = document.createElement("div");
  el.className = "ocean-omen";
  el.setAttribute("aria-hidden", "true");
  const dim = document.createElement("div");
  dim.className = "ocean-omen__dim";
  const lane = document.createElement("div");
  lane.className = "ocean-omen__lane";
  el.append(dim, lane);
  let anims: Animation[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const keep = (a: Anim): void => { if (a) anims.push(a); };
  const reset = (): void => {
    for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } }
    anims = [];
    if (timer !== null) { clearTimeout(timer); timer = null; }
    lane.replaceChildren();
    el.className = "ocean-omen";
    dim.style.opacity = "0";
  };

  const play = (kind: Omen, ms: number): void => {
    reset();
    const total = Math.max(ms, 2 * RAMP_MS);
    el.className = `ocean-omen is-on is-${kind}`;
    const depth = OMEN_DIM[kind];
    const edge = RAMP_MS / total;
    keep(anim(dim, [{ opacity: 0 }, { opacity: depth, offset: edge }, { opacity: depth, offset: 1 - edge }, { opacity: 0 }],
      { duration: total, easing: "linear", fill: "forwards" }));

    const art = document.createElement("div");
    art.className = `ocean-omen__art ocean-omen__art--${kind}`;
    art.innerHTML = cache[kind] ??= ART[kind]();
    lane.appendChild(art);
    const W = el.clientWidth || 320;

    if (kind === "whale") {
      // larger than the screen, right to left, slow, a gentle rise and fall
      const aw = W * 1.75;
      art.style.width = `${aw}px`;
      const x = (p: number) => (W + (-aw - W) * p).toFixed(1);
      const y = (p: number) => (6 * Math.cos(p * Math.PI * 1.6)).toFixed(2);
      const r = (p: number) => (1.5 * Math.cos(p * Math.PI * 1.6 + 0.6)).toFixed(2);
      keep(anim(art, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((p) => ({
        offset: p,
        transform: `translate3d(${x(p)}px, ${y(p)}%, 0) rotate(${r(p)}deg)`,
        // the silhouette fades in and out at the screen edges
        opacity: p === 0 || p === 1 ? 0 : 1,
      })), { duration: total, easing: "linear", fill: "forwards" }));
    } else if (kind === "shark") {
      const aw = W * 1.05;
      art.style.width = `${aw}px`;
      keep(anim(art, [
        { transform: `translate3d(${-aw}px, 10%, 0) rotate(-3deg)` },
        { transform: `translate3d(${-aw * 0.75}px, 4%, 0) rotate(-1deg)`, offset: 0.3 },
        { transform: `translate3d(${W * 0.15}px, -6%, 0) rotate(2deg)`, offset: 0.62, easing: "cubic-bezier(.2,.7,.4,1)" },
        { transform: `translate3d(${W + 10}px, -2%, 0) rotate(0deg)` },
      ], { duration: total * 0.86, delay: total * 0.08, easing: "cubic-bezier(.6,0,.4,1)", fill: "both" }));
    } else {
      // rises from the floor, the lid opens and the pearl light leaks, then it sinks back
      art.style.width = `${Math.min(W * 0.78, 300)}px`;
      keep(anim(art, [
        { transform: "translate3d(-50%, 70%, 0)" },
        { transform: "translate3d(-50%, 0, 0)", offset: 0.28, easing: "cubic-bezier(.2,.8,.3,1)" },
        { transform: "translate3d(-50%, 0, 0)", offset: 0.8 },
        { transform: "translate3d(-50%, 80%, 0)" },
      ], { duration: total, easing: "ease-in", fill: "both" }));
      const lid = art.querySelector(".om-clam__lid");
      const glow = art.querySelectorAll(".om-clam__glow, .om-clam__rays");
      if (lid) keep(anim(lid, [
        { transform: "translateY(0) scaleY(1)" },
        { transform: "translateY(0) scaleY(1)", offset: 0.3 },
        { transform: "translateY(-30px) scaleY(.72)", offset: 0.55, easing: "cubic-bezier(.3,1.5,.6,1)" },
        { transform: "translateY(-30px) scaleY(.72)", offset: 0.78 },
        { transform: "translateY(0) scaleY(1)", offset: 0.9 },
      ], { duration: total, fill: "both" }));
      for (const g of glow) keep(anim(g, [
        { opacity: 0, transform: "scale(.6)" },
        { opacity: 0, transform: "scale(.6)", offset: 0.34 },
        { opacity: 1, transform: "scale(1)", offset: 0.6 },
        { opacity: 1, transform: "scale(1.06)", offset: 0.76 },
        { opacity: 0, transform: "scale(.8)", offset: 0.9 },
      ], { duration: total, easing: "ease-in-out", fill: "both" }));
    }
    timer = setTimeout(() => { timer = null; reset(); }, total + 80);
  };

  return {
    el,
    play,
    clear() {
      if (!el.classList.contains("is-on")) return;
      // a slow fade (≥ 600 ms), never a cut to bright
      for (const a of anims) { try { a.pause(); } catch { /* ignore */ } }
      const cur = Number(getComputedStyle(dim).opacity) || 0;
      for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } }
      anims = [];
      lane.replaceChildren();
      if (timer !== null) clearTimeout(timer);
      dim.style.opacity = "0";
      keep(anim(dim, [{ opacity: cur }, { opacity: 0 }], { duration: RAMP_MS, easing: "linear" }));
      timer = setTimeout(() => { timer = null; reset(); }, RAMP_MS + 40);
    },
    destroy() { reset(); el.remove(); },
  };
}
