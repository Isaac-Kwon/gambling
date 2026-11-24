/**
 * Pixi isolation by source inspection (ARCHITECTURE §4.3, §11.1):
 * - only gambling/fx/gl/stage.ts imports 'pixi.js' (or 'pixi.js/*');
 * - only gambling/fx/gl/loader.ts refers to gl/stage, and only through one dynamic import();
 * - following static imports from gambling/src/main.ts never reaches gl/stage.ts or gl/atlas.ts;
 * - fx/null.ts and gambling/harness/** do not import fx/gl/**.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

interface Imp { spec: string; dynamic: boolean; typeOnly: boolean }
function importsOf(src: string): Imp[] {
  const s = strip(src);
  const out: Imp[] = [];
  const stat = /(^|[;\n])\s*(import|export)\s+(type\s+)?([^'"`;]*?\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = stat.exec(s))) {
    // `export { x }` without from is not an import; the regex requires a string literal so it is skipped.
    if (m[2] === "export" && !m[4]) continue;
    out.push({ spec: m[5], dynamic: false, typeOnly: !!m[3] });
  }
  const dyn = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dyn.exec(s))) out.push({ spec: m[1], dynamic: true, typeOnly: false });
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else if (spec.startsWith("@shared/")) base = join(ROOT, "shared", spec.slice(8));
  else if (spec.startsWith("@i18n/")) base = join(ROOT, "i18n", spec.slice(6));
  else return null;                                   // package
  for (const c of [base, base + ".ts", base + ".tsx", base + ".js", join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const files = [...walk(join(ROOT, "gambling")), ...walk(join(ROOT, "shared")), ...walk(join(ROOT, "understanding")), ...walk(join(ROOT, "scripts"))]
  .filter((f) => !/\.test\.ts$/.test(f));
const STAGE = join(ROOT, "gambling/fx/gl/stage.ts");
const ATLAS = join(ROOT, "gambling/fx/gl/atlas.ts");
const LOADER = join(ROOT, "gambling/fx/gl/loader.ts");

describe("Pixi isolation (source)", () => {
  it("only gl/stage.ts imports pixi.js", () => {
    const importers = files.filter((f) => importsOf(readFileSync(f, "utf8")).some((i) => i.spec === "pixi.js" || i.spec.startsWith("pixi.js/")));
    expect(importers.map(rel)).toEqual(["gambling/fx/gl/stage.ts"]);
  });

  it("only gl/loader.ts refers to gl/stage, through exactly one dynamic import()", () => {
    const refs: string[] = [];
    for (const f of files) {
      for (const i of importsOf(readFileSync(f, "utf8"))) {
        if (resolveSpec(f, i.spec) === STAGE) refs.push(`${rel(f)}:${i.dynamic ? "dynamic" : "static"}`);
      }
    }
    expect(refs).toEqual(["gambling/fx/gl/loader.ts:dynamic"]);
    expect(importsOf(readFileSync(LOADER, "utf8")).filter((i) => !i.typeOnly && !i.dynamic).map((i) => i.spec)).toEqual([]);
  });

  it("static imports from gambling/src/main.ts (and the fx director) never reach gl/stage.ts or gl/atlas.ts", () => {
    const entries = [join(ROOT, "gambling/src/main.ts"), join(ROOT, "gambling/fx/index.ts"), join(ROOT, "gambling/fx/backend.ts")];
    const seen = new Set<string>();
    const stack = entries.filter((e) => existsSync(e));
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
      for (const i of importsOf(readFileSync(f, "utf8"))) {
        if (i.dynamic || i.typeOnly) continue;
        const r = resolveSpec(f, i.spec);
        if (r) stack.push(r);
      }
    }
    expect(seen.has(STAGE)).toBe(false);
    expect(seen.has(ATLAS)).toBe(false);
    expect(seen.size).toBeGreaterThan(3);
  });

  it("fx/null.ts and gambling/harness/** do not import fx/gl/**", () => {
    const gl = join(ROOT, "gambling/fx/gl");
    const check = [join(ROOT, "gambling/fx/null.ts"), ...walk(join(ROOT, "gambling/harness"))];
    const bad: string[] = [];
    for (const f of check) {
      if (!existsSync(f)) continue;
      for (const i of importsOf(readFileSync(f, "utf8"))) {
        const r = resolveSpec(f, i.spec);
        if (r && r.startsWith(gl)) bad.push(`${rel(f)} -> ${i.spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
