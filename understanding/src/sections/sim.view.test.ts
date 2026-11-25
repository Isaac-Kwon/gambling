import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Session } from '@shared/schema';
import { makeT, mergeDictionaries } from '@shared/i18n';
import { summarize } from '@shared/handoff';
import { edgeOf } from '../analysis/edges';
import { simPlayers } from '../sim/bankroll';
import type { SlotDist } from '../sim/slotDist';
import {
  bankrollParams, bankrollView, baseBetFor, defaultEdge, edgeToSlider, EDGE_MAX, finalsOverlay, mainGame, nearestStep,
  latticeHist, pathSeries, PATHS, PLAYERS, ROUND_STEPS, sessionRounds, sliderToEdge, slotBankrollParams, slotRows, SYSTEMS,
} from './sim';

const fx = (n: string): Session => JSON.parse(readFileSync(new URL(`../analysis/__fixtures__/${n}.json`, import.meta.url), 'utf8'));
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

describe('sim view model: defaults from the summary', () => {
  it('main game = most credits wagered; edge computed, not hardcoded', () => {
    for (const n of ['session-on', 'session-svb']) {
      const s = summarize(fx(n));
      const g = mainGame(s)!;
      expect(g).not.toBeNull();
      for (const v of Object.values(s.games)) if (v && v.n > 0) expect(s.games[g]!.bet).toBeGreaterThanOrEqual(v.bet);
      const d = defaultEdge(s);
      expect(d.game).toBe(g);
      expect(d.fromSession).toBe(true);
      expect(d.edge).toBeCloseTo(Math.min(EDGE_MAX, edgeOf(g, s.sv ?? 'a')), 12);
      expect(sessionRounds(s)).toBe(Object.values(s.games).reduce((a, x) => a + (x?.n ?? 0), 0));
    }
  });
  it('no games → roulette edge, not from the session', () => {
    const d = defaultEdge({ games: {} });
    expect(mainGame({ games: {} })).toBeNull();
    expect(d).toEqual({ game: 'roulette', edge: edgeOf('roulette'), fromSession: false });
    expect(sessionRounds(undefined)).toBe(0);
  });
  it('nearest round step on a log scale', () => {
    expect(ROUND_STEPS[nearestStep(ROUND_STEPS, 70)]).toBe(50);
    expect(ROUND_STEPS[nearestStep(ROUND_STEPS, 80)]).toBe(100);
    expect(ROUND_STEPS[nearestStep(ROUND_STEPS, 1e6)]).toBe(5000);
    expect(nearestStep(ROUND_STEPS, 0)).toBe(3);
  });
  it('edge slider round trip in 0.1% steps, clamped', () => {
    expect(sliderToEdge(edgeToSlider(0.027))).toBeCloseTo(0.027, 12);
    expect(sliderToEdge(edgeToSlider(0.5))).toBeCloseTo(EDGE_MAX, 12);
    expect(edgeToSlider(-1)).toBe(0);
  });
});

describe('sim view model: bankroll results', () => {
  const p = bankrollParams({ edge: 0.027, rounds: 60, system: 'martingale' }, { bankroll: 10_000, seed: 'test', players: 400 });
  const r = simPlayers(p);

  it('params: even-money payoff, base bet 1% of the bankroll, 20 paths', () => {
    expect(p.payoff).toEqual({ kind: 'even' });
    expect(p.baseBet).toBe(baseBetFor(10_000));
    expect(p.paths).toBe(PATHS);
    expect(bankrollParams({ edge: 0, rounds: 10, system: 'flat' }, { bankroll: 100, seed: 's' }).players).toBe(PLAYERS);
    expect(SYSTEMS).toEqual(['flat', 'martingale', 'fibonacci', 'dalembert']);
  });
  it('view: shares in [0,1], histogram matches the counts, median from the quantiles', () => {
    const v = bankrollView(r);
    expect(v.players).toBe(400);
    expect(v.requested).toBe(400);
    expect(v.scale).toBe(1);
    for (const x of [v.bust, v.ahead]) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
    expect(v.hist.x).toHaveLength(r.hist.counts.length);
    expect(sum(v.hist.y)).toBe(400);
    const sorted = Array.from(r.finals).sort((a, b) => a - b);
    expect(v.median).toBeGreaterThanOrEqual(sorted[0]);
    expect(v.median).toBeLessThanOrEqual(sorted[sorted.length - 1]);
    expect(v.top.threshold).toBeGreaterThanOrEqual(v.median);
    expect(bankrollView({ ...r, scale: 0.3, requested: 1000 }).requested).toBe(1000);
    const lv = bankrollView(r, 2 * p.baseBet).hist;
    expect(sum(lv.y)).toBe(400);
    const w = lv.x[1] - lv.x[0];
    expect(Math.round(w) % (2 * p.baseBet)).toBe(0);
  });
  it('lattice histogram: bin width is a multiple of the step, so a lattice fills bins evenly', () => {
    const lattice = Array.from({ length: 101 }, (_, i) => i * 200);   // 0, 200, …, 20000
    const hh = latticeHist(lattice, 20_000, 40, 200);
    expect(hh.x[1] - hh.x[0]).toBe(600);
    expect(new Set(hh.y.slice(0, -1))).toEqual(new Set([3]));
    expect(sum(hh.y)).toBe(101);
  });
  it('paths: one start line and one series per sampled player', () => {
    const ps = pathSeries(r);
    expect(ps.paths).toHaveLength(PATHS);
    expect(ps.start).toHaveLength(ps.x.length);
    expect(ps.start.every((y) => y === 10_000)).toBe(true);
    for (const y of ps.paths) { expect(y).toHaveLength(ps.x.length); expect(y[0]).toBe(10_000); }
  });
  it('overlay: common grid from 0, shares per sample', () => {
    const a = Float64Array.from({ length: 1000 }, (_, i) => i * 10);
    const b = Float64Array.from({ length: 500 }, (_, i) => i * 5);
    const ov = finalsOverlay([a, b], 20);
    expect(ov.x).toHaveLength(20);
    expect(ov.ys).toHaveLength(2);
    expect(ov.x[0]).toBeGreaterThan(0);
    expect(sum(ov.ys[1])).toBeCloseTo(1, 12);
    expect(sum(ov.ys[0])).toBeGreaterThan(0.99);
    expect(sum(ov.ys[0])).toBeLessThanOrEqual(1);
  });
});

