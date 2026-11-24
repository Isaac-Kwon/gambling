import { describe, expect, it } from 'vitest';
import { dictionaries as g, t as tg } from './i18n.gambling';
import { dictionaries as u } from './i18n.understanding';

describe('i18n dictionaries', () => {
  for (const [name, d] of [['gambling', g], ['understanding', u]] as const) {
    for (const lang of ['en', 'it'] as const) {
      it(`${name}.${lang} has exactly the keys of ${name}.ko`, () => {
        expect(Object.keys(d[lang]).sort()).toEqual(Object.keys(d.ko).sort());
      });
    }
  }

  it('falls back to ko for empty values', () => {
    expect(tg('app.title', 'en')).toBe(g.ko['app.title']);
  });
});
