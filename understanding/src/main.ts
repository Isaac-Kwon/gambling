/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { getLang, pickLang, setLang } from '@shared/i18n';
import { blockPinchZoom } from '@shared/nozoom';
import { t } from '@shared/i18n.understanding';
import { createChartKit, type ChartKit } from './charts/kit';
import { createSimClient } from './sim';
import { demoAvailable, loadDemo, resolveSource, type DataSource, type Source } from './source';
import { loaders, SECTION_IDS } from './sections';
import type { Section, SectionCtx, SectionId } from './sections/types';

const app = document.getElementById('app') as HTMLElement;
const sim = createSimClient();
let charts: ChartKit;
let teardown: (() => void)[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function initLang(): void {
  const q = new URLSearchParams(location.search).get('lang');
  let stored: string | null = null;
  try { stored = localStorage.getItem('eg.lang'); } catch { /* storage blocked */ }
  setLang(pickLang({ query: q, stored, navigatorLang: navigator.language }));
  document.documentElement.lang = getLang();
  document.title = t('app.title');
}

const nf = () => new Intl.NumberFormat(getLang());
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m >= 1 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function demoButton(label: string): HTMLButtonElement {
  const b = el('button', 'btn', label);
  b.type = 'button';
  b.dataset.testid = 'open-demo';
  b.addEventListener('click', async () => {
    b.disabled = true;
    const d = await loadDemo();
    if (!d) { b.disabled = false; b.after(el('p', 'muted', t('app.demo.missing'))); return; }
    try { history.replaceState(null, '', location.pathname + '?demo=1'); } catch { /* ignore */ }
    show(d);
    window.scrollTo(0, 0);
  });
  return b;
}

function statCards(s: DataSource['summary']): HTMLElement {
  const n = Object.values(s.games).reduce((a, g) => a + (g?.n ?? 0), 0);
  const items: [string, string][] = [
    [t('app.stat.rounds'), nf().format(n)],
    [t('app.stat.duration'), fmtDuration(s.durMs)],
    [t('app.stat.start'), nf().format(s.startCredits)],
    [t('app.stat.final'), nf().format(s.finalCredits)],
    [t('app.stat.peak'), nf().format(s.peak.bal)],
  ];
  const wrap = el('div', 'stats');
  for (const [k, v] of items) {
    const c = el('div', 'stat');
    c.append(el('span', 'stat-v', v), el('span', 'stat-k', k));
    wrap.append(c);
  }
  return wrap;
}

function header(source: Source): HTMLElement {
  const h = el('header', 'page-head');
  h.append(el('h1', 'page-title', t('app.title')), el('p', 'lede', t('app.lede')));
  if (source.kind !== 'none') {
    const b = el('p', 'badge', t(`app.source.${source.kind}`));
    b.dataset.testid = 'source-kind';
    h.append(b);
  }
  return h;
}

/** Link back to the game lobby (site base): a new session starts there. */
function backLink(testid: string): HTMLAnchorElement {
  const a = el('a', 'page-back', t('app.back'));
  a.href = import.meta.env.BASE_URL;
  a.dataset.testid = testid;
  return a;
}

function footer(): HTMLElement {
  const f = el('footer', 'page-foot');
  f.append(backLink('back-to-game-foot'));
  return f;
}

function noData(): HTMLElement {
  const box = el('section', 'card nodata');
  box.dataset.testid = 'nodata';
  box.append(el('h2', '', t('app.nodata.title')), el('p', '', t('app.nodata.body')));
  if (demoAvailable()) box.append(demoButton(t('app.demo.open')));
  else box.append(el('p', 'muted', t('app.demo.missing')));
  return box;
}

function degrade(source: DataSource): HTMLElement {
  const box = el('div', 'callout');
  box.append(el('strong', '', t('app.degrade.title')), el('p', '', t('app.degrade.body')), statCards(source.summary));
  if (demoAvailable()) box.append(demoButton(t('app.degrade.demo')));
  return box;
}

function buildToc(): { nav: HTMLElement; setCurrent(id: string): void } {
  const nav = el('nav', 'toc');
  nav.setAttribute('aria-label', t('app.toc.label'));
  const toggle = el('button', 'toc-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'toc-list');
  const lbl = el('span', 'toc-label', t('app.toc.label'));
  const cur = el('span', 'toc-current');
  toggle.append(lbl, cur, el('span', 'toc-chev'));
  const list = el('ol', 'toc-list');
  list.id = 'toc-list';
  list.hidden = true;
  const links = new Map<string, HTMLAnchorElement>();
  for (const id of SECTION_IDS) {
    const li = el('li');
    const a = el('a', '', t(`app.toc.${id}`));
    a.href = `#sec-${id}`;
    a.addEventListener('click', () => setOpen(false));
    li.append(a);
    list.append(li);
    links.set(id, a);
  }
  const setOpen = (o: boolean) => { list.hidden = !o; toggle.setAttribute('aria-expanded', String(o)); };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
  const onDoc = (e: Event) => { if (!nav.contains(e.target as Node)) setOpen(false); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onDoc);
  teardown.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onDoc); });
  nav.append(toggle, list);
  return {
    nav,
    setCurrent(id) {
      cur.textContent = t(`app.toc.${id}`);
      links.forEach((a, k) => (k === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    },
  };
}

function show(source: Source): void {
  teardown.forEach((f) => f());
  teardown = [];
  app.replaceChildren();
  window.scrollTo(0, 0);
  const wrap = el('div', 'page');
  wrap.append(backLink('back-to-game'), header(source));
  if (source.kind === 'none') {
    wrap.append(noData(), footer());
    app.append(wrap);
    return;
  }
  const toc = buildToc();
  const main = el('main', 'sections');
  const holders = new Map<SectionId, HTMLElement>();
  for (const id of SECTION_IDS) {
    const s = el('section', 'section');
    s.id = `sec-${id}`;
    s.dataset.section = id;
    const h = el('h2', 'section-title', t(`app.toc.${id}`));
    const body = el('div', 'section-body');
    s.append(h, body);
    main.append(s);
    holders.set(id, body);
  }
  wrap.append(toc.nav, main, footer());
  app.append(wrap);
  toc.setCurrent(SECTION_IDS[0]);

  const ctx: SectionCtx = {
    source,
    session: source.kind === 'summary' ? undefined : source.session,
    summary: source.summary,
    t,
    lang: getLang(),
    charts,
    sim,
  };
  const mounted = new Set<SectionId>();
  const mountOne = async (id: SectionId): Promise<void> => {
    if (mounted.has(id)) return;
    mounted.add(id);
    const body = holders.get(id) as HTMLElement;
    try {
      const sec: Section = (await loaders[id]()).default;
      if (sec.needs === 'full' && !ctx.session) {
        body.append(degrade(source));
        return;
      }
      teardown.push(() => sec.dispose?.());
      await sec.render(body, ctx);
    } catch (err) {
      console.error(`section ${id} failed`, err);
      body.append(el('p', 'muted', t('app.pending')));
    }
  };

  void mountOne(SECTION_IDS[0]);
  if ('IntersectionObserver' in window) {
    const mountIO = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) { void mountOne((e.target as HTMLElement).dataset.section as SectionId); mountIO.unobserve(e.target); }
    }, { rootMargin: '900px 0px' });
    const visible = new Set<Element>();
    const curIO = new IntersectionObserver((es) => {
      for (const e of es) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
      const first = [...holders.keys()].find((k) => visible.has(holders.get(k)!.parentElement!));
      if (first) toc.setCurrent(first);
    }, { rootMargin: '-60px 0px -60% 0px' });
    holders.forEach((b) => { mountIO.observe(b.parentElement!); curIO.observe(b.parentElement!); });
    teardown.push(() => { mountIO.disconnect(); curIO.disconnect(); });
  } else {
    SECTION_IDS.forEach((id) => void mountOne(id));
  }
}

async function boot(): Promise<void> {
  blockPinchZoom();
  initLang();
  charts = createChartKit(t('app.chart.empty'));
  const hash = location.hash;
  const source = await resolveSource(hash, location.search);
  // The handoff payload (#s=) has been read; drop it so #sec-<id> anchors work. Summary stays stashed for reloads.
  const target = /^#sec-(\w+)$/.exec(hash)?.[1];
  if (hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  show(source);
  if (target && source.kind !== 'none') {
    // sections above may still grow while they mount; jump once now and once after layout settles
    const go = () => document.getElementById(`sec-${target}`)?.scrollIntoView();
    go();
    setTimeout(go, 400);
  }
}

addEventListener('pagehide', () => sim.dispose());
registerSW({ immediate: false }); // a new worker applies on the next launch, never mid-session
void boot();
