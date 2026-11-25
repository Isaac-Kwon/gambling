/** ABYSS LEGEND how-to-play content (src/help.ts). Numbers come from the machine's own tables. */
import { OCEAN, type Omen } from '../../../shared/rules/ocean';
import type { Sym } from '../../../shared/rules/slot';
import { lines, paytable, type HelpBuilder } from '../../src/help';
import { symbolSvg } from './art';
import { STEPS } from './core';

const PAY_ORDER = ['7', 'B', 'R', 'C', 'H', 's', 'h', 'c', 'd'] as const satisfies readonly Sym[];
const OMENS: readonly Omen[] = ['clam', 'shark', 'whale'];
const fmt = (n: number): string => n.toLocaleString('en-US');

/** "5× – 15×": the smallest and largest bonus total (× bet) a creature stands for. */
export function omenRange(o: Omen): string {
  const m = OCEAN.bonus.filter((b) => b.omen === o).map((b) => b.mult);
  return `${fmt(Math.min(...m))}× – ${fmt(Math.max(...m))}×`;
}

export const help: HelpBuilder = ({ t }) => {
  const name = (s: Sym): string => t(`help.ocean.sym.${s}`);
  return {
    title: t('help.title', { game: t('ocean.title') }),
    sections: [
      { title: t('help.h.goal'), blocks: [{ kind: 'p', text: t('help.ocean.goal') }] },
      { title: t('help.h.play'), blocks: [{ kind: 'list', items: lines(t('help.ocean.play', { steps: STEPS.join(' / ') })) }] },
      {
        title: t('help.h.pay'),
        blocks: [
          { kind: 'p', text: t('help.reels.payNote') },
          paytable({ pay: OCEAN.slot.pay, order: PAY_ORDER, svg: (s) => symbolSvg(s), name, head: t('help.col.sym') }),
          { kind: 'syms', items: [{ svg: symbolSvg('W'), label: name('W') }] },
          { kind: 'list', items: lines(t('help.ocean.wild')) },
        ],
      },
      {
        title: t('help.h.bonus'),
        blocks: [
          { kind: 'list', items: lines(t('help.ocean.bonus')) },
          {
            kind: 'table',
            head: [t('help.ocean.col.sign'), t('help.ocean.col.bonus')],
            rows: OMENS.map((o) => [t(`help.ocean.omen.${o}`), omenRange(o)]),
            num: [1],
          },
        ],
      },
      { title: t('help.h.ticket'), blocks: [{ kind: 'p', text: t('help.ocean.ticket') }] },
      { title: t('help.h.rules'), blocks: [{ kind: 'list', items: lines(t('help.reels.rules')) }] },
      { title: t('help.h.lines'), blocks: [{ kind: 'paylines', lines: OCEAN.slot.lines }] },
    ],
  };
};
