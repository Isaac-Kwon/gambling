/**
 * Purpose statement + problem-gambling notice, shown on the lobby (footer), in the settings sheet, and (purpose
 * line only) on the gate. All of its strings live in i18n/gambling/notice.*.json: the bundle check allow-lists
 * exactly those strings (scripts/check-gambling-bundle.ts), so keep every notice sentence in that namespace.
 */
import './notice.css';
import { t } from '../../shared/i18n.gambling';
import { h } from './ui';

export function noticeBlock(o: { testid?: string } = {}): HTMLElement {
  const el = h('aside', 'notice', [
    h('p', 'notice__purpose', [t('notice.purpose')]),
    h('p', 'notice__line', [t('notice.nomoney')]),
    h('p', 'notice__line', [t('notice.warning')]),
    h('p', 'notice__help', [t('notice.help')]),
  ]);
  if (o.testid) el.dataset.testid = o.testid;
  return el;
}

/** One line, for the gate. */
export function noticePurpose(): HTMLElement {
  const el = h('p', 'notice-purpose', [t('notice.purpose')]);
  el.dataset.testid = 'notice-purpose';
  return el;
}
