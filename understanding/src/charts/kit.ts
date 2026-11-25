// Thin uPlot wrapper (ARCHITECTURE 10.2). uPlot and its CSS are imported dynamically on first use.
// Charts resize to their container (ResizeObserver), can be read by touch, and use only greys + the accent.
import type uPlotType from 'uplot';
import { getLang } from '@shared/i18n';

// ---------------------------------------------------------------- pure helpers (unit tested)

/** Compact axis label: 1200 -> "1.2K" (en) / "1.2천" (ko). */
export function formatAxis(v: number, lang: string = getLang()): string {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) < 1000) return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(v);
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

/** Full-precision value for the touch/hover readout (grouped digits). */
export function formatValue(v: number | null | undefined, lang: string = getLang(), digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v);
}

export interface Bins {
  /** length n + 1 */
  edges: number[];
  /** length n, bin midpoints (used as x values) */
  centers: number[];
  /** length n */
  counts: number[];
}

/**
 * Equal-width histogram. Values equal to the upper bound go in the last bin. Values outside `range`
 * are dropped unless `clamp` is set (then they land in the first/last bin). Non-finite values are ignored.
 */
export function histogramBins(values: readonly number[], bins = 20, range?: [number, number], clamp = false): Bins {
  const n = Math.max(1, Math.floor(bins));
  let lo = range?.[0];
  let hi = range?.[1];
  if (lo === undefined || hi === undefined) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === Infinity) { mn = 0; mx = 1; }
    lo ??= mn;
    hi ??= mx;
  }
  if (hi <= lo) { hi = lo + 1; }
  const w = (hi - lo) / n;
  const counts = new Array<number>(n).fill(0);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    let i = Math.floor((v - lo) / w);
    if (v === hi) i = n - 1;
    if (clamp) i = Math.min(n - 1, Math.max(0, i));
    else if (i < 0 || i >= n) continue;
    counts[i]++;
  }
  const edges = Array.from({ length: n + 1 }, (_, i) => lo + i * w);
  const centers = Array.from({ length: n }, (_, i) => lo + (i + 0.5) * w);
  return { edges, centers, counts };
}

/** Index of the entry of ascending `xs` closest to `x` (-1 for an empty array). */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

/**
 * Min/max decimation for long series: keeps at most ~`max` points, always retaining each bucket's extremes
 * so spikes stay visible. Returns the original arrays when already short enough.
 */
export function decimate(x: readonly number[], ys: readonly (readonly (number | null)[])[], max = 1500): { x: number[]; ys: (number | null)[][] } {
  const n = x.length;
  if (n <= max) return { x: x.slice(), ys: ys.map((y) => y.slice()) };
  const buckets = Math.max(1, Math.floor(max / 2));
  const size = n / buckets;
  const keep = new Set<number>([0, n - 1]);
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(n, Math.floor((b + 1) * size));
    for (const y of ys) {
      let mi = -1;
      let ma = -1;
      for (let i = from; i < to; i++) {
        const v = y[i];
        if (v === null || v === undefined) continue;
        if (mi < 0 || v < (y[mi] as number)) mi = i;
        if (ma < 0 || v > (y[ma] as number)) ma = i;
      }
      if (mi >= 0) keep.add(mi);
      if (ma >= 0) keep.add(ma);
    }
  }
  const idx = [...keep].sort((a, b) => a - b);
  return { x: idx.map((i) => x[i]), ys: ys.map((y) => idx.map((i) => y[i])) };
}

/** Plot height for a given container width: wider screens get a bit more, within sane bounds. */
export function plotHeight(width: number, ratio = 0.5, min = 170, max = 300): number {
  return Math.round(Math.min(max, Math.max(min, width * ratio)));
}

// ---------------------------------------------------------------- public API

