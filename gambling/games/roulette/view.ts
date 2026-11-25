/**
 * RUBY ROULETTE screen (DOM). Portrait layout (BASE_PROMPT §2.2): the wheel on top (title, last 20 results and the
 * WIN read-out beside it), the felt board below turned upright (0 at the top, numbers in 3 columns going down,
 * dozens on the left, even-money bets on the right, columns underneath; the 12 number rows scroll between the
 * fixed 0 row and the fixed column row), then the chip tray, BET read-out and UNDO · CLEAR · REBET · SPIN.
 *
 * Input: tap a chip to select it, tap a cell to place it (near a shared edge = split), press and hold a cell to take
 * its chips back. The view never decides anything: it forwards input to the core and draws what the core says.
 */
import "./style.css";
import { MIN_BET } from "../../../shared/config";
import { type RouletteBet } from "../../../shared/rules/roulette";
import {
  button, chip, chipArt, chipLabel, fmtCredits, goldText, h, iconButton, neonText, plate, setDigits, sheet, spinButton,
  type Chip, type Overlay,
} from "../../src/ui/index";
import type { GameCtx } from "../../src/types";
import { buildWheel } from "./art";
import {
  betKey, CHIP_VALUES, colorOf, HISTORY_LEN, limitOf, normBet, resolveNumberTap, resolveZeroTap, stackChip, STORE_HIST, streaks, TABLE_MAX,
  type Reject, type RouletteCore, type RouletteState, type RouletteUi,
} from "./core";
import { ballXY, DROP_END, makeAnim, pocketDeg, pocketUnder, POCKET_R, STEP, wheelDeg, type WheelAnim } from "./wheel";

export interface RouletteView extends RouletteUi {
  bind(core: RouletteCore): void;
  destroy(): void;
}

const LONG_PRESS_MS = 480;
const MOVE_PX = 10;
const TICK_GAP_MS = 60;

