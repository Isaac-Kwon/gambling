import type { Section } from './types';

// Placeholder: replaced by the real section implementation.
const section: Section = {
  id: 'intro',
  titleKey: 'app.toc.intro',
  needs: 'any',
  render(el, ctx) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = ctx.t('app.pending');
    el.append(p);
  },
};
export default section;
