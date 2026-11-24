// Gambling bundle purity check (ARCHITECTURE.md 0.4, 1.2, 1.3, 11.3).
//   tsx scripts/check-gambling-bundle.ts [--dist dist] [--budget 250] [--root .]
// scripts/ is never bundled, so forbidden words may appear in this file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// ---------------------------------------------------------------- scanText

export interface WordRule {
  name: string;
  re: RegExp; // must carry the g flag
}

/** How the `understanding` special case is applied to a text. */
export type UnderstandingMode =
  | 'zero' // HTML / manifest / CSS: any occurrence fails
  | 'count' // JS: counted (caller aggregates, max 1); an occurrence not followed by "/" fails here
  | 'exempt'; // sw.js / workbox: rule skipped

export interface Rules {
  words: WordRule[];
  understanding: UnderstandingMode;
  /** URL prefixes that may appear. Anything else matching https?:// fails. */
  urlAllow: string[];
  /** Treat any https:// URL as allowed (understanding output: source links). http:// still needs allow-list. */
  allowHttps?: boolean;
  /** Skip the forbidden-word list (used for URL-only scans). */
  skipWords?: boolean;
  forbiddenApis: boolean;
}

export interface Violation {
  rule: string;
  match: string;
  index: number;
  line: number;
  file?: string;
}

export interface ScanResult {
  violations: Violation[];
  /** Occurrences of `understanding` (case-insensitive) in this text. */
  understandingCount: number;
  /** URLs seen that were accepted by an allow rule (info). */
  urls: string[];
}

const ci = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'), 'gi');

/** Case-insensitive plain words (2 forbidden-word list, minus the special cases). */
const PLAIN_WORDS = [
  '교육', '중독', '하우스 엣지', 'house edge', 'near-miss', '니어미스', '바다이야기',
  '하우스엣지', 'houseEdge', 'near miss', 'nearMiss', '도박', '예방', '치유', '오개념', '기댓값',
  '퀴즈', '해설', '실험', 'educat', 'addict', 'helpline', 'fallacy', 'disguised',
];

export const WORD_RULES: WordRule[] = [
  ...PLAIN_WORDS.map((w) => ({ name: w, re: ci(w) })),
  { name: 'LDW', re: /(?<![A-Za-z0-9_])LDW(?![A-Za-z0-9_])/g },
  { name: 'RTP', re: /(?<![A-Za-z0-9_])RTP(?![A-Za-z0-9_])/g },
  // 1336 not inside a longer number and not part of a decimal.
  { name: '1336', re: /(?<![\d.])1336(?!\d|\.\d)/g },
];

export const FORBIDDEN_APIS = ['Notification', 'PushManager', 'setAppBadge', 'periodicSync', 'storage.persist'];

export const URL_ALLOW = ['http://www.w3.org/', 'http://www.pixijs.com/'];

const UNDERSTANDING_RE = /understanding/gi;
const URL_RE = /https?:\/\/[^\s"'`)<>\\,;]+/g;

const lineOf = (text: string, index: number): number => {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

export function defaultRules(over: Partial<Rules> = {}): Rules {
  return {
    words: WORD_RULES,
    understanding: 'count',
    urlAllow: URL_ALLOW,
    forbiddenApis: false,
    ...over,
  };
}

export function scanText(text: string, rules: Rules): ScanResult {
  const violations: Violation[] = [];
  const add = (rule: string, match: string, index: number) =>
    violations.push({ rule, match, index, line: lineOf(text, index) });

  if (!rules.skipWords) {
    for (const w of rules.words) {
      for (const m of text.matchAll(new RegExp(w.re.source, w.re.flags.includes('g') ? w.re.flags : w.re.flags + 'g'))) {
        add(w.name, m[0], m.index ?? 0);
      }
    }
  }

  let understandingCount = 0;
  if (rules.understanding !== 'exempt') {
    for (const m of text.matchAll(UNDERSTANDING_RE)) {
      understandingCount++;
      const idx = m.index ?? 0;
      if (rules.understanding === 'zero') add('understanding', m[0], idx);
      else if (text[idx + m[0].length] !== '/') add('understanding (not followed by "/")', m[0], idx);
    }
  }

  const urls: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const u = m[0];
    const idx = m.index ?? 0;
    if (rules.urlAllow.some((p) => u.startsWith(p)) || (rules.allowHttps && u.startsWith('https://'))) urls.push(u);
    else add('external URL', u, idx);
  }

  if (rules.forbiddenApis) {
    for (const api of FORBIDDEN_APIS) {
      let i = text.indexOf(api);
      while (i !== -1) {
        add('forbidden API', api, i);
        i = text.indexOf(api, i + api.length);
      }
    }
  }
  return { violations, understandingCount, urls };
}

// ---------------------------------------------------------------- manifest graph

export interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}
export type Manifest = Record<string, ManifestChunk>;

