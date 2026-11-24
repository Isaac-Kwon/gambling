/**
 * The decoration layer's only texture: one Canvas 2D atlas baked once after the gate tap (ARCHITECTURE §4.2).
 * Coin spin (8 frames), confetti (4 white shapes, tinted per particle), spark, bubble, ticket shard,
 * two pre-blurred glow discs and a ray wedge. Everything is drawn here in code; no image assets.
 * Imported only by `gl/stage.ts`.
 */

export interface AtlasRect { x: number; y: number; w: number; h: number }
export interface Atlas {
  canvas: HTMLCanvasElement;
  coin: AtlasRect[];
  confetti: AtlasRect[];
  spark: AtlasRect;
  bubble: AtlasRect;
  ticket: AtlasRect;
  glow: AtlasRect;
  glowTight: AtlasRect;
  ray: AtlasRect;
}

export const ATLAS_W = 1024;
export const ATLAS_H = 512;
const COIN = 72, CONF = 40, SPARK = 40, BUBBLE = 56;

type C2D = CanvasRenderingContext2D;

function star(ctx: C2D, cx: number, cy: number, r1: number, r2: number, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** Coin seen at spin angle `a` (0 = face on). Width follows |cos a|; the rim shows as the coin turns. */
function drawCoin(ctx: C2D, r: AtlasRect, a: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = 31;
  const c = Math.cos(a), sx = Math.max(0.07, Math.abs(c));
  const back = c < 0;
  const thick = 5 * Math.sin(Math.abs(a) % Math.PI);
  ctx.save();
  // Rim (edge thickness), offset to the side the coin turns toward.
  if (thick > 0.4) {
    ctx.save();
    ctx.translate(cx + (back ? -1 : 1) * thick * 0.5, cy);
    ctx.scale(sx, 1);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = "#8a5410"; ctx.fill();
    ctx.restore();
  }
  ctx.translate(cx - (back ? -1 : 1) * thick * 0.5, cy);
  ctx.scale(sx, 1);
  // Body
  let g = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R);
  g.addColorStop(0, back ? "#FFE3A0" : "#FFF6CF");
  g.addColorStop(0.45, back ? "#E2AE36" : "#F5C542");
  g.addColorStop(1, back ? "#9A6212" : "#B8791A");
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = "#7A4A0A"; ctx.stroke();
  // Raised inner ring
  ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2);
  ctx.lineWidth = 2.2; ctx.strokeStyle = "rgba(122,74,10,.75)"; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0.8, R * 0.78, Math.PI * 1.05, Math.PI * 1.95);
  ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(255,246,207,.8)"; ctx.stroke();
  // Emboss: star on the face, bell-ish ring on the back.
  if (!back) {
    star(ctx, 1, 2, R * 0.5, R * 0.22); ctx.fillStyle = "rgba(122,74,10,.55)"; ctx.fill();
    star(ctx, 0, 0, R * 0.5, R * 0.22);
    g = ctx.createLinearGradient(0, -R * 0.5, 0, R * 0.5);
    g.addColorStop(0, "#FFF6CF"); g.addColorStop(1, "#E2A52A");
    ctx.fillStyle = g; ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(122,74,10,.6)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.14, 0, Math.PI * 2); ctx.fillStyle = "rgba(122,74,10,.6)"; ctx.fill();
  }
  // Specular glint
  ctx.globalCompositeOperation = "lighter";
  g = ctx.createRadialGradient(-R * 0.38, -R * 0.42, 0, -R * 0.38, -R * 0.42, R * 0.55);
  g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawConfetti(ctx: C2D, r: AtlasRect, i: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  const g = ctx.createLinearGradient(-14, -14, 14, 14);
  g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#cfcfcf");
  ctx.fillStyle = g;
  ctx.beginPath();
  if (i === 0) {
    ctx.roundRect(-13, -6, 26, 12, 2);
  } else if (i === 1) {
    // Curled ribbon
    ctx.moveTo(-15, -3);
    ctx.bezierCurveTo(-8, -12, 0, 6, 8, -4);
    ctx.bezierCurveTo(11, -8, 14, -6, 16, -2);
    ctx.lineTo(16, 4);
    ctx.bezierCurveTo(13, 0, 11, -2, 8, 2);
    ctx.bezierCurveTo(0, 12, -8, -6, -15, 3);
    ctx.closePath();
  } else if (i === 2) {
    ctx.ellipse(0, 0, 9, 9, 0, 0, Math.PI * 2);
  } else {
    star(ctx, 0, 0, 12, 5, 4, 0);
  }
  ctx.fill();
  ctx.restore();
}

