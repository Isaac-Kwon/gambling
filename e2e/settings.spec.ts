/**
 * Lobby settings (language + sound), the purpose / problem-gambling notice, pinch-zoom off, and the way back
 * to the game from the receipt and from the detail page.
 */
import { balance, cashOut, enter, expect, open, receipt, start, test } from './lib';

test.describe('settings, notice, zoom, back to the game', () => {
  test('viewport forbids zoom and the gate carries the purpose line', async ({ page }) => {
    await open(page);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1.*user-scalable=no/);
    await expect(page.getByTestId('notice-purpose')).toContainText('도박 중독 방지 교육용 목적으로 제작되었습니다.');
    await enter(page);
    const notice = page.getByTestId('lobby-notice');
    await expect(notice).toContainText('도박 중독 방지 교육용 목적으로 제작되었습니다.');
    await expect(notice).toContainText('1336');
  });

  test('language switches in place, is remembered, and the session goes on', async ({ page }) => {
    await start(page, { seed: 'settings-lang' });
    const before = await balance(page);
    await page.getByTestId('btn-settings').click();
    const sheet = page.getByTestId('settings');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('settings-lang').getByRole('button', { name: 'English' }).click();

    // The lobby is redrawn in English and the sheet reopens in English.
    await expect(page.getByTestId('lobby-notice')).toContainText('Made for gambling addiction prevention education.');
    await expect(page.locator('.lb-dock__tab').first()).toHaveText('Casino');
    await expect(page.getByTestId('settings')).toHaveCount(1); // the Korean sheet has finished closing
    await expect(page.getByTestId('settings').getByRole('heading')).toContainText('SETTINGS');
    await expect(page.getByTestId('settings').getByTestId('settings-lang').getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => localStorage.getItem('eg.lang'))).toBe('en');
    expect(await balance(page)).toBe(before);

    // Sound off from the same sheet.
    await page.getByTestId('settings').getByTestId('settings-sound').getByRole('button', { name: 'OFF' }).click();
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('settings')).toHaveCount(0);

    // The change is in the session log (saved with the next write: the cash-out writes it).
    await cashOut(page);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('eg.session.v1') ?? 'null'));
    const kinds = (s?.aux ?? []).map((a: { k?: string; kind?: string }) => a.k ?? a.kind);
    expect(kinds).toContain('lang');
    expect(kinds).toContain('mute');
  });

  test('receipt: back to the game starts a new session at the gate', async ({ page }) => {
    await start(page, { seed: 'settings-again' });
    await cashOut(page);
    await expect(receipt(page).getByTestId('btn-again')).toBeVisible();
    await receipt(page).getByTestId('btn-again').click();
    await expect(page).toHaveURL(/\/gambling\/\?seed=settings-again$/);
    await expect(page.getByTestId('gate')).toBeVisible();
    await enter(page);
    await expect(page.getByTestId('lobby')).toBeVisible();
  });

  test('detail page links back to the game', async ({ page }) => {
    await page.goto('/gambling/understanding/');
    const back = page.getByTestId('back-to-game');
    await expect(back).toHaveAttribute('href', '/gambling/');
    await back.click();
    await expect(page.getByTestId('gate')).toBeVisible();
  });
});
