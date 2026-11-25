import { describe, expect, it } from 'vitest';
import { isInstalledDisplay, isIosSafari } from './install';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

describe('install detection', () => {
  it('recognizes iOS Safari only', () => {
    expect(isIosSafari({ ua: IPHONE_SAFARI })).toBe(true);
    expect(isIosSafari({ ua: IPHONE_CHROME })).toBe(false);
    expect(isIosSafari({ ua: ANDROID })).toBe(false);
    expect(isIosSafari({ ua: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ ua: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true); // iPadOS
  });
  it('detects installed display modes', () => {
    const mm = (on: string) => (q: string) => ({ matches: q.includes(on) });
    expect(isInstalledDisplay({ matchMedia: mm('fullscreen') })).toBe(true);
    expect(isInstalledDisplay({ matchMedia: mm('standalone') })).toBe(true);
    expect(isInstalledDisplay({ standalone: true })).toBe(true);
    expect(isInstalledDisplay({ matchMedia: mm('browser') })).toBe(false);
    expect(isInstalledDisplay({})).toBe(false);
  });
});
