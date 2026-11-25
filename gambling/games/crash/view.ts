/**
 * SKYROCKET screen (DOM/SVG). Portrait layout (BASE_PROMPT §2.2): recent crash points on top, the night-sky
 * graph filling the middle (curve, rocket, huge multiplier counter), the crowd list in a sheet, and at the
 * bottom BET / AUTO CASH OUT inputs and one big button (BET -> CANCEL -> CASH OUT).
 * The view never decides anything: it forwards input to the core and draws what the core tells it. The curve
 * and the counter are game information (SVG + digits, drawn on rAF from the clock), so they look the same with
 * fx off; fx only adds exhaust sparks, the tone, the celebration, the crowd and the drifting stars.
 */
import "./style.css";
import { MIN_BET } from "../../../shared/config";
import { CRASH, multAt } from "../../../shared/rules/crash";
import {
  button, fmtCredits, fmtMult, goldText, h, iconButton, setButtonLabel, setDigits, sheet, svgRoot, toggle,
  type Overlay, type Toggle,
} from "../../src/ui/index";
import type { GameCtx } from "../../src/types";
import { puffSvg, rocketSvg, skylineSvg, starsSvgs, svgUrl, TWINKLE_GROUPS } from "./art";
import {
  affordableBet, BET_MAX, BET_MIN, BET_STEP, targetStep,
  type CashInfo, type CrashCore, type CrashState, type CrashUi, type CrowdPlayer, type FlightPlan,
} from "./core";

export interface CrashView extends CrashUi {
  bind(core: CrashCore): void;
  destroy(): void;
}

const SVGNS = "http://www.w3.org/2000/svg";
const PTS = 64;
const BET_CHIPS = [100, 1000] as const;
const TARGET_CHIPS = [1.5, 2, 5] as const;

/** Nice grid values: multiples of a round step, at most ~5 of them, strictly inside (lo, hi). */
export function niceTicks(lo: number, hi: number, steps: readonly number[], maxCount = 5): number[] {
  let step = steps[steps.length - 1];
  for (const s of steps) if ((hi - lo) / s <= maxCount) { step = s; break; }
  const out: number[] = [];
  for (let v = Math.floor(lo / step + 1e-9) * step; v < hi; v += step) if (v > lo + step * 0.25 && v < hi - step * 0.2) out.push(Math.round(v * 1000) / 1000);
  return out;
}
const M_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const T_STEPS = [1, 2, 5, 10, 15, 30, 60, 120];

export function tierClass(m: number): 0 | 1 | 2 | 3 {
  return m >= 10 ? 3 : m >= 4 ? 2 : m >= 2 ? 1 : 0;
}

