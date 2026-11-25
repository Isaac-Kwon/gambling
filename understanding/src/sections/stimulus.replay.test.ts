import { describe, expect, it } from 'vitest';
import type { Session } from '@shared/schema';
import on from '../analysis/__fixtures__/session-on.json';
import off from '../analysis/__fixtures__/session-off.json';
import { replayRows } from '../analysis/replay';
import { advance, jumpToEnd, pageRange, restart, turnPage, PAGE_SIZE } from './replayPlain';
import { buildStimView, channelSeconds } from './stimulus';

const SON = on as unknown as Session;
const SOFF = off as unknown as Session;

describe('buildStimView', () => {
  it('has aligned series and consistent split', () => {
    const v = buildStimView(SON);
    expect(v.fxOff).toBe(false);
    expect(v.x.length).toBe(v.stim.length);
    expect(v.x.length).toBe(v.cum.length);
    expect(v.split.winRounds + v.split.lossRounds).toBe(v.x.length);
    expect(v.big.length).toBeLessThanOrEqual(v.bigTotal);
    expect(v.bigBelow).toBeLessThanOrEqual(v.bigTotal);
  });
  it('flags fx=off and records no stimulus or fakes', () => {
    const v = buildStimView(SOFF);
    expect(v.fxOff).toBe(true);
    expect(v.split.winSec + v.split.lossSec).toBe(0);
    expect(v.fakes.tickers + v.fakes.hot).toBe(0);
  });
  it('channel seconds are non-negative', () => {
    for (const x of Object.values(channelSeconds(SON))) expect(x).toBeGreaterThanOrEqual(0);
  });
});

describe('replay paging', () => {
  const total = 120;
  it('jumps to the last page', () => {
    const st = jumpToEnd(total);
    expect(st).toEqual({ shown: 120, page: 2 });
    expect(pageRange(st)).toEqual([100, 120]);
  });
  it('advances and follows the newest row', () => {
    let st = restart({ shown: total, page: 2 }, total);
    expect(st).toEqual({ shown: 1, page: 0 });
    st = advance(st, 60, total);
    expect(st.shown).toBe(61);
    expect(st.page).toBe(1);
    expect(pageRange(st)).toEqual([PAGE_SIZE, 61]);
    expect(advance(st, 1000, total).shown).toBe(total);
  });
  it('turns pages within bounds', () => {
    const st = { shown: 75, page: 0 };
    expect(turnPage(st, -1).page).toBe(0);
    expect(turnPage(turnPage(st, 1), 1).page).toBe(1);
  });
  it('replay rows cover every event', () => {
    expect(replayRows(SON).length).toBe(SON.events.length);
  });
});
