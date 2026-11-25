/**
 * ABYSS LEGEND screen (DOM). Portrait cabinet: marquee sign, LED meters, chrome bezel with the reels screen,
 * the deck (coin slot, TURBO, ticket mouth) and the BET / START / STOP arcade buttons in the thumb zone.
 * Input: START (STOP while turning), STOP, BET (next step), swipe down on the reels (spin), a tap on turning
 * reels (STOP), Space. The view never decides anything: it forwards input to the core and draws what the core
 * tells it (reels, creature, bonus overlay, tickets).
 */
import "../../src/ui/led.css";
import "./style.css";
import { MIN_BET } from "../../../shared/config";
import { OCEAN } from "../../../shared/rules/ocean";
import { button, fmtCredits, h, neonStroke, sheet, svgRoot, type Overlay } from "../../src/ui/index";
import type { GameCtx } from "../../src/types";
import { createReels, type Reels } from "../slot/reels";
import { windowCells } from "../slot/core";
import { SYMBOLS, symClass, symbolCss } from "./art";
import { buildCabinet } from "./cabinet";
import { REELS, STORE_LAST, TICKET_MS, type OceanCore, type OceanPlan, type OceanUi, type OceanViewState } from "./core";
import { createOmenLayer } from "./creatures";
import { createTicketPrinter } from "./tickets";

export interface OceanView extends OceanUi {
  bind(core: OceanCore): void;
  destroy(): void;
}

const PEEK_ROWS = 3.7;
const LINE_COLORS = ["#FFC83D", "#19D3C5", "#FF6B5E", "#7FFFF4", "#F4EDE0", "#FF9A3D", "#B98BFF"];
const SWIPE_PX = 40;

let styleEl: HTMLStyleElement | null = null;
let styleUsers = 0;

