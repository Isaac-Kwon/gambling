/**
 * RUBY ROULETTE wheel, drawn in code (SVG, no images). Three stacked layers in one 200×200 box:
 *   base   – static: gold bezel with bulbs, the ball track, shadow
 *   rot    – the part that turns (CSS rotate on one element): 37 pockets in European order, cone, hub
 *   top    – static: the ball and the glass sheen
 * The turning layer is rasterised once and only rotated, so a frame costs one compositor transform plus the ball
 * (two attributes). Pocket `i` of WHEEL_ORDER is centred at i × STEP clockwise from the top in the rot layer.
 */
import { BLACK, RED, WHEEL_ORDER } from "../../../shared/rules/roulette";
import { linearGrad, radialGrad, s, svgRoot, uid, GOLD_STOPS } from "../../src/ui/svg";
import { POCKETS, STEP, TRACK_R } from "./wheel";

export const PALETTE = {
  red: "#D4123A",
  redDark: "#7E0620",
  black: "#1B1228",
  blackLight: "#3A2A52",
  green: "#10A04C",
  greenDark: "#06562A",
} as const;

const C = 100;
const pt = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const f = (n: number): string => n.toFixed(2);

/** Annular sector from angle a0 to a1 (clockwise), radii r0 < r1. */
function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}

export interface WheelArt {
  el: HTMLElement;
  /** Element rotated with CSS `rotate()`. */
  rot: HTMLElement;
  ball: SVGGElement;
  ballShadow: SVGCircleElement;
  /** Gold outline of the winning pocket, turns with the wheel. */
  hit: SVGGElement;
  /** Centre readout of the last number. */
  num: HTMLElement;
}

