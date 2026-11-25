/** ARCHITECTURE 11.4 scenarios 1, 2, 3 and 12: the whole visit, the bust path, blocked storage, the ocean lump sum. */
import { createStreams } from '../shared/rng';
import { START_CREDITS } from '../shared/config';
import { SLOTS, spin } from '../shared/rules/slot';
import { OCEAN, oceanInit, oceanSpin } from '../shared/rules/ocean';
import {
  balance, cashOut, crashFirst, digits, endedSession, evTotals, expect, installRoundCounter, losingOutsideBets, oceanPlan,
  openCard, pickSeed, playRounds, readSession, receipt, rouletteFirst, sessionWith, skipIntro, slotPlan, start, test, toLobby,
} from './lib';

const SECTION_IDS = ['intro', 'debrief', 'stimulus', 'replayPlain', 'strategyCheck', 'sim', 'quiz', 'caseStudy', 'help'];

test.describe('1. a whole visit', () => {
  test('gate, lobby, five games, cash out, receipt, understanding draws every section', async ({ page }) => {
    // crash round 1 must reach the default 2.00x auto target, so the cash-out is deterministic
    const seed = pickSeed('e2e-visit', (s) => crashFirst(s) >= 2);
    await installRoundCounter(page);
    await start(page, { seed, fx: 'off' });
    expect(await balance(page)).toBe(START_CREDITS);
    let n = 0;

    // --- slot
    await openCard(page, 'slot');
    await playRounds(page, 1);
    n++;
    await toLobby(page);

    // --- roulette: ten credits on red
    await openCard(page, 'roulette');
    await page.getByTestId('cell-red').click();
    await page.getByTestId('btn-spin').click();
    await sessionWith(page, n + 1);
    n++;
    await toLobby(page);

    // --- blackjack: 20 credits, stand (a natural settles the round by itself)
    await openCard(page, 'blackjack');
    await page.getByTestId('chip-20').click();
    await page.getByTestId('btn-deal').click();
    await expect.poll(async () => {
      const stand = page.getByTestId('btn-stand');
      if (await stand.isEnabled()) await stand.click({ timeout: 1000 }).catch(() => undefined);
      return (await readSession(page))?.events.length ?? 0;
    }, { timeout: 30_000, intervals: [200, 400, 800] }).toBeGreaterThanOrEqual(n + 1);
    n++;
    await toLobby(page);

    // --- crash: auto cash-out at 2.00x
    await openCard(page, 'crash');
    await page.getByTestId('btn-auto').click(); // auto cash-out at the default 2.00x (the quick-pick chips are hidden on short screens)
    await page.getByTestId('btn-action').click();
    await sessionWith(page, n + 1, 30_000);
    n++;
    await toLobby(page);

    // --- ocean
    await openCard(page, 'ocean');
    await playRounds(page, 1);
    n++;
    await toLobby(page);

    // --- the stored log agrees with the rules engine and with the HUD
    const log = await sessionWith(page, n);
    expect(log.events.map((e) => e.game)).toEqual(['slot', 'roulette', 'blackjack', 'crash', 'ocean']);
    const streams = createStreams(seed);
    const [slotEv, rouEv, bjEv, crEv, ocEv] = log.events;
    const slotRes = spin(SLOTS.a, streams.res('slot').at(1), 1);
    expect(slotEv.payout).toBe(slotRes.payout);
    expect(slotEv.out?.stops).toEqual(slotRes.stops);
    expect(rouEv.out?.n).toBe(rouletteFirst(seed));
    expect(rouEv.payout).toBe(([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(rouletteFirst(seed)) ? 20 : 0));
    expect(crEv.out?.crash).toBe(crashFirst(seed));
    expect(crEv.out?.cashoutAt).toBe(2);
    expect(crEv.payout).toBe(Math.floor((crEv.bet * 200) / 100));
    expect(bjEv.bet).toBeGreaterThanOrEqual(20);
    const oc = oceanSpin(OCEAN, oceanInit(), streams.res('ocean').at(1), 20).result;
    expect(ocEv.payout).toBe(oc.payout);
    // every Ev's balance is the previous balance plus its net
    let bal = log.startCredits;
    for (const e of log.events) {
      bal += e.net;
      expect(e.balance).toBe(bal);
    }
    expect(await balance(page)).toBe(bal);

    // --- cash out: the receipt prints the same number
    await cashOut(page);
    expect(digits(await page.getByTestId('receipt-credits').textContent())).toBe(bal);
    await expect(receipt(page)).toHaveAttribute('data-reason', 'cashout');
    await expect(page.getByTestId('receipt-bonus')).toHaveCount(0);
    const ended = await endedSession(page);
    expect(ended.endReason).toBe('cashout');
    expect(evTotals(ended).balance).toBe(bal);

    // --- hand-off to the detail page, which draws all nine sections
    await page.getByTestId('btn-detail').click();
    await page.waitForURL(/\/gambling\/understanding\//);
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await skipIntro(page);
    for (const id of SECTION_IDS) {
      const sec = page.locator(`#sec-${id}`);
      await sec.scrollIntoViewIfNeeded();
      await expect(sec.locator('.section-body > *').first(), `section ${id}`).toBeAttached({ timeout: 20_000 });
    }
  });
});

test.describe('2. bust', () => {
  test('two losing even-money bets of 5,000 empty the wallet and open the settlement by themselves', async ({ page }) => {
    const seed = pickSeed('e2e-bust', () => true);
    const n = rouletteFirst(seed);
    const [a, b] = losingOutsideBets(n);
    await start(page, { seed, fx: 'off' });
    await openCard(page, 'roulette');
    await page.getByTestId('chip-500').click();
    for (const kind of [a, b]) {
      for (let i = 0; i < 10; i++) await page.getByTestId(`cell-${kind}`).click();
    }
    await expect.poll(async () => digits(await page.getByTestId('bet').first().textContent())).toBe(10_000);
    await page.getByTestId('btn-spin').click();
    await expect(receipt(page)).toBeVisible({ timeout: 30_000 });
    await expect(receipt(page)).toHaveAttribute('data-reason', 'bust');
    expect(digits(await page.getByTestId('receipt-credits').textContent())).toBe(0);
    const s = await endedSession(page);
    expect(s.endReason).toBe('bust');
    expect(s.events).toHaveLength(1);
    expect(s.events[0].out?.n).toBe(n);
    expect(s.events[0].balance).toBe(0);
    await expect(page.getByTestId('btn-detail')).toBeVisible();
  });
});

test.describe('3. storage blocked', () => {
  test('the summary in the URL hash is enough for the detail page', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); };
    });
    await installRoundCounter(page);
    const seed = 'e2e-blocked';
    await start(page, { seed, fx: 'off' });
    await openCard(page, 'slot');
    await playRounds(page, 3);
    const want = slotPlan(seed, 'a', 3)[2].balanceAfter;
    expect(await balance(page)).toBe(want);
    await cashOut(page);
    expect(await page.evaluate(() => localStorage.getItem('eg.session.v1'))).toBeNull();
    await page.getByTestId('btn-detail').click();
    await page.waitForURL(/\/gambling\/understanding\//);
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await expect(page.getByTestId('nodata')).toHaveCount(0);
    await skipIntro(page);
    // sections that need only the summary are drawn
    const first = page.locator('#sec-intro .section-body > *').first();
    await expect(first).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.stats').first()).toBeVisible();
  });
});

