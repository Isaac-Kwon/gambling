/** ARCHITECTURE 11.4 scenarios 7 to 11: same-origin only, offline, demo offer, the Pixi layer, context loss. */
import type { Page } from '@playwright/test';
import {
  balance, enter, expect, installRoundCounter, open, openCard, pixiChunkFile, playRounds, slotPlan, start, test, toLobby,
  type GameKey,
} from './lib';

const GAMES: GameKey[] = ['slot', 'roulette', 'blackjack', 'crash', 'ocean'];

// ------------------------------------------------------------------------------------------------ 7
test.describe('7. no foreign requests', () => {
  test('lobby, five games, receipt and the detail page only talk to their own origin', async ({ page, watch, baseURL }) => {
    await start(page, { seed: 'e2e-net', fx: 'on' });
    for (const g of GAMES) {
      await openCard(page, g);
      await toLobby(page);
    }
    await page.getByTestId('btn-cashout').click();
    await expect(page.getByTestId('receipt')).toBeVisible();
    await page.getByTestId('btn-detail').click();
    await page.waitForURL(/\/understanding\//);
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await page.locator('#sec-sim').scrollIntoViewIfNeeded();
    await page.waitForLoadState('networkidle');
    expect(watch.requests.length).toBeGreaterThan(10);
    const origin = new URL(baseURL!).origin;
    expect(watch.requests.filter((u) => !/^(data|blob):/.test(u) && new URL(u).origin !== origin)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ 8
test.describe('8. offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('after the service worker is active both pages reload without a network', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit: context.setOffline does not cover service-worker-served navigations in Playwright; scenario is Chromium-only (11.4)');
    await page.goto('/gambling/');
    await expect(page.getByTestId('gate')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    // active means the install step (the whole precache) has finished
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('gate')).toBeVisible();
    await enter(page);
    await page.goto('/gambling/understanding/');
    await expect(page.getByTestId('nodata')).toBeVisible();
    await page.getByTestId('open-demo').click();
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await context.setOffline(false);
  });
});

// ------------------------------------------------------------------------------------------------ 9
test.describe('9. no log', () => {
  test('the detail page offers the demo session', async ({ page }) => {
    await page.goto('/gambling/understanding/');
    await expect(page.getByTestId('nodata')).toBeVisible();
    await expect(page.getByTestId('source-kind')).toHaveCount(0);
    await page.getByTestId('open-demo').click();
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await expect(page.getByTestId('nodata')).toHaveCount(0);
    await expect(page.locator('#sec-intro .section-body > *').first()).toBeAttached();
    await expect(page.locator('main.sections')).toHaveClass(/is-gated/); // below the intro stays locked until answered or skipped
  });
});

// ------------------------------------------------------------------------------------------------ 10
const trackCanvas = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const w = window as unknown as { __canvasSeen: number };
    w.__canvasSeen = 0;
    const mo = new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes) {
        if (n instanceof HTMLCanvasElement || (n instanceof Element && n.querySelector('canvas'))) w.__canvasSeen++;
      }
    });
    mo.observe(document, { subtree: true, childList: true });
  });
};

test.describe('10. Pixi layer', () => {
  test('fx=off: no canvas, no Pixi chunk request, all session long', async ({ page, watch, request }) => {
    const chunk = await pixiChunkFile(request);
    await trackCanvas(page);
    await installRoundCounter(page);
    await open(page, { seed: 'e2e-off', fx: 'off' });
    await page.waitForLoadState('networkidle');
    expect(watch.requests.filter((u) => u.includes(chunk)), 'before the gate tap').toEqual([]);
    await enter(page);
    await openCard(page, 'slot');
    await playRounds(page, 2);
    await toLobby(page);
    for (const g of ['roulette', 'crash', 'ocean'] as const) {
      await openCard(page, g);
      await toLobby(page);
    }
    await page.waitForLoadState('networkidle');
    expect(await page.locator('canvas').count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __canvasSeen: number }).__canvasSeen)).toBe(0);
    expect(watch.requests.filter((u) => u.includes(chunk)), 'after a session').toEqual([]);
  });

  test('fx on: nothing before the gate tap, the layer shows up within 3 s after it', async ({ page, watch, browserName, request }, info) => {
    const chunk = await pixiChunkFile(request);
    await open(page, { seed: 'e2e-on', fx: 'on' });
    await page.waitForLoadState('networkidle');
    expect(watch.requests.filter((u) => u.includes(chunk)), 'before the gate tap').toEqual([]);
    expect(await page.locator('canvas').count()).toBe(0);
    await page.getByTestId('gate').click();
    await expect(page.getByTestId('lobby')).toBeVisible();
    if (browserName === 'chromium') {
      await expect(page.locator('#gfx canvas')).toBeVisible({ timeout: 3000 });
      expect(watch.requests.filter((u) => u.includes(chunk)).length).toBeGreaterThan(0);
    } else {
      // WebKit headless: WebGL may be unavailable; the chunk is still requested, the canvas is a bonus.
      await expect.poll(() => watch.requests.some((u) => u.includes(chunk)), { timeout: 3000 }).toBe(true);
      const has = await page.locator('#gfx canvas').count();
      info.annotations.push({ type: 'webgl', description: has ? 'canvas present' : 'no WebGL canvas in this WebKit run (game runs without it)' });
    }
  });
});

// ------------------------------------------------------------------------------------------------ 11
test.describe('11. context loss', () => {
  test('a slot round completes with the right balance while the GL context is lost and restored', async ({ page, browserName }, info) => {
    const seed = 'e2e-lose';
    await installRoundCounter(page);
    await start(page, { seed, fx: 'on' });
    await openCard(page, 'slot');
    await page.getByTestId('btn-turbo').click();
    const canvas = page.locator('#gfx canvas');
    const plan = slotPlan(seed, 'a', 3);
    if (browserName === 'chromium') {
      await expect(canvas).toBeVisible({ timeout: 5000 });
    } else if (await canvas.count() === 0) {
      // no WebGL here: the game must run without the layer
      info.annotations.push({ type: 'webgl', description: 'no canvas in this WebKit run; only checked that play continues' });
      await playRounds(page, 1);
      expect(await balance(page)).toBe(plan[0].balanceAfter);
      return;
    }
    const lost = await page.evaluate(() => {
      const c = document.querySelector('#gfx canvas') as HTMLCanvasElement;
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !ext) return false;
      (window as unknown as { __lose: typeof ext }).__lose = ext;
      ext.loseContext();
      return gl.isContextLost();
    });
    if (browserName === 'chromium') expect(lost).toBe(true);
    await playRounds(page, 1);
    expect(await balance(page)).toBe(plan[0].balanceAfter);
    if (lost) {
      await page.evaluate(() => (window as unknown as { __lose: { restoreContext(): void } }).__lose.restoreContext());
      await page.waitForFunction(() => {
        const c = document.querySelector('#gfx canvas') as HTMLCanvasElement | null;
        const gl = (c?.getContext('webgl2') ?? c?.getContext('webgl')) as WebGLRenderingContext | null | undefined;
        return !gl || !gl.isContextLost();
      });
    }
    await playRounds(page, 1);
    expect(await balance(page)).toBe(plan[1].balanceAfter);
  });
});
