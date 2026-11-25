/** ORO SEVENS how-to-play content (src/help.ts). Numbers come from the game's own tables. */
import { SLOTS, type Sym } from '../../../shared/rules/slot';
import { lines, paytable, type HelpBuilder } from '../../src/help';
import { symbolSvg } from './art';
import { AUTO_COUNTS, STEPS } from './core';

export const PAY_ORDER = ['7', 'B', 'R', 'C', 'H', 's', 'h', 'c', 'd'] as const satisfies readonly Sym[];

export const help: HelpBuilder = ({ t, sv }) => {
  const cfg = SLOTS[sv];
  const name = (s: Sym): string => t(`help.sym.${s}`);
  return {
    title: t('help.title', { game: t('slot.title') }),
    sections: [
      { title: t('help.h.goal'), blocks: [{ kind: 'p', text: t('help.slot.goal') }] },
      { title: t('help.h.play'), blocks: [{ kind: 'list', items: lines(t('help.slot.play', { steps: STEPS.join(' / '), auto: AUTO_COUNTS.join(' / ') })) }] },
      {
        title: t('help.h.pay'),
        blocks: [
          { kind: 'p', text: t('help.reels.payNote') },
          paytable({ pay: cfg.pay, order: PAY_ORDER, svg: (s) => symbolSvg(s), name, head: t('help.col.sym') }),
          { kind: 'syms', items: [{ svg: symbolSvg('W'), label: name('W') }] },
          { kind: 'list', items: lines(t('help.reels.wild')) },
        ],
      },
      { title: t('help.h.rules'), blocks: [{ kind: 'list', items: lines(t('help.reels.rules')) }] },
      { title: t('help.h.lines'), blocks: [{ kind: 'paylines', lines: cfg.lines }] },
    ],
  };
};
