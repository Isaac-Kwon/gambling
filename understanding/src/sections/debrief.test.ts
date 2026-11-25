import { describe, expect, it } from 'vitest';
import { summarize } from '../../../shared/handoff';
import type { Session } from '../../../shared/schema';
import on from '../analysis/__fixtures__/session-on.json';
import { feltKey, parseFelt, parseFeltInput } from '../felt';
import { buildView, chartModel, clock, feltView } from './debrief';
import { timeline } from '../analysis/timeline';

const session = on as unknown as Session;
const summary = summarize(session);

describe('buildView (full log)', () => {
  const v = buildView(session, summary);
  it('is consistent with the summary', () => {
    expect(v.hasLog).toBe(true);
    expect(v.endBalance).toBe(summary.finalCredits);
    expect(v.net).toBe(summary.finalCredits - summary.startCredits);
    expect(v.celebrations.netLoss).toBeLessThanOrEqual(v.celebrations.total);
    expect(v.money.lossCredits).toBe(Math.max(0, -v.net));
    expect(v.money.lossKrw).toBe(v.money.lossCredits * 10);
    expect(v.expectedNet).not.toBeNull();
    expect(v.expectedNet as number).toBeLessThanOrEqual(0);
  });
  it('builds a chart whose lines start at the starting balance', () => {
    const c = v.chart!;
    expect(c.x[0]).toBe(0);
    expect(c.balance[0]).toBe(session.startCredits);
    expect(c.expected[0]).toBe(session.startCredits);
    expect(c.balance).toHaveLength(c.x.length);
    expect(c.expected).toHaveLength(c.x.length);
  });
});

describe('buildView (summary only)', () => {
  const v = buildView(undefined, summary);
  it('shows what the summary supports and no chart', () => {
    expect(v.hasLog).toBe(false);
    expect(v.chart).toBeNull();
    expect(v.expectedNet).toBeNull();
    expect(v.afterPeak).toBeNull();
    expect(v.stop).toBe(Object.values(summary.games).reduce((a, g) => a + (g?.stop ?? 0), 0));
    expect(v.net).toBe(summary.finalCredits - summary.startCredits);
  });
  it('agrees with the full-log view on shared numbers', () => {
    const f = buildView(session, summary);
    expect(v.rounds).toBe(f.rounds);
    expect(v.celebrations).toEqual(f.celebrations);
    expect(v.nearMiss).toBe(f.nearMiss);
    expect(v.chase).toBe(f.chase);
    expect(v.endBalance).toBe(f.endBalance);
  });
});

describe('chartModel', () => {
  it('counts markers by kind', () => {
    const tl = timeline(session);
    const c = chartModel(tl);
    const total = Object.values(c.stripCounts).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(tl.markers.length);
    expect(c.strip).toHaveLength(tl.markers.length);
  });
});

describe('felt', () => {
  it('compares felt with actual and tolerates missing answers', () => {
    const v = buildView(session, summary);
    expect(feltView(v, null).feltMinutes).toBeNull();
    const f = feltView(v, { minutes: 5, net: -100 });
    expect(f.feltMinutes).toBe(5);
    expect(f.netDiff).toBe(-100 - v.net);
  });
  it('keys by session and parses safely', () => {
    const k = feltKey(summary);
    const raw = JSON.stringify({ key: k, minutes: 3, net: -50, skipped: false });
    expect(parseFelt(raw, k)).toEqual({ key: k, minutes: 3, net: -50, skipped: false });
    expect(parseFelt(raw, 'other')).toBeNull();
    expect(parseFelt('{bad', k)).toBeNull();
  });
  it('parses form input', () => {
    expect(parseFeltInput('12', '1,500', 'lost')).toEqual({ minutes: 12, net: -1500 });
    expect(parseFeltInput('', '', 'even')).toEqual({ minutes: null, net: 0 });
    expect(parseFeltInput('x', '-5', 'won')).toEqual({ minutes: null, net: null });
  });
});

describe('clock', () => {
  it('formats m:ss', () => expect(clock(125_000)).toBe('2:05'));
});
