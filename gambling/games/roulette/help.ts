/** RUBY ROULETTE how-to-play content (src/help.ts). Payouts and limits come from the game's own rules. */
import { multOf, type RouletteBet } from '../../../shared/rules/roulette';
import { lines, type HelpBuilder } from '../../src/help';
import { CHIP_VALUES, TABLE_MAX, TABLE_MIN, limitOf } from './core';

const fmt = (n: number): string => n.toLocaleString('en-US');

/** One representative bet per row of the payout table. */
export const BET_ROWS: readonly { key: string; bet: RouletteBet }[] = [
  { key: 'straight', bet: { kind: 'straight', n: 17 } },
  { key: 'split', bet: { kind: 'split', a: 17, b: 18 } },
  { key: 'dozen', bet: { kind: 'dozen', i: 1 } },
  { key: 'column', bet: { kind: 'column', i: 1 } },
  { key: 'color', bet: { kind: 'red' } },
  { key: 'parity', bet: { kind: 'odd' } },
  { key: 'half', bet: { kind: 'low' } },
];

export const help: HelpBuilder = ({ t }) => ({
  title: t('help.title', { game: t('roulette.title') }),
  sections: [
    { title: t('help.h.goal'), blocks: [{ kind: 'p', text: t('help.roulette.goal') }] },
    { title: t('help.h.play'), blocks: [{ kind: 'list', items: lines(t('help.roulette.play', { chips: CHIP_VALUES.map(fmt).join(' / ') })) }] },
    {
      title: t('help.h.pay'),
      blocks: [
        {
          kind: 'table',
          head: [t('help.roulette.col.bet'), t('help.roulette.col.pays'), t('help.roulette.col.max')],
          rows: BET_ROWS.map((b) => [t(`help.roulette.bet.${b.key}`), `${multOf(b.bet) - 1}:1`, fmt(limitOf(b.bet))]),
          num: [1, 2],
        },
        { kind: 'list', items: lines(t('help.roulette.rules', { min: fmt(TABLE_MIN), max: fmt(TABLE_MAX) })) },
      ],
    },
  ],
});
