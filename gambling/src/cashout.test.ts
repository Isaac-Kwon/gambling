import { describe, expect, it } from 'vitest';
import { createRng } from '../../shared/rng';
import { decodeSummary, summarize, HASH_MAX } from '../../shared/handoff';
import type { Ev, Session } from '../../shared/schema';
import { createStubFx, HEADLESS_ENV } from '../harness/ctx';
import { createManualClock } from './clock';
import { OCEAN_STATE_KEY, createSession } from './session';
import { buildReceipt, detailUrl, fmtPlayTime, goToDetail, ticketMarks } from './cashout';

const T0 = 1_700_000_000_000;

function ev(game: Ev['game'], round: number, bet: number, payout: number, balance: number, dec?: Ev['dec']): Ev {
  return { t: round * 1000, game, round, bet, payout, net: payout - bet, balance, ...(dec ? { dec } : {}) };
}

function synthetic(): Session {
  return {
    v: 1, seed: 'rc1', mode: 'free', fx: 'on', display: 'browser', installed: false,
    device: { w: 375, h: 812, dpr: 2, touch: true, orient: 'portrait' },
    startedAt: T0, endedAt: T0 + 754_000, endReason: 'cashout', startCredits: 10_000,
    events: [
      ev('slot', 1, 100, 0, 9900),
      ev('slot', 2, 100, 1500, 11300), // net +1400
      ev('roulette', 1, 200, 400, 11500), // net +200
      ev('slot', 3, 100, 0, 11400),
      ev('ocean', 1, 0, 800, 12200, { bonusSeqId: 3, flush: true }), // lump-sum: not a round, not a win
    ],
    nav: [], aux: [], unreleased: 800,
  };
}

describe('receipt data', () => {
  it('computes play time, biggest win, games and the flush line', () => {
    const d = buildReceipt(synthetic(), 12_200);
    expect(d).toEqual({
      reason: 'cashout', finalCredits: 12_200, bonus: 800, playMs: 754_000, maxWin: 1400,
      games: [{ id: 'slot', rounds: 3 }, { id: 'roulette', rounds: 1 }],
    });
  });

  it('no flush: bonus 0, no wins: maxWin 0, empty session', () => {
    const s = synthetic();
    s.events = [ev('slot', 1, 100, 0, 9900)];
    delete s.unreleased;
    expect(buildReceipt(s, 9900)).toMatchObject({ bonus: 0, maxWin: 0, games: [{ id: 'slot', rounds: 1 }] });
    s.events = [];
    expect(buildReceipt(s, 10_000).games).toEqual([]);
  });

  it('formats play time as mm:ss, h:mm:ss from one hour', () => {
    expect(fmtPlayTime(0)).toBe('00:00');
    expect(fmtPlayTime(754_999)).toBe('12:34');
    expect(fmtPlayTime(3_599_000)).toBe('59:59');
    expect(fmtPlayTime(3_600_000)).toBe('1:00:00');
    expect(fmtPlayTime(3_725_000)).toBe('1:02:05');
  });

  it('serial and barcode come from the presentation stream, deterministically', () => {
    const a = ticketMarks(createRng('x', 'pre:receipt'));
    const b = ticketMarks(createRng('x', 'pre:receipt'));
    expect(a).toEqual(b);
    expect(a.serial).toMatch(/^\d{12}$/);
    expect(a.bars).toHaveLength(46);
    expect(a.bars.every((w) => w >= 1 && w <= 4)).toBe(true);
    expect(ticketMarks(createRng('y', 'pre:receipt'))).not.toEqual(a);
  });
});

describe('handoff url', () => {
  it('is base + detail path + #s=summary, and decodes back', async () => {
    const s = synthetic();
    const url = await detailUrl(s, '/gambling/');
    expect(url.startsWith('/gambling/understanding/#s=')).toBe(true);
    expect(url.slice(url.indexOf('#')).length).toBeLessThanOrEqual(HASH_MAX);
    expect(await decodeSummary(url.slice(url.indexOf('#s=') + 3))).toEqual(summarize(s));
    expect((await detailUrl(s, '/')).startsWith('/understanding/#s=')).toBe(true);
    expect((await detailUrl(s, '/gambling')).startsWith('/gambling/understanding/#s=')).toBe(true);
  });

  it('saves first, then navigates', async () => {
    const calls: string[] = [];
    const url = await goToDetail({
      session: synthetic(), base: '/', save: () => calls.push('save'), navigate: (u) => calls.push('nav:' + u.slice(0, 20)),
    });
    expect(calls[0]).toBe('save');
    expect(calls[1]).toBe('nav:' + url.slice(0, 20));
  });

  it('a failing save (storage blocked) still navigates with the summary hash', async () => {
    let nav = '';
    const url = await goToDetail({
      session: synthetic(), base: '/gambling/',
      save: () => { throw new Error('QuotaExceeded'); },
      navigate: (u) => { nav = u; },
    });
    expect(nav).toBe(url);
    expect(nav).toContain('/understanding/#s=');
    const save = () => false; // logger.save() reports failure by returning false
    nav = '';
    await goToDetail({ session: synthetic(), base: '/', save, navigate: (u) => { nav = u; } });
    expect(nav).toContain('#s=');
  });
});

describe('session end reasons', () => {
  const make = (startCredits: number) => createSession({
    seed: 's1', fx: createStubFx(true), fxMode: 'on', env: HEADLESS_ENV, clock: createManualClock(),
    epoch: () => T0, storage: null, id: 'id1', startCredits,
  });

  it('bust ends the session with reason bust and a receipt of the final balance', async () => {
    const rt = make(30);
    let reason = '';
    rt.onCashout((r) => { reason = r; });
    rt.roundsFor('slot').begin({ bet: 25 }).settle({ payout: 0 });
    await rt.whenSettled();
    expect(reason).toBe('bust');
    const s = rt.finish('bust');
    expect(s.endReason).toBe('bust');
    expect(s.endedAt).toBeDefined();
    expect(buildReceipt(s, rt.wallet.balance)).toMatchObject({ reason: 'bust', finalCredits: 5, maxWin: 0 });
  });

  it('CASH OUT ends with reason cashout; the ocean flush shows up as the bonus line', () => {
    const rt = make(10_000);
    rt.store.set(OCEAN_STATE_KEY, {
      round: 1, nextId: 8,
      queue: [{ id: 7, round: 1, bet: 20, mult: 50, total: 1000, omen: 'clam', delay: 1, chunks: [500, 500], next: 0, wait: 2 }],
    });
    rt.roundsFor('slot').begin({ bet: 100 }).settle({ payout: 0 });
    let reason = '';
    rt.onCashout((r) => { reason = r; });
    rt.requestCashout('cashout');
    expect(reason).toBe('cashout');
    const s = rt.finish('cashout');
    expect(s.endReason).toBe('cashout');
    const d = buildReceipt(s, rt.wallet.balance);
    expect(d).toMatchObject({ reason: 'cashout', finalCredits: 10_900, bonus: 1000, games: [{ id: 'slot', rounds: 1 }] });
  });
});