export interface Mark { x: number; label: string }
export interface LineSeries { label: string; y: (number | null)[]; dash?: boolean; /** fill under this line */ area?: boolean }
export interface LineOpts {
  x: number[];
  series: LineSeries[];
  marks?: Mark[];
  /** x value in axis ticks / readout, default formatAxis / formatValue */
  fmtX?: (x: number) => string;
  fmtY?: (y: number) => string;
  /** fix the y range, e.g. [0, 100] */
  yRange?: [number, number];
  /** fixed plot height (px); otherwise derived from the width */
  height?: number;
  /** accessible description of the chart */
  ariaLabel?: string;
}
export interface BarsOpts {
  x: number[];
  y: number[];
  label: string;
  fmtX?: (x: number) => string;
  fmtY?: (y: number) => string;
  height?: number;
  ariaLabel?: string;
}
export interface HistogramOpts {
  values: number[];
  bins?: number;
  range?: [number, number];
  clamp?: boolean;
  label: string;
  fmtX?: (x: number) => string;
  height?: number;
  ariaLabel?: string;
}

export interface Chart {
  /** Resolves once uPlot is loaded and the first draw is done. */
  readonly ready: Promise<void>;
  /** Replace the data: same shape as the creating options' data part. */
  update(data: Partial<LineOpts> | Partial<BarsOpts> | Partial<HistogramOpts>): void;
  destroy(): void;
}

export interface ChartKit {
  line(el: HTMLElement, o: LineOpts): Chart;
  area(el: HTMLElement, o: LineOpts): Chart;
  bars(el: HTMLElement, o: BarsOpts): Chart;
  histogram(el: HTMLElement, o: HistogramOpts): Chart;
  /** Two plots stacked over a shared x axis with a linked cursor (e.g. stimulus on top, running balance below). */
  stacked2(el: HTMLElement, top: LineOpts, bottom: LineOpts): Chart;
}

// ---------------------------------------------------------------- theme

interface Theme { accent: string; accentFill: string; ink: string; grid: string; series: string[] }

function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    accent: v('--chart-accent', '#1f5f8b'),
    accentFill: v('--chart-accent-fill', 'rgba(31,95,139,0.14)'),
    ink: v('--chart-ink', '#6b7280'),
    grid: v('--chart-grid', '#e5e7eb'),
    series: [v('--chart-s1', '#1f5f8b'), v('--chart-s2', '#4b5563'), v('--chart-s3', '#9ca3af'), v('--chart-s4', '#c4c9d1')],
  };
}

let uplotPromise: Promise<typeof uPlotType> | null = null;
function loadUPlot(): Promise<typeof uPlotType> {
  uplotPromise ??= Promise.all([import('uplot'), import('uplot/dist/uPlot.min.css')]).then(([m]) => m.default);
  return uplotPromise;
}

// ---------------------------------------------------------------- implementation

type Built = { u: uPlotType; destroy(): void };
type Builder = (U: typeof uPlotType, plot: HTMLElement, width: number, theme: Theme, readout: HTMLElement) => Built;

interface Shell { root: HTMLElement; readouts: HTMLElement[]; plots: HTMLElement[] }

function makeShell(el: HTMLElement, plots: number, aria?: string): Shell {
  el.classList.add('chart');
  el.replaceChildren();
  const root = document.createElement('div');
  root.className = 'chart-inner';
  const readouts: HTMLElement[] = [];
  const ps: HTMLElement[] = [];
  for (let i = 0; i < plots; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'chart-pane';
    const ro = document.createElement('div');
    ro.className = 'chart-readout';
    ro.setAttribute('aria-hidden', 'true');
    const plot = document.createElement('div');
    plot.className = 'chart-plot';
    if (aria) { plot.setAttribute('role', 'img'); plot.setAttribute('aria-label', aria); }
    wrap.append(ro, plot);
    root.append(wrap);
    readouts.push(ro);
    ps.push(plot);
  }
  el.append(root);
  return { root, readouts, plots: ps };
}

