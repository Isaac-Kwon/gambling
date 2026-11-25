import type { Section } from './types';

/** Helpline number; the only phone number on the page. */
export const HELPLINE = '1336';

export const REMOVE_STEPS = ['help.remove.android', 'help.remove.ios', 'help.remove.desktop'] as const;
export const DATA_STEPS = ['help.data.android', 'help.data.ios', 'help.data.desktop'] as const;

const section: Section = {
  id: 'help',
  titleKey: 'app.toc.help',
  needs: 'any',
  render(el, ctx) {
    const { t } = ctx;
    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => {
      const e = document.createElement(tag);
      if (text !== undefined) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    };
    const list = (keys: readonly string[]) => {
      const ul = mk('ul');
      for (const k of keys) ul.append(mk('li', t(k)));
      return ul;
    };

    el.append(mk('p', t('help.intro')));
    const box = mk('div', undefined, 'callout');
    box.append(mk('strong', t('help.line.title')), mk('p', `${t('help.line.name')} (${t('help.line.hours')})`));
    const call = mk('a', t('help.line.call'), 'btn');
    call.href = `tel:${HELPLINE}`;
    box.append(call);
    el.append(box);

    el.append(mk('h3', t('help.remove.title')), mk('p', t('help.remove.intro')), list(REMOVE_STEPS));
    el.append(mk('h3', t('help.data.title')), mk('p', t('help.data.intro')), list(DATA_STEPS));
  },
};
export default section;
