import type { Session } from '@shared/schema';
import type { Translator } from '@shared/i18n';
import { oceanAnalysis, type OceanAnalysis } from '../analysis/ocean';
import type { Section } from './types';

/** Facts and the sources behind them (CONTEXT §4.8.1). Numbers refer to `case.src<N>.*`. */
export const CASE_FACTS: readonly { key: string; src: readonly number[] }[] = [
  { key: 'case.p1', src: [1, 2] },
  { key: 'case.p2', src: [1, 2] },
  { key: 'case.p3', src: [3] },
  { key: 'case.p4', src: [3, 1, 2] },
  { key: 'case.p5', src: [1, 2, 4] },
  { key: 'case.p6', src: [1, 2, 5] },
];
export const CASE_SOURCES: readonly number[] = [1, 2, 3, 4, 5];

export interface CaseMe {
  omens: number;
  fixed: number;
  rounds: number;
  after: { rounds: number; bet: number; avgBet: number | null };
  other: { rounds: number; bet: number; avgBet: number | null };
  controls: { stop: number; turbo: number; auto: number; betChanges: number };
  flush: number | null;
  /** Return per credit of the ocean machine (from edges.ts) and the expected loss on the after-omen wagering. */
  ret: number;
  expectedLoss: number;
}

/** Pure view model. null = no ocean play in the session. */
export function caseMe(a: OceanAnalysis | null): CaseMe | null {
  if (!a || (a.rounds === 0 && !a.flush)) return null;
  const c = a.controls;
  return {
    omens: a.omens.length,
    fixed: a.fixedAtOmens,
    rounds: a.rounds,
    after: { rounds: a.afterOmen.rounds, bet: a.afterOmen.bet, avgBet: a.afterOmen.avgBet },
    other: { rounds: a.otherRounds.rounds, bet: a.otherRounds.bet, avgBet: a.otherRounds.avgBet },
    controls: { stop: c.stop, turbo: c.turbo, auto: c.auto, betChanges: c.betChanges },
    flush: a.flush && a.flush.amount > 0 ? a.flush.amount : null,
    ret: 1 - a.edge,
    expectedLoss: a.afterOmen.expectedLoss,
  };
}

/** Plain-text lines of the "my session" block, in display order. */
export function caseMeLines(m: CaseMe | null, t: Translator, nf: (n: number) => string, pct: (n: number) => string): string[] {
  if (!m) return [t('case.me.none')];
  const out: string[] = [];
  if (m.omens === 0) out.push(t('case.me.noOmen', { rounds: nf(m.rounds) }));
  else {
    out.push(t('case.me.omens', { n: nf(m.omens), fixed: nf(m.fixed) }));
    if (m.after.rounds > 0) {
      out.push(t('case.me.after', {
        rounds: nf(m.after.rounds), bet: nf(m.after.bet), avgAfter: nf(Math.round(m.after.avgBet ?? 0)),
        avgOther: m.other.avgBet === null ? '-' : nf(Math.round(m.other.avgBet)), otherRounds: nf(m.other.rounds),
      }));
      out.push(t('case.me.stayed', { bet: nf(m.after.bet), ret: pct(m.ret), loss: nf(Math.round(m.expectedLoss)) }));
      out.push(t('case.me.controls', {
        stop: nf(m.controls.stop), turbo: nf(m.controls.turbo), auto: nf(m.controls.auto), bets: nf(m.controls.betChanges),
      }));
    }
  }
  if (m.flush !== null) out.push(t('case.me.flush', { amount: nf(m.flush) }));
  return out;
}

export const meFor = (s: Session | undefined): CaseMe | null => (s ? caseMe(oceanAnalysis(s)) : null);

const section: Section = {
  id: 'caseStudy',
  titleKey: 'app.toc.caseStudy',
  needs: 'any',
  render(el, ctx) {
    const { t } = ctx;
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
      const e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    const link = (n: number) => {
      const a = mk('a', t(`case.src${n}.title`));
      a.href = t(`case.src${n}.url`);
      a.rel = 'noopener noreferrer';
      return a;
    };

    el.append(mk('p', t('case.intro')));
    el.append(mk('h3', t('case.title.history')));
    const ol = mk('ol');
    for (const f of CASE_FACTS) {
      const li = mk('li');
      li.append(mk('span', t(f.key)));
      const refs = mk('span', '', 'muted');
      refs.append(' (');
      f.src.forEach((n, i) => { if (i) refs.append(', '); refs.append(link(n)); });
      refs.append(')');
      li.append(refs);
      ol.append(li);
    }
    el.append(ol);
    el.append(mk('h3', t('case.refs')));
    const ul = mk('ul');
    for (const n of CASE_SOURCES) {
      const li = mk('li');
      li.append(link(n), mk('span', ` ${t(`case.src${n}.url`)}`, 'muted'));
      ul.append(li);
    }
    el.append(ul);

    el.append(mk('h3', t('case.me.title')));
    const nf = new Intl.NumberFormat(ctx.lang);
    const pf = new Intl.NumberFormat(ctx.lang, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const box = mk('div', undefined, 'callout');
    for (const line of caseMeLines(meFor(ctx.session), t, (n) => nf.format(n), (n) => pf.format(n))) box.append(mk('p', line));
    el.append(box);
    el.append(mk('p', t('case.fiction'), 'muted'));
  },
};
export default section;
