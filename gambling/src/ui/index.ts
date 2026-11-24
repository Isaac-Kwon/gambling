/**
 * OROBELLE UI kit — brand theme and DOM parts for the game page. No framework: every factory returns
 * plain HTMLElements (or a tiny `{ el, set… }` handle). Importing this module installs the CSS
 * (theme tokens, reset, #frame, kit components) and the Lilita One latin font.
 *
 * ── Page frame ─────────────────────────────────────────────────────────────────────────────────
 *   <body> gets the dark casino backdrop. Put everything inside `<div id="frame">` (≤ 430×932,
 *   centred, safe-area padding, touch suppression). Layers inside #frame (ARCHITECTURE 4.4):
 *   screen/HUD → `#gfx` (z 20) → `#fx-dom` (z 30) → sheet (40) → modal (50) → gate/receipt
 *   (`z-index: var(--z-top)`, 60). Add `rotateOverlay()` once (CSS shows it in landscape with
 *   height < 480px); `onRotateBlock(blocked => …)` lets the runtime pause while it shows.
 *   `setFxMode('off')` (sets `<html data-fx="off">`) hides kit glow layers and stops kit loops.
 *
 * ── Tokens (theme.css) ─────────────────────────────────────────────────────────────────────────
 *   --bg --surface --surface-2 --gold-1/2/3 --red --crimson --magenta --cyan --violet --win --text
 *   --muted, gradients --gold-grad --gold-text --crimson-grad --violet-grad --dark-grad --panel-grad,
 *   --font-display (Lilita One → system Hangul) --font-ko, --safe-t/r/b/l, --tap (44px), --z-*.
 *
 * ── Text & numbers ─────────────────────────────────────────────────────────────────────────────
 *   goldText('ORO SEVENS', { size: 40, glow: 'magenta' })   gold lettering, thick ink outline, neon glow
 *   setGoldText(el, text)                                    change it later (keeps the layers in sync)
 *   neonText('CASINO', { color: 'cyan', size: 16 })          neon tube lettering
 *   winTitle(tier)                                           tier 0..4 → WIN / NICE / BIG WIN / MEGA WIN / EPIC WIN
 *   const n = num({ value: 10000, tone: 'gold', size: 32 }); n.set(12500)   fixed-width digit cells
 *   setDigits(el, '12,500')                                  same cells on any element (count-up targets:
 *                                                            give the element class `ui-num ui-num--gold`)
 *   plate({ label: 'BALANCE', value: 10000, testid: 'balance' })   recessed read-out; .set(v) / .setLabel()
 *   progressBar({ value: .4 })                               XP bar; .set(0..1)
 *   fmtCredits(10000) → "10,000" · fmtDelta(-300) → "−300" · fmtMult(2.5) → "2.50×"
 *
 * ── Controls (all real <button type="button">, ≥ 44×44, instant pressed look) ─────────────────
 *   button({ label: 'CASH OUT', variant: 'red', size: 'sm', icon: 'coin', testid: 'btn-cashout', onTap })
 *       variants gold | red | violet | dark, sizes sm 44 | md 52 | lg 64, `block`, `shine` (light sweep)
 *   setButtonLabel(btn, 'STOP')
 *   iconButton({ icon: 'close', aria: '닫기', onTap })      round 44×44 (dark | gold | violet)
 *   const spin = spinButton({ label: 'SPIN', testid: 'btn-spin', onTap })
 *       spin.set({ mode: 'stop' | 'auto' | 'spin', label, sub: 'HOLD', badge: 25 | null, disabled })
 *   const turbo = toggle({ label: 'TURBO', icon: 'bolt', onChange: on => … }); turbo.on / turbo.set(on)
 *   const bet = stepper({ label: 'BET', values: [10, 20, 50, 100], index: 1, onChange: (v, i) => … })
 *   pill('HOT', 'hot')                                       badges: hot | gold | cyan | violet | win
 *   chip({ value: 100, onTap, selected: true })              casino chip (button when onTap); .select(on)
 *   chipArt(value) / chipColors(value) / chipLabel(1000) → "1K"
 *   icon('sound' | 'mute' | 'bolt' | 'loop' | 'close' | 'plus' | 'minus' | 'back' | 'coin' | 'star' | 'crown' | 'grid')
 *
 * ── Panels & overlays ──────────────────────────────────────────────────────────────────────────
 *   ribbon('카지노관', { tone: 'red' | 'violet' | 'gold' })     section / panel title
 *   frameBox({ title: 'CASH OUT TICKET', children: [...] })  ornate gold panel with corner gems
 *   const sh = sheet({ title, body: [...], actions: [button(...)], onClose }); sh.open(); sh.close()
 *   const m = modal({ title, body: [...], actions, dismissible: false }); m.open()
 *       Overlays attach to #frame (or a given host) and detach after the close transition.
 *
 * ── Brand art ──────────────────────────────────────────────────────────────────────────────────
 *   logo({ size: 'lg' | 'md' | 'sm', ko: true, slogan: true })   bell emblem + OROBELLE + neon CASINO
 *   bellEmblem({ ring: true })                               the emblem alone (same art as public/icons/icon.svg)
 *   svg helpers: s(tag, attrs, kids), svgRoot(viewBox, kids), uid(), linearGrad/radialGrad(id, stops),
 *     GOLD_STOPS, CRIMSON_STOPS, neonStroke(d, color, w), circlePath, starPath, sparklePath, sparkle
 *
 * ── Rules for consumers ────────────────────────────────────────────────────────────────────────
 *   - Strings come from i18n keys (`t()`); the kit itself only reads app.* and tier.*.
 *   - Looping CSS that changes opacity/filter/background/color/shadows: period ≥ 1s, ease-in-out
 *     (tested for this folder by ui.test.ts). Prefer transform/opacity; never animate blur or shadows.
 *   - The ABYSS LEGEND LED face is `ui/led.css` (Press Start 2P) — import it from the ocean chunk only.
 */
import './fonts.css';
import './theme.css';
import './kit.css';

export * from './kit';
export * from './svg';
export * from './format';
export { logo, type LogoSize } from './logo';
