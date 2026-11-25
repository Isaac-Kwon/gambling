/**
 * Shared helpers for the E2E suite. Expected outcomes are always recomputed from shared/rules + shared/rng
 * with the seed under test; nothing numeric is hardcoded.
 */
import { test as base, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { START_CREDITS } from '../shared/config';
import { SESSION_KEY } from '../shared/logger';
import { createStreams } from '../shared/rng';
import { crashPoint } from '../shared/rules/crash';
import { OCEAN, oceanInit, oceanPending, oceanSpin, type OceanState } from '../shared/rules/ocean';
import { spinWheel, wins, type RouletteBet } from '../shared/rules/roulette';
import { SLOTS, spin as slotSpin } from '../shared/rules/slot';
import type { Ev, Session } from '../shared/schema';
import type { SlotVariant } from '../shared/config';

export { expect };

// ---------------------------------------------------------------------------------------------- fixture

/**
 * `page` that records every request (url + whether it came from a service worker), uncaught page errors and
 * console errors. After each test: no cross-origin request, no page error, no console error.
 */
export interface Watch {
  requests: string[];
  errors: string[];
}

export const test = base.extend<{ watch: Watch }>({
  watch: [async ({ page, baseURL }, use) => {
    const w: Watch = { requests: [], errors: [] };
    const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
    page.on('request', (r) => {
      w.requests.push(r.url());
    });
    page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') w.errors.push(`console.error: ${m.text()}`);
    });
    await use(w);
    const foreign = w.requests.filter((u) => !/^(data|blob|about):/.test(u) && new URL(u).origin !== origin);
    expect(foreign, 'requests outside the page origin').toEqual([]);
    expect(w.errors, 'page errors').toEqual([]);
  }, { auto: true }],
});

// ---------------------------------------------------------------------------------------------- urls

export interface Opts { seed?: string; fx?: 'on' | 'off'; sv?: SlotVariant }

export function gameUrl(o: Opts = {}): string {
  const q = new URLSearchParams();
  if (o.seed) q.set('seed', o.seed);
  if (o.fx === 'off') q.set('fx', 'off');
  if (o.sv === 'b') q.set('sv', 'b');
  const s = q.toString();
  return `/gambling/${s ? '?' + s : ''}`;
}

export const digits = (s: string | null | undefined): number => Number((s ?? '').replace(/[^\d]/g, ''));

// ---------------------------------------------------------------------------------------------- flow

/** Open the page (not yet entered): the gate is showing. */
export async function open(page: Page, o: Opts = {}): Promise<void> {
  await page.goto(gameUrl(o));
  await expect(page.getByTestId('gate')).toBeVisible();
}

/** Tap the gate; resolves when the lobby is up and the gate is gone. */
export async function enter(page: Page): Promise<void> {
  await page.getByTestId('gate').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('gate')).toHaveCount(0);
}

export async function start(page: Page, o: Opts = {}): Promise<void> {
  await open(page, o);
  await enter(page);
}

export type GameKey = 'slot' | 'roulette' | 'blackjack' | 'crash' | 'ocean';

export async function openCard(page: Page, g: GameKey): Promise<void> {
  await page.getByTestId(`card-${g}`).click();
  await expect(page.getByTestId(g === 'ocean' ? 'ocean-screen' : g)).toBeVisible();
}

export async function toLobby(page: Page): Promise<void> {
  await page.getByTestId('btn-lobby').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
}

/** The wallet's exact balance (HUD `data-value`, set on every wallet change). */
export async function balance(page: Page): Promise<number> {
  return Number(await page.getByTestId('balance').getAttribute('data-value'));
}

// ---------------------------------------------------------------------------------------------- session log

export async function readSession(page: Page): Promise<Session | null> {
  return page.evaluate((k) => {
    try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }, SESSION_KEY);
}

/** Polls the stored log (it is written within 1.5 s of every settlement) until it holds `n` events. */
export async function sessionWith(page: Page, n: number, timeout = 15_000): Promise<Session> {
  let s: Session | null = null;
  await expect.poll(async () => {
    s = await readSession(page);
    return s?.events.length ?? 0;
  }, { timeout, intervals: [100, 250, 500] }).toBeGreaterThanOrEqual(n);
  return s as unknown as Session;
}

/** A finished (cashed-out / bust) session as saved by the receipt. */
export async function endedSession(page: Page): Promise<Session> {
  let s: Session | null = null;
  await expect.poll(async () => {
    s = await readSession(page);
    return s?.endedAt !== undefined;
  }, { timeout: 15_000 }).toBe(true);
  return s as unknown as Session;
}

// ---------------------------------------------------------------------------------------------- oracles

/** Seeds are probed in a fixed order, so the result is deterministic. */
export function pickSeed(prefix: string, ok: (seed: string) => boolean): string {
  for (let i = 0; i < 20_000; i++) {
    const seed = `${prefix}-${i}`;
    if (ok(seed)) return seed;
  }
  throw new Error(`no seed for ${prefix}`);
}

export interface SlotPlan { bet: number; payout: number; balanceAfter: number }

/** Slot rounds 1..n at the first bet step (the session default). */
export function slotPlan(seed: string, sv: SlotVariant, n: number): SlotPlan[] {
  const cfg = SLOTS[sv];
  const streams = createStreams(seed);
  const bet = 20;
  let bal = START_CREDITS;
  const out: SlotPlan[] = [];
  for (let i = 1; i <= n; i++) {
    const r = slotSpin(cfg, streams.res('slot').at(i), bet / 20);
    bal += r.payout - bet;
    out.push({ bet, payout: r.payout, balanceAfter: bal });
  }
  return out;
}