/** Make touching/dragging on the plot move the uPlot cursor (uPlot itself only follows the mouse). */
function wireTouch(u: uPlotType): () => void {
  const over = u.over;
  over.style.touchAction = 'pan-y';
  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    const r = over.getBoundingClientRect();
    u.setCursor({ left: Math.min(r.width, Math.max(0, t.clientX - r.left)), top: Math.min(r.height, Math.max(0, t.clientY - r.top)) });
  };
  const end = () => u.setCursor({ left: -10, top: -10 });
  over.addEventListener('touchstart', move, { passive: true });
  over.addEventListener('touchmove', move, { passive: true });
  over.addEventListener('touchend', end);
  over.addEventListener('touchcancel', end);
  return () => {
    over.removeEventListener('touchstart', move);
    over.removeEventListener('touchmove', move);
    over.removeEventListener('touchend', end);
    over.removeEventListener('touchcancel', end);
  };
}

function axisBase(theme: Theme, fmt: (v: number) => string, extra: Partial<uPlotType.Axis> = {}): uPlotType.Axis {
  return {
    stroke: theme.ink,
    grid: { stroke: theme.grid, width: 1 },
    ticks: { stroke: theme.grid, width: 1, size: 4 },
    font: '11px system-ui, sans-serif',
    size: 44,
    values: (_u, splits) => splits.map((s) => fmt(s)),
    ...extra,
  };
}

function setReadout(ro: HTMLElement, theme: Theme, xText: string, rows: { label: string; text: string; color: string }[]) {
  ro.replaceChildren();
  const x = document.createElement('span');
  x.className = 'chart-readout-x';
  x.textContent = xText;
  ro.append(x);
  for (const r of rows) {
    const s = document.createElement('span');
    s.className = 'chart-readout-v';
    const dot = document.createElement('i');
    dot.style.background = r.color;
    s.append(dot, document.createTextNode(`${r.label} ${r.text}`));
    ro.append(s);
  }
  void theme;
}

