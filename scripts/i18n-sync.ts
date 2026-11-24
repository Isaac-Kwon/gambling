// Sync en/it dictionaries to the ko keys (ARCHITECTURE.md 10.5).
//   tsx scripts/i18n-sync.ts [--check] [--root .]
// Layout: i18n/gambling/<ns>.<lang>.json, i18n/understanding/<ns>.<lang>.json.
// Legacy flat files i18n/<scope>.<lang>.json are synced too while they still exist.
// ko is the source of truth: missing keys are added with "", keys not in ko are removed,
// existing translations are kept. Keys are written sorted, 2-space JSON, LF, trailing newline.
// A file is only rewritten when its content (keys, order, values) would change.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_LANG = 'ko';
export const TARGET_LANGS = ['en', 'it'];

export type Dict = Record<string, string>;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Target dictionary for the given ko keys, keeping existing values. */
export function syncDict(ko: Dict, target: Dict | undefined): Dict {
  const out: Dict = {};
  for (const k of Object.keys(ko).sort(cmp)) {
    const v = target?.[k];
    out[k] = typeof v === 'string' ? v : '';
  }
  return out;
}

export const serialize = (d: Dict): string => JSON.stringify(d, null, 2) + '\n';

/** True when writing `next` over the parsed existing dictionary would change content or key order. */
export function differs(current: Dict | undefined, next: Dict): boolean {
  return current === undefined || JSON.stringify(current) !== JSON.stringify(next);
}

export interface Change {
  file: string; // path relative to root
  added: string[];
  removed: string[];
  created: boolean;
  reordered: boolean;
}

export interface Group {
  dir: string; // absolute
  ns: string;
}

/** ko files found under i18n/gambling, i18n/understanding (namespaced) and i18n/ (legacy flat). */
export function findGroups(i18nDir: string): Group[] {
  const groups: Group[] = [];
  for (const sub of ['gambling', 'understanding', '']) {
    const dir = join(i18nDir, sub);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) {
      const m = /^(.+)\.ko\.json$/.exec(n);
      if (m) groups.push({ dir, ns: m[1] });
    }
  }
  return groups;
}

const readDict = (p: string): Dict | undefined => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Dict) : undefined);

export function syncAll(root: string, write: boolean): Change[] {
  const i18n = join(root, 'i18n');
  const changes: Change[] = [];
  for (const g of findGroups(i18n)) {
    const ko = readDict(join(g.dir, `${g.ns}.${SOURCE_LANG}.json`)) ?? {};
    for (const lang of TARGET_LANGS) {
      const file = join(g.dir, `${g.ns}.${lang}.json`);
      const cur = readDict(file);
      const next = syncDict(ko, cur);
      if (!differs(cur, next)) continue;
      const curKeys = Object.keys(cur ?? {});
      const added = Object.keys(next).filter((k) => !(cur && k in cur));
      const removed = curKeys.filter((k) => !(k in next));
      changes.push({
        file: relative(root, file).split('\\').join('/'),
        added,
        removed,
        created: cur === undefined,
        reordered: !!cur && !added.length && !removed.length && JSON.stringify(curKeys) !== JSON.stringify(Object.keys(next)),
      });
      if (write) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, serialize(next), 'utf8');
      }
    }
  }
  return changes;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const ri = args.indexOf('--root');
  const root = ri >= 0 ? resolve(args[ri + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const changes = syncAll(root, !check);
  for (const c of changes) {
    const what = c.created ? 'create' : c.reordered ? 'reorder' : 'update';
    console.log(`${check ? 'would ' : ''}${what} ${c.file}: +${c.added.length} -${c.removed.length}`);
    for (const k of c.removed) console.log(`    removed: ${k}`);
  }
  if (!changes.length) console.log('i18n: en/it are in sync with ko');
  process.exit(check && changes.length ? 1 : 0);
}
