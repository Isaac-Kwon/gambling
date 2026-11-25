/** ARCHITECTURE 11.4 scenarios 4, 5 and 6: fx-independent outcomes, small / sideways screens, touch targets. */
import type { Page } from '@playwright/test';
import { tierOf } from '../shared/config';
import {
  balance, digits, enter, expect, gameUrl, installRoundCounter, open, openCard, pickSeed, playRounds, receipt, shot,
  sessionWith, slotPlan, start, test, toLobby, type GameKey,
} from './lib';

const GAMES: GameKey[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];

// ------------------------------------------------------------------------------------------------ 4
test.describe('4. same seed, same money', () => {
  // no tier-3+ celebration inside the first ten rounds: keeps the fx-on run short
  const seed = pickSeed('e2e-det', (s) => slotPlan(s, 'a', 10).every((r) => tierOf(r.payout, r.bet) < 3)
    && slotPlan(s, 'a', 10)[9].balanceAfter !== slotPlan(s, 'b', 10)[9].balanceAfter);

  for (const fx of ['on', 'off'] as const) {
    test(`ten slot rounds, fx=${fx}`, async ({ page }) => {
      await installRoundCounter(page);
      await start(page, { seed, fx });
      await openCard(page, 'slot');
      if (fx === 'on') await page.getByTestId('btn-turbo').click();
      await playRounds(page, 10, 85_000);
      const want = slotPlan(seed, 'a', 10)[9].balanceAfter;
      expect(await balance(page)).toBe(want);
      const s = await sessionWith(page, 10);
      expect(s.fx).toBe(fx);
      expect(s.events[9].balance).toBe(want);
    });
  }

  test('?sv=b: Session.sv is "b" and the balance follows SLOT_B', async ({ page }) => {
    await installRoundCounter(page);
    await start(page, { seed, fx: 'off', sv: 'b' });
    await openCard(page, 'slot');
    await playRounds(page, 10);
    const want = slotPlan(seed, 'b', 10)[9].balanceAfter;
    expect(await balance(page)).toBe(want);
    const s = await sessionWith(page, 10);
    expect(s.sv).toBe('b');
    expect(s.events[9].balance).toBe(want);
    // the two variants really differ on this seed (checked in pickSeed), so the comparison above is not vacuous
    expect(want).not.toBe(slotPlan(seed, 'a', 10)[9].balanceAfter);
  });
});

// ------------------------------------------------------------------------------------------------ 5
const widths = (page: Page): Promise<{ sw: number; cw: number }> =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));

test.describe('5. 320x568 and sideways', () => {
  test('320x568: every screen fits the width (screenshots attached)', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page, { seed: 'e2e-small', fx: 'off' });
    await shot(page, info, 'gate-320');
    await enter(page);
    await shot(page, info, 'lobby-320');
    for (const g of GAMES) {
      await openCard(page, g);
      const { sw, cw } = await widths(page);
      expect.soft(sw, `${g}: page wider than the viewport`).toBeLessThanOrEqual(cw);
      await shot(page, info, `${g}-320`);
      await toLobby(page);
    }
  });

  test('landscape: the rotate cover covers the game, upright removes it (screenshots attached)', async ({ page }, info) => {
    await start(page, { seed: 'e2e-side', fx: 'off' });
    await openCard(page, 'slot');
    await expect(page.getByTestId('rotate')).toBeHidden();
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width: Math.max(width, height), height: Math.min(width, height) });
    await expect(page.getByTestId('rotate')).toBeVisible();
    await shot(page, info, 'landscape');
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('rotate')).toBeHidden();
  });

  test('landscape at load: the cover is up before the gate is tapped', async ({ page }, info) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(gameUrl({ seed: 'e2e-side2', fx: 'off' }));
    await expect(page.getByTestId('rotate')).toBeVisible();
    await shot(page, info, 'landscape-gate');
  });
});

// ------------------------------------------------------------------------------------------------ 6
interface Small { tid: string; label: string; w: number; h: number }
const smallTargets = (page: Page): Promise<Small[]> =>
  page.evaluate(() => {
    const out: { tid: string; label: string; w: number; h: number }[] = [];
    let seen = 0;
    for (const el of document.querySelectorAll<HTMLElement>('button, [role=button]')) {
      if (el.closest('[aria-hidden="true"]') || el.closest('[hidden]')) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      seen++;
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
        out.push({ tid: el.dataset.testid ?? '', label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    (window as unknown as { __seen: number }).__seen = seen;
    return out;
  });

test.describe('6. touch targets', () => {
  test('buttons are at least 44x44 on the gate, lobby, games and receipt', async ({ page }) => {
    await open(page, { seed: 'e2e-touch', fx: 'off' });
    const found: Record<string, Small[]> = {};
    found.gate = await smallTargets(page);
    await enter(page);
    found.lobby = await smallTargets(page);
    for (const g of GAMES) {
      await openCard(page, g);
      found[g] = await smallTargets(page);
      await toLobby(page);
    }
    await page.getByTestId('btn-cashout').click();
    await expect(receipt(page)).toBeVisible();
    found.receipt = await smallTargets(page);
    expect(await page.evaluate(() => (window as unknown as { __seen: number }).__seen), 'the scan saw the receipt controls').toBeGreaterThan(0);
    for (const [screen, list] of Object.entries(found)) {
      expect.soft(list, `${screen}: controls under 44x44`).toEqual([]);
    }
    expect(digits(await page.getByTestId('receipt-credits').textContent())).toBeGreaterThan(0);
  });
});