/** Manifest key of the entry whose src is the given page (default: the lobby index.html). */
export function findEntry(manifest: Manifest, src = 'index.html'): string | undefined {
  return Object.keys(manifest).find((k) => manifest[k].src === src && manifest[k].isEntry);
}

/** Keys reachable from `key` through `imports` only (includes `key`). */
export function staticClosure(manifest: Manifest, key: string): Set<string> {
  const seen = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k) || !manifest[k]) return;
    seen.add(k);
    for (const i of manifest[k].imports ?? []) walk(i);
  };
  walk(key);
  return seen;
}

export interface Graph {
  /** Entry + chunks reachable via imports only. */
  staticKeys: Set<string>;
  /** Chunks reachable only through at least one dynamic import. */
  dynamicKeys: Set<string>;
  /** staticKeys + dynamicKeys. */
  allKeys: Set<string>;
}

export function collectGraph(manifest: Manifest, entry: string): Graph {
  const staticKeys = staticClosure(manifest, entry);
  const all = new Set<string>();
  const walk = (k: string) => {
    if (all.has(k) || !manifest[k]) return;
    all.add(k);
    for (const i of manifest[k].imports ?? []) walk(i);
    for (const d of manifest[k].dynamicImports ?? []) walk(d);
  };
  walk(entry);
  const dynamicKeys = new Set([...all].filter((k) => !staticKeys.has(k)));
  return { staticKeys, dynamicKeys, allKeys: all };
}

export interface FileSet {
  js: string[];
  css: string[];
  assets: string[];
}

/** Output files (relative to dist) of a set of manifest keys. */
export function filesOf(manifest: Manifest, keys: Iterable<string>): FileSet {
  const js = new Set<string>();
  const css = new Set<string>();
  const assets = new Set<string>();
  for (const k of keys) {
    const c = manifest[k];
    if (!c) continue;
    if (/\.css$/.test(c.file)) css.add(c.file);
    else if (/\.m?js$/.test(c.file)) js.add(c.file);
    else assets.add(c.file);
    for (const f of c.css ?? []) css.add(f);
    for (const f of c.assets ?? []) assets.add(f);
  }
  return { js: [...js], css: [...css], assets: [...assets] };
}

// ---------------------------------------------------------------- budget / Pixi

export const KB = 1024;
export const PIXI_STAGE_SRC = 'gambling/fx/gl/stage.ts';
export const PIXI_WARN_KB = 110;
export const DEFAULT_BUDGET_KB = 250;

export const gzipSize = (buf: Uint8Array | string): number => gzipSync(buf, { level: 9 }).length;

export interface PixiInfo {
  state: 'not built' | 'present';
  key?: string;
  files: string[];
  gzip: number;
  /** Failure messages of the isolation check. */
  problems: string[];
  warn: boolean;
}

/**
 * Pixi chunk = static closure of the dynamic stage entry minus the entry's static closure.
 * `stageExpected`: source for the stage exists, so absence from the manifest is a failure.
 */
export function pixiInfo(
  manifest: Manifest,
  entry: string,
  readFile: (f: string) => Uint8Array,
  stageExpected = false,
): PixiInfo {
  const stageKey = Object.keys(manifest).find((k) => k === PIXI_STAGE_SRC || manifest[k].src === PIXI_STAGE_SRC);
  if (!stageKey) {
    return {
      state: 'not built',
      files: [],
      gzip: 0,
      warn: false,
      problems: stageExpected ? [`${PIXI_STAGE_SRC} exists in source but is missing from the manifest`] : [],
    };
  }
  const problems: string[] = [];
  if (!manifest[stageKey].isDynamicEntry) problems.push(`${stageKey} is not a dynamic entry in the manifest`);
  const st = staticClosure(manifest, entry);
  if (st.has(stageKey)) problems.push(`${stageKey} is in the static closure of the entry`);
  const pixiKeys = [...staticClosure(manifest, stageKey)].filter((k) => !st.has(k));
  const files = filesOf(manifest, pixiKeys).js;
  const gzip = files.reduce((n, f) => n + gzipSize(readFile(f)), 0);
  return { state: 'present', key: stageKey, files, gzip, problems, warn: gzip > PIXI_WARN_KB * KB };
}

