export type Lang = 'ko' | 'en' | 'it';
export type Dict = Record<string, string>;
export type Dictionaries = Record<Lang, Dict>;
export type Params = Record<string, string | number>;

export const LANGS: readonly Lang[] = ['ko', 'en', 'it'];
export const LANG_STORAGE_KEY = 'eg.lang';

let current: Lang = 'ko';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

function asLang(v: string | null | undefined): Lang | null {
  if (!v) return null;
  const two = v.trim().toLowerCase().slice(0, 2);
  return (LANGS as readonly string[]).includes(two) ? (two as Lang) : null;
}

export interface LangInputs {
  /** Value of the `?lang=` query parameter. */
  query?: string | null;
  /** Value of localStorage["eg.lang"]. */
  stored?: string | null;
  /** navigator.language (first two letters are used). */
  navigatorLang?: string | null;
}

/** Pure language selection: ?lang= -> localStorage -> navigator.language -> ko. */
export function pickLang(inp: LangInputs = {}): Lang {
  return asLang(inp.query) ?? asLang(inp.stored) ?? asLang(inp.navigatorLang) ?? 'ko';
}

/** Replace `{name}` placeholders; unknown placeholders are left as written. */
export function format(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export type Translator = (key: string, params?: Params, lang?: Lang) => string;

/** Build a translator over one page's dictionaries; empty/missing values fall back to ko, then to the key. */
export function makeT(d: Dictionaries): Translator {
  return (key, params, lang = current) => format(d[lang][key] || d.ko[key] || key, params);
}

type Mod = { default: Dict };

/** Merge `<ns>.<lang>.json` modules (from import.meta.glob eager) into per-language dictionaries. */
export function mergeDictionaries(files: Record<string, Mod | Dict>): Dictionaries {
  const out: Dictionaries = { ko: {}, en: {}, it: {} };
  for (const [path, mod] of Object.entries(files)) {
    const m = /([^/\\]+)\.(ko|en|it)\.json$/.exec(path);
    if (!m) continue;
    const dict = ('default' in mod && typeof mod.default === 'object' ? mod.default : mod) as Dict;
    Object.assign(out[m[2] as Lang], dict);
  }
  return out;
}
