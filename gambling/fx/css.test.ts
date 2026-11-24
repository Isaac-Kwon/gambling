/**
 * CSS flash rule (ARCHITECTURE §2.3, §6.6, §11.1): every infinite animation in gambling/**\/*.css whose
 * keyframes change opacity / filter / background / color / box-shadow must have a period >= 1 s and use
 * ease-in-out. Transform-only loops are unrestricted.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GAMBLING = join(ROOT, "gambling");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

const BRIGHT = /(^|[\s;{-])(opacity|filter|backdrop-filter|background(-color|-image|-position)?|color|box-shadow|text-shadow|fill|stroke|border-color|outline-color)\s*:/i;

export interface Violation { anim: string; why: string }

/** Pure checker used by the test (exported for reuse). */
export function checkCss(css: string): Violation[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // 1. Keyframes → whether they change a brightness/colour property.
  const bright = new Map<string, boolean>();
  let rest = "";
  let i = 0;
  const kfRe = /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = kfRe.exec(src))) {
    rest += src.slice(i, m.index);
    let depth = 1, j = kfRe.lastIndex;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(kfRe.lastIndex, j - 1);
    bright.set(m[1], BRIGHT.test(body));
    i = j;
    kfRe.lastIndex = j;
  }
  rest += src.slice(i);

  // 2. Rule blocks (innermost braces) → animation declarations.
  const out: Violation[] = [];
  const blockRe = /\{([^{}]*)\}/g;
  while ((m = blockRe.exec(rest))) {
    const decls = new Map<string, string>();
    for (const d of m[1].split(";")) {
      const k = d.indexOf(":");
      if (k > 0) decls.set(d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim());
    }
    const anims: { name: string; dur: string | null; iter: string; ease: string | null }[] = [];
    const short = decls.get("animation");
    if (short) {
      for (const part of short.split(/,(?![^(]*\))/)) {
        const toks = part.trim().split(/\s+(?![^(]*\))/);
        const times = toks.filter((t) => /^-?[\d.]+m?s$/i.test(t));
        const ease = toks.find((t) => /^(ease(-in|-out|-in-out)?|linear|step-start|step-end|steps\(.*\)|cubic-bezier\(.*\)|linear\(.*\))$/i.test(t)) ?? null;
        const iter = toks.find((t) => /^(infinite|[\d.]+)$/i.test(t) && !/m?s$/i.test(t)) ?? "1";
        const name = toks.find((t) => bright.has(t)) ?? toks.find((t) => /^[a-z_-][\w-]*$/i.test(t) && !/^(infinite|alternate|alternate-reverse|reverse|normal|forwards|backwards|both|none|running|paused|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(t)) ?? "";
        anims.push({ name, dur: times[0] ?? null, iter, ease });
      }
    }
    const names = decls.get("animation-name");
    if (names) {
      const list = names.split(",").map((s) => s.trim());
      const durs = (decls.get("animation-duration") ?? "").split(",").map((s) => s.trim());
      const iters = (decls.get("animation-iteration-count") ?? "1").split(",").map((s) => s.trim());
      const eases = (decls.get("animation-timing-function") ?? "").split(/,(?![^(]*\))/).map((s) => s.trim());
      list.forEach((name, k) => anims.push({ name, dur: durs[k % durs.length] || null, iter: iters[k % iters.length], ease: eases[k % eases.length] || null }));
    } else if (!short) {
      // Longhands overriding a shorthand elsewhere (e.g. animation-duration on a modifier class).
      const dur = decls.get("animation-duration");
      if (dur && /^[\d.]+m?s$/i.test(dur)) {
        const ms = dur.endsWith("ms") ? parseFloat(dur) : parseFloat(dur) * 1000;
        if (ms < 1000) out.push({ anim: "(animation-duration override)", why: `duration ${dur} < 1s (override; verify the animation it applies to)` });
      }
    }
    for (const a of anims) {
      if (a.iter.toLowerCase() !== "infinite") continue;
      if (!bright.get(a.name)) continue;    // transform-only or unknown (defined in another file → checked there via its own rules)
      if (!a.dur) { out.push({ anim: a.name, why: "no literal duration" }); continue; }
      const ms = a.dur.toLowerCase().endsWith("ms") ? parseFloat(a.dur) : parseFloat(a.dur) * 1000;
      if (!(ms >= 1000)) out.push({ anim: a.name, why: `period ${a.dur} < 1s` });
      if ((a.ease ?? "ease").toLowerCase() !== "ease-in-out") out.push({ anim: a.name, why: `timing ${a.ease ?? "ease (default)"} is not ease-in-out` });
    }
  }
  return out;
}

describe("CSS flash rule", () => {
  it("checker catches violations and passes the allowed forms", () => {
    const kf = "@keyframes glow { from { opacity: .2 } to { opacity: 1 } } @keyframes spin { to { transform: rotate(1turn) } }";
    expect(checkCss(kf + ".a { animation: glow 0.4s ease-in-out infinite alternate; }")).toHaveLength(1);
    expect(checkCss(kf + ".a { animation: glow 1.2s linear infinite; }")).toHaveLength(1);
    expect(checkCss(kf + ".a { animation: glow 1.2s infinite; }")).toHaveLength(1);
    expect(checkCss(kf + ".a { animation: glow 1.2s ease-in-out infinite alternate; }")).toHaveLength(0);
    expect(checkCss(kf + ".a { animation: glow 300ms ease-in-out 2; }")).toHaveLength(0);       // finite
    expect(checkCss(kf + ".a { animation: spin 0.2s linear infinite; }")).toHaveLength(0);       // transform only
    expect(checkCss(kf + ".a { animation-name: glow; animation-duration: .5s; animation-iteration-count: infinite; animation-timing-function: ease-in-out }")).toHaveLength(1);
    expect(checkCss(kf + "@media (min-width: 1px) { .a { animation: glow 900ms ease-in-out infinite; } }")).toHaveLength(1);
    expect(checkCss(kf + ".a { animation: spin 1s linear infinite, glow .5s ease-in-out infinite; }")).toHaveLength(1);
  });

  it("every infinite brightness/colour animation in gambling/**/*.css has period >= 1 s and ease-in-out", () => {
    const files = walk(GAMBLING);
    expect(files.some((f) => f.endsWith("glow.css"))).toBe(true);
    const problems: string[] = [];
    for (const f of files) {
      for (const v of checkCss(readFileSync(f, "utf8"))) problems.push(`${relative(ROOT, f)}: ${v.anim} — ${v.why}`);
    }
    expect(problems).toEqual([]);
  });
});
