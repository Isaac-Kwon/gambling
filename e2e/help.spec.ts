/**
 * How-to-play sheet: the HUD ? button shows only inside a game, opens that game's rules and paytable,
 * changes nothing in the wallet, and is noted in the session log.
 */
import { balance, cashOut, expect, openCard, start, test, toLobby, type GameKey } from './lib';

const GAMES: { g: GameKey; text: string }[] = [
  { g: 'slot', text: '20 LINES' },
  { g: 'roulette', text: '35:1' },
  { g: 'blackjack', text: '3:2' },
  { g: 'crash', text: 'AUTO CASH OUT' },
  { g: 'ocean', text: '황금 진주' },
];

test.describe('how to play', () => {
  test('every game has its own sheet; the lobby has no ? button', async ({ page }, info) => {
    await start(page, { seed: 'help-sheets' });
    await expect(page.getByTestId('btn-help')).toBeHidden();
    const before = await balance(page);
    for (const { g, text } of GAMES) {
      await openCard(page, g);
      await page.getByTestId('btn-help').click();
      const sheet = page.getByTestId('help');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('heading', { level: 2 })).toContainText('게임 방법');
      await expect(sheet).toContainText(text);
      if (process.env.HELP_SHOTS) await page.screenshot({ path: `${process.env.HELP_SHOTS}/${info.project.name}-${g}.png` });
      await page.getByTestId('help-close').click();
      await expect(page.getByTestId('help')).toHaveCount(0);
      await toLobby(page);
    }
    expect(await balance(page)).toBe(before);

    await cashOut(page);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('eg.session.v1') ?? 'null'));
    const help = (s?.aux ?? []).filter((a: { k?: string; kind?: string }) => (a.k ?? a.kind) === 'help');
    expect(help).toHaveLength(GAMES.length);
  });
});
