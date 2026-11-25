import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameId, SlotVariant } from '../../shared/config';
import { LANGS, type Lang } from '../../shared/i18n';
import { t } from '../../shared/i18n.gambling';
import { WORD_RULES } from '../../scripts/check-gambling-bundle';
import { help as blackjack } from '../games/blackjack/help';
import { help as crash } from '../games/crash/help';
import { help as ocean } from '../games/ocean/help';
import { help as roulette } from '../games/roulette/help';
import { help as slot } from '../games/slot/help';
import type { HelpBuilder, HelpCell, HelpDoc } from './help';
import { lines } from './help';

const BUILDERS: Record<GameId, HelpBuilder> = { slot, roulette, blackjack, crash, ocean };
const build = (g: GameId, lang: Lang, sv: SlotVariant = 'a'): HelpDoc =>
  BUILDERS[g]({ t: (k, p) => t(k, p, lang), sv });

/** Every visible string of a document. */
function texts(doc: HelpDoc): string[] {
  const out = [doc.title];
  const cellText = (c: HelpCell): string[] => (typeof c === 'string' ? [c] : c.map((x) => x.label));
  for (const s of doc.sections) {
    out.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === 'p') out.push(b.text);
      else if (b.kind === 'list') out.push(...b.items);
      else if (b.kind === 'syms') out.push(...b.items.map((x) => x.label));
      else if (b.kind === 'table') out.push(...(b.head ?? []), ...b.rows.flat().flatMap(cellText));
    }
  }
  return out;
}
const table = (doc: HelpDoc, title: string) => {
  const b = doc.sections.find((s) => s.title === title)!.blocks.find((x) => x.kind === 'table');
  if (b?.kind !== 'table') throw new Error('no table');
  return b;
};
const rowOf = (rows: HelpCell[][], label: string) => rows.find((r) => typeof r[0] !== 'string' && r[0].some((x) => x.label === label))!;

describe('how-to-play content', () => {
  it('every game builds in every language with no missing key or unfilled placeholder', () => {
    for (const g of Object.keys(BUILDERS) as GameId[]) {
      for (const lang of LANGS) {
        for (const sv of ['a', 'b'] as const) {
          const all = texts(build(g, lang, sv));
          expect(all.length).toBeGreaterThan(5);
          for (const s of all) {
            expect(s.trim(), `${g}/${lang}`).not.toBe('');
            expect(s, `${g}/${lang}`).not.toMatch(/help\.|[{}]/);
          }
        }
      }
    }
  });

  it('slot paytable follows the variant; ocean has its own table', () => {
    const a = table(build('slot', 'en', 'a'), 'Payouts');
    const b = table(build('slot', 'en', 'b'), 'Payouts');
    expect(rowOf(a.rows, 'Seven').slice(1)).toEqual(['150', '750', '3,000']);
    expect(rowOf(b.rows, 'Seven').slice(1)).toEqual(['250', '1,000', '3,000']);
    // Suits that pay the same share a row.
    expect((rowOf(a.rows, 'Spade')[0] as { label: string }[]).map((x) => x.label)).toEqual(['Spade', 'Heart']);
    expect(a.rows).toHaveLength(7);
    const o = table(build('ocean', 'en'), 'Payouts');
    expect(rowOf(o.rows, 'Golden pearl').slice(1)).toEqual(['100', '500', '2,000']);
    expect(o.rows.flat().some((c) => typeof c !== 'string' && c.some((x) => x.label === 'Seven'))).toBe(false);
  });

  it('roulette, blackjack, crash and ocean numbers come from the rules', () => {
    const r = table(build('roulette', 'en'), 'Payouts');
    expect(r.rows.map((x) => x[1])).toEqual(['35:1', '17:1', '2:1', '2:1', '1:1', '1:1', '1:1']);
    expect(r.rows.map((x) => x[2])).toEqual(['500', '1,000', '2,000', '2,000', '5,000', '5,000', '5,000']);
    expect(table(build('blackjack', 'en'), 'Payouts').rows[0][1]).toBe('3:2');
    expect(table(build('crash', 'en'), 'Payouts').rows).toContainEqual(['2.00×', '2,000']);
    expect(table(build('ocean', 'en'), 'BONUS').rows.map((x) => x[1])).toEqual(['5× – 15×', '30× – 100×', '250× – 1,250×']);
    const bj = texts(build('blackjack', 'ko')).join('\n');
    expect(bj).toContain('6덱');
    expect(bj).toContain('75%');
  });

  it('dictionary text passes the page word check', () => {
    for (const lang of LANGS) {
      const text = readFileSync(new URL(`../../i18n/gambling/help.${lang}.json`, import.meta.url), 'utf8');
      for (const r of WORD_RULES) expect(text.match(r.re), `${lang}: ${r.name}`).toBeNull();
    }
  });

  it('lines() splits on newlines and drops blanks', () => {
    expect(lines('a\n\n b \n')).toEqual(['a', 'b']);
  });
});