export interface BudgetInfo {
  files: { file: string; gzip: number }[];
  total: number;
  limit: number;
  ok: boolean;
}

export function computeBudget(
  manifest: Manifest,
  entry: string,
  readFile: (f: string) => Uint8Array,
  budgetKb = DEFAULT_BUDGET_KB,
): BudgetInfo {
  const js = filesOf(manifest, staticClosure(manifest, entry)).js;
  const files = js.map((file) => ({ file, gzip: gzipSize(readFile(file)) }));
  const total = files.reduce((n, f) => n + f.gzip, 0);
  const limit = budgetKb * KB;
  return { files, total, limit, ok: total <= limit };
}

// ---------------------------------------------------------------- import boundaries (0.4)

export interface SourceFile {
  path: string; // repo-relative, posix
  text: string;
}
export interface BoundaryViolation {
  file: string;
  specifier: string;
  target: string;
  reason: string;
}

const IMPORT_RES = [
  /(?:^|\n)\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\bimport\.meta\.glob\s*(?:<[^>]*>)?\(\s*\[?\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
];

export function extractSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const re of IMPORT_RES) for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Repo-relative target of a specifier, or undefined for bare packages. */
export function resolveSpecifier(fromPath: string, spec: string): string | undefined {
  if (spec.startsWith('@shared/')) return 'shared/' + spec.slice('@shared/'.length);
  if (spec === '@shared') return 'shared';
  if (spec.startsWith('@i18n/')) return 'i18n/' + spec.slice('@i18n/'.length);
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromPath), spec));
  return undefined;
}

type Zone = 'gambling' | 'understanding' | 'shared' | 'other';
const zoneOf = (p: string): Zone =>
  p.startsWith('gambling/') ? 'gambling' : p.startsWith('understanding/') ? 'understanding' : p.startsWith('shared/') ? 'shared' : 'other';

const isUnderstandingI18n = (t: string) => /^i18n\/understanding([./]|$)/.test(t) || /^shared\/i18n\.understanding(\.|$)/.test(t);
const isGamblingI18n = (t: string) => /^i18n\/gambling([./]|$)/.test(t);
const isGamblingCode = (t: string) => /^gambling(\/|$)/.test(t);
const isUnderstandingCode = (t: string) => /^understanding(\/|$)/.test(t);

const isTestFile = (p: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);

export function findBoundaryViolations(files: SourceFile[]): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  for (const f of files) {
    if (isTestFile(f.path)) continue; // tests may build cross-page fixtures; they are never bundled
    const zone = zoneOf(f.path);
    if (zone === 'other') continue;
    // shared/i18n.understanding.ts is itself understanding-side glue: it may import i18n/understanding.
    for (const spec of extractSpecifiers(f.text)) {
      const target = resolveSpecifier(f.path, spec);
      if (!target) continue;
      let reason = '';
      if (zone === 'gambling') {
        if (isUnderstandingCode(target) || isUnderstandingI18n(target)) reason = 'gambling/** must not import understanding code, i18n/understanding or shared/i18n.understanding';
      } else if (zone === 'shared') {
        if (isGamblingCode(target) || isUnderstandingCode(target)) reason = 'shared/** must not import gambling/** or understanding/**';
      } else if (zone === 'understanding') {
        if (isGamblingCode(target) || isGamblingI18n(target)) reason = 'understanding/** must not import gambling code or i18n/gambling';
      }
      if (reason) out.push({ file: f.path, specifier: spec, target, reason });
    }
  }
  return out;
}

const SRC_RE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'playwright-report', 'test-results']);

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

