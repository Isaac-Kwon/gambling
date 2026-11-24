// UI kit checks (node, no DOM): CSS loop rule for this folder (ARCHITECTURE 2.3), icon.svg well-formedness,
// pure helpers.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { fmtCredits, fmtDelta, fmtMult } from './format';
import { starPath, sparklePath } from './svg';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../../..');

// ---------------------------------------------------------------- CSS loop rule

/** Properties whose change reads as brightness/colour change. */
const LIGHT_PROPS = /^(opacity|filter|backdrop-filter|background(-color|-image|-position)?|color|box-shadow|text-shadow|fill|stroke|fill-opacity|stroke-opacity|-webkit-text-stroke(-color)?|border(-\w+)?-color|outline-color)$/;

export interface LoopViolation { file: string; anim: string; why: string }

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the body of every top-level block matching `@keyframes name { ... }`. */
function keyframes(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.set(m[1], css.slice(re.lastIndex, i - 1));
  }
  return out;
}

function changedProps(body: string): Set<string> {
  const props = new Set<string>();
  for (const d of body.matchAll(/([\w-]+)\s*:/g)) props.add(d[1].toLowerCase());
  return props;
}

function splitTop(v: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function toMs(tok: string): number {
  const m = /^(-?[\d.]+)(ms|s)$/.exec(tok);
  if (!m) return NaN;
  return m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
}

/** Check every `animation:` shorthand in `css`. Longhand iteration/duration overrides are rejected outright. */
export function checkLoops(file: string, cssRaw: string, shared: Map<string, string> = new Map()): LoopViolation[] {
  const css = stripComments(cssRaw);
  const frames = new Map([...shared, ...keyframes(css)]);
  const out: LoopViolation[] = [];
  for (const m of css.matchAll(/(?:^|[;{\s])animation-(iteration-count|duration|timing-function|name)\s*:\s*([^;}]+)/g)) {
    out.push({ file, anim: m[2].trim(), why: `animation-${m[1]} longhand: use the shorthand so the rule can be checked` });
  }
  for (const m of css.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]+)/g)) {
    for (const one of splitTop(m[1])) {
      const toks = one.replace(/\([^)]*\)/g, (x) => x.replace(/\s+/g, '')).split(/\s+/);
      if (!toks.includes('infinite')) continue;
      const name = toks.find((tk) => frames.has(tk));
      if (!name) { out.push({ file, anim: one, why: 'unknown @keyframes' }); continue; }
      const lit = [...changedProps(frames.get(name)!)].filter((p) => LIGHT_PROPS.test(p));
      if (lit.length === 0) continue; // transform-only loop: free
      const dur = toks.map(toMs).find((x) => !Number.isNaN(x));
      if (dur === undefined || dur < 1000) out.push({ file, anim: one, why: `changes ${lit.join(',')} with period ${dur ?? '?'}ms < 1000ms` });
      if (!toks.includes('ease-in-out')) out.push({ file, anim: one, why: `changes ${lit.join(',')} without ease-in-out` });
    }
  }
  return out;
}

describe('CSS loops in gambling/src/ui (2.3: brightness/colour loops >= 1s, ease-in-out)', () => {
  const files = readdirSync(here).filter((f) => f.endsWith('.css'));
  const sources = new Map(files.map((f) => [f, readFileSync(join(here, f), 'utf8')]));
  // Keyframes are global: a loop in kit.css may use frames defined in theme.css.
  const allFrames = new Map<string, string>();
  for (const css of sources.values()) for (const [k, v] of keyframes(stripComments(css))) allFrames.set(k, v);

  it('finds the kit stylesheets', () => {
    expect(files).toEqual(expect.arrayContaining(['theme.css', 'kit.css', 'fonts.css']));
  });

  for (const f of files) {
    it(`${f} respects the loop rule`, () => {
      expect(checkLoops(f, sources.get(f)!, allFrames)).toEqual([]);
    });
  }

  it('the checker catches violations', () => {
    const bad = `@keyframes blink { 50% { opacity: 0 } } @keyframes go { to { transform: rotate(1turn) } }
      .a { animation: blink .4s ease-in-out infinite; }
      .b { animation: blink 1.2s linear infinite; }
      .c { animation: go 200ms linear infinite, blink 1s ease-in-out infinite alternate; }
      .d { animation-iteration-count: infinite; }`;
    const v = checkLoops('x.css', bad);
    expect(v.map((x) => x.why.split(' ')[0])).toEqual(['animation-iteration-count', 'changes', 'changes']);
    expect(v.some((x) => x.anim.startsWith('blink .4s'))).toBe(true);
    expect(v.some((x) => x.anim.startsWith('blink 1.2s') && x.why.includes('ease-in-out'))).toBe(true);
    expect(v.some((x) => x.anim.startsWith('go'))).toBe(false);
  });
});

