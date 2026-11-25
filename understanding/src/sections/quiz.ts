import type { Session } from '@shared/schema';
import type { Translator } from '@shared/i18n';
import { returnTable } from '../analysis/edges';
import { isNearMiss, roundsOf } from '../analysis/mapping';
import { oceanAnalysis } from '../analysis/ocean';
import type { Section } from './types';
import './quiz.css';

export interface QuizItem { id: string; answer: boolean }
/** All five statements are false; the point is to read each one rather than guess a pattern. */
export const QUIZ_ITEMS: readonly QuizItem[] = [
  { id: 'q1', answer: false }, { id: 'q2', answer: false }, { id: 'q3', answer: false },
  { id: 'q4', answer: false }, { id: 'q5', answer: false },
];

export interface QuizFacts {
  longestLoss: number;
  raisedAfterLoss: number;
  nearMiss: number;
  omens: number;
  wagered: number;
  expectedLoss: number;
}

/** Numbers from the user's own session that the explanations can point at. */
export function quizFacts(s: Session): QuizFacts {
  const rs = roundsOf(s);
  const table = returnTable(s.sv ?? 'a');
  let run = 0, longest = 0, raised = 0, near = 0, wagered = 0, loss = 0;
  let prev: { bet: number; net: number } | null = null;
  for (const { e } of rs) {
    if (e.net < 0) { run++; if (run > longest) longest = run; } else run = 0;
    if (prev && prev.net < 0 && e.bet > prev.bet) raised++;
    if (isNearMiss(e)) near++;
    wagered += e.bet;
    loss += e.bet * (1 - (table[e.game] ?? 1));
    prev = e;
  }
  return {
    longestLoss: longest, raisedAfterLoss: raised, nearMiss: near, omens: oceanAnalysis(s)?.omens.length ?? 0,
    wagered, expectedLoss: loss,
  };
}

/** Personal line for an item (undefined when the session has nothing to say about it). */
export function personalLine(id: string, f: QuizFacts | null, t: Translator, nf: (n: number) => string): string | undefined {
  if (!f) return undefined;
  switch (id) {
    case 'q1': return f.longestLoss >= 2 ? t('quiz.q1.me', { n: nf(f.longestLoss) }) : undefined;
    case 'q2': return f.raisedAfterLoss > 0 ? t('quiz.q2.me', { n: nf(f.raisedAfterLoss) }) : undefined;
    case 'q3': return f.nearMiss > 0 ? t('quiz.q3.me', { n: nf(f.nearMiss) }) : undefined;
    case 'q4': return f.omens > 0 ? t('quiz.q4.me', { n: nf(f.omens) }) : undefined;
    case 'q5': return f.wagered > 0 ? t('quiz.q5.me', { wagered: nf(f.wagered), loss: nf(Math.round(f.expectedLoss)) }) : undefined;
    default: return undefined;
  }
}

/** Number of correct answers; unanswered items do not count. */
export function score(items: readonly QuizItem[], answers: ReadonlyMap<string, boolean>): { n: number; total: number; done: boolean } {
  let n = 0;
  for (const it of items) if (answers.get(it.id) === it.answer) n++;
  return { n, total: items.length, done: items.every((it) => answers.has(it.id)) };
}

const section: Section = {
  id: 'quiz',
  titleKey: 'app.toc.quiz',
  needs: 'any',
  render(el, ctx) {
    const { t } = ctx;
    const nfmt = new Intl.NumberFormat(ctx.lang);
    const nf = (n: number) => nfmt.format(n);
    const facts = ctx.session ? quizFacts(ctx.session) : null;
    const answers = new Map<string, boolean>();
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
      const e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };

    el.append(mk('p', t('quiz.intro')));
    const scoreBox = mk('div', undefined, 'quiz-item');
    scoreBox.hidden = true;
    scoreBox.setAttribute('role', 'status');
    scoreBox.setAttribute('aria-live', 'polite');
    const scoreText = mk('p', undefined, 'quiz-score');
    const reset = mk('button', t('quiz.reset'), 'btn secondary');
    reset.type = 'button';
    scoreBox.append(scoreText, reset);

    const resets: (() => void)[] = [];
    const update = () => {
      const sc = score(QUIZ_ITEMS, answers);
      scoreBox.hidden = !sc.done;
      if (sc.done) scoreText.textContent = t('quiz.score', { n: nf(sc.n), total: nf(sc.total) });
    };

    QUIZ_ITEMS.forEach((it, idx) => {
      const card = mk('section', undefined, 'quiz-item');
      const qid = `quiz-${it.id}`;
      card.setAttribute('aria-labelledby', qid);
      card.append(mk('p', t('quiz.q.label', { i: nf(idx + 1) }), 'quiz-label'));
      const q = mk('p', t(`quiz.${it.id}`), 'quiz-q');
      q.id = qid;
      const choices = mk('div', undefined, 'quiz-choices');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-labelledby', qid);
      const result = mk('div', undefined, 'quiz-result');
      result.setAttribute('aria-live', 'polite');
      const btns = ([true, false] as const).map((v) => {
        const b = mk('button', t(v ? 'quiz.btn.true' : 'quiz.btn.false'), 'btn');
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          if (answers.has(it.id)) return;
          answers.set(it.id, v);
          btns.forEach((x, k) => { x.setAttribute('aria-pressed', String((k === 0) === v)); x.disabled = true; });
          const ok = v === it.answer;
          result.replaceChildren(
            mk('p', ok ? t('quiz.correct') : t('quiz.wrong'), 'quiz-verdict'),
            mk('p', t('quiz.reveal', { answer: t(it.answer ? 'quiz.btn.true' : 'quiz.btn.false') })),
            mk('p', t(`quiz.${it.id}.exp`)),
          );
          const me = personalLine(it.id, facts, t, nf);
          if (me) result.append(mk('p', me));
          update();
        });
        return b;
      });
      resets.push(() => {
        btns.forEach((b) => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });
        result.replaceChildren();
      });
      choices.append(...btns);
      card.append(q, choices, result);
      el.append(card);
    });

    reset.addEventListener('click', () => { answers.clear(); resets.forEach((f) => f()); update(); });
    el.append(scoreBox);
  },
};
export default section;
