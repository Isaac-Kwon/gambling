// OROBELLE neon logo: gold bell emblem + gold wordmark + neon "CASINO" line (+ optional Korean name).
import { t } from '@shared/i18n.gambling';
import { bellEmblem } from './svg';
import { goldText, h, neonText } from './kit';

export type LogoSize = 'sm' | 'md' | 'lg';

/**
 * - `lg`: stacked, emblem on top (gate screen). `md`: stacked, smaller (lobby header).
 * - `sm`: one row, emblem + wordmark (HUD / receipts).
 * `ko` adds the Korean name under the mark; `slogan` adds the gate slogan.
 */
export function logo(o: { size?: LogoSize; ko?: boolean; slogan?: boolean; testid?: string } = {}): HTMLElement {
  const size = o.size ?? 'md';
  const word = goldText(t('app.brand'), { glow: 'magenta', className: 'ui-logo__word' });
  const kids: (HTMLElement | SVGElement | null)[] = [
    h('span', 'ui-logo__emblem', [bellEmblem()]),
    h('span', 'ui-logo__text', [
      word,
      size === 'sm'
        ? null
        : h('span', 'ui-logo__sub', [h('span', 'ui-logo__rule'), neonText(t('app.brand.sub'), { color: 'cyan', className: 'ui-logo__casino' }), h('span', 'ui-logo__rule')]),
      o.ko ? h('span', 'ui-logo__ko', [t('app.title')]) : null,
    ]),
    o.slogan ? neonText(t('app.slogan'), { color: 'magenta', className: 'ui-logo__slogan' }) : null,
  ];
  const el = h('div', `ui-logo ui-logo--${size}`, kids);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${t('app.brand')} ${t('app.brand.sub')}`);
  if (o.testid) el.dataset.testid = o.testid;
  return el;
}