describe('sim view model: slot variants', () => {
  const dist = (o: Partial<SlotDist>): SlotDist => ({
    id: 'x', lines: 20, cycle: 32 ** 5, m: new Float64Array(), count: new Float64Array(), sumLinePay: 0,
    ret: 0.94, sigma: 2.7, hit: 0, tierFreq: [0, 0, 0, 0, 0], under: 0, hitRate: 0.4, underRate: 0.12, bigEvery: 21.5, ...o,
  });
  it('rows come from the distributions, null until both are in', () => {
    expect(slotRows({ a: dist({}) })).toBeNull();
    const rows = slotRows({ a: dist({ ret: 0.9399 }), b: dist({ ret: 0.94, hitRate: 0.3, underRate: 0.08, bigEvery: 18.7, sigma: 3.1 }) })!;
    expect(rows.map((r) => r.key)).toEqual(['rtp', 'hit', 'under', 'big', 'sigma']);
    expect(rows[0]).toEqual({ key: 'rtp', a: 0.9399, b: 0.94 });
    expect(rows[1]).toEqual({ key: 'hit', a: 0.4, b: 0.3 });
    expect(rows[3]).toEqual({ key: 'big', a: 21.5, b: 18.7 });
  });
  it('bankroll params: same rounds and bet for both variants, slot payoff', () => {
    const a = slotBankrollParams('a', { bankroll: 10_000, seed: 's' });
    const b = slotBankrollParams('b', { bankroll: 10_000, seed: 's' });
    expect(a.payoff).toEqual({ kind: 'slot', sv: 'a' });
    expect(b.payoff).toEqual({ kind: 'slot', sv: 'b' });
    expect({ ...a, payoff: null }).toEqual({ ...b, payoff: null });
    expect(a.system).toBe('flat');
  });
});

// ------------------------------------------------------------------------------------------- i18n coverage

describe('strategy/sim i18n', () => {
  const dir = new URL('../../../i18n/understanding/', import.meta.url);
  const files: Record<string, Record<string, string>> = {};
  for (const f of readdirSync(dir)) files[f] = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const ko = { ...files['strategy.ko.json'], ...files['sim.ko.json'] };
  const t = makeT(mergeDictionaries(files as never));

  it('every literal key used in the two sections exists in ko', () => {
    for (const f of ['strategyCheck.ts', 'sim.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      const keys = [...src.matchAll(/t\('((?:strategy|sim)\.[\w.]+)'/g)].map((m) => m[1]);
      expect(keys.length).toBeGreaterThan(10);
      for (const k of keys) expect(ko[k], k).toBeTruthy();
    }
  });
  it('template keys resolve for every value they take', () => {
    const want = [
      ...['blackjack', 'roulette', 'crash'].flatMap((g) => [`strategy.game.${g}`, `strategy.arms.def.${g}`, `strategy.arms.conclusion.${g}`]),
      ...['yours', 'random', 'optimal', 'machine'].map((a) => `strategy.arm.${a}`),
      ...['H', 'S', 'D', 'P'].map((a) => `strategy.action.${a}`),
      ...['slot', 'ocean'].map((g) => `strategy.noStrategy.${g}`),
      ...['slot', 'roulette', 'blackjack', 'crash', 'ocean'].map((g) => `sim.game.${g}`),
      ...SYSTEMS.flatMap((s) => [`sim.sys.${s}`, `sim.sys.desc.${s}`]),
      ...['a', 'b'].map((v) => `sim.slot.col.${v}`),
      ...['rtp', 'hit', 'under', 'big', 'sigma'].map((k) => `sim.slot.row.${k}`),
    ];
    for (const k of want) expect(ko[k], k).toBeTruthy();
  });
  it('no hardcoded percentages in the text; en/it have the same keys', () => {
    for (const [k, v] of Object.entries(ko)) expect(v, k).not.toMatch(/\d\s*%|%\s*\d/);
    for (const ns of ['strategy', 'sim']) {
      const k = Object.keys(files[`${ns}.ko.json`]).sort();
      expect(Object.keys(files[`${ns}.en.json`]).sort()).toEqual(k);
      expect(Object.keys(files[`${ns}.it.json`]).sort()).toEqual(k);
      for (const key of k) expect(key.startsWith(`${ns}.`)).toBe(true);
    }
    expect(t('sim.top.body', { top: 'y', n: 1, threshold: 2, mean: 3, bust: 'x', median: 4, bankroll: 5 })).not.toMatch(/\{\w+\}/);
  });
});
