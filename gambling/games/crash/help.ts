/** SKYROCKET how-to-play content (src/help.ts). Limits come from the game's own constants. */
import { CRASH } from '../../../shared/rules/crash';
import { lines, type HelpBuilder } from '../../src/help';
import { BET_MAX, BET_MIN, BET_STEP, HIST_LEN } from './core';

const fmt = (n: number): string => n.toLocaleString('en-US');
const EXAMPLE_BET = 1000;
const EXAMPLE_MULTS = [1.5, 2, 5, 10];

export const help: HelpBuilder = ({ t }) => ({
  title: t('help.title', { game: t('crash.title') }),
  sections: [
    { title: t('help.h.goal'), blocks: [{ kind: 'p', text: t('help.crash.goal') }] },
    {
      title: t('help.h.play'),
      blocks: [{ kind: 'list', items: lines(t('help.crash.play', { min: fmt(BET_MIN), max: fmt(BET_MAX), step: fmt(BET_STEP), sec: CRASH.countdownMs / 1000, hist: HIST_LEN })) }],
    },
    { title: t('help.h.auto'), blocks: [{ kind: 'list', items: lines(t('help.crash.auto', { min: CRASH.minTarget.toFixed(2), max: fmt(CRASH.maxTarget) })) }] },
    {
      title: t('help.h.pay'),
      blocks: [
        {
          kind: 'table',
          head: [t('help.crash.col.at'), t('help.crash.col.get', { bet: fmt(EXAMPLE_BET) })],
          rows: EXAMPLE_MULTS.map((m) => [`${m.toFixed(2)}×`, fmt(Math.floor(EXAMPLE_BET * m))]),
          num: [0, 1],
        },
        { kind: 'list', items: lines(t('help.crash.rules', { cap: fmt(CRASH.cap) })) },
      ],
    },
  ],
});