const el = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function createCrashView(root: HTMLElement, ctx: GameCtx): CrashView {
  const t = ctx.t;
  const { fx, clock } = ctx;
  // Decoration (drifting stars, idle hover) is presentation: only with the presentation layer on.
  const vivid = fx.enabled && !ctx.settings.reducedMotion;
  let core: CrashCore | null = null;
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
    target.addEventListener(type, fn as EventListener, opt);
    offs.push(() => target.removeEventListener(type, fn as EventListener, opt));
  };

  // ---------------------------------------------------------------- history bar
  const histLabel = h("span", "cr-hist__label", [t("crash.hist")]);
  const histRow = h("div", "cr-hist__row");
  const hist = h("div", "cr-hist", [histLabel, histRow]);
  hist.dataset.testid = "history";

  // ---------------------------------------------------------------- stage (sky + graph)
  // Sky layers are background images (not inline SVG): nothing in them is laid out or re-styled per frame.
  const sky = starsSvgs();
  const layer = (svg: string, cls = ""): HTMLElement => {
    const d = h("div", `cr-stars__l${cls}`);
    d.style.backgroundImage = svgUrl(svg);
    return d;
  };
  const stars = h("div", "cr-stars", [layer(sky.base), ...sky.tw.map((svg, g) => {
    const d = layer(svg, " cr-stars__l--t");
    d.style.animationDelay = `-${(((g + 0.5) * 4) / TWINKLE_GROUPS).toFixed(2)}s`;
    return d;
  })]);
  const city = h("div", "cr-city");
  city.style.backgroundImage = svgUrl(skylineSvg());
  const moon = h("div", "cr-moon");

  const gridG = el("g", { class: "cr-grid" });
  const yTicks = Array.from({ length: 6 }, () => {
    const line = el("line", { class: "cr-gl" });
    const text = el("text", { class: "cr-gt", "text-anchor": "end" });
    gridG.append(line, text);
    return { line, text };
  });
  const xTicks = Array.from({ length: 7 }, () => {
    const line = el("line", { class: "cr-gl cr-gl--v" });
    const text = el("text", { class: "cr-gt", "text-anchor": "middle" });
    gridG.append(line, text);
    return { line, text };
  });
  const defs = el("defs");
  defs.innerHTML =
    `<linearGradient id="crLine" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7A3CFF"/><stop offset=".55" stop-color="#29E6FF"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient>` +
    `<linearGradient id="crLineX" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7A3CFF"/><stop offset=".6" stop-color="#FF3DA5"/><stop offset="1" stop-color="#FF2D55"/></linearGradient>` +
    `<linearGradient id="crArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#29E6FF" stop-opacity=".34"/><stop offset=".7" stop-color="#7A3CFF" stop-opacity=".14"/><stop offset="1" stop-color="#7A3CFF" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="crAreaX" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF2D55" stop-opacity=".3"/><stop offset="1" stop-color="#7A3CFF" stop-opacity="0"/></linearGradient>`;
  const area = el("path", { class: "cr-area" });
  const glow = el("path", { class: "cr-curve cr-curve--glow" });
  const line = el("path", { class: "cr-curve cr-curve--line" });
  const core1 = el("path", { class: "cr-curve cr-curve--core" });
  const chart = svgRoot("0 0 300 300", [], { class: "cr-chart" });
  chart.append(defs, gridG, area, glow, line, core1);

  const rocketArt = h("div", "cr-rocket__art");
  rocketArt.innerHTML = rocketSvg();
  const rocket = h("div", "cr-rocket", [rocketArt]);
  const tail = h("div", "cr-tail");   // exhaust anchor (fx)
  const puff = h("div", "cr-puff");
  puff.innerHTML = puffSvg();

  // centre read-out
  const status = h("div", "cr-status");
  const multEl = h("div", "ui-num cr-mult");
  multEl.dataset.testid = "multiplier";
  const ring = svgRoot("0 0 100 100", [], { class: "cr-ring" });
  const ringBg = el("circle", { cx: 50, cy: 50, r: 44, class: "cr-ring__bg" });
  const ringFg = el("circle", { cx: 50, cy: 50, r: 44, class: "cr-ring__fg", "stroke-dasharray": "276.5", "stroke-dashoffset": "0", transform: "rotate(-90 50 50)" });
  ring.append(ringBg, ringFg);
  const readout = h("div", "cr-readout", [status, h("div", "cr-readout__mid", [ring, multEl])]);

  // win read-out (celebration target mirrors into it, like the slot's WIN plate)
  const winProxy = h("span", "cr-win-proxy");
  winProxy.hidden = true;
  const wonNum = h("span", "ui-num ui-num--win cr-won__num");
  const won = h("div", "cr-won", [h("span", "cr-won__label", [t("crash.cashed")]), h("span", "cr-won__at"), wonNum]);
  won.dataset.testid = "won";
  won.append(winProxy);
  const mo = new MutationObserver(() => setDigits(wonNum, "+" + (winProxy.textContent ?? "")));
  mo.observe(winProxy, { childList: true, characterData: true, subtree: true });
  const wonAt = won.querySelector<HTMLElement>(".cr-won__at")!;

  const feed = h("div", "cr-feed");
  feed.setAttribute("aria-hidden", "true");

  const livePill = button({ label: "", variant: "violet", size: "sm", icon: "grid", testid: "btn-crowd", onTap: () => openCrowd() });
  livePill.classList.add("cr-live");
  livePill.hidden = true;
  const liveCount = livePill.querySelector<HTMLElement>(".ui-btn__label")!;

  const brand = goldText(t("crash.title"), { glow: "magenta", tag: "h1", className: "cr-brand" });
  const stage = h("div", "cr-stage", [stars, moon, city, chart, tail, rocket, puff, readout, won, feed, brand, livePill]);
  stage.dataset.testid = "stage";

  // ---------------------------------------------------------------- controls
  const betIn = h("input", "cr-in") as HTMLInputElement;
  betIn.type = "text";
  betIn.inputMode = "numeric";
  betIn.autocomplete = "off";
  betIn.setAttribute("aria-label", t("crash.bet"));
  betIn.dataset.testid = "bet-input";
  const betMinus = iconButton({ icon: "minus", aria: "-", variant: "violet", testid: "bet-minus", onTap: () => core && core.setBet(core.state.bet - BET_STEP) });
  const betPlus = iconButton({ icon: "plus", aria: "+", variant: "violet", testid: "bet-plus", onTap: () => core && core.setBet(core.state.bet + BET_STEP) });
  const betBox = h("div", "cr-field", [
    h("div", "cr-field__head", [h("span", "cr-field__label", [t("crash.bet")])]),
    h("div", "cr-stepper", [betMinus, betIn, betPlus]),
  ]);
  const quick = (label: string, tid: string, fn: () => void): HTMLButtonElement => {
    const b = h("button", "cr-q", [label]);
    b.type = "button";
    b.dataset.testid = tid;
    b.addEventListener("click", () => { fx.sfx.play("tap", { k: 0.4 }); fn(); });
    return b;
  };
  const betChips = BET_CHIPS.map((v) => quick(v >= 1000 ? `${v / 1000}K` : String(v), `bet-${v}`, () => core?.setBet(v)));
  const betMax = quick(t("crash.max"), "bet-max", () => core?.setBet(affordableBet(ctx.wallet.balance)));
  const betChipRow = h("div", "cr-chips", [...betChips, betMax]);

  const autoToggle: Toggle = toggle({ label: t("crash.auto"), testid: "btn-auto", onChange: (v) => core?.setAuto(v) });
  const tgtIn = h("input", "cr-in cr-in--x") as HTMLInputElement;
  tgtIn.type = "text";
  tgtIn.inputMode = "decimal";
  tgtIn.autocomplete = "off";
  tgtIn.setAttribute("aria-label", t("crash.target"));
  tgtIn.dataset.testid = "target-input";
  const tgtMinus = iconButton({ icon: "minus", aria: "-", variant: "violet", testid: "target-minus", onTap: () => core && core.setTarget(core.state.target - targetStep(core.state.target - 0.001)) });
  const tgtPlus = iconButton({ icon: "plus", aria: "+", variant: "violet", testid: "target-plus", onTap: () => core && core.setTarget(core.state.target + targetStep(core.state.target)) });
  const tgtBox = h("div", "cr-field", [
    h("div", "cr-field__head", [autoToggle.el]),
    h("div", "cr-stepper", [tgtMinus, h("div", "cr-in-wrap", [tgtIn, h("i", "cr-in__x", ["×"])]), tgtPlus]),
  ]);
  const tgtChips = TARGET_CHIPS.map((v) => quick(`${v}×`, `target-${v}`, () => { core?.setAuto(true); core?.setTarget(v); }));
  const tgtChipRow = h("div", "cr-chips", tgtChips);

  const act = button({ label: t("crash.bet"), variant: "gold", size: "lg", block: true, shine: true, testid: "btn-action", onTap: () => { if (swallowClick) { swallowClick = false; return; } core?.press(); } });
  act.classList.add("cr-act");
  const actAmt = h("span", "cr-act__amt");
  act.querySelector(".ui-btn__face")!.append(actAmt);
  let swallowClick = false;

  const panel = h("div", "cr-panel", [
    h("div", "cr-panel__cols", [h("div", "cr-col", [betBox, betChipRow]), h("div", "cr-col", [tgtBox, tgtChipRow])]),
    act,
  ]);

  const screen = h("div", "cr", [hist, stage, panel]);
  screen.dataset.testid = "crash";
  screen.dataset.phase = "idle";
  root.appendChild(screen);

  // ---------------------------------------------------------------- input
  const tapSound = (): void => fx.sfx.play("tap", { k: 0.55 });
  on(act, "pointerdown", (e) => {
    if (e.button > 0) return;
    swallowClick = false;
    tapSound();
    // A manual cash-out is resolved from the moment of the touch, not from the click that follows it.
    if (core && core.state.phase === "flight" && !core.state.cashed) { if (core.cashout()) swallowClick = true; }
  });
  on(autoToggle.el, "pointerdown", tapSound);
  for (const b of [betMinus, betPlus, tgtMinus, tgtPlus]) on(b, "pointerdown", tapSound);

  const commitBet = (): void => { if (core) { core.setBet(Number(betIn.value.replace(/[^\d]/g, "")) || BET_MIN); render(core.state); } };
  const commitTarget = (): void => {
    if (!core) return;
    const v = Number(tgtIn.value.replace(",", ".").replace(/[^\d.]/g, ""));
    if (Number.isFinite(v) && v > 0) core.setTarget(v);
    render(core.state);
  };
  for (const [inp, commit] of [[betIn, commitBet], [tgtIn, commitTarget]] as const) {
    on(inp, "focus", () => { try { inp.select(); } catch { /* ignore */ } });
    on(inp, "change", commit);
    on(inp, "blur", commit);
    on(inp, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
  }
  on(betIn, "input", () => { betIn.value = betIn.value.replace(/[^\d,.]/g, ""); });

  // tap through the rest of an already cashed-out climb
  on(stage, "click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (core?.state.phase === "flight" && core.state.cashed) core.skip();
  });

  on(window, "keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    e.preventDefault();
    if (e.repeat || sh?.isOpen || crowdSheet?.isOpen || !core) return;
    tapSound();
    if (core.state.phase === "flight" && !core.state.cashed) core.cashout(); else core.press();
  });

  // ---------------------------------------------------------------- geometry + drawing
  let W = 0, H = 0;
  const PL = 38, PR = 20;
  let PT = 70, PB = 46;
  let plan: FlightPlan | null = null;
  let t0 = 0;
  let mode: "idle" | "countdown" | "flight" | "crashed" = "idle";
  let shownEl = 0;   // ms into the climb that is drawn
  let headX = 0, headY = 0;   // head of the drawn curve (the puff is placed there only when it shows: left/top cost a layout)
  let stopFrame: (() => void) | null = null;
  let cd: { from: number; to: number } | null = null;
  let lastMultText = "";
  let lastAmt = "";
  let revealIdx = 0;
  let order: number[] = [];
  let crowdRows: { row: HTMLElement; status: HTMLElement; p: CrowdPlayer }[] = [];
  let youRow: { row: HTMLElement; status: HTMLElement } | null = null;

  const setMult = (m: number): void => {
    const txt = fmtMult(m);
    if (txt !== lastMultText) { lastMultText = txt; setDigits(multEl, txt); }
    const tc = String(tierClass(m));
    if (multEl.dataset.tier !== tc) multEl.dataset.tier = tc;
  };

  const ptFor = (tSec: number, m: number, tSpan: number, mSpan: number): [number, number] => [
    PL + (tSec / tSpan) * (W - PL - PR),
    H - PB - ((m - 1) / (mSpan - 1)) * (H - PT - PB),
  ];

  /** Draws the climb `ms` into the flight (0 = the launch pad). */
  const drawAt = (ms: number): void => {
    if (!(W > 0 && H > 0)) return;
    shownEl = ms;
    const tNow = ms / 1000;
    const k = CRASH.k;
    const mNow = Math.exp(k * tNow);
    const tSpan = Math.max(8, tNow * 1.1);
    const mSpan = Math.max(2.2, mNow * 1.12);
    let d = "";
    let last: [number, number] = ptFor(0, 1, tSpan, mSpan);
    let prev: [number, number] = last;
    const n = tNow <= 0 ? 0 : PTS;
    d = `M${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
    for (let i = 1; i <= n; i++) {
      const ti = (tNow * i) / n;
      prev = last;
      last = ptFor(ti, Math.exp(k * ti), tSpan, mSpan);
      d += `L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
    }
    glow.setAttribute("d", d);
    line.setAttribute("d", d);
    core1.setAttribute("d", d);
    area.setAttribute("d", n ? `${d}L${last[0].toFixed(1)} ${H - PB}L${PL} ${H - PB}Z` : "");

    // direction of the curve at its head (average of the last few segments, steeper = pointing up)
    let dx = last[0] - prev[0], dy = last[1] - prev[1];
    if (n === 0 || (dx === 0 && dy === 0)) { dx = 1; dy = -0.55; }
    let ang = Math.atan2(dy, dx);
    ang = Math.max(-1.45, Math.min(-0.12, ang));
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const cx = last[0] - ux * 16, cy = last[1] - uy * 16;   // rocket centre (nose at the head)
    rocket.style.transform = `translate3d(${(cx - 32).toFixed(1)}px,${(cy - 16).toFixed(1)}px,0) rotate(${ang.toFixed(3)}rad)`;
    tail.style.transform = `translate3d(${(cx - ux * 24 - 9).toFixed(1)}px,${(cy - uy * 24 - 9).toFixed(1)}px,0)`;
    headX = last[0]; headY = last[1];

    // grid (labels are read-outs of the current scale)
    const my = niceTicks(1, mSpan, M_STEPS);
    yTicks.forEach((tk, i) => {
      const v = my[i];
      const show = v !== undefined;
      tk.line.style.visibility = tk.text.style.visibility = show ? "visible" : "hidden";
      if (!show) return;
      const y = ptFor(0, v, tSpan, mSpan)[1];
      tk.line.setAttribute("x1", String(PL)); tk.line.setAttribute("x2", String(W - PR + 6));
      tk.line.setAttribute("y1", y.toFixed(1)); tk.line.setAttribute("y2", y.toFixed(1));
      tk.text.setAttribute("x", String(PL - 6)); tk.text.setAttribute("y", (y + 3.5).toFixed(1));
      const label = `${v}×`;
      if (tk.text.textContent !== label) tk.text.textContent = label;
    });
    const tx = niceTicks(0, tSpan, T_STEPS, 6);
    xTicks.forEach((tk, i) => {
      const v = tx[i];
      const show = v !== undefined;
      tk.line.style.visibility = tk.text.style.visibility = show ? "visible" : "hidden";
      if (!show) return;
      const x = ptFor(v, 1, tSpan, mSpan)[0];
      tk.line.setAttribute("y1", String(PT - 8)); tk.line.setAttribute("y2", String(H - PB));
      tk.line.setAttribute("x1", x.toFixed(1)); tk.line.setAttribute("x2", x.toFixed(1));
      tk.text.setAttribute("x", x.toFixed(1)); tk.text.setAttribute("y", String(H - PB + 15));
      const label = `${v}s`;
      if (tk.text.textContent !== label) tk.text.textContent = label;
    });
    if (vivid) stars.style.transform = `translate3d(0,${Math.min(110, 26 * Math.log(Math.max(1, mNow))).toFixed(1)}px,0)`;
  };

  const layout = (): void => {
    W = stage.clientWidth; H = stage.clientHeight;
    if (!(W > 0 && H > 0)) return;
    PT = Math.max(54, Math.min(86, H * 0.2));
    PB = Math.max(34, Math.min(50, H * 0.1));
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    screen.classList.toggle("is-small", root.clientHeight < 620);
    screen.classList.toggle("is-narrow", root.clientWidth < 350);
    drawAt(mode === "crashed" && plan ? plan.crashMs : mode === "flight" ? shownEl : 0);
  };
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  offs.push(() => ro.disconnect());

  // ---------------------------------------------------------------- frame loop (flight + countdown)
  const startFrames = (): void => { if (!stopFrame) stopFrame = clock.frame(onFrame); };
  const endFrames = (): void => { stopFrame?.(); stopFrame = null; };

  const potential = (m: number): number => Math.floor((plan?.bet ?? 0) * Math.round(m * 100) / 100);
  const setAmt = (txt: string): void => { if (txt !== lastAmt) { lastAmt = txt; actAmt.textContent = txt; } };

  const onFrame = (): void => {
    if (mode === "countdown" && cd) {
      const now = clock.now();
      const rem = Math.max(0, cd.to - now);
      const n = Math.max(1, Math.ceil(rem / 1000));
      const txt = String(n);
      if (txt !== lastMultText) { lastMultText = txt; setDigits(multEl, txt); }
      const frac = (rem - (n - 1) * 1000) / 1000;   // 1 -> 0 inside the current second
      ringFg.setAttribute("stroke-dashoffset", (276.5 * (1 - frac)).toFixed(1));
      return;
    }
    if (mode !== "flight" || !plan) return;
    const ms = Math.max(0, Math.min(clock.now() - t0, plan.crashMs));
    drawAt(ms);
    const m = Math.min(multAt(ms / 1000), plan.crash);
    setMult(m);
    if (core && !core.state.cashed) setAmt(fmtCredits(potential(m)));
    // the crowd gets out as the climb passes them
    while (revealIdx < order.length && crowdRows[order[revealIdx]].p.cashAt! <= m) reveal(order[revealIdx++]);
  };

  // ---------------------------------------------------------------- crowd
  let crowdSheet: Overlay | null = null;
  const crowdList = h("div", "cr-crowd");
  const crowdHead = h("div", "cr-crowd__head");
  const buildRow = (name: string, bet: number, me = false) => {
    const status = h("span", "cr-p__st", ["…"]);
    const av = h("i", "cr-p__av", [name.slice(0, 1).toUpperCase()]);
    av.style.setProperty("--hue", String((name.charCodeAt(0) * 47 + name.length * 31) % 360));
    const row = h("div", me ? "cr-p cr-p--me" : "cr-p", [av, h("span", "cr-p__name", [name]), h("span", "cr-p__bet", [fmtCredits(bet)]), status]);
    return { row, status };
  };
  const reveal = (i: number): void => {
    const c = crowdRows[i];
    if (!c || c.row.classList.contains("is-out")) return;
    const p = c.p;
    const win = Math.floor((p.bet * Math.round(p.cashAt! * 100)) / 100);
    c.row.classList.add("is-out");
    c.status.textContent = `${fmtMult(p.cashAt!)}  +${fmtCredits(win)}`;
    fx.sfx.play("coin", { k: 0.07, pitch: 1.1 + Math.min(1, p.cashAt! / 20) });
    const toast = h("div", "cr-toast", [h("b", "", [p.name]), h("span", "cr-toast__x", [fmtMult(p.cashAt!)]), h("span", "cr-toast__amt", [`+${fmtCredits(win)}`])]);
    toast.addEventListener("animationend", () => toast.remove());
    feed.append(toast);
    while (feed.children.length > 3) feed.firstElementChild!.remove();
  };
  const openCrowd = (): void => {
    if (crowdSheet?.isOpen) return;
    crowdSheet = sheet({ title: t("crash.players"), body: [crowdHead, crowdList], testid: "sheet-crowd" });
    crowdSheet.open();
  };

  // ---------------------------------------------------------------- state -> screen
  const setVariant = (b: HTMLElement, v: "gold" | "red" | "violet" | "dark"): void => {
    for (const x of ["gold", "red", "violet", "dark"]) b.classList.toggle(`ui-btn--${x}`, x === v);
  };
  const render = (st: CrashState): void => {
    const idle = st.phase === "idle";
    screen.dataset.phase = st.phase;
    screen.classList.toggle("is-cashed", st.cashed);
    screen.classList.toggle("is-auto", st.auto);
    if (document.activeElement !== betIn) betIn.value = fmtCredits(st.bet);
    if (document.activeElement !== tgtIn) tgtIn.value = st.target.toFixed(2);
    betIn.disabled = !idle;
    betMinus.disabled = !idle || st.bet <= BET_MIN;
    betPlus.disabled = !idle || st.bet >= BET_MAX;
    for (const b of [...betChips, betMax]) b.disabled = !idle;
    autoToggle.set(st.auto);
    autoToggle.el.disabled = !idle;
    const tOn = idle && st.auto;
    tgtIn.disabled = !tOn;
    tgtMinus.disabled = !tOn || st.target <= CRASH.minTarget;
    tgtPlus.disabled = !tOn || st.target >= CRASH.maxTarget;
    for (const b of tgtChips) b.disabled = !idle;
    tgtBox.classList.toggle("is-off", !st.auto);
    if (st.phase === "idle") {
      setVariant(act, "gold"); setButtonLabel(act, t("crash.bet")); setAmt(fmtCredits(st.bet));
    } else if (st.phase === "countdown") {
      setVariant(act, "dark"); setButtonLabel(act, t("crash.cancel")); setAmt(fmtCredits(st.bet));
    } else if (st.cashed) {
      setVariant(act, "violet"); setButtonLabel(act, t("crash.cashed")); setAmt(`×${st.cashedAt!.toFixed(2)}`);
    } else {
      setVariant(act, "red"); setButtonLabel(act, t("crash.cashout"));
      if (plan) setAmt(fmtCredits(potential(Math.min(multAt(Math.max(0, clock.now() - t0) / 1000), plan.crash))));
    }
    betBox.classList.toggle("is-locked", !idle);
  };

  let sh: Overlay | null = null;
  const showSheet = (): void => {
    if (sh?.isOpen) return;
    sh = sheet({
      title: t("crash.short.title"),
      body: [h("p", "cr-sheet__body", [t("crash.short.body", { min: fmtCredits(MIN_BET.crash) })])],
      actions: [
        button({ label: t("crash.short.lobby"), variant: "violet", icon: "grid", testid: "short-lobby", onTap: () => { sh?.close(); ctx.nav.toLobby(); } }),
        button({ label: t("crash.short.cashout"), variant: "red", testid: "short-cashout", onTap: () => { sh?.close(); ctx.nav.requestCashout("cashout"); } }),
      ],
      testid: "sheet-short",
    });
    sh.open();
  };

  const showStatus = (txt: string, tone = ""): void => { status.textContent = txt; status.dataset.tone = tone; };
  const resetStage = (): void => {
    stage.classList.remove("is-crashed", "is-flight", "is-countdown");
    won.classList.remove("is-on");
    feed.replaceChildren();
    chart.classList.remove("is-crashed");
    rocket.classList.remove("is-gone");
    puff.classList.remove("is-on");
  };

  const view: CrashView = {
    rocketEl: tail,
    winEl: winProxy,
    render,
    countdown(from, to) {
      resetStage();
      mode = "countdown";
      cd = { from, to };
      plan = null;
      stage.classList.add("is-countdown");
      showStatus(t("crash.next"));
      lastMultText = "";
      ringFg.setAttribute("stroke-dashoffset", "0");
      drawAt(0);
      startFrames();
      onFrame();
    },
    countdownStop() {
      if (mode !== "countdown") return;
      endFrames();
      mode = "idle";
      cd = null;
      resetStage();
      showStatus(t("crash.ready"));
      lastMultText = "";
      setMult(1);
    },
    flightStart(p, start) {
      plan = p; t0 = start; mode = "flight"; cd = null;
      resetStage();
      stage.classList.add("is-flight");
      showStatus("");
      lastMultText = "";
      lastAmt = "";
      setMult(1);
      drawAt(0);
      // the crowd of this round
      revealIdx = 0;
      crowdRows = p.crowd.map((c) => ({ ...buildRow(c.name, c.bet), p: c }));
      order = crowdRows.map((_, i) => i).filter((i) => crowdRows[i].p.cashAt !== null).sort((a, b) => crowdRows[a].p.cashAt! - crowdRows[b].p.cashAt!);
      youRow = buildRow(t("crash.you"), p.bet, true);
      crowdList.replaceChildren(youRow.row, ...crowdRows.map((c) => c.row));
      const total = p.crowd.reduce((s, c) => s + c.bet, 0) + p.bet;
      crowdHead.textContent = p.crowd.length ? t("crash.players.sum", { n: p.crowd.length + 1, total: fmtCredits(total) }) : "";
      livePill.hidden = p.crowd.length === 0;
      if (p.crowd.length) liveCount.textContent = `${t("crash.live")} ${p.crowd.length + 1}`;
      startFrames();
    },
    cashed(info: CashInfo) {
      winProxy.textContent = fmtCredits(info.payout);
      wonAt.textContent = fmtMult(info.cashoutAt);
      won.classList.add("is-on");
      if (youRow) { youRow.row.classList.add("is-out"); youRow.status.textContent = `${fmtMult(info.cashoutAt)}  +${fmtCredits(info.payout)}`; }
    },
    crashed(crash, _skipped) {
      endFrames();
      mode = "crashed";
      const ms = plan ? plan.crashMs : 0;
      drawAt(ms);
      lastMultText = "";
      setMult(crash);
      stage.classList.remove("is-flight");
      stage.classList.add("is-crashed");
      chart.classList.add("is-crashed");
      rocket.classList.add("is-gone");
      puff.classList.remove("is-on");
      puff.style.left = `${(headX - 40).toFixed(1)}px`;
      puff.style.top = `${(headY - 40).toFixed(1)}px`;
      void puff.offsetWidth;
      puff.classList.add("is-on");
      showStatus(t("crash.crashed"), "bad");
      // everyone still on board: out
      for (const c of crowdRows) if (!c.row.classList.contains("is-out")) { c.row.classList.add("is-bust"); c.status.textContent = t("crash.bust"); }
      if (youRow && !youRow.row.classList.contains("is-out")) { youRow.row.classList.add("is-bust"); youRow.status.textContent = t("crash.bust"); }
    },
    history(list) {
      histRow.replaceChildren(...list.map((m, i) => {
        const c = h("span", `cr-hc cr-hc--${m < 2 ? "lo" : m < 10 ? "mid" : "hi"}`, [fmtMult(m)]);
        if (i === 0) c.classList.add("is-new");
        return c;
      }));
      if (list.length === 0) histRow.replaceChildren(h("span", "cr-hist__empty", ["—"]));
    },
    short(kind) {
      if (kind === "sheet") { showSheet(); return; }
      betBox.classList.remove("is-nudge");
      void betBox.offsetWidth;
      betBox.classList.add("is-nudge");
    },
    bind(c) {
      core = c;
      showStatus(t("crash.ready"));
      setMult(1);
      render(c.state);
      layout();
    },
    destroy() {
      for (const f of offs.splice(0)) f();
      endFrames();
      mo.disconnect();
      sh?.close();
      crowdSheet?.close();
      screen.remove();
      core = null;
    },
  };
  return view;
}
