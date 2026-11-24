import { describe, expect, it, vi } from 'vitest';
import { createHaptics, HAPTIC_CAP_MS, normPattern, OMEN_HAPTIC, TIER_HAPTIC, vibeMs } from './haptics';

const total = (p: readonly number[]) => p.reduce((a, b) => a + b, 0);

describe('haptics', () => {
  it('tier patterns escalate and fit the cap', () => {
    expect(TIER_HAPTIC).toHaveLength(5);
    for (let i = 1; i < TIER_HAPTIC.length; i++) {
      expect(total(TIER_HAPTIC[i]!)).toBeGreaterThan(total(TIER_HAPTIC[i - 1]!));
      expect(vibeMs(TIER_HAPTIC[i]!)).toBeGreaterThan(vibeMs(TIER_HAPTIC[i - 1]!));
    }
    for (const p of [...TIER_HAPTIC, ...OMEN_HAPTIC]) {
      expect(total(p)).toBeLessThanOrEqual(HAPTIC_CAP_MS);
      expect(normPattern(p)).toEqual(p); // already normalized
    }
  });

  it('calls navigator.vibrate with the expected patterns', () => {
    const vibrate = vi.fn(() => true);
    const h = createHaptics({ nav: { vibrate } });
    expect(h.supported).toBe(true);
    h.pulse([...TIER_HAPTIC[1]!]);
    expect(vibrate).toHaveBeenLastCalledWith([30, 60, 30]);
    h.pulse([...TIER_HAPTIC[4]!]);
    expect(vibrate).toHaveBeenLastCalledWith([60, 40, 60, 40, 60, 40, 100, 60, 140]);
    h.pulse(25);
    expect(vibrate).toHaveBeenLastCalledWith(25);
  });

  it('keeps the receiver bound (Chrome throws Illegal invocation otherwise)', () => {
    const nav = {
      calls: 0,
      vibrate(this: { calls: number }) {
        this.calls++;
        return true;
      },
    };
    createHaptics({ nav }).pulse(10);
    expect(nav.calls).toBe(1);
  });

  it('caps the total at 600 ms and cleans bad values', () => {
    const vibrate = vi.fn(() => true);
    const h = createHaptics({ nav: { vibrate } });
    h.pulse([400, 100, 400, 100, 400]);
    expect(vibrate).toHaveBeenLastCalledWith([400, 100, 100]);
    h.pulse(5000);
    expect(vibrate).toHaveBeenLastCalledWith(600);
    expect(normPattern([NaN, -5, 30.6, 20])).toEqual([0, 0, 31]);
    expect(normPattern([30, 60])).toEqual([30]); // trailing pause dropped
    expect(vibeMs([100, 900, 100])).toBe(100);
    vibrate.mockClear();
    h.pulse([0]);
    h.pulse([]);
    h.pulse([-1, 50]);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('is a silent no-op when the API is missing (iOS) or throws', () => {
    expect(() => createHaptics({ nav: {} }).pulse([30, 60, 30])).not.toThrow();
    expect(() => createHaptics({ nav: null }).pulse(30)).not.toThrow();
    expect(() => createHaptics().pulse(30)).not.toThrow(); // node: navigator may lack vibrate
    expect(createHaptics({ nav: {} }).supported).toBe(false);
    const vibrate = vi.fn(() => {
      throw new Error('blocked');
    });
    expect(() => createHaptics({ nav: { vibrate } }).pulse(30)).not.toThrow();
    expect(() => createHaptics({ nav: { vibrate: vi.fn(() => true) } }).pulse('x' as unknown as number)).not.toThrow();
  });

  it('skips before the first user activation and when disabled', () => {
    const vibrate = vi.fn(() => true);
    const ua = { hasBeenActive: false };
    const h = createHaptics({ nav: { vibrate, userActivation: ua } });
    h.pulse(30);
    expect(vibrate).not.toHaveBeenCalled();
    ua.hasBeenActive = true;
    h.pulse(30);
    expect(vibrate).toHaveBeenCalledTimes(1);
    h.setEnabled(false);
    h.pulse(30);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