export function buildWheel(): WheelArt {
  const id = uid("rw");
  const gold = linearGrad(`${id}g`, GOLD_STOPS);
  const goldH = linearGrad(`${id}gh`, GOLD_STOPS, { x1: 0, y1: 0, x2: 1, y2: 1 });

  // ---------------------------------------------------------------- base (static)
  const bulbs: SVGElement[] = [];
  const NB = 24;
  for (let i = 0; i < NB; i++) {
    const [x, y] = pt(92.6, (i * 360) / NB);
    bulbs.push(s("circle", { cx: f(x), cy: f(y), r: 2.2, class: i % 2 ? "rr-bulb rr-bulb--b" : "rr-bulb rr-bulb--a" }));
  }
  const base = svgRoot("0 0 200 200", [
    s("defs", {}, [
      gold, goldH,
      radialGrad(`${id}t`, [[0.82, "#0D0618"], [0.9, "#2A1648"], [0.96, "#120824"], [1, "#05010B"]], { cx: 0.5, cy: 0.5, r: 0.5 }),
      radialGrad(`${id}sh`, [[0.8, "#000", 0.55], [1, "#000", 0]], { cx: 0.5, cy: 0.5, r: 0.5 }),
    ]),
    s("circle", { cx: C, cy: C + 3, r: 99, fill: `url(#${id}sh)` }),
    s("circle", { cx: C, cy: C, r: 98, fill: "#1A0805" }),
    s("circle", { cx: C, cy: C, r: 95.5, fill: "none", stroke: `url(#${id}g)`, "stroke-width": 7 }),
    s("circle", { cx: C, cy: C, r: 90.5, fill: "#240B3F", stroke: "#1A0805", "stroke-width": 1.4 }),
    ...bulbs,
    s("circle", { cx: C, cy: C, r: 87.5, fill: "none", stroke: `url(#${id}g)`, "stroke-width": 2.2 }),
    // ball track
    s("circle", { cx: C, cy: C, r: 85.5, fill: `url(#${id}t)` }),
    s("circle", { cx: C, cy: C, r: TRACK_R, fill: "none", stroke: "#FFFFFF", "stroke-opacity": 0.06, "stroke-width": 6 }),
    s("circle", { cx: C, cy: C, r: 85.4, fill: "none", stroke: "#000", "stroke-opacity": 0.55, "stroke-width": 1 }),
    // rim of the pocket ring
    s("circle", { cx: C, cy: C, r: 77.4, fill: "none", stroke: `url(#${id}g)`, "stroke-width": 1.6 }),
  ], { class: "rr-wheel__base" });

  // ---------------------------------------------------------------- rot (turning)
  const pockets: SVGElement[] = [];
  const labels: SVGElement[] = [];
  for (let i = 0; i < POCKETS; i++) {
    const n = WHEEL_ORDER[i];
    const col = n === 0 ? PALETTE.green : RED.has(n) ? PALETTE.red : BLACK.has(n) ? PALETTE.black : PALETTE.black;
    const a0 = (i - 0.5) * STEP, a1 = (i + 0.5) * STEP;
    pockets.push(s("path", { d: sector(50, 77, a0, a1), fill: col }));
    // a lighter inner floor so the ball sits on a visible pocket bottom
    pockets.push(s("path", { d: sector(53, 66, a0 + 0.35, a1 - 0.35), fill: n === 0 ? PALETTE.greenDark : RED.has(n) ? PALETTE.redDark : "#0B0614", "fill-opacity": 0.55 }));
    const [tx, ty] = pt(71.2, i * STEP);
    const t = s("text", {
      x: f(tx), y: f(ty), "text-anchor": "middle", "dominant-baseline": "central", class: "rr-pocket-num",
      transform: `rotate(${f(i * STEP)} ${f(tx)} ${f(ty)})`,
    });
    t.textContent = String(n);
    labels.push(t);
  }
  const seps: SVGElement[] = [];
  for (let i = 0; i < POCKETS; i++) {
    const a = (i + 0.5) * STEP;
    const [x0, y0] = pt(50, a), [x1, y1] = pt(77, a);
    seps.push(s("path", { d: `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`, stroke: "#F5C542", "stroke-width": 0.85, "stroke-linecap": "round" }));
  }
  const hit = s("g", { class: "rr-hit", transform: `rotate(0 ${C} ${C})` }, [
    s("path", { d: sector(50, 77, -0.5 * STEP, 0.5 * STEP), fill: "#FFE9A6", "fill-opacity": 0.28, stroke: "#FFF3C4", "stroke-width": 1.6, "stroke-linejoin": "round" }),
  ]);
  const spokes: SVGElement[] = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = pt(35, k * 90 + 45);
    spokes.push(s("path", { d: `M${C} ${C}L${f(x)} ${f(y)}`, stroke: `url(#${id}gh)`, "stroke-width": 4.2, "stroke-linecap": "round" }));
    spokes.push(s("circle", { cx: f(x), cy: f(y), r: 3.6, fill: `url(#${id}gh)`, stroke: "#3A1606", "stroke-width": 0.8 }));
  }
  const rotSvg = svgRoot("0 0 200 200", [
    s("defs", {}, [
      radialGrad(`${id}c`, [[0, "#7A3CFF"], [0.55, "#3A1A72"], [1, "#150A2C"]], { cx: 0.5, cy: 0.42, r: 0.6 }),
      radialGrad(`${id}hb`, [[0, "#FFFBE6"], [0.45, "#F5C542"], [1, "#8A5410"]], { cx: 0.38, cy: 0.32, r: 0.8 }),
    ]),
    ...pockets, ...seps, ...labels, hit,
    s("circle", { cx: C, cy: C, r: 50, fill: `url(#${id}c)`, stroke: `url(#${id}g)`, "stroke-width": 1.8 }),
    s("circle", { cx: C, cy: C, r: 41, fill: "none", stroke: "#F5C542", "stroke-opacity": 0.7, "stroke-width": 0.9, "stroke-dasharray": "2.2 3" }),
    s("circle", { cx: C, cy: C, r: 27, fill: "#1A0B33", "fill-opacity": 0.55, stroke: "#FF3DA5", "stroke-opacity": 0.55, "stroke-width": 0.9 }),
    ...spokes,
    s("circle", { cx: C, cy: C, r: 12, fill: `url(#${id}hb)`, stroke: "#3A1606", "stroke-width": 1.2 }),
    s("circle", { cx: C - 3, cy: C - 4, r: 4, fill: "#FFFFFF", "fill-opacity": 0.5 }),
  ], { class: "rr-wheel__rotsvg" });
  const rot = document.createElement("div");
  rot.className = "rr-wheel__rot";
  rot.appendChild(rotSvg);

  // ---------------------------------------------------------------- top (ball + sheen)
  const ballShadow = s("circle", { cx: C, cy: C, r: 3.3, fill: "#000", "fill-opacity": 0.45 });
  const ball = s("g", {}, [
    s("circle", { cx: 0, cy: 0, r: 3.5, fill: `url(#${id}b)`, stroke: "#8A7AA8", "stroke-width": 0.35 }),
    s("circle", { cx: -1.1, cy: -1.2, r: 1.1, fill: "#fff" }),
  ]);
  const top = svgRoot("0 0 200 200", [
    s("defs", {}, [radialGrad(`${id}b`, [[0, "#FFFFFF"], [0.55, "#E9E2F5"], [1, "#9C8FB8"]], { cx: 0.35, cy: 0.3, r: 0.8 })]),
    ballShadow, ball,
    s("path", { d: "M18 70A86 86 0 0 1 120 15", fill: "none", stroke: "#fff", "stroke-opacity": 0.22, "stroke-width": 4, "stroke-linecap": "round" }),
  ], { class: "rr-wheel__top" });

  const num = document.createElement("div");
  num.className = "rr-wheel__num";
  const el = document.createElement("div");
  el.className = "rr-wheel";
  el.append(base, rot, top, num);
  return { el, rot, ball, ballShadow, hit, num };
}