export function createRouletteView(root: HTMLElement, ctx: GameCtx): RouletteView {
  const t = ctx.t;
  const { fx, clock } = ctx;
  let core: RouletteCore | null = null;
  const offs: (() => void)[] = [];
  const timers = new Set<number>();
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, opt);
    offs.push(() => el.removeEventListener(type, fn as EventListener, opt));
  };
  const later = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  };

  // ---------------------------------------------------------------- top: wheel + title + last 20 + WIN
  const art = buildWheel();
  const wheelWrap = h("div", "rr-wheelwrap", [art.el]);
  wheelWrap.dataset.testid = "wheel";

  const title = goldText(t("roulette.title"), { glow: "magenta", tag: "h1", className: "rr-title" });
  const sub = neonText(t("roulette.sub"), { color: "cyan", className: "rr-sub" });
  const histHead = h("div", "rr-hist__head", [h("span", "rr-hist__label", [t("roulette.last")]), h("span", "rr-hist__streak")]);
  const histGrid = h("div", "rr-hist__grid");
  const hist = h("div", "rr-hist", [histHead, histGrid]);
  hist.dataset.testid = "history";
  const histCells: HTMLElement[] = [];
  for (let i = 0; i < HISTORY_LEN; i++) {
    const c = h("span", "rr-h is-empty", [h("b"), h("i")]);
    histCells.push(c);
    histGrid.appendChild(c);
  }

  const win = plate({ label: t("roulette.win"), value: 0, tone: "win", size: 24, testid: "win", className: "rr-win" });
  const winProxy = h("span", "rr-win-proxy");
  winProxy.hidden = true;
  win.el.appendChild(winProxy);
  const mo = new MutationObserver(() => setDigits(win.value, winProxy.textContent ?? ""));
  mo.observe(winProxy, { childList: true, characterData: true, subtree: true });
  win.el.classList.add("is-zero");
  const turbo = iconButton({ icon: "bolt", aria: t("roulette.turbo"), variant: "violet", testid: "btn-turbo" });
  turbo.classList.add("rr-turbo");
  turbo.setAttribute("aria-pressed", "false");
  const winRow = h("div", "rr-winrow", [win.el, turbo]);
  const side = h("div", "rr-side", [h("div", "rr-titlebox", [title, sub]), hist, winRow]);
  const top = h("div", "rr-top", [wheelWrap, side]);

  // ---------------------------------------------------------------- board
  const resolvers = new WeakMap<HTMLElement, (fx: number, fy: number) => RouletteBet>();
  const cellOf = new Map<string, HTMLElement>();
  const mkCell = (cls: string, label: string | Node, bet: (fx: number, fy: number) => RouletteBet, aria: string): HTMLButtonElement => {
    const b = h("button", `rr-cell ${cls}`, [typeof label === "string" ? h("span", "rr-cell__t", [label]) : label]);
    b.type = "button";
    b.setAttribute("aria-label", aria);
    b.dataset.cell = "1";
    resolvers.set(b, bet);
    return b;
  };
  const numberBadge = (n: number): HTMLElement => h("span", `rr-n rr-n--${colorOf(n)}`, [h("b", "", [String(n)])]);

  const zero = mkCell("rr-cell--zero", numberBadge(0), resolveZeroTap, "0");
  zero.dataset.testid = "cell-0";
  cellOf.set("s0", zero);
  const zeroRow = h("div", "rr-row rr-row--zero", [h("i", "rr-pad"), zero, h("i", "rr-pad")]);

  const grid = h("div", "rr-grid");
  const dozenTxt = ["1-12", "13-24", "25-36"];
  const dozens = ([1, 2, 3] as const).map((i) => {
    const c = mkCell("rr-cell--side rr-cell--dozen", dozenTxt[i - 1], () => ({ kind: "dozen", i }), dozenTxt[i - 1]);
    c.style.gridColumn = "1";
    c.style.gridRow = `${(i - 1) * 4 + 1} / span 4`;
    c.dataset.testid = `cell-dozen-${i}`;
    cellOf.set(`d${i}`, c);
    return c;
  });
  const numCells: HTMLElement[] = [];
  for (let n = 1; n <= 36; n++) {
    const c = mkCell(`rr-cell--num rr-cell--${colorOf(n)}`, numberBadge(n), (fx2, fy2) => resolveNumberTap(n, fx2, fy2), String(n));
    c.style.gridColumn = String(((n - 1) % 3) + 2);
    c.style.gridRow = String(Math.ceil(n / 3));
    c.dataset.testid = `cell-${n}`;
    numCells[n] = c;
    cellOf.set(`s${n}`, c);
  }
  const diamond = (color: "red" | "black") => h("span", `rr-dia rr-dia--${color}`);
  const outside: { bet: RouletteBet; label: string | Node; aria: string; cls: string }[] = [
    { bet: { kind: "low" }, label: "1-18", aria: "1-18", cls: "" },
    { bet: { kind: "even" }, label: t("roulette.even"), aria: t("roulette.even"), cls: "" },
    { bet: { kind: "red" }, label: diamond("red"), aria: t("roulette.red"), cls: "rr-cell--redb" },
    { bet: { kind: "black" }, label: diamond("black"), aria: t("roulette.black"), cls: "rr-cell--blackb" },
    { bet: { kind: "odd" }, label: t("roulette.odd"), aria: t("roulette.odd"), cls: "" },
    { bet: { kind: "high" }, label: "19-36", aria: "19-36", cls: "" },
  ];
  const outsideCells = outside.map((o, k) => {
    const c = mkCell(`rr-cell--side rr-cell--out ${o.cls}`, o.label, () => o.bet, o.aria);
    c.style.gridColumn = "5";
    c.style.gridRow = `${k * 2 + 1} / span 2`;
    c.dataset.testid = `cell-${o.bet.kind}`;
    cellOf.set(betKey(o.bet), c);
    return c;
  });
  grid.append(...dozens, ...numCells.slice(1), ...outsideCells);
  const scroll = h("div", "rr-scroll", [grid]);
  scroll.dataset.testid = "board-scroll";

  const cols = ([1, 2, 3] as const).map((i) => {
    const c = mkCell("rr-cell--col", "2:1", () => ({ kind: "column", i }), `${t("roulette.column")} ${i}`);
    c.dataset.testid = `cell-col-${i}`;
    cellOf.set(`c${i}`, c);
    return c;
  });
  const colRow = h("div", "rr-row rr-row--cols", [h("i", "rr-pad"), ...cols, h("i", "rr-pad")]);
  const toast = h("div", "rr-toast");
  toast.hidden = true;
  const board = h("div", "rr-board", [zeroRow, scroll, colRow, toast]);
  board.dataset.testid = "board";

  // ---------------------------------------------------------------- dock: BET, chips, tools, SPIN
  const bet = plate({ label: t("roulette.bet"), value: 0, tone: "gold", size: 22, testid: "bet", className: "rr-bet" });
  const chips: Chip[] = CHIP_VALUES.map((v) => chip({
    value: v, size: 52, testid: `chip-${v}`, aria: String(v),
    onTap: () => { core?.setChip(v); },
  }));
  const tray = h("div", "rr-tray", chips.map((c) => c.el));
  const dockTop = h("div", "rr-dock__top", [bet.el, tray]);
  const undo = button({ label: t("roulette.undo"), variant: "dark", size: "sm", testid: "btn-undo", onTap: () => { core?.undo(); } });
  const clear = button({ label: t("roulette.clear"), variant: "dark", size: "sm", testid: "btn-clear", onTap: () => { core?.clear(); } });
  const rebet = button({ label: t("roulette.rebet"), variant: "violet", size: "sm", testid: "btn-rebet", onTap: () => { core?.rebet(); } });
  const spin = spinButton({ label: t("roulette.spin"), size: 88, testid: "btn-spin", onTap: () => { void core?.spin({ gesture: "tap" }); } });
  const tools = h("div", "rr-tools", [undo, clear, rebet]);
  const dock = h("div", "rr-dock", [dockTop, h("div", "rr-dock__bot", [tools, spin.el])]);

  const screen = h("div", "rr", [top, board, dock]);
  screen.dataset.testid = "roulette";
  root.appendChild(screen);

  // ---------------------------------------------------------------- input
  const tapSound = (): void => fx.sfx.play("tap", { k: 0.6 });
  on(spin.el, "pointerdown", (e) => { if (e.button <= 0) tapSound(); });
  for (const b of [undo, clear, rebet, turbo]) on(b, "pointerdown", (e) => { if (e.button <= 0) tapSound(); });
  for (const c of chips) on(c.el, "pointerdown", (e) => { if (e.button <= 0) fx.sfx.play("chip", { k: 0.4 }); });
  on(turbo, "click", () => { core?.setTurbo(!(core?.state.turbo ?? false)); });

  type Press = { id: number; x: number; y: number; el: HTMLElement; timer: number; fired: boolean; moved: boolean };
  let press: Press | null = null;
  const fracs = (el: HTMLElement, e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))), Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))];
  };
  const endPress = (): void => {
    if (!press) return;
    window.clearTimeout(press.timer);
    timers.delete(press.timer);
    press.el.classList.remove("is-down");
    press = null;
  };
  on(board, "pointerdown", (e) => {
    if (e.button > 0 || press) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!el) return;
    el.classList.add("is-down");
    const p: Press = { id: e.pointerId, x: e.clientX, y: e.clientY, el, timer: 0, fired: false, moved: false };
    const [fx0, fy0] = fracs(el, e);
    p.timer = later(() => {
      if (press !== p || p.moved) return;
      p.fired = true;
      const want = resolvers.get(el)!(fx0, fy0);
      let ok = core?.remove(want) ?? false;
      if (!ok && want.kind === "split" && core) ok = core.remove(resolvers.get(el)!(0.5, 0.5));
      if (ok) fx.haptics.pulse(14);
      el.classList.remove("is-down");
    }, LONG_PRESS_MS);
    press = p;
  });
  on(board, "pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_PX) {
      press.moved = true;
      window.clearTimeout(press.timer);
      press.el.classList.remove("is-down");
    }
  });
  on(board, "pointerup", (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    const wasTap = !p.fired && !p.moved;
    const [fx1, fy1] = fracs(p.el, e);
    endPress();
    if (wasTap) core?.place(resolvers.get(p.el)!(fx1, fy1));
  });
  on(board, "pointercancel", endPress);
  on(board, "pointerleave", (e) => { if (e.pointerType === "mouse") endPress(); });
  on(board, "contextmenu", (e) => e.preventDefault());
  // keyboard activation (Enter/Space on a focused cell): no pointer, so the straight bet
  on(board, "click", (e) => {
    if (e.detail !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (el) core?.place(resolvers.get(el)!(0.5, 0.5));
  });

  // ---------------------------------------------------------------- layout
  let wsize = 0;
  const layout = (): void => {
    const H = root.clientHeight || screen.clientHeight;
    const W = root.clientWidth;
    if (!(H > 0 && W > 0)) return;
    const small = H < 620;
    screen.classList.toggle("is-small", small);
    const wh = Math.floor(small ? Math.max(104, Math.min(150, W * 0.42, H * 0.25)) : Math.max(124, Math.min(206, W * 0.52, H * 0.27)));
    if (wh !== wsize) {
      wsize = wh;
      screen.style.setProperty("--wh", `${wh}px`);
    }
  };
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  offs.push(() => ro.disconnect());

  // ---------------------------------------------------------------- wheel animation
  let restDeg = 0;
  let restBall = 0;
  let anim: WheelAnim | null = null;
  let stopLoop: (() => void) | null = null;
  const ballAt = (x: number, y: number): void => {
    art.ball.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    art.ballShadow.setAttribute("cx", (x + 0.8).toFixed(2));
    art.ballShadow.setAttribute("cy", (y + 1.2).toFixed(2));
  };
  const setWheel = (deg: number): void => { art.rot.style.transform = `rotate(${deg.toFixed(2)}deg)`; };
  const restBallAt = (n: number | null): void => {
    const idx = n === null ? 0 : pocketDeg(n) / STEP;
    restBall = idx * STEP;
    const a = ((restDeg + restBall) * Math.PI) / 180;
    ballAt(100 + POCKET_R * Math.sin(a), 100 - POCKET_R * Math.cos(a));
  };
  const lastBoard = ctx.store.get<number[]>(STORE_HIST);
  const lastN = Array.isArray(lastBoard) && lastBoard.length ? lastBoard[lastBoard.length - 1] : null;
  setWheel(restDeg);
  restBallAt(lastN);
  const showNumber = (n: number | null): void => {
    art.num.className = n === null ? "rr-wheel__num" : `rr-wheel__num is-on rr-wheel__num--${colorOf(n)}`;
    art.num.textContent = n === null ? "" : String(n);
    art.hit.style.opacity = n === null ? "0" : "1";
    if (n !== null) art.hit.setAttribute("transform", `rotate(${(pocketDeg(n)).toFixed(2)} 100 100)`);
  };
  art.hit.style.opacity = "0";

  // ---------------------------------------------------------------- history
  let toastTimer = 0;
  const renderHistory = (h20: readonly number[]): void => {
    const runs = streaks(h20);
    const n = h20.length;
    const inRun = new Map<number, { len: number; color: string; head: boolean }>();
    for (const r of runs) for (let i = r.from; i <= r.to; i++) inRun.set(i, { len: r.len, color: r.color, head: i === r.to });
    for (let k = 0; k < HISTORY_LEN; k++) {
      const idx = n - 1 - k;   // newest first
      const cell = histCells[k];
      if (idx < 0) { cell.className = "rr-h is-empty"; cell.firstElementChild!.textContent = ""; cell.lastElementChild!.textContent = ""; continue; }
      const num = h20[idx];
      const run = inRun.get(idx);
      cell.className = `rr-h rr-h--${colorOf(num)}${k === 0 ? " is-new" : ""}${run ? ` is-run is-run--${run.color}` : ""}${run?.head ? " is-head" : ""}`;
      cell.firstElementChild!.textContent = String(num);
      cell.lastElementChild!.textContent = "";
    }
    const cur = runs.find((r) => r.to === n - 1);
    const sk = histHead.lastElementChild as HTMLElement;
    sk.className = cur ? `rr-hist__streak is-on rr-hist__streak--${cur.color}` : "rr-hist__streak";
    sk.textContent = cur ? `${t(cur.color === "red" ? "roulette.red" : "roulette.black")} ×${cur.len}` : "";
  };

  // ---------------------------------------------------------------- chips on the table
  const marks = new Map<string, { amt: number; el: HTMLElement }>();
  const hostOf = (b: RouletteBet): { cell: HTMLElement; cls: string; style?: string } | null => {
    switch (b.kind) {
      case "straight": { const c = cellOf.get(`s${b.n}`); return c ? { cell: c, cls: "rr-mk--c" } : null; }
      case "split": {
        if (b.a === 0) return { cell: zero, cls: "rr-mk--zb", style: `${(((b.b - 1) + 0.5) / 3) * 100}%` };
        const c = numCells[b.a];
        return { cell: c, cls: b.b - b.a === 1 ? "rr-mk--r" : "rr-mk--b" };
      }
      default: { const c = cellOf.get(betKey(b)); return c ? { cell: c, cls: "rr-mk--c" } : null; }
    }
  };
  const mkEl = (amt: number): HTMLElement => {
    const el = h("span", "rr-mk");
    el.append(chipArt(stackChip(amt), chipLabel(amt)));
    return el;
  };
  const renderMarks = (st: RouletteState): void => {
    const want = new Map<string, { bet: RouletteBet; amt: number }>();
    for (const p of st.placed) want.set(betKey(p.bet), { bet: p.bet, amt: p.amt });
    for (const [k, m] of marks) if (!want.has(k)) { m.el.remove(); marks.delete(k); }
    for (const [k, w] of want) {
      const cur = marks.get(k);
      if (cur && cur.amt === w.amt) continue;
      const host = hostOf(w.bet);
      if (!host) continue;
      cur?.el.remove();
      const el = mkEl(w.amt);
      el.className = `rr-mk ${host.cls}${cur ? " is-bump" : " is-new"}`;
      el.dataset.key = k;
      if (host.style) el.style.left = host.style;
      host.cell.appendChild(el);
      marks.set(k, { amt: w.amt, el });
    }
  };
  const clearHits = (): void => {
    for (const c of board.querySelectorAll(".is-hit")) c.classList.remove("is-hit");
    for (const c of board.querySelectorAll(".rr-mk.is-win")) c.classList.remove("is-win");
  };

  // ---------------------------------------------------------------- core → screen
  let sh: Overlay | null = null;
  const render = (st: RouletteState): void => {
    const spinning = st.phase === "spin";
    bet.set(st.total);
    for (const c of chips) {
      c.select(c.value === st.chip);
      (c.el as HTMLButtonElement).disabled = false;
      c.el.classList.toggle("is-poor", c.value > st.free);
    }
    (undo as HTMLButtonElement).disabled = spinning || !st.canUndo;
    (clear as HTMLButtonElement).disabled = spinning || st.placed.length === 0;
    (rebet as HTMLButtonElement).disabled = spinning || !st.canRebet;
    spin.set({ mode: "spin", label: t("roulette.spin"), sub: null, badge: null, disabled: spinning || st.placed.length === 0 });
    turbo.classList.toggle("is-on", st.turbo);
    turbo.setAttribute("aria-pressed", String(st.turbo));
    screen.classList.toggle("is-spinning", spinning);
    screen.classList.toggle("is-empty", st.placed.length === 0);
    renderMarks(st);
    renderHistory(st.history);
  };

  const showToast = (msg: string): void => {
    toast.textContent = msg;
    toast.hidden = false;
    toast.classList.remove("is-on");
    void toast.offsetWidth;
    toast.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = later(() => { toast.hidden = true; }, 1500);
  };
  const nudge = (el: HTMLElement): void => {
    el.classList.remove("is-nudge");
    void el.offsetWidth;
    el.classList.add("is-nudge");
  };

  const showSheet = (): void => {
    if (sh?.isOpen) return;
    sh = sheet({
      title: t("roulette.short.title"),
      body: [h("p", "rr-sheet__body", [t("roulette.short.body", { min: fmtCredits(MIN_BET.roulette) })])],
      actions: [
        button({ label: t("roulette.short.lobby"), variant: "violet", icon: "grid", testid: "short-lobby", onTap: () => { sh?.close(); ctx.nav.toLobby(); } }),
        button({ label: t("roulette.short.cashout"), variant: "red", testid: "short-cashout", onTap: () => { sh?.close(); ctx.nav.requestCashout("cashout"); } }),
      ],
      testid: "sheet-short",
    });
    sh.open();
  };

  /** Brings the winning number into the scrolling part of the board. */
  const revealCell = (n: number): void => {
    const c = numCells[n];
    if (!c) return;
    const top = c.offsetTop, bot = top + c.offsetHeight;
    let to = scroll.scrollTop;
    if (top < to) to = top; else if (bot > to + scroll.clientHeight) to = bot - scroll.clientHeight;
    if (to !== scroll.scrollTop) scroll.scrollTo({ top: to, behavior: fx.enabled ? "smooth" : "auto" });
  };

  let pTick = -1, tickAt = 0;
  const view: RouletteView = {
    winEl: winProxy,
    wheelEl: wheelWrap,
    render,
    spinStart(plan, t0) {
      stopLoop?.();
      clearHits();
      showNumber(null);
      winProxy.textContent = "0";
      win.el.classList.add("is-zero");
      anim = makeAnim(plan.n, restDeg, plan.seed);
      const a = anim;
      if (plan.quick) return;
      screen.classList.add("is-rolling");
      pTick = -1;
      stopLoop = clock.frame(() => {
        const p = Math.min(1, (clock.now() - t0) / plan.durationMs);
        setWheel(wheelDeg(a, p));
        const b = ballXY(a, p);
        ballAt(b.x, b.y);
        if (p > 0.4 && p < DROP_END + 0.03) {
          const idx = pocketUnder(a, p);
          const now = clock.now();
          if (idx !== pTick && now - tickAt >= TICK_GAP_MS) { pTick = idx; tickAt = now; fx.sfx.play("tick", { k: 0.22 + 0.2 * p, pitch: 0.9 + 0.5 * p }); }
        }
        if (p >= 1) { stopLoop?.(); stopLoop = null; }
      });
    },
    result(plan) {
      stopLoop?.();
      stopLoop = null;
      screen.classList.remove("is-rolling");
      const a = anim ?? makeAnim(plan.n, restDeg, plan.seed);
      restDeg = wheelDeg(a, 1) % 360;
      setWheel(restDeg);
      restBallAt(plan.n);
      showNumber(plan.n);
      numCells[plan.n]?.classList.add("is-hit");
      revealCell(plan.n);
      if (plan.n === 0) zero.classList.add("is-hit");
      plan.settlement.lines.forEach((ln) => {
        if (ln.won) marks.get(betKey(normBet(ln.bet)))?.el.classList.add("is-win");
      });
      if (plan.payout > 0) {
        win.el.classList.remove("is-zero");
        winProxy.textContent = fmtCredits(plan.payout);
      }
    },
    reject(why: Reject, b?: RouletteBet) {
      if (why === "busy") return;
      if (why === "limit" && b) showToast(t("roulette.msg.limit", { max: fmtCredits(limitOf(b)) }));
      else if (why === "table") showToast(t("roulette.msg.table", { max: fmtCredits(TABLE_MAX) }));
      else if (why === "funds") showToast(t("roulette.msg.funds"));
      else if (why === "empty") showToast(t("roulette.msg.empty"));
      nudge(bet.el);
      fx.haptics.pulse(10);
    },
    short(kind) {
      if (kind === "sheet") { showSheet(); return; }
      showToast(t("roulette.msg.lowered"));
      nudge(bet.el);
    },
    bind(c) {
      core = c;
      layout();
      render(c.state);
    },
    destroy() {
      stopLoop?.();
      endPress();
      for (const f of offs.splice(0)) f();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      mo.disconnect();
      sh?.close();
      screen.remove();
      core = null;
    },
  };
  return view;
}

