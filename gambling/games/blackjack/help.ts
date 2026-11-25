/** BLACKJACK 21 how-to-play content (src/help.ts). Rules come from the shared rule set. */
import { BJ } from '../../../shared/rules/blackjack';
import { lines, type HelpBuilder } from '../../src/help';
import { BET_UNIT, CHIP_VALUES, MAX_BET } from './core';

const fmt = (n: number): string => n.toLocaleString('en-US');

export const help: HelpBuilder = ({ t }) => ({
  title: t('help.title', { game: t('blackjack.title') }),
  sections: [
    { title: t('help.h.goal'), blocks: [{ kind: 'list', items: lines(t('help.blackjack.goal')) }] },
    {
      title: t('help.h.play'),
      blocks: [{ kind: 'list', items: lines(t('help.blackjack.play', { chips: CHIP_VALUES.map(fmt).join(' / '), min: fmt(BET_UNIT), max: fmt(MAX_BET), unit: fmt(BET_UNIT) })) }],
    },
    {
      title: t('help.h.pay'),
      blocks: [{
        kind: 'table',
        rows: [
          [t('help.blackjack.pay.bj'), BJ.bjPays === 1.5 ? '3:2' : `${BJ.bjPays}:1`],
          [t('help.blackjack.pay.win'), '1:1'],
          [t('help.blackjack.pay.push'), t('help.blackjack.pay.pushV')],
        ],
        num: [1],
      }],
    },
    { title: t('help.h.rules'), blocks: [{ kind: 'list', items: lines(t('help.blackjack.rules', { decks: BJ.decks, cut: Math.round(BJ.cut * 100) })) }] },
  ],
});
