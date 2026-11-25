import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Session } from '@shared/schema';
import { makeT, mergeDictionaries } from '@shared/i18n';
import { oceanAnalysis } from '../analysis/ocean';
import { oceanReturn } from '../analysis/edges';
import { caseMe, caseMeLines, CASE_FACTS, CASE_SOURCES } from './caseStudy';
import { personalLine, quizFacts, QUIZ_ITEMS, score } from './quiz';
import { HELPLINE } from './help';

const fx = (n: string): Session => JSON.parse(readFileSync(new URL(`../analysis/__fixtures__/${n}.json`, import.meta.url), 'utf8'));
const dir = new URL('../../../i18n/understanding/', import.meta.url);
const files: Record<string, Record<string, string>> = {};
for (const f of readdirSync(dir)) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const t = makeT(mergeDictionaries(files as never));
const nf = (n: number) => String(n);

describe('caseStudy view model', () => {
  it('null without ocean play', () => {
    expect(caseMe(null)).toBeNull();
    expect(caseMeLines(null, t, nf, nf)).toEqual([t('case.me.none')]);
  });
  it('mirrors the ocean analysis; return comes from edges', () => {
    let checked = 0;
    for (const n of ['session-on', 'session-off', 'session-svb']) {
      const a = oceanAnalysis(fx(n)), m = caseMe(a);
      if (!a || !m) continue;
      checked++;
      expect(m.omens).toBe(a.omens.length);
      expect(m.ret).toBeCloseTo(oceanReturn(), 12);
      expect(m.expectedLoss).toBeCloseTo(a.afterOmen.bet * (1 - oceanReturn()), 9);
      const lines = caseMeLines(m, t, nf, (x) => x.toFixed(4));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join('\n')).not.toMatch(/\{\w+\}/);
    }
    expect(checked).toBeGreaterThan(0);
  });
  it('every fact has existing text and https sources', () => {
    expect(CASE_SOURCES).toHaveLength(5);
    for (const f of CASE_FACTS) {
      expect(t(f.key)).not.toBe(f.key);
      for (const n of f.src) expect(t(`case.src${n}.url`)).toMatch(/^https:\/\//);
    }
  });
  it('flush and no-omen lines', () => {
    const base = {
      omens: 0, fixed: 0, rounds: 12, after: { rounds: 0, bet: 0, avgBet: null }, other: { rounds: 12, bet: 120, avgBet: 10 },
      controls: { stop: 0, turbo: 0, auto: 0, betChanges: 0 }, flush: null, ret: 0.92, expectedLoss: 0,
    };
    expect(caseMeLines(base, t, nf, nf)).toEqual([t('case.me.noOmen', { rounds: '12' })]);
    expect(caseMeLines({ ...base, flush: 777 }, t, nf, nf).join('\n')).toContain('777');
  });
});

describe('quiz view model', () => {
  it('scores answers', () => {
    const a = new Map<string, boolean>(QUIZ_ITEMS.map((i) => [i.id, i.answer]));
    expect(score(QUIZ_ITEMS, a)).toEqual({ n: 5, total: 5, done: true });
    a.set('q1', !QUIZ_ITEMS[0].answer);
    a.delete('q5');
    expect(score(QUIZ_ITEMS, a)).toEqual({ n: 3, total: 5, done: false });
  });
  it('session facts are consistent and lines have no unresolved placeholders', () => {
    const f = quizFacts(fx('session-on'));
    expect(f.wagered).toBeGreaterThan(0);
    expect(f.expectedLoss).toBeGreaterThan(0);
    expect(f.expectedLoss).toBeLessThan(f.wagered);
    for (const it of QUIZ_ITEMS) {
      const l = personalLine(it.id, f, t, nf);
      if (l) expect(l).not.toMatch(/\{\w+\}/);
      expect(t(`quiz.${it.id}`)).not.toBe(`quiz.${it.id}`);
      expect(t(`quiz.${it.id}.exp`)).not.toBe(`quiz.${it.id}.exp`);
    }
    expect(personalLine('q1', null, t, nf)).toBeUndefined();
  });
});

describe('help and i18n', () => {
  it('only the 1336 number appears in help text', () => {
    expect(HELPLINE).toBe('1336');
    const all = Object.values(files['help.ko.json']).join(' ');
    expect(all.match(/\d{3,}/g)).toEqual(['1336', '1336']);
  });
  it('en/it carry the same keys as ko', () => {
    for (const ns of ['case', 'quiz', 'help'])
      for (const l of ['en', 'it'])
        expect(Object.keys(files[`${ns}.${l}.json`]).sort()).toEqual(Object.keys(files[`${ns}.ko.json`]).sort());
  });
});
