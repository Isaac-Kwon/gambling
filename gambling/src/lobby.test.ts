import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRoundRng, createStreams } from '../../shared/rng';
import { levelOf } from './session';
import { countMs, levelProgress } from './hud';
import { hotGames, maskNick, tickerItem } from './lobby';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Record<string, string>;

describe('lobby presentation content', () => {
  it('ticker lines are determined by the pre:lobby stream and well-formed', () => {
    const a = createStreams('seed-1').pre('lobby');
    const b = createRoundRng('seed-1', 'pre:lobby');
    for (let n = 1; n <= 300; n++) {
      const x = tickerItem(a.at(n));
      expect(tickerItem(b.at(n))).toEqual(x);
      expect(['slot', 'roulette', 'blackjack', 'crash', 'ocean']).toContain(x.game);
      expect(Number.isSafeInteger(x.amt)).toBe(true);
      expect(x.amt).toBeGreaterThanOrEqual(1000);
      expect(x.name.endsWith('**')).toBe(true);
    }
    // different seeds give different sequences
    const c = createStreams('seed-2').pre('lobby');
    const seq = (r: typeof a) => Array.from({ length: 20 }, (_, i) => JSON.stringify(tickerItem(r.at(i + 1)))).join();
    expect(seq(a)).not.toEqual(seq(c));
  });

  it('HOT picks 1-2 distinct games', () => {
    const r = createStreams('hot').pre('lobby');
    const sizes = new Set<number>();
    for (let n = 1; n <= 200; n++) {
      const g = hotGames(r.at(n));
      sizes.add(g.length);
      expect(new Set(g).size).toBe(g.length);
      expect(g.length).toBeGreaterThanOrEqual(1);
      expect(g.length).toBeLessThanOrEqual(2);
    }
    expect([...sizes].sort()).toEqual([1, 2]);
  });

  it('masks nicknames', () => {
    expect(maskNick('lucky777')).toBe('lucky**');
    expect(maskNick('골드킹')).toBe('골드**');
    expect(maskNick('ab')).toBe('a**');
  });
});

describe('HUD helpers', () => {
  it('level progress is 0 at a level start and approaches 1 at the next', () => {
    for (const xp of [0, 999, 1000, 2999, 3000, 12345, 99999]) {
      const l = levelOf(xp);
      const p = levelProgress(xp, l);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
    expect(levelProgress(1000, 1)).toBe(0);
    expect(levelProgress(2000, 1)).toBeCloseTo(0.5);
  });

  it('count-up only for gains, bounded', () => {
    expect(countMs(0)).toBe(0);
    expect(countMs(-500)).toBe(0);
    expect(countMs(20)).toBeGreaterThan(300);
    expect(countMs(10_000_000)).toBeLessThanOrEqual(1600);
    expect(countMs(5000)).toBeGreaterThan(countMs(50));
  });
});

describe('i18n namespaces gate / lobby / hud', () => {
  it('keys exist for every game card and HUD control', () => {
    const lobby = read('../../i18n/gambling/lobby.ko.json');
    const hud = read('../../i18n/gambling/hud.ko.json');
    const gate = read('../../i18n/gambling/gate.ko.json');
    for (const g of ['slot', 'roulette', 'blackjack', 'crash', 'ocean']) {
      expect(lobby[`lobby.game.${g}`]).toBeTruthy();
      expect(lobby[`lobby.game.${g}.tag`]).toBeTruthy();
    }
    expect(lobby['lobby.ticker.line']).toMatch(/\{name\}.*\{game\}.*\{amt\}|\{name\}/);
    for (const k of ['hud.cashout', 'hud.bonus', 'hud.level', 'hud.levelup']) expect(hud[k]).toBeTruthy();
    expect(hud['hud.bonus']).toContain('{amt}');
    expect(gate['gate.enter']).toBe('터치하여 입장');
  });
});