function marksHook(marks: Mark[] | undefined, theme: Theme): uPlotType.Hooks.Defs['draw'] | undefined {
  if (!marks?.length) return undefined;
  return (u) => {
    const ctx = u.ctx;
    const px = devicePixelRatio || 1;
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.fillStyle = theme.ink;
    ctx.lineWidth = 1 * px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.font = `${11 * px}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const { left, top, width, height } = u.bbox;
    // Labels are placed left to right; one that would overlap the previous label (or run off the
    // plot) is dropped and only its dashed tick is drawn.
    let labelEnd = -Infinity;
    for (const m of [...marks].sort((a, b) => a.x - b.x)) {
      const x = Math.round(u.valToPos(m.x, 'x', true));
      if (x < left || x > left + width) continue;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      if (!m.label) continue;
      const tw = ctx.measureText(m.label).width;
      let tx = x + 4 * px;
      if (tx + tw > left + width) tx = x - 4 * px - tw;
      if (tx < left || tx < labelEnd + 4 * px) continue;
      ctx.fillText(m.label, tx, top + 3 * px);
      labelEnd = tx + tw;
    }
    ctx.restore();
  };
}

function lineBuilder(o: LineOpts, area: boolean, syncKey?: string, hideX = false): Builder {
  return (U, plot, width, theme, readout) => {
    const fmtX = o.fmtX ?? ((v: number) => formatAxis(v));
    const fmtXr = o.fmtX ?? ((v: number) => formatValue(v));
    const fmtY = o.fmtY ?? ((v: number) => formatAxis(v));
    const fmtYr = o.fmtY ?? ((v: number) => formatValue(v));
    const height = o.height ?? plotHeight(width);
    const series: uPlotType.Series[] = [{}];
    o.series.forEach((s, i) => {
      const color = theme.series[Math.min(i, theme.series.length - 1)];
      series.push({
        label: s.label,
        stroke: color,
        width: i === 0 ? 2 : 1.5,
        dash: s.dash ? [5, 4] : undefined,
        fill: (area || s.area) && i === 0 ? theme.accentFill : undefined,
        points: { show: false },
        spanGaps: false,
      });
    });
    const data = [o.x, ...o.series.map((s) => s.y)] as uPlotType.AlignedData;
    const draw = marksHook(o.marks, theme);
    const opts: uPlotType.Options = {
      width,
      height,
      legend: { show: false },
      padding: [8, 8, 0, 0],
      scales: { x: { time: false }, y: o.yRange ? { range: o.yRange } : {} },
      axes: [
        axisBase(theme, fmtX, { size: hideX ? 0 : 30, show: !hideX }),
        axisBase(theme, fmtY),
      ],
      series,
      cursor: {
        points: { size: 7, width: 1.5 },
        drag: { x: false, y: false },
        sync: syncKey ? { key: syncKey } : undefined,
      },
      hooks: {
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            if (i === null || i === undefined) {
              readout.replaceChildren();
              readout.dataset.empty = '1';
              return;
            }
            delete readout.dataset.empty;
            const xs = u.data[0] as number[];
            setReadout(readout, theme, fmtXr(xs[i]), o.series.map((s, k) => ({
              label: s.label,
              text: u.data[k + 1][i] === null ? '-' : fmtYr(u.data[k + 1][i] as number),
              color: theme.series[Math.min(k, theme.series.length - 1)],
            })));
          },
        ],
        draw: draw ? [draw] : [],
      },
    };
    const u = new U(opts, data, plot);
    const unTouch = wireTouch(u);
    return { u, destroy: () => { unTouch(); u.destroy(); } };
  };
}

function barsBuilder(x: () => number[], y: () => number[], o: { label: string; fmtX?: (v: number) => string; fmtY?: (v: number) => string; height?: number }): Builder {
  return (U, plot, width, theme, readout) => {
    const xs = x();
    const fmtX = o.fmtX ?? ((v: number) => formatAxis(v));
    const fmtXr = o.fmtX ?? ((v: number) => formatValue(v));
    const fmtYr = o.fmtY ?? ((v: number) => formatValue(v, getLang(), 2));
    const gap = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 1;
    const opts: uPlotType.Options = {
      width,
      height: o.height ?? plotHeight(width),
      legend: { show: false },
      padding: [8, 8, 0, 0],
      scales: { x: { time: false, range: (_u, mn, mx) => [mn - gap / 2, mx + gap / 2] }, y: { range: (_u, _mn, mx) => [0, Math.max(1, mx * 1.08)] } },
      axes: [axisBase(theme, fmtX, { size: 30 }), axisBase(theme, (v) => formatAxis(v))],
      series: [
        {},
        {
          label: o.label,
          stroke: theme.accent,
          fill: theme.accent,
          width: 0,
          paths: U.paths.bars!({ size: [0.86, 100], radius: 0.15 }),
          points: { show: false },
        },
      ],
      cursor: { points: { show: false }, drag: { x: false, y: false } },
      hooks: {
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            if (i === null || i === undefined) { readout.replaceChildren(); return; }
            setReadout(readout, theme, fmtXr(u.data[0][i] as number), [{ label: o.label, text: fmtYr(u.data[1][i] as number), color: theme.accent }]);
          },
        ],
      },
    };
    const u = new U(opts, [xs, y()] as uPlotType.AlignedData, plot);
    const unTouch = wireTouch(u);
    return { u, destroy: () => { unTouch(); u.destroy(); } };
  };
}

/** One logical chart = N plots sharing a container; rebuilds on theme change and resizes with the container. */
function mount(el: HTMLElement, plots: number, aria: string | undefined, builders: () => Builder[], setData: (d: Record<string, unknown>) => void): Chart {
  const shell = makeShell(el, plots, aria);
  let built: Built[] = [];
  let destroyed = false;
  let width = 0;
  let ro: ResizeObserver | null = null;
  let mql: MediaQueryList | null = null;
  let theme: Theme | null = null;
  let U: typeof uPlotType | null = null;

  const widthOf = () => Math.floor(el.clientWidth || shell.root.clientWidth);
  const build = () => {
    if (destroyed || !U) return;
    built.forEach((b) => b.destroy());
    shell.plots.forEach((p) => p.replaceChildren());
    theme = readTheme(el);
    const th = theme;
    built = builders().map((b, i) => b(U as typeof uPlotType, shell.plots[i], width, th, shell.readouts[i]));
  };
  const onTheme = () => build();

  const ready = loadUPlot().then((lib) => {
    if (destroyed) return;
    U = lib;
    width = widthOf();
    if (width > 0) build();
    ro = new ResizeObserver(() => {
      const w = widthOf();
      if (w <= 0 || w === width) return;
      width = w;
      if (!built.length) { build(); return; }
      built.forEach((b, i) => {
        const h = b.u.height;
        void i;
        b.u.setSize({ width: w, height: h });
      });
    });
    ro.observe(el);
    mql = matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', onTheme);
  });

  return {
    ready,
    update(d) {
      setData(d as Record<string, unknown>);
      if (U && width > 0) build();
    },
    destroy() {
      destroyed = true;
      ro?.disconnect();
      mql?.removeEventListener('change', onTheme);
      built.forEach((b) => b.destroy());
      built = [];
      el.replaceChildren();
      el.classList.remove('chart');
    },
  };
}

function empty(el: HTMLElement, msg: string): Chart {
  el.classList.add('chart', 'chart-empty');
  el.textContent = msg;
  return { ready: Promise.resolve(), update() {}, destroy() { el.replaceChildren(); el.classList.remove('chart', 'chart-empty'); } };
}

export function createChartKit(emptyMessage = ''): ChartKit {
  const lineLike = (el: HTMLElement, o: LineOpts, area: boolean): Chart => {
    if (!o.x.length) return empty(el, emptyMessage);
    let cur = { ...o };
    return mount(el, 1, o.ariaLabel, () => [lineBuilder(cur, area)], (d) => { cur = { ...cur, ...(d as Partial<LineOpts>) }; });
  };
  return {
    line: (el, o) => lineLike(el, o, false),
    area: (el, o) => lineLike(el, o, true),
    bars(el, o) {
      if (!o.x.length) return empty(el, emptyMessage);
      let cur = { ...o };
      return mount(el, 1, o.ariaLabel, () => [barsBuilder(() => cur.x, () => cur.y, cur)], (d) => { cur = { ...cur, ...(d as Partial<BarsOpts>) }; });
    },
    histogram(el, o) {
      if (!o.values.length) return empty(el, emptyMessage);
      let cur = { ...o };
      const bins = () => histogramBins(cur.values, cur.bins ?? 20, cur.range, cur.clamp);
      return mount(el, 1, o.ariaLabel, () => [barsBuilder(() => bins().centers, () => bins().counts, cur)], (d) => { cur = { ...cur, ...(d as Partial<HistogramOpts>) }; });
    },
    stacked2(el, top, bottom) {
      if (!top.x.length && !bottom.x.length) return empty(el, emptyMessage);
      let a = { ...top };
      let b = { ...bottom };
      const key = `u-${Math.random().toString(36).slice(2)}`;
      return mount(
        el, 2, top.ariaLabel,
        () => [lineBuilder({ ...a, height: a.height ?? 150 }, false, key, true), lineBuilder({ ...b, height: b.height ?? 170 }, false, key)],
        (d) => { const x = d as { top?: Partial<LineOpts>; bottom?: Partial<LineOpts> }; a = { ...a, ...x.top }; b = { ...b, ...x.bottom }; },
      );
    },
  };
}