export function createOceanView(root: HTMLElement, ctx: GameCtx): OceanView {
  const t = ctx.t;
  const { fx, clock, wallet } = ctx;
  let core: OceanCore | null = null;
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

  const cab = buildCabinet(t);
  const cfg = OCEAN.slot;

  // ---------------------------------------------------------------- reels
  const last = ctx.store.get<number[]>(STORE_LAST);
  const firstStops = Array.isArray(last) && last.length === REELS ? last : [12, 4, 20, 9, 2];
  const reels: Reels = createReels(clock, windowCells(cfg, firstStops));
  const lines = svgRoot("0 0 100 100", [], { class: "ocean-lines" });
  const reelsWrap = h("div", "ocean-reels-wrap", [reels.el, lines, h("div", "ocean-glass")]);
  const windowEl = h("div", "ocean-window", [reelsWrap]);
  windowEl.dataset.testid = "reels";
  cab.stage.appendChild(windowEl);
  const omen = createOmenLayer();
  cab.screen.insertBefore(omen.el, cab.bonus.el);
  const printer = createTicketPrinter({ title: t("ocean.ticket.title") });
  cab.mouth.appendChild(printer.el);
  root.appendChild(cab.root);

  // ---------------------------------------------------------------- LEDs
  const ledText = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };
  ledText(cab.ledCredit, fmtCredits(wallet.balance));
  offs.push(wallet.onChange((b) => ledText(cab.ledCredit, fmtCredits(b))));
  cab.ledWin.textContent = "0";
  cab.ledWin.parentElement?.classList.add("is-zero");

  // ---------------------------------------------------------------- input
  const tapSound = (): void => fx.sfx.play("tap", { k: 0.6 });
  for (const b of [cab.btnBet, cab.btnStart, cab.btnStop, cab.turbo]) {
    on(b, "pointerdown", (e) => { if (e.button > 0 || b.disabled) return; b.classList.add("is-down"); tapSound(); });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) on(b, ev, () => b.classList.remove("is-down"));
  }
  on(cab.btnStart, "click", () => core?.press("tap"));
  on(cab.btnStop, "click", () => { core?.stop(); });
  on(cab.btnBet, "click", () => core?.cycleBet());
  on(cab.turbo, "click", () => { if (core) core.setTurbo(!core.state.turbo); });

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
    if (!drag.fired && dy >= SWIPE_PX && Math.abs(dx) < dy && core && core.state.phase === "idle") {
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
    if (e.type === "pointerup" && !d.fired && !d.moved && core && core.state.phase === "spin") core.stop();
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
    cab.btnStart.classList.add("is-down");
    void clock.wait(90).then(() => cab.btnStart.classList.remove("is-down"));
    core.press("tap");
  });

  // ---------------------------------------------------------------- layout
  let ch = 0;
  let geom: { W: number; xs: number[] } | null = null;
  let geomRaf = 0;
  const measureGeom = (): { W: number; xs: number[] } => {
    geom ??= { W: reelsWrap.clientWidth, xs: [...reels.el.children].map((c) => (c as HTMLElement).offsetLeft + (c as HTMLElement).offsetWidth / 2) };
    return geom;
  };
  let passes = 0;
  const layout = (): void => {
    geom = null;
    if (!geomRaf && typeof requestAnimationFrame === "function") {
      geomRaf = requestAnimationFrame(() => { geomRaf = 0; measureGeom(); });
    }
    const H = root.clientHeight || cab.root.clientHeight;
    const W = reelsWrap.clientWidth;
    if (!(H > 0 && W > 0)) return;
    const small = H < 560;
    const cw = W / REELS;
    // everything but the reels: the children's heights (reels at their current height) + gaps + padding
    const cs = getComputedStyle(cab.root);
    const kids = [...cab.root.children] as HTMLElement[];
    const used = kids.reduce((a, k) => a + k.offsetHeight, 0) + (kids.length - 1) * (parseFloat(cs.rowGap) || 0)
      + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const avail = H - (used - reelsWrap.offsetHeight) - 4;
    const next = Math.floor(Math.max(cw * 0.78, Math.min(cw * 1.24, avail / PEEK_ROWS)) * 2) / 2;
    // Spare height (tall phones): a larger sign; the rest is spread around it.
    const tall = !small && avail - PEEK_ROWS * next > 64;
    const chrome = cab.root.classList.contains("is-small") !== small || cab.root.classList.contains("is-tall") !== tall;
    cab.root.classList.toggle("is-small", small);
    cab.root.classList.toggle("is-tall", tall);
    if (Math.abs(next - ch) >= 0.5) {
      ch = next;
      cab.root.style.setProperty("--ch", `${ch}px`);
      reels.resize(ch);
      if (lastPlan) drawLines(lastPlan);
    }
    // the chrome changed size: measure once more (bounded)
    if (chrome && passes++ < 3) layout();
  };
  const ro = new ResizeObserver(() => { passes = 0; layout(); });
  ro.observe(root);
  offs.push(() => ro.disconnect());

  // ---------------------------------------------------------------- win lines
  let lastPlan: OceanPlan | null = null;
  const drawLines = (plan: OceanPlan | null): void => {
    lines.replaceChildren();
    if (!plan || plan.wins.length === 0) return;
    const { W, xs } = measureGeom();
    const Hh = ch * PEEK_ROWS;
    lines.setAttribute("viewBox", `0 0 ${W.toFixed(1)} ${Hh.toFixed(1)}`);
    for (const w of plan.wins) {
      const pts = cfg.lines[w.line].map((row, i) => [xs[i] ?? 0, (row + 0.35 + 0.5) * ch] as const);
      const d = `M2 ${pts[0][1].toFixed(1)}` + pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join("") + `L${(W - 2).toFixed(1)} ${pts[4][1].toFixed(1)}`;
      lines.appendChild(neonStroke(d, LINE_COLORS[w.line % LINE_COLORS.length], Math.max(2.2, ch * 0.04)));
    }
  };

  // Rasterise every symbol (sharp and streak) once at cell size before the first spin.
  const warm = (): void => {
    const box = h("div", "ocean-warm", [
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

  // ---------------------------------------------------------------- bonus overlay
  const hideBonus = (): void => { cab.bonus.el.hidden = true; cab.bonus.el.classList.remove("is-pop"); };
  const showBonus = (plan: OceanPlan): void => {
    cab.bonus.amt.textContent = `+${fmtCredits(plan.seqPay)}`;
    cab.bonus.chain.textContent = plan.chain > 0 ? t("ocean.chain", { n: plan.chain }) : "";
    cab.bonus.el.hidden = false;
    cab.bonus.el.classList.remove("is-pop");
    void cab.bonus.el.offsetWidth;
    cab.bonus.el.classList.add("is-pop");
  };

  // ---------------------------------------------------------------- core → screen
  const render = (st: OceanViewState): void => {
    const spinning = st.phase === "spin";
    ledText(cab.ledBet, fmtCredits(st.bet));
    cab.btnStart.classList.toggle("is-stop", spinning);
    cab.btnStop.disabled = !spinning || st.hurried;
    cab.btnBet.disabled = spinning;
    cab.turbo.classList.toggle("is-on", st.turbo);
    cab.turbo.setAttribute("aria-pressed", String(st.turbo));
    cab.lamp.classList.toggle("is-on", st.lamp);
    cab.root.classList.toggle("is-spinning", spinning);
  };

  const showSheet = (): void => {
    if (sh?.isOpen) return;
    sh = sheet({
      title: t("ocean.short.title"),
      body: [h("p", "ocean-sheet__body", [t("ocean.short.body", { min: fmtCredits(MIN_BET.ocean) })])],
      actions: [
        button({ label: t("ocean.short.lobby"), variant: "violet", icon: "grid", testid: "short-lobby", onTap: () => { sh?.close(); ctx.nav.toLobby(); } }),
        button({ label: t("ocean.short.cashout"), variant: "red", testid: "short-cashout", onTap: () => { sh?.close(); ctx.nav.requestCashout("cashout"); } }),
      ],
      testid: "sheet-short",
    });
    sh.open();
  };

  const view: OceanView = {
    winEl: cab.ledWin,
    reelsEl: windowEl,
    screenEl: cab.screen,
    outletEl: cab.mouth,
    render,
    spinStart(plan, at) {
      lastPlan = null;
      drawLines(null);
      reels.highlight([]);
      hideBonus();
      cab.ledWin.textContent = "0";
      cab.ledWin.parentElement?.classList.add("is-zero");
      windowEl.classList.remove("is-antic");
      reels.start(plan, at);
    },
    retime(at, snap) { reels.retime(at, snap); },
    reelStop(i) { reels.rest(i); },
    antic(from) {
      windowEl.classList.add("is-antic");
      reels.antic(from);
    },
    omen(kind, ms) { omen.play(kind, ms); },
    result(plan) {
      windowEl.classList.remove("is-antic");
      lastPlan = plan;
      if (plan.wins.length) {
        const cells: [number, number][] = [];
        for (const w of plan.wins) for (let i = 0; i < w.count; i++) cells.push([i, cfg.lines[w.line][i]]);
        reels.highlight(cells);
        drawLines(plan);
      }
      if (plan.seqPay > 0) showBonus(plan);
      if (plan.payout > 0) {
        cab.ledWin.parentElement?.classList.remove("is-zero");
        cab.ledWin.textContent = fmtCredits(plan.payout);
      }
    },
    ticket(_i, serial, instant) { printer.print(serial, instant ? 0 : TICKET_MS * 0.9); },
    clearTickets() { printer.clear(); omen.clear(); },
    short(kind) {
      if (kind === "sheet") { showSheet(); return; }
      cab.btnBet.classList.remove("is-nudge");
      void cab.btnBet.offsetWidth;
      cab.btnBet.classList.add("is-nudge");
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
      sh?.close();
      omen.destroy();
      printer.destroy();
      reels.destroy();
      cab.root.remove();
      core = null;
      styleUsers = Math.max(0, styleUsers - 1);
      if (styleUsers === 0 && styleEl) { styleEl.remove(); styleEl = null; }
    },
  };
  return view;
}
