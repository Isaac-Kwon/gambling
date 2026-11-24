import { t } from '@shared/i18n.understanding';

const app = document.getElementById('app');
if (app) {
  app.textContent = t('app.title');
}
