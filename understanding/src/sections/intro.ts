import { feltKey, parseFeltInput, readFelt, writeFelt, type FeltRecord } from '../felt';
import type { Section, SectionCtx } from './types';
import './intro.css';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let cleanup: (() => void) | null = null;

/** Toggle the gate on `main.sections`: CSS collapses/blurs the later sections, `inert` keeps them out of focus and AT. */
function setGate(main: HTMLElement | null, on: boolean): void {
  if (!main) return;
  main.classList.toggle('is-gated', on);
  main.querySelectorAll<HTMLElement>(':scope > .section:not([data-section="intro"]) > .section-body').forEach((b) => {
    if (on) b.setAttribute('inert', ''); else b.removeAttribute('inert');
  });
}

function render(el: HTMLElement, ctx: SectionCtx): void {
  const { t, lang } = ctx;
  const nf = new Intl.NumberFormat(lang);
  const key = feltKey(ctx.summary);
  const main = el.closest<HTMLElement>('main.sections');
  let rec = readFelt(key);

  el.replaceChildren();
  el.append(h('p', '', t('intro.lead')));
  if (ctx.source.kind === 'demo') el.append(h('p', 'muted', t('intro.demo')));

  const form = h('form', 'intro-form');
  form.noValidate = true;

  const qm = h('div');
  const lm = h('label', 'q', t('intro.q.minutes'));
  lm.htmlFor = 'intro-minutes';
  const im = h('input');
  im.type = 'text'; im.id = 'intro-minutes'; im.inputMode = 'decimal'; im.autocomplete = 'off';
  const rowM = h('div', 'intro-row');
  rowM.append(im, h('span', 'intro-unit', t('intro.unit.minutes')));
  qm.append(lm, rowM);

  const fs = h('fieldset');
  fs.append(h('legend', '', t('intro.q.result')));
  const rowR = h('div', 'intro-row');
  const radios: Record<string, HTMLInputElement> = {};
  for (const v of ['won', 'lost', 'even'] as const) {
    const lab = h('label', 'intro-opt');
    const r = h('input');
    r.type = 'radio'; r.name = 'intro-dir'; r.value = v;
    radios[v] = r;
    lab.append(r, document.createTextNode(t(`intro.opt.${v}`)));
    rowR.append(lab);
  }
  const ia = h('input');
  ia.type = 'text'; ia.inputMode = 'numeric'; ia.autocomplete = 'off';
  ia.setAttribute('aria-label', t('intro.amount'));
  const rowA = h('div', 'intro-row');
  rowA.append(ia, h('span', 'intro-unit', t('intro.unit.credits')));
  fs.append(rowR, rowA);

  const err = h('p', 'intro-err');
  err.setAttribute('role', 'status');
  const actions = h('div', 'intro-actions');
  const ok = h('button', 'btn', t('intro.btn.show'));
  ok.type = 'submit';
  const skip = h('button', 'btn secondary', t('intro.btn.skip'));
  skip.type = 'button';
  skip.dataset.testid = 'btn-skip';
  actions.append(ok, skip);
  form.append(qm, fs, err, actions);

  const answered = h('div', 'intro-answered');
  answered.hidden = true;
  answered.setAttribute('aria-live', 'polite');
  const msg = h('p');
  const edit = h('button', 'btn secondary', t('intro.btn.edit'));
  edit.type = 'button';
  answered.append(msg, edit);

  const gateHint = h('p', 'muted', t('intro.gate.hint'));

  const showAnswered = (): void => {
    if (!rec) return;
    if (rec.skipped && rec.minutes === null && rec.net === null) msg.textContent = t('intro.skipped');
    else {
      const parts: string[] = [];
      if (rec.minutes !== null) parts.push(t('intro.saved.minutes', { v: nf.format(rec.minutes) }));
      if (rec.net !== null) {
        parts.push(t('intro.saved.net', { v: new Intl.NumberFormat(lang, { signDisplay: 'exceptZero' }).format(rec.net) }));
      }
      msg.textContent = `${t('intro.saved')} ${parts.join(' · ')}`;
    }
    form.hidden = true; gateHint.hidden = true; answered.hidden = false;
  };
  const finish = (r: FeltRecord): void => {
    rec = r;
    writeFelt(r);
    setGate(main, false);
    showAnswered();
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const dir = (Object.keys(radios).find((k) => radios[k].checked) ?? '') as 'won' | 'lost' | 'even' | '';
    const p = parseFeltInput(im.value, ia.value, dir);
    const badMin = im.value.trim() !== '' && p.minutes === null;
    const badNet = (dir === 'won' || dir === 'lost') && p.net === null;
    if (badMin || badNet) { err.textContent = t('intro.err.number'); return; }
    if (p.minutes === null && p.net === null) { err.textContent = t('intro.err.empty'); return; }
    err.textContent = '';
    finish({ key, minutes: p.minutes, net: p.net, skipped: false });
  });
  skip.addEventListener('click', () => finish({ key, minutes: null, net: null, skipped: true }));
  edit.addEventListener('click', () => {
    if (rec?.minutes != null) im.value = String(rec.minutes);
    if (rec?.net != null) {
      radios[rec.net > 0 ? 'won' : rec.net < 0 ? 'lost' : 'even'].checked = true;
      if (rec.net !== 0) ia.value = String(Math.abs(rec.net));
    }
    form.hidden = false; answered.hidden = true; im.focus();
  });

  el.append(form, answered, gateHint);
  if (rec) showAnswered(); else setGate(main, true);

  cleanup = () => setGate(main, false);
}

const section: Section = {
  id: 'intro',
  titleKey: 'app.toc.intro',
  needs: 'any',
  render,
  dispose() { cleanup?.(); cleanup = null; },
};
export default section;
