// Rasterizes public/icons/icon.svg into the PWA PNG set. Output is committed; CI does not run this.
//   npm run gen:icons
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const BG = '#0B0612';

/** Rasterize at `size`; `inset` (0..0.5) shrinks the artwork inside a solid brand-colour square (maskable safe zone). */
function render(size: number, inset = 0): Buffer {
  let src = svg;
  if (inset > 0) {
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const k = 1 - inset * 2;
    const off = (512 * inset).toFixed(2);
    src = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${BG}"/><g transform="translate(${off} ${off}) scale(${k})">${inner}</g></svg>`;
  }
  return Buffer.from(new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng());
}

const out: [string, Buffer][] = [
  ['icon-192.png', render(192)],
  ['icon-512.png', render(512)],
  // Maskable: content kept inside the central 80% circle (inset 10% per side leaves a comfortable margin).
  ['icon-maskable-512.png', render(512, 0.1)],
  ['apple-touch-icon-180.png', render(180)],
];
for (const [name, buf] of out) {
  writeFileSync(join(dir, name), buf);
  console.log(`${name} ${buf.length} bytes`);
}
