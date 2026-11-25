import { describe, expect, it } from 'vitest';
import { files as gFiles, dictionaries as g, t as tg } from './i18n.gambling';
import { files as uFiles, dictionaries as u } from './i18n.understanding';
import { format, makeT, pickLang } from './i18n';

describe('i18n files', () => {
  for (const [page, files] of [['gambling', gFiles], ['understanding', uFiles]] as const) {
    const byNs = new Map<string, Record<string, Record<string, string>>>();
    for (const [path, dict] of Object.entries(files)) {
      const m = /([^/]+)\.(ko|en|it)\.json$/.exec(path)!;
      expect(m, path).toBeTruthy();
      if (!byNs.has(m[1])) byNs.set(m[1], {});
      byNs.get(m[1])![m[2]] = dict;
      it(`${page}/${m[1]}.${m[2]}: every key starts with "${m[1]}."`, () => {
        for (const k of Object.keys(dict)) expect(k.split('.')[0]).toBe(m[1]);
      });
    }
    for (const [ns, langs] of byNs) {
      it(`${page}/${ns} has ko, en, it with identical keys`, () => {
        expect(Object.keys(langs).sort()).toEqual(['en', 'it', 'ko']);
        for (const l of ['en', 'it']) {
          expect(Object.keys(langs[l]).sort()).toEqual(Object.keys(langs.ko).sort());
        }
      });
    }
  }

  it('keeps pages separate', () => {
    expect(Object.keys(g.ko).length).toBeGreaterThan(0);
    for (const p of Object.keys(gFiles)) expect(p).toContain('/gambling/');
    for (const p of Object.keys(uFiles)) expect(p).toContain('/understanding/');
    expect(g.ko['app.title']).toBe('오로벨 카지노');
    expect(u.ko['app.title']).not.toBe(g.ko['app.title']);
  });
});

describe('t()', () => {
  it('falls back to ko for empty values, then to the key', () => {
    const t = makeT({ ko: { 'a.b': '한국어' }, en: { 'a.b': '' }, it: {} });
    expect(t('a.b', undefined, 'en')).toBe('한국어');
    expect(t('a.b', undefined, 'it')).toBe('한국어');
    expect(tg('nope.key')).toBe('nope.key');
  });
  it('substitutes {name} params', () => {
    const t = makeT({ ko: { 'a.b': '{who}님 {n}판' }, en: { 'a.b': 'Hi {who}' }, it: { 'a.b': '' } });
    expect(t('a.b', { who: 'Kim', n: 3 }, 'ko')).toBe('Kim님 3판');
    expect(t('a.b', { who: 'Kim' }, 'en')).toBe('Hi Kim');
    expect(t('a.b', { who: 'Kim', n: 3 }, 'it')).toBe('Kim님 3판');
    expect(format('x {missing} y', {})).toBe('x {missing} y');
    expect(format('x {a} {a}', { a: 0 })).toBe('x 0 0');
  });
});

describe('pickLang', () => {
  it('orders query, stored, navigator, ko', () => {
    expect(pickLang({ query: 'en', stored: 'it', navigatorLang: 'ko-KR' })).toBe('en');
    expect(pickLang({ query: 'xx', stored: 'it', navigatorLang: 'en-US' })).toBe('it');
    expect(pickLang({ stored: null, navigatorLang: 'en-US' })).toBe('en');
    expect(pickLang({ navigatorLang: 'fr-FR' })).toBe('ko');
    expect(pickLang()).toBe('ko');
  });
});
