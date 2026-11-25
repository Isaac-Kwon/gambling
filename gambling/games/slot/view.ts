/**
 * ORO SEVENS screen (DOM). Portrait layout (BASE_PROMPT §2.2): marquee on top, reels filling the width,
 * then the BET stepper and WIN meter, then TURBO · SPIN · AUTO in the thumb zone.
 * Input: SPIN/STOP button, swipe down on the reels (spin), tap on turning reels (STOP), Space key.
 * The view never decides anything: it forwards input to the core and draws what the core tells it.
 */
import "./style.css";
import { BET_STEPS, MIN_BET } from "../../../shared/config";
import { SLOTS, type SlotConfig, type Sym } from "../../../shared/rules/slot";
import {
  button, fmtCredits, goldText, h, neonStroke, neonText, plate, setDigits, sheet, spinButton, stepper, svgRoot,
  toggle, type Overlay,
} from "../../src/ui/index";
import type { GameCtx } from "../../src/types";
import { SYMBOLS, symClass, symbolCss } from "./art";
import { AUTO_COUNTS, LINES, REELS, STORE_LAST, windowCells, type SlotCore, type SlotState, type SlotUi, type SpinPlan } from "./core";
import { createReels, type Reels } from "./reels";

export interface SlotView extends SlotUi {
  bind(core: SlotCore): void;
  destroy(): void;
}

const PEEK_ROWS = 3.7;
const LINE_COLORS = ["#FFD84A", "#FF3DA5", "#29E6FF", "#3DFF8A", "#B98BFF", "#FF8A3D", "#FFFFFF"];
const SWIPE_PX = 40;
const PAY_ROWS: Sym[][] = [["7"], ["B"], ["R"], ["C"], ["H"], ["s", "h"], ["c", "d"]];

let styleEl: HTMLStyleElement | null = null;
let styleUsers = 0;

