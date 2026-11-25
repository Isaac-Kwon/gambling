import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Session } from '@shared/schema';
import { CRASH } from '@shared/rules/crash';
import { MIN_BET } from '@shared/config';
import { strategyCheck } from '../analysis/strategy';
import { buildModel } from '../sim/model';
import { simStrategy, crashTargetsJob } from '../sim/strategy';
import { runSync } from '../sim/scheduler';
import {
  ARM_ORDER, armOverlay, armRows, avgStake, blockFor, cardLabel, crashChosenBars, crashTargetRows, playedRounds, rebin,
  rouletteView, topDeviations,
} from './strategyCheck';

const fx = (n: string): Session => JSON.parse(readFileSync(new URL(`../analysis/__fixtures__/${n}.json`, import.meta.url), 'utf8'));
const on = fx('session-on');
const svb = fx('session-svb');
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

describe('strategyCheck view model: session facts', () => {
  it('counts rounds per game, skipping the ocean flush', () => {
    const r = playedRounds(on);
    const flush = on.events.filter((e) => e.game === 'ocean' && (e.dec as { flush?: boolean } | undefined)?.flush).length;
    expect(r.blackjack).toBe(on.events.filter((e) => e.game === 'blackjack').length);
    expect(r.ocean).toBe(on.events.filter((e) => e.game === 'ocean').length - flush);
    const b = playedRounds(svb);
    expect(b.blackjack + b.roulette + b.crash).toBe(0);
    expect(b.slot).toBeGreaterThan(0);
  });

  it('average stake uses the initial blackjack bet', () => {
    expect(avgStake(on, 'blackjack')).toBeGreaterThan(0);
    expect(avgStake(on, 'crash')).toBeGreaterThanOrEqual(MIN_BET.crash);
    expect(avgStake(svb, 'blackjack')).toBe(0);
  });

  it('block length is the round count, capped by the run size', () => {
    expect(blockFor(8, 100_000)).toBe(8);
    expect(blockFor(5000, 30_000)).toBe(150);
    expect(blockFor(0, 100_000)).toBe(1);
    expect(blockFor(3, 100)).toBe(1);
  });

  it('cards read as rank + suit symbol', () => {
    expect(cardLabel('Ts')).toBe('10♠');
    expect(cardLabel('Ah')).toBe('A♥');
  });
});

describe('rebin', () => {
  it('keeps the mass when the target covers the source, and splits by overlap', () => {
    const out = rebin([0, 2, 4], [10, 6], [0, 1, 2, 3, 4]);
    expect(out).toEqual([5, 5, 3, 3]);
    const coarse = rebin([0, 1, 2, 3, 4], [1, 2, 3, 4], [0, 4]);
    expect(coarse).toEqual([10]);
  });
  it('drops mass outside the target range; zero-width bins land whole', () => {
    expect(sum(rebin([0, 10], [10], [2, 4, 6]))).toBeCloseTo(4, 12);
    expect(rebin([3, 3], [7], [0, 2, 4])).toEqual([0, 7]);
    expect(rebin([9, 9], [7], [0, 2, 4])).toEqual([0, 0]);
  });
});

describe('arms (roulette and blackjack, small runs)', () => {
  const model = buildModel(on);
  const rl = simStrategy('roulette', model, 4000, 'test-seed', { block: 8 });
  const bj = simStrategy('blackjack', model, 3000, 'test-seed', { block: 8 });

  it('rows come in display order and the intervals bracket the mean', () => {
    for (const r of [rl, bj]) {
      const rows = armRows(r);
      const order = rows.map((x) => ARM_ORDER.indexOf(x.arm));
      expect(order).toEqual(order.slice().sort((a, b) => a - b));
      expect(rows.map((x) => x.arm)).toContain('optimal');
      for (const x of rows) {
        expect(x.lo).toBeLessThanOrEqual(x.mean);
        expect(x.hi).toBeGreaterThanOrEqual(x.mean);
        expect(x.ahead).not.toBeNull();
      }
    }
    expect(armRows(rl).map((x) => x.arm)).toEqual(['yours', 'optimal', 'random']);
  });

  it('overlay: one common grid, each arm a share distribution', () => {
    for (const r of [rl, bj]) {
      const ov = armOverlay(r, 20, 40);
      expect(ov).not.toBeNull();
      expect(ov!.x).toHaveLength(40);
      for (let i = 1; i < ov!.x.length; i++) expect(ov!.x[i]).toBeGreaterThan(ov!.x[i - 1]);
      expect(ov!.series.map((s) => s.arm)).toEqual(armRows(r).map((x) => x.arm));
      for (const s of ov!.series) {
        expect(s.y).toHaveLength(40);
        const tot = sum(s.y);
        expect(tot).toBeGreaterThan(0.9);
        expect(tot).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('overlay x is in credits (unit multiplies the stake-unit grid)', () => {
    const a = armOverlay(rl, 1)!, b = armOverlay(rl, 50)!;
    a.x.forEach((v, i) => expect(b.x[i]).toBeCloseTo(v * 50, 9));
  });
});

describe('analysis adapters', () => {
  const c = strategyCheck(on);

  it('deviations are sorted by expected loss', () => {
    expect(c.blackjack).not.toBeNull();
    const top = topDeviations(c.blackjack!, 50);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].evLossCredits ?? -1).toBeGreaterThanOrEqual(top[i].evLossCredits ?? -1);
    expect(top.every((d) => !d.match)).toBe(true);
    expect(topDeviations(c.blackjack!, 2).length).toBeLessThanOrEqual(2);
  });

  it('roulette view mirrors the check', () => {
    expect(c.roulette).not.toBeNull();
    const v = rouletteView(c.roulette!);
    expect(v.martingale.doublings).toBe(c.roulette!.martingale.doublings);
    expect(v.martingale.longest).toBe(Math.max(0, ...c.roulette!.martingale.runs.map((r) => r.len)));
    expect(v.streak.against + v.streak.with).toBeLessThanOrEqual(v.streak.opportunities);
  });

  it('crash bars cover every chosen multiple', () => {
    expect(c.crash).not.toBeNull();
    const b = crashChosenBars(c.crash!);
    expect(b.x).toEqual(b.bins.map((_, i) => i));
    expect(sum(b.y)).toBe(c.crash!.chosen.length);
  });

  it('crash target rows: exact return ≈ 1 − edge for every target', () => {
    const r = runSync(crashTargetsJob({ n: 3000, seed: 'test-seed' }));
    const rows = crashTargetRows(r);
    expect(rows).toHaveLength(r.targets.length);
    for (const x of rows) {
      expect(x.exact).toBeCloseTo(1 - CRASH.edge, 3);
      expect(x.lo).toBeLessThanOrEqual(x.rtp);
      expect(x.hi).toBeGreaterThanOrEqual(x.rtp);
      expect(x.pWin).toBeGreaterThanOrEqual(0);
      expect(x.pWin).toBeLessThanOrEqual(1);
    }
  });
});
