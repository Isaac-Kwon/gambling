export type Lang = 'ko' | 'en' | 'it';
export type Dict = Record<string, string>;
export type Dictionaries = Record<Lang, Dict>;

let current: Lang = 'ko';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** Build a translator over one page's dictionaries; empty/missing values fall back to ko, then to the key. */
export function makeT(d: Dictionaries): (key: string, lang?: Lang) => string {
  return (key, lang = current) => d[lang][key] || d.ko[key] || key;
}