export const rouletteFirst = (seed: string): number => spinWheel(createStreams(seed).res('roulette').at(1));
export const crashFirst = (seed: string): number => crashPoint(createStreams(seed).res('crash').at(1));

export interface OceanPlan { bet: number; payout: number; balanceAfter: number; pendingAfter: number; triggered: boolean }

/** Ocean rounds 1..n at the first bet step; the queue is carried between rounds exactly like the game does. */
export function oceanPlan(seed: string, n: number): OceanPlan[] {
  const streams = createStreams(seed);
  const bet = 20;
  let st: OceanState = oceanInit();
  let bal = START_CREDITS;
  const out: OceanPlan[] = [];
  for (let i = 1; i <= n; i++) {
    const { state, result } = oceanSpin(OCEAN, st, streams.res('ocean').at(i), bet);
    st = state;
    bal += result.payout - bet;
    out.push({ bet, payout: result.payout, balanceAfter: bal, pendingAfter: oceanPending(st), triggered: !!result.triggered });
  }
  return out;
}

/** Two outside bets that both lose for number `n` (zero loses everything). */
export function losingOutsideBets(n: number): ('red' | 'black' | 'odd' | 'even' | 'low' | 'high')[] {
  const kinds = ['red', 'black', 'odd', 'even', 'low', 'high'] as const;
  const lose = kinds.filter((k) => !wins({ kind: k } as RouletteBet, n));
  if (lose.length < 2) throw new Error(`need two losing outside bets for ${n}`);
  return lose.slice(0, 2);
}

// ---------------------------------------------------------------------------------------------- slot / ocean round counters

/**
 * Installs a MutationObserver (before any page script) that counts rounds of the spin button: `starts` when
 * it goes into its running state, `ends` when it comes out again. Slot: `data-mode="stop"`; ocean: class `is-stop`.
 * Works without sleeps and also with the 150 ms fx=off rounds.
 */
export async function installRoundCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ctr = { starts: 0, ends: 0 };
    (window as unknown as { __rounds: typeof ctr }).__rounds = ctr;
    const running = (el: Element, attr: string, v: string | null): boolean =>
      attr === 'data-mode' ? v === 'stop' : (v ?? '').split(/\s+/).includes('is-stop') && el.getAttribute('data-testid') === 'btn-spin';
    const start = (): void => {
      const mo = new MutationObserver((recs) => {
        const per = new Map<string, { el: Element; attr: string; vals: (string | null)[]; cur: string | null }>();
        for (const r of recs) {
          const t = r.target as Element;
          if (t.getAttribute('data-testid') !== 'btn-spin' || !r.attributeName) continue;
          const key = r.attributeName;
          let p = per.get(key);
          if (!p) { p = { el: t, attr: key, vals: [], cur: t.getAttribute(key) }; per.set(key, p); }
          p.vals.push(r.oldValue);
        }
        for (const p of per.values()) {
          const seq = [...p.vals, p.cur];
          for (let i = 0; i + 1 < seq.length; i++) {
            const a = running(p.el, p.attr, seq[i]);
            const b = running(p.el, p.attr, seq[i + 1]);
            if (!a && b) ctr.starts++;
            if (a && !b) ctr.ends++;
          }
        }
      });
      mo.observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-mode', 'class'] });
    };
    start();
  });
}

export const rounds = (page: Page): Promise<{ starts: number; ends: number }> =>
  page.evaluate(() => (window as unknown as { __rounds?: { starts: number; ends: number } }).__rounds ?? { starts: -1, ends: -1 });

/**
 * Plays `count` more rounds with the `btn-spin` button (counter from installRoundCounter). A tap that only skips a
 * celebration is repeated; no fixed sleeps.
 */
export async function playRounds(page: Page, count: number, timeout = 60_000): Promise<void> {
  const btn = page.getByTestId('btn-spin');
  const base = await rounds(page);
  const total = base.ends + count;
  await expect.poll(async () => {
    const c = await rounds(page);
    if (c.starts < total && c.starts === c.ends) await btn.click({ timeout: 2000 }).catch(() => undefined);
    return (await rounds(page)).ends;
  }, { timeout, intervals: [60, 120, 250] }).toBeGreaterThanOrEqual(total);
}

// ---------------------------------------------------------------------------------------------- receipt

export const receipt = (page: Page): Locator => page.getByTestId('receipt');

export async function cashOut(page: Page): Promise<void> {
  await page.getByTestId('btn-cashout').click();
  await expect(receipt(page)).toBeVisible();
  await expect(receipt(page)).toHaveClass(/is-done/);
}

// ---------------------------------------------------------------------------------------------- misc

export function evTotals(s: Session): { balance: number; net: number } {
  const net = s.events.reduce((a, e: Ev) => a + e.net, 0);
  return { balance: s.events.length ? s.events[s.events.length - 1].balance : s.startCredits, net };
}

/** The manifest-resolved Pixi stage chunk file name (e.g. assets/c-xxxx.js), read from the served build. */
export async function pixiChunkFile(request: APIRequestContext): Promise<string> {
  const res = await request.get('/gambling/.vite/manifest.json');
  expect(res.ok(), 'build manifest is served').toBe(true);
  const m = (await res.json()) as Record<string, { file: string }>;
  const e = m['gambling/fx/gl/stage.ts'];
  if (!e) throw new Error('manifest has no gambling/fx/gl/stage.ts');
  return e.file;
}

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

/** The detail page blurs everything below the intro until the two feelings are answered or skipped: skip them. */
export async function skipIntro(page: Page): Promise<void> {
  await page.getByTestId('btn-skip').click();
  await expect(page.locator('main.sections')).not.toHaveClass(/is-gated/);
}