function drawSpark(ctx: C2D, r: AtlasRect) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2 - 1;
  ctx.save();
  let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,.85)");
  g.addColorStop(0.45, "rgba(255,255,255,.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
  // Four-point flare
  ctx.globalCompositeOperation = "lighter";
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    g = ctx.createLinearGradient(cx - dx * R, cy - dy * R, cx + dx * R, cy + dy * R);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    if (dx) ctx.fillRect(cx - R, cy - 1.2, 2 * R, 2.4); else ctx.fillRect(cx - 1.2, cy - R, 2.4, 2 * R);
  }
  ctx.restore();
}

function drawBubble(ctx: C2D, r: AtlasRect) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2 - 3;
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  g.addColorStop(0, "rgba(160,240,255,0.06)");
  g.addColorStop(0.8, "rgba(160,240,255,0.35)");
  g.addColorStop(1, "rgba(230,252,255,0.9)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - R * 0.38, cy - R * 0.42, R * 0.22, R * 0.13, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.fill();
  ctx.restore();
}

function drawTicket(ctx: C2D, r: AtlasRect) {
  const x = r.x + 2, y = r.y + 2, w = r.w - 4, h = r.h - 4;
  ctx.save();
  ctx.fillStyle = "#F4EDE0";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 2); ctx.fill();
  ctx.strokeStyle = "#19D3C5"; ctx.lineWidth = 1.6;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    for (let i = 0; i <= w; i += 2) {
      const yy = y + 7 + k * 5 + Math.sin(i / 4) * 1.6;
      if (i) ctx.lineTo(x + i, yy); else ctx.moveTo(x + i, yy);
    }
    ctx.stroke();
  }
  ctx.fillStyle = "#FFC83D"; ctx.beginPath(); ctx.arc(x + w - 9, y + h - 8, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#06304A";
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 5 + i * 6, y + h - 9, 4, 2);
  ctx.setLineDash([2, 2]); ctx.strokeStyle = "rgba(6,48,74,.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + w - 18, y + 1); ctx.lineTo(x + w - 18, y + h - 1); ctx.stroke();
  ctx.restore();
}

/** Pre-blurred disc: gaussian-like falloff baked as gradient stops (no runtime blur filter). */
function drawGlow(ctx: C2D, r: AtlasRect, sharp: number) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2 - 1;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    g.addColorStop(u, `rgba(255,255,255,${Math.exp(-sharp * u * u * 4).toFixed(4)})`);
  }
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** Light ray: apex at the bottom centre (the origin), widening and fading upward; soft edges from stacked wedges. */
function drawRay(ctx: C2D, r: AtlasRect) {
  ctx.save();
  const ax = r.x + r.w / 2, ay = r.y + r.h - 1;
  for (let k = 0; k < 6; k++) {
    const half = (r.w / 2 - 2) * (1 - k * 0.15);
    const g = ctx.createLinearGradient(0, ay, 0, r.y);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.08, "rgba(255,255,255,.22)");
    g.addColorStop(0.45, "rgba(255,255,255,.14)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - half, r.y + 1);
    ctx.lineTo(ax + half, r.y + 1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function bakeAtlas(): Atlas {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const coin: AtlasRect[] = [];
  for (let i = 0; i < 8; i++) coin.push({ x: i * COIN, y: 0, w: COIN, h: COIN });
  let x = 8 * COIN + 4;
  const confetti: AtlasRect[] = [];
  for (let i = 0; i < 4; i++) { confetti.push({ x, y: 0, w: CONF, h: CONF }); x += CONF + 2; }
  const spark = { x, y: 0, w: SPARK, h: SPARK }; x += SPARK + 2;
  const bubble = { x, y: 0, w: BUBBLE, h: BUBBLE }; x += BUBBLE + 2;
  const ticket = { x, y: 0, w: 64, h: 32 };
  const glow = { x: 0, y: 80, w: 256, h: 256 };
  const glowTight = { x: 260, y: 80, w: 128, h: 128 };
  const ray = { x: 400, y: 80, w: 80, h: 420 };

  // One full turn over 8 frames, so the spin loops without a pop.
  coin.forEach((r, i) => drawCoin(ctx, r, (i / 8) * Math.PI * 2));
  confetti.forEach((r, i) => drawConfetti(ctx, r, i));
  drawSpark(ctx, spark);
  drawBubble(ctx, bubble);
  drawTicket(ctx, ticket);
  drawGlow(ctx, glow, 1.6);
  drawGlow(ctx, glowTight, 3.2);
  drawRay(ctx, ray);
  return { canvas, coin, confetti, spark, bubble, ticket, glow, glowTight, ray };
}