test.describe('12. ocean lump sum', () => {
  test('cash-out right after a bonus trigger pays the queue as one final event', async ({ page }) => {
    // first seed whose bonus triggers within the first 8 ocean rounds
    const seed = pickSeed('e2e-ocean', (s) => oceanPlan(s, 8).findIndex((r) => r.triggered) >= 0);
    const plan = oceanPlan(seed, 8);
    const k = plan.findIndex((r) => r.triggered) + 1;
    const pending = plan[k - 1].pendingAfter;
    expect(pending).toBeGreaterThan(0);
    await installRoundCounter(page);
    await start(page, { seed, fx: 'off' });
    await openCard(page, 'ocean');
    await playRounds(page, k);
    expect(await balance(page)).toBe(plan[k - 1].balanceAfter);
    await cashOut(page);
    const finalCredits = plan[k - 1].balanceAfter + pending;
    expect(digits(await page.getByTestId('receipt-credits').textContent())).toBe(finalCredits);
    expect(digits(await page.getByTestId('receipt-bonus').textContent())).toBe(pending);
    const s = await endedSession(page);
    const last = s.events[s.events.length - 1];
    expect(last.dec).toMatchObject({ flush: true });
    expect(last.payout).toBe(pending);
    expect(last.balance).toBe(finalCredits);
    expect(s.unreleased).toBe(pending);
    expect(s.events).toHaveLength(k + 1);
  });
});