export function loadSourceFiles(root: string): SourceFile[] {
  const files: string[] = [];
  for (const d of ['gambling', 'shared', 'understanding']) walk(join(root, d), (p) => SRC_RE.test(p), files);
  return files.map((p) => ({ path: relative(root, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
}

export const scanSourceBoundaries = (root: string): BoundaryViolation[] => findBoundaryViolations(loadSourceFiles(root));

// ---------------------------------------------------------------- dist check (orchestration)

const TEXT_EXT = /\.(?:js|mjs|css|html|webmanifest|json|svg)$/i;
const FONT_EXT = /\.(?:woff2?|ttf|otf)$/i;

export interface FileReport {
  file: string;
  kind: string;
  bytes: number;
  gzip: number;
}
export interface Failure {
  where: string;
  rule: string;
  detail: string;
}
export interface Report {
  filesScanned: string[];
  failures: Failure[];
  notes: string[];
  budget?: BudgetInfo;
  pixi?: PixiInfo;
  staticCss: FileReport[];
  fonts: FileReport[];
  dynamicChunks: FileReport[];
  understandingCount: number;
}

export interface CheckOptions {
  dist: string;
  root: string;
  budgetKb: number;
}

export function checkDist(opts: CheckOptions): Report {
  const dist = resolve(opts.root, opts.dist);
  const report: Report = { filesScanned: [], failures: [], notes: [], staticCss: [], fonts: [], dynamicChunks: [], understandingCount: 0 };
  const fail = (where: string, rule: string, detail: string) => report.failures.push({ where, rule, detail });
  const read = (f: string) => readFileSync(join(dist, f));
  const reportOf = (file: string, kind: string): FileReport => {
    const b = read(file);
    return { file, kind, bytes: b.length, gzip: gzipSize(b) };
  };

  for (const b of boundaryReport(opts.root)) fail(b.file, 'import boundary', `${b.specifier} -> ${b.target}: ${b.reason}`);

  const manifestPath = join(dist, '.vite', 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('.vite/manifest.json', 'manifest', 'not found (build with build.manifest = true)');
    return report;
  }
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = findEntry(manifest);
  if (!entry) {
    fail('.vite/manifest.json', 'manifest', 'no isEntry item with src "index.html"');
    return report;
  }
  const graph = collectGraph(manifest, entry);
  const all = filesOf(manifest, graph.allKeys);
  const stat = filesOf(manifest, graph.staticKeys);

  // Targets: [file, understanding mode]
  const targets = new Map<string, UnderstandingMode>();
  const put = (f: string, mode: UnderstandingMode) => {
    if (existsSync(join(dist, f)) && TEXT_EXT.test(f) && !targets.has(f)) targets.set(f, mode);
  };
  for (const f of all.js) put(f, 'count');
  for (const f of all.css) put(f, 'zero');
  for (const f of all.assets) put(f, 'zero');
  for (const f of ['index.html', '404.html', 'manifest.webmanifest']) put(f, 'zero');
  if (existsSync(dist)) {
    for (const n of readdirSync(dist)) if (n === 'sw.js' || /^workbox-.*\.js$/.test(n)) put(n, 'exempt');
  }
  if (!existsSync(join(dist, 'sw.js'))) report.notes.push('sw.js not present: skipped');
  if (!existsSync(join(dist, 'manifest.webmanifest'))) report.notes.push('manifest.webmanifest not present: skipped');

  let understandingTotal = 0;
  for (const [f, mode] of targets) {
    const text = read(f).toString('utf8');
    report.filesScanned.push(f);
    const res = scanText(text, defaultRules({ understanding: mode, forbiddenApis: false }));
    for (const v of res.violations) fail(f, v.rule, `"${v.match}" at line ${v.line}`);
    if (mode === 'count') understandingTotal += res.understandingCount;
  }
  report.understandingCount = understandingTotal;
  if (understandingTotal > 1) fail('(gambling JS graph)', 'understanding', `${understandingTotal} occurrences, at most 1 allowed`);

  // Forbidden APIs: every JS file in dist.
  const distJs = walk(dist, (p) => /\.m?js$/.test(p)).map((p) => relative(dist, p).split(sep).join('/'));
  for (const f of distJs) {
    const res = scanText(read(f).toString('utf8'), { words: [], understanding: 'exempt', urlAllow: [], skipWords: true, forbiddenApis: true });
    for (const v of res.violations.filter((x) => x.rule === 'forbidden API')) fail(f, v.rule, `"${v.match}" at line ${v.line}`);
  }

  // Understanding output: external URL check only (https source links allowed).
  const uEntry = findEntry(manifest, 'understanding/index.html');
  const uFiles = new Set<string>();
  if (uEntry) {
    const u = filesOf(manifest, collectGraph(manifest, uEntry).allKeys);
    for (const f of [...u.js, ...u.css]) uFiles.add(f);
  }
  if (existsSync(join(dist, 'understanding', 'index.html'))) uFiles.add('understanding/index.html');
  for (const f of uFiles) {
    if (!existsSync(join(dist, f))) continue;
    const res = scanText(read(f).toString('utf8'), { words: [], understanding: 'exempt', urlAllow: URL_ALLOW, allowHttps: true, skipWords: true, forbiddenApis: false });
    for (const v of res.violations) fail(f, 'external URL (understanding)', `"${v.match}" at line ${v.line}`);
  }
  if (!uEntry) report.notes.push('understanding entry not in manifest: its URL scan skipped');

  // Budget.
  report.budget = computeBudget(manifest, entry, read, opts.budgetKb);
  if (!report.budget.ok) fail('(static closure)', 'budget', `${(report.budget.total / KB).toFixed(1)}KB gz > ${opts.budgetKb}KB`);

  // Pixi.
  const stageExpected = existsSync(join(opts.root, PIXI_STAGE_SRC));
  report.pixi = pixiInfo(manifest, entry, read, stageExpected);
  for (const p of report.pixi.problems) fail(PIXI_STAGE_SRC, 'pixi isolation', p);
  for (const f of stat.js) {
    if (read(f).toString('utf8').includes('pixijs.com')) fail(f, 'pixi isolation', 'string "pixijs.com" in the static closure');
  }

  // Informational sizes.
  report.staticCss = stat.css.map((f) => reportOf(f, 'css'));
  const staticJs = new Set(stat.js);
  report.dynamicChunks = all.js.filter((f) => !staticJs.has(f)).map((f) => reportOf(f, 'dynamic js'));
  report.fonts = walk(dist, (p) => FONT_EXT.test(p)).map((p) => reportOf(relative(dist, p).split(sep).join('/'), 'font'));
  return report;
}

const boundaryReport = (root: string) => scanSourceBoundaries(root);

export function formatReport(r: Report, budgetKb: number): string {
  const kb = (n: number) => (n / KB).toFixed(1).padStart(7) + ' KB';
  const L: string[] = [];
  L.push(`Files scanned: ${r.filesScanned.length}`);
  for (const f of r.filesScanned) L.push(`  ${f}`);
  if (r.budget) {
    L.push('', `Static import closure of index.html (gzip -9):`);
    for (const f of r.budget.files) L.push(`  ${kb(f.gzip)}  ${f.file}`);
    L.push(`  ${kb(r.budget.total)}  TOTAL (budget ${budgetKb} KB) ${r.budget.ok ? 'OK' : 'OVER BUDGET'}`);
  }
  if (r.pixi) {
    L.push('', r.pixi.state === 'not built' ? 'Pixi chunk: not built' : `Pixi chunk: ${kb(r.pixi.gzip)} gz (${r.pixi.files.join(', ')})${r.pixi.warn ? `  WARNING: > ${PIXI_WARN_KB} KB` : ''}`);
  }
  const section = (title: string, rows: FileReport[]) => {
    L.push('', `${title}:` + (rows.length ? '' : ' none'));
    for (const f of rows) L.push(`  ${kb(f.gzip)} gz  ${kb(f.bytes)} raw  ${f.file}`);
  };
  section('Dynamic chunks (info)', r.dynamicChunks);
  section('CSS in static closure (info)', r.staticCss);
  section('Fonts in dist (info)', r.fonts);
  L.push('', `"understanding" occurrences in gambling JS: ${r.understandingCount} (max 1)`);
  for (const n of r.notes) L.push(`note: ${n}`);
  if (r.failures.length) {
    L.push('', `FAILURES (${r.failures.length}):`);
    for (const f of r.failures) L.push(`  [${f.rule}] ${f.where}: ${f.detail}`);
  } else L.push('', 'OK: no failures');
  return L.join('\n');
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv: string[]): CheckOptions {
  const o: CheckOptions = { dist: 'dist', root: process.cwd(), budgetKb: DEFAULT_BUDGET_KB };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dist') o.dist = argv[++i];
    else if (a === '--budget') o.budgetKb = Number(argv[++i]);
    else if (a === '--root') o.root = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(o.budgetKb) || o.budgetKb <= 0) throw new Error('--budget needs a positive number (KB)');
  return o;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opts = parseArgs(process.argv.slice(2));
  if (!process.argv.includes('--root')) opts.root = root;
  const report = checkDist(opts);
  console.log(formatReport(report, opts.budgetKb));
  process.exit(report.failures.length ? 1 : 0);
}
