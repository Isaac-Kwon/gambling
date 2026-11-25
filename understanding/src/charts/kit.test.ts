import { describe, expect, it } from 'vitest';
import { decimate, formatAxis, formatValue, histogramBins, nearestIndex, plotHeight } from './kit';

describe('histogramBins', () => {
  it('counts into equal-width bins and puts the max in the last bin', () => {
    const b = histogramBins([0, 1, 2, 3, 4, 10], 5, [0, 10]);
    expect(b.counts).toEqual([2, 2, 1, 0, 1]);
    expect(b.edges).toHaveLength(6);
    expect(b.centers[0]).toBe(1);
  });
  it('derives the range from the data and sums to the input size', () => {
    const v = [3, 5, 5, 9, 12, 20];
    const b = histogramBins(v, 4);
    expect(b.counts.reduce((a, c) => a + c, 0)).toBe(v.length);
    expect(b.edges[0]).toBe(3);
    expect(b.edges[4]).toBe(20);
  });
  it('drops out-of-range values unless clamped', () => {
    expect(histogramBins([-5, 5, 50], 2, [0, 10]).counts).toEqual([0, 1]);
    expect(histogramBins([-5, 5, 50], 2, [0, 10], true).counts).toEqual([1, 2]);
  });
  it('handles empty, constant and non-finite input', () => {
    expect(histogramBins([], 3).counts).toEqual([0, 0, 0]);
    const c = histogramBins([7, 7, 7, NaN], 2);
    expect(c.counts.reduce((a, x) => a + x, 0)).toBe(3);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 40];
  it('finds the closest entry', () => {
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 31)).toBe(3);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('decimate', () => {
  it('returns short series unchanged', () => {
    const r = decimate([1, 2, 3], [[4, 5, 6]], 10);
    expect(r.x).toEqual([1, 2, 3]);
    expect(r.ys[0]).toEqual([4, 5, 6]);
  });
  it('keeps extremes and endpoints of long series', () => {
    const n = 10000;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = x.map((i) => (i === 4321 ? 1000 : i === 7777 ? -1000 : 0));
    const r = decimate(x, [y], 200);
    expect(r.x.length).toBeLessThan(500);
    expect(r.x[0]).toBe(0);
    expect(r.x[r.x.length - 1]).toBe(n - 1);
    expect(r.ys[0]).toContain(1000);
    expect(r.ys[0]).toContain(-1000);
  });
});

describe('formatting', () => {
  it('formats axis labels compactly', () => {
    expect(formatAxis(0, 'en')).toBe('0');
    expect(formatAxis(950, 'en')).toBe('950');
    expect(formatAxis(1200, 'en')).toBe('1.2K');
    expect(formatAxis(-2500000, 'en')).toBe('-2.5M');
    expect(formatAxis(NaN, 'en')).toBe('');
  });
  it('formats readout values', () => {
    expect(formatValue(1234.567, 'en')).toBe('1,234.57');
    expect(formatValue(null, 'en')).toBe('-');
  });
  it('bounds plot height', () => {
    expect(plotHeight(100)).toBe(170);
    expect(plotHeight(300)).toBe(170);
    expect(plotHeight(5000)).toBe(300);
  });
});
