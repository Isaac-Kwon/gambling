import { t } from '@shared/i18n.understanding';
import { resolveHandoff } from '../../shared/handoff';

// TEMPORARY handoff check (P4-A1). Phase 5 replaces this with the real page.
const app = document.getElementById('app');
if (app) {
  app.textContent = t('app.title');
  const out = document.createElement('p');
  out.dataset.testid = 'handoff';
  out.textContent = '...';
  app.append(out);
  let storage: Storage | null = null;
  try { storage = localStorage; } catch { storage = null; }
  void resolveHandoff(location.hash, storage).then((h) => {
    out.textContent = h === null ? 'no data'
      : h.kind === 'full' ? `full session: ${h.session.events.length} rounds`
      : 'summary only';
  }, () => { out.textContent = 'no data'; });
}