export function createSlotView(root: HTMLElement, ctx: GameCtx): SlotView {
  const t = ctx.t;
  const { fx, clock } = ctx;
  let core: SlotCore | null = null;
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, opt);
    offs.push(() => el.removeEventListener(type, fn as EventListener, opt));
  };

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.textContent = symbolCss();
    document.head.appendChild(styleEl);
  }
  styleUsers++;

  // ---------------------------------------------------------------- marquee + paytable ticker
  const cfg = coreCfg(ctx);
  const title = goldText(t("slot.title"), { glow: "magenta", tag: "h1", className: "slot-title" });
  const sub = neonText(t("slot.sub"), { color: "cyan", className: "slot-subtitle" });
  const seven = (side: string) => h("i", `slot-mini sym-7 slot-mini--${side}`);
  const marquee = h("div", "slot-marquee", [seven("l"), h("div", "slot-marquee__text", [title, sub]), seven("r")]);
  // Real five-of-a-kind line pays in credits at the current bet (they grow with the bet).
  const payTrack = h("div", "slot-pays__track");
  const pays = h("div", "slot-pays", [payTrack]);
  pays.dataset.testid = "pays";
  let paysFor = -1;
  const renderPays = (lineBet: number): void => {
    if (lineBet === paysFor) return;
    paysFor = lineBet;
    const item = (syms: Sym[]) => h("span", "slot-pay", [
      ...syms.map((x) => h("i", `slot-pay__sym ${symClass(x)}`)),
      h("span", "slot-pay__x", ["×5"]),
      h("span", "slot-pay__amt", [fmtCredits(cfg.pay[syms[0] as Exclude<Sym, "W">][2] * lineBet)]),
    ]);
    const row = () => PAY_ROWS.map(item);
    payTrack.replaceChildren(...row(), ...row());
  };
  const top = h("div", "slot-top", [marquee, pays]);

  // ---------------------------------------------------------------- reels window
  const last = ctx.store.get<number[]>(STORE_LAST);
  const cfgStops = Array.isArray(last) && last.length === REELS ? last : [0, 4, 12, 9, 2];
  const reels: Reels = createReels(clock, windowCells(cfg, cfgStops));
  const lines = svgRoot("0 0 100 100", [], { class: "slot-lines" });
  const rail = (side: string) => h("div", `slot-rail slot-rail--${side}`, [h("i"), h("i"), h("i")]);
  const reelsWrap = h("div", "slot-reels-wrap", [reels.el, lines, h("div", "slot-glass")]);
  const windowEl = h("div", "slot-window", [rail("l"), reelsWrap, rail("r")]);
  windowEl.dataset.testid = "reels";
  const cab = h("div", "slot-cab", [h("div", "slot-cab__plaque", [t("slot.lines")]), windowEl]);

  // ---------------------------------------------------------------- meters
  const steps = BET_STEPS.slot;
  const bet = stepper({
    label: t("slot.bet"), values: steps, index: 0, testid: "bet",
    onChange: (_v, i) => { fx.sfx.play("tap", { k: 0.5 }); core?.setBet(i); },
  });
  const win = plate({ label: t("slot.win"), value: 0, tone: "win", size: 26, testid: "win", className: "slot-win" });
  const winProxy = h("span", "slot-win-proxy");
  winProxy.hidden = true;
  win.el.appendChild(winProxy);
  const mo = new MutationObserver(() => setDigits(win.value, winProxy.textContent ?? ""));
  mo.observe(winProxy, { childList: true, characterData: true, subtree: true });
  const meters = h("div", "slot-meters", [bet.el, win.el]);

  // ---------------------------------------------------------------- controls
  const spin = spinButton({ label: t("slot.spin"), testid: "btn-spin", onTap: () => core?.press("tap") });
  const turbo = toggle({ label: t("slot.turbo"), icon: "bolt", testid: "btn-turbo", onChange: (v) => core?.setTurbo(v) });
  const auto = toggle({ label: t("slot.auto"), icon: "loop", testid: "btn-auto" });
  const picks = AUTO_COUNTS.map((n) => button({
    label: String(n), variant: "violet", size: "sm", testid: `auto-${n}`,
    onTap: () => { closePicker(); void core?.startAuto(n); },
  }));
  const picker = h("div", "slot-autopick", [h("span", "slot-autopick__label", [t("slot.auto")]), h("div", "slot-autopick__row", picks)]);
  picker.hidden = true;
  const autoBox = h("div", "slot-autobox", [auto.el, picker]);
  const controls = h("div", "slot-controls", [h("div", "slot-side", [turbo.el]), spin.el, h("div", "slot-side", [autoBox])]);

  const screen = h("div", "slot", [top, cab, meters, controls]);
  screen.dataset.testid = "slot";
  root.appendChild(screen);

  // ---------------------------------------------------------------- input
  const tapSound = (): void => fx.sfx.play("tap", { k: 0.6 });
  on(spin.el, "pointerdown", (e) => { if (e.button <= 0) tapSound(); });
  on(turbo.el, "pointerdown", tapSound);
  on(auto.el, "pointerdown", tapSound);

  function closePicker(): void { picker.hidden = true; }
  on(auto.el, "click", () => {
    if (!core) return;
    if (core.state.auto > 0) { core.cancelAuto(); closePicker(); return; }
    if (core.state.phase !== "idle") { render(core.state); return; }
    picker.hidden = !picker.hidden;
    render(core.state);
  });
  on(document, "pointerdown", (e) => {
    if (!picker.hidden && !autoBox.contains(e.target as Node)) closePicker();
  }, { capture: true });

  // swipe down on the reels = spin; a tap on turning reels = STOP
  let drag: { id: number; x: number; y: number; fired: boolean; moved: boolean } | null = null;
  const nudge = (px: number): void => { reelsWrap.style.transform = px ? `translate3d(0,${px.toFixed(1)}px,0)` : ""; };
  on(windowEl, "pointerdown", (e) => {
    if (e.button > 0 || drag) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false, moved: false };
    reelsWrap.classList.add("is-drag");
    try { windowEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  on(windowEl, "pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y, dx = e.clientX - drag.x;
    if (Math.abs(dy) > 8 || Math.abs(dx) > 8) drag.moved = true;
    if (core?.state.phase === "idle") nudge(Math.max(0, Math.min(dy * 0.28, 14)));
    if (!drag.fired && dy >= SWIPE_PX && Math.abs(dx) < dy && core && core.state.phase === "idle" && core.state.auto === 0) {
      drag.fired = true;
      tapSound();
      void core.spin({ gesture: "swipe" });
    }
  });
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    reelsWrap.classList.remove("is-drag");
    nudge(0);
    if (e.type === "pointerup" && !d.fired && !d.moved && core && core.state.phase === "spin" && core.state.auto === 0) core.stop();
  };
  on(windowEl, "pointerup", endDrag);
  on(windowEl, "pointercancel", endDrag);

  let sh: Overlay | null = null;
  on(window, "keydown", (e) => {
    if (e.code !== "Space" && e.key !== " ") return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    e.preventDefault();
    if (e.repeat || sh?.isOpen || !core) return;
    tapSound();
    spin.el.classList.add("is-down");
    void clock.wait(90).then(() => spin.el.classList.remove("is-down"));
    core.press("tap");
  });

  // ---------------------------------------------------------------- layout
  let ch = 0;
  // Reel centres and window width for the win lines. Measured once per layout change (in a frame where
  // layout is already clean), so drawing the lines when a spin settles never forces a synchronous layout.
  let geom: { W: number; xs: number[] } | null = null;
  let geomRaf = 0;
  const measureGeom = (): { W: number; xs: number[] } => {
    geom ??= { W: reelsWrap.clientWidth, xs: [...reels.el.children].map((c) => (c as HTMLElement).offsetLeft + (c as HTMLElement).offsetWidth / 2) };
    return geom;
  };
  const layout = (): void => {
    geom = null;
    if (!geomRaf && typeof requestAnimationFrame === "function") {
      geomRaf = requestAnimationFrame(() => { geomRaf = 0; measureGeom(); });
    }
    const H = root.clientHeight || screen.clientHeight;
    const W = reelsWrap.clientWidth;
    if (!(H > 0 && W > 0)) return;
    screen.classList.toggle("is-small", H < 560);
    const cw = W / REELS;
    const fixed = meters.offsetHeight + controls.offsetHeight + (cab.offsetHeight - reelsWrap.offsetHeight);
    const pad = parseFloat(getComputedStyle(screen).paddingTop) + parseFloat(getComputedStyle(screen).paddingBottom);
    const gap = parseFloat(getComputedStyle(screen).rowGap) || 0;
    let avail = H - fixed - pad - 3 * gap - marquee.offsetHeight - 4;
    const tick = 38;
    const withPays = avail - tick >= PEEK_ROWS * cw * 0.95;
    pays.hidden = !withPays;
    if (withPays) avail -= tick;
    const next = Math.floor(Math.max(cw * 0.8, Math.min(cw * 1.28, avail / PEEK_ROWS)) * 2) / 2;
    // Spare height (tall phones): a larger marquee; the rest is spread around it.
    screen.classList.toggle("is-tall", avail - PEEK_ROWS * next > 56);
    if (Math.abs(next - ch) < 0.5) return;
    ch = next;
    screen.style.setProperty("--ch", `${ch}px`);
    reels.resize(ch);
    if (lastPlan) drawLines(lastPlan);
  };
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  offs.push(() => ro.disconnect());

  // ---------------------------------------------------------------- win lines
  let lastPlan: SpinPlan | null = null;
  const drawLines = (plan: SpinPlan | null): void => {
    lines.replaceChildren();
    if (!plan || plan.wins.length === 0) return;
    const { W, xs } = measureGeom();
    const Hh = ch * PEEK_ROWS;
    lines.setAttribute("viewBox", `0 0 ${W.toFixed(1)} ${Hh.toFixed(1)}`);
    const rows = cfg.lines;
    for (const w of plan.wins) {
      const pts = rows[w.line].map((row, i) => [xs[i] ?? 0, (row + 0.35 + 0.5) * ch] as const);
      const d = `M2 ${pts[0][1].toFixed(1)}` + pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join("") + `L${(W - 2).toFixed(1)} ${pts[4][1].toFixed(1)}`;
      lines.appendChild(neonStroke(d, LINE_COLORS[w.line % LINE_COLORS.length], Math.max(2.2, ch * 0.04)));
    }
  };

  // Rasterise every symbol (sharp and streak) once at cell size before the first spin, so the first
  // switch to the streak images does not stall a frame.
  const warm = (): void => {
    const box = h("div", "slot-warm", [
      h("div", "", SYMBOLS.map((x) => h("i", `slot-sym ${symClass(x)}`))),
      h("div", "is-blur", SYMBOLS.map((x) => h("i", `slot-sym ${symClass(x)}`))),
    ]);
    reelsWrap.appendChild(box);
    const ref = reels.el.querySelector<HTMLElement>(".slot-sym");
    if (ref) {
      const r = ref.getBoundingClientRect();
      for (const el of box.querySelectorAll<HTMLElement>(".slot-sym")) { el.style.width = `${r.width}px`; el.style.height = `${r.height}px`; }
    }
    let n = 0;
    const stop = clock.frame(() => { if (++n >= 3) { stop(); box.remove(); } });
    offs.push(() => { stop(); box.remove(); });
  };

  // ---------------------------------------------------------------- core → screen
  const render = (st: SlotState): void => {
    const spinning = st.phase === "spin";
    renderPays(st.bet / LINES);
    if (st.auto > 0) spin.set({ mode: "auto", label: t("slot.stop"), sub: t("slot.auto"), badge: st.auto, disabled: false });
    else if (spinning) spin.set({ mode: "stop", label: t("slot.stop"), sub: null, badge: null, disabled: st.hurried });
    else spin.set({ mode: "spin", label: t("slot.spin"), sub: null, badge: null, disabled: false });
    if (bet.index !== st.betIndex) bet.set(st.betIndex);
    bet.setDisabled(spinning || st.auto > 0);
    turbo.set(st.turbo);
    auto.set(st.auto > 0 || !picker.hidden);
    screen.classList.toggle("is-spinning", spinning);
    screen.classList.toggle("is-auto", st.auto > 0);
  };

  const showSheet = (): void => {
    if (sh?.isOpen) return;
    sh = sheet({
      title: t("slot.short.title"),
      body: [h("p", "slot-sheet__body", [t("slot.short.body", { min: fmtCredits(MIN_BET.slot) })])],
      actions: [
        button({ label: t("slot.short.lobby"), variant: "violet", icon: "grid", testid: "short-lobby", onTap: () => { sh?.close(); ctx.nav.toLobby(); } }),
        button({ label: t("slot.short.cashout"), variant: "red", testid: "short-cashout", onTap: () => { sh?.close(); ctx.nav.requestCashout("cashout"); } }),
      ],
      testid: "sheet-short",
    });
    sh.open();
  };

  const view: SlotView = {
    winEl: winProxy,
    reelsEl: windowEl,
    render,
    spinStart(plan, at) {
      closePicker();
      lastPlan = null;
      drawLines(null);
      reels.highlight([]);
      winProxy.textContent = "0";
      win.el.classList.add("is-zero");
      windowEl.classList.remove("is-antic");
      reels.start(plan, at);
    },
    retime(at, snap) { reels.retime(at, snap); },
    reelStop(i) { reels.rest(i); },
    antic(from) {
      windowEl.classList.add("is-antic");
      reels.antic(from);
    },
    result(plan) {
      windowEl.classList.remove("is-antic");
      lastPlan = plan;
      if (plan.wins.length) {
        const rows = cfg.lines;
        const cells: [number, number][] = [];
        for (const w of plan.wins) for (let i = 0; i < w.count; i++) cells.push([i, rows[w.line][i]]);
        reels.highlight(cells);
        drawLines(plan);
      }
      if (plan.payout > 0) {
        win.el.classList.remove("is-zero");
        winProxy.textContent = fmtCredits(plan.payout);
      }
    },
    short(kind) {
      if (kind === "sheet") { showSheet(); return; }
      bet.el.classList.remove("is-nudge");
      void bet.el.offsetWidth;
      bet.el.classList.add("is-nudge");
    },
    bind(c) {
      core = c;
      render(c.state);
      layout();
      warm();
    },
    destroy() {
      if (geomRaf) cancelAnimationFrame(geomRaf);
      geomRaf = 0;
      for (const f of offs.splice(0)) f();
      mo.disconnect();
      sh?.close();
      reels.destroy();
      screen.remove();
      core = null;
      styleUsers = Math.max(0, styleUsers - 1);
      if (styleUsers === 0 && styleEl) { styleEl.remove(); styleEl = null; }
    },
  };
  win.el.classList.add("is-zero");
  return view;
}

function coreCfg(ctx: GameCtx): SlotConfig { return SLOTS[ctx.settings.sv] ?? SLOTS.a; }