// ---------------------------------------------------------------- icon.svg

/** Minimal XML well-formedness check: balanced tags, quoted attributes, no stray '<' or bad entities. */
function xmlErrors(src: string): string[] {
  const errs: string[] = [];
  const body = src.replace(/^﻿/, '').replace(/<\?xml[^?]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/g;
  const stack: string[] = [];
  let last = 0;
  let roots = 0;
  let m: RegExpExecArray | null;
  const text = (s: string) => {
    if (s.includes('<') || s.includes('>')) errs.push(`stray markup: ${s.trim().slice(0, 40)}`);
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s)) errs.push('bad entity');
    if (stack.length === 0 && s.trim()) errs.push(`text outside root: ${s.trim().slice(0, 40)}`);
  };
  while ((m = tag.exec(body))) {
    text(body.slice(last, m.index));
    last = tag.lastIndex;
    const [, close, name, attrs, self] = m;
    const seen = new Set<string>();
    for (const a of attrs.matchAll(/([A-Za-z_][\w:.-]*)\s*=/g)) {
      if (seen.has(a[1])) errs.push(`duplicate attribute ${a[1]} on <${name}>`);
      seen.add(a[1]);
    }
    if (close) {
      const open = stack.pop();
      if (open !== name) errs.push(`</${name}> closes <${open}>`);
    } else {
      if (stack.length === 0) roots++;
      if (!self) stack.push(name);
    }
  }
  text(body.slice(last));
  if (stack.length) errs.push(`unclosed: ${stack.join(' > ')}`);
  if (roots !== 1) errs.push(`expected one root element, got ${roots}`);
  return errs;
}

describe('public/icons/icon.svg', () => {
  const src = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');

  it('is well-formed XML', () => {
    expect(xmlErrors(src)).toEqual([]);
  });

  it('has an <svg> root with the SVG namespace and a square viewBox', () => {
    const open = /^\s*<svg\b([^>]*)>/.exec(src);
    expect(open).toBeTruthy();
    expect(open![1]).toContain('xmlns="http://www.w3.org/2000/svg"');
    const vb = /viewBox="([^"]+)"/.exec(open![1]);
    expect(vb).toBeTruthy();
    const [x, y, w, h] = vb![1].trim().split(/[\s,]+/).map(Number);
    expect([x, y]).toEqual([0, 0]);
    expect(w).toBeGreaterThanOrEqual(192);
    expect(w).toBe(h);
  });

  it('is self-contained code-drawn art (no external refs, scripts, raster images or text glyphs)', () => {
    expect(src.replace(/http:\/\/www\.w3\.org\/[\w/.-]*/g, '')).not.toMatch(/https?:/);
    expect(src).not.toMatch(/<(script|image|foreignObject|text)\b/);
    expect(src).not.toMatch(/\son\w+=/);
    for (const ref of src.matchAll(/url\(#([\w-]+)\)/g)) expect(src).toContain(`id="${ref[1]}"`);
  });

  it('the checker rejects broken XML', () => {
    expect(xmlErrors('<svg><g></svg>').length).toBeGreaterThan(0);
    expect(xmlErrors('<svg a=1></svg>').length).toBeGreaterThan(0);
    expect(xmlErrors('<svg></svg><svg></svg>').length).toBeGreaterThan(0);
    expect(xmlErrors('<svg><path d="M0 0"/></svg>')).toEqual([]);
  });
});

// ---------------------------------------------------------------- pure helpers

describe('format', () => {
  it('formats credits per language', () => {
    expect(fmtCredits(10000, 'ko')).toBe('10,000');
    expect(fmtCredits(10000, 'en')).toBe('10,000');
    expect(fmtCredits(10000, 'it')).toBe('10.000');
    expect(fmtCredits(1234.6, 'ko')).toBe('1,235');
  });
  it('formats deltas and multipliers', () => {
    expect(fmtDelta(1250, 'ko')).toBe('+1,250');
    expect(fmtDelta(-300, 'ko')).toBe('−300');
    expect(fmtDelta(0, 'ko')).toBe('0');
    expect(fmtMult(2.5, 'ko')).toBe('2.50×');
    expect(fmtMult(2.5, 'it')).toBe('2,50×');
  });
});

describe('svg paths', () => {
  it('star has 2n points and starts at the top', () => {
    const d = starPath(10, 10, 8, 3, 5);
    expect(d.match(/[ML]/g)!.length).toBe(10);
    expect(d.startsWith('M10.00 2.00')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
  it('sparkle is a closed 4-curve path', () => {
    expect(sparklePath(0, 0, 10).match(/Q/g)!.length).toBe(4);
  });
});
