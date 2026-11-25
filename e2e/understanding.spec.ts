/** Phone-width pass over every understanding section with the demo session (screenshots go to test-results/sections). */
import { mkdirSync } from 'node:fs';
import { expect, skipIntro, test } from './lib';

const SECTION_IDS = ['intro', 'debrief', 'stimulus', 'replayPlain', 'strategyCheck', 'sim', 'quiz', 'caseStudy', 'help'];

test.describe('understanding at 390x844 (demo session)', () => {
  test('every section draws, fits the width, and is captured', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/gambling/understanding/?demo=1');
    await expect(page.getByTestId('source-kind')).toBeVisible();
    await skipIntro(page);
    const dir = `test-results/sections/${info.project.name}`;
    mkdirSync(dir, { recursive: true });
    for (const id of SECTION_IDS) {
      const sec = page.locator(`#sec-${id}`);
      await sec.scrollIntoViewIfNeeded();
      await expect(sec.locator('.section-body > *').first(), `section ${id}`).toBeAttached({ timeout: 20_000 });
      // let charts / the simulation worker finish: the section height stops changing
      let last = -1;
      await expect.poll(async () => {
        const h = (await sec.boundingBox())?.height ?? 0;
        const same = h === last;
        last = h;
        return same;
      }, { timeout: 20_000, intervals: [400] }).toBe(true);
      await sec.screenshot({ path: `${dir}/${id}.png`, animations: 'disabled' });
      const over = await page.evaluate((sel) => {
        const root = document.querySelector(sel) as HTMLElement;
        const vw = document.documentElement.clientWidth;
        const bad: string[] = [];
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
            // elements inside their own horizontal scroller are fine
            let p = el.parentElement, scrolled = false;
            while (p && p !== root) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolled = true; break; } p = p.parentElement; }
            if (!scrolled) bad.push(`${el.tagName.toLowerCase()}.${String(el.className)}`.slice(0, 60));
          }
        }
        return bad.slice(0, 5);
      }, `#sec-${id}`);
      expect.soft(over, `section ${id}: content past the viewport edge`).toEqual([]);
    }
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect.soft(sw, 'page scrolls sideways').toBeLessThanOrEqual(cw);
  });
});
