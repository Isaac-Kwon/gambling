/**
 * BLACKJACK 21 screen (DOM). Portrait layout (BASE_PROMPT §2.2): title plaque on top, the felt table in the
 * middle (dealer hand on top, player hand(s) below, shoe and tray in the corners), then BET / chips / WIN, and
 * the action row (HIT · STAND · DOUBLE · SPLIT, or CLEAR · REBET · DEAL while betting) in the thumb zone.
 * The view never decides anything: it forwards input to the core and draws what the core tells it
 * (animation lengths arrive in the moves: 0 = no animation).
 */
import "./style.css";
import { MIN_BET } from "../../../shared/config";
import type { Action } from "../../../shared/rules/blackjack";
import {
  bellEmblem, button, chip, chipArt, fmtCredits, goldText, h, neonText, plate, s, setDigits, sheet, starPath, svgRoot,
  type Overlay,
} from "../../src/ui/index";
import type { GameCtx } from "../../src/types";
import { backSvg, chipsFor, faceSvg, spriteSvg } from "./art";
import {
  CHIP_VALUES, type BjCore, type BjState4Ui, type BjUi, type Move, type ResultVm, type ShoeInfo, type TableVm,
} from "./core";

export interface BjView extends BjUi {
  bind(core: BjCore): void;
  destroy(): void;
}

interface HandEl {
  box: HTMLElement;
  cardsEl: HTMLElement;
  cards: HTMLElement[];
  total: HTMLElement;
  bet: HTMLElement;
  betChip: HTMLElement;
  betAmt: HTMLElement;
  tag: HTMLElement;
}

const CARD_ASPECT = 1.4;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function createBjView(root: HTMLElement, ctx: GameCtx): BjView {
  const t = ctx.t;
  const { fx, clock } = ctx;
  let core: BjCore | null = null;
  let cw = 56;
  let shoePos = 0;
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, opt);
    offs.push(() => el.removeEventListener(type, fn as EventListener, opt));
  };

  // ---------------------------------------------------------------- title plaque
  const title = goldText(t("blackjack.title"), { glow: "magenta", tag: "h1", className: "bj-title" });
  const sub = neonText(t("blackjack.sub"), { color: "cyan", className: "bj-subtitle" });
  const suitMini = (k: string) => h("i", `bj-mini bj-mini--${k}`, [svgRoot("0 0 100 100", [s("use", { href: `#bj-su-${k === "l" ? "s" : "h"}`, width: 100, height: 100, fill: k === "l" ? "url(#bj-blk)" : "url(#bj-red)" })])]);
  const head = h("div", "bj-head", [h("div", "bj-marquee", [suitMini("l"), h("div", "bj-marquee__text", [title, sub]), suitMini("r")])]);

  // ---------------------------------------------------------------- felt table
  const hands: HandEl[] = [];
  const makeHand = (dealer: boolean): HandEl => {
    const cardsEl = h("div", "bj-hand__cards is-empty");
    const total = h("span", "bj-total");
    total.hidden = true;
    const betChip = h("span", "bj-hbet__chip");
    const betAmt = h("span", "bj-hbet__amt");
    const bet = h("span", "bj-hbet", [betChip, betAmt]);
    bet.hidden = true;
    const tag = h("div", "bj-tag");
    tag.hidden = true;
    const info = h("div", "bj-hand__info", [dealer ? h("span", "bj-hand__who", [t("blackjack.dealer")]) : null, total, bet]);
    const box = h("div", `bj-hand${dealer ? " bj-hand--dealer" : ""}`, [cardsEl, tag, info]);
    return { box, cardsEl, cards: [], total, bet, betChip, betAmt, tag };
  };
  const dealerHand = makeHand(true);
  dealerHand.box.classList.add("is-idle");
  const handsRow = h("div", "bj-hands");
  const ensureHand = (i: number): HandEl => {
    while (hands.length <= i) {
      const hd = makeHand(false);
      hands.push(hd);
      handsRow.append(hd.box);
    }
    handsRow.classList.toggle("is-split", hands.length > 1);
    return hands[i];
  };
  ensureHand(0);

  const feltArt = svgRoot("0 0 340 150", [
    s("defs", {}, [
      s("path", { id: "bj-arc1", d: "M24 118Q170 6 316 118" }),
      s("path", { id: "bj-arc2", d: "M58 138Q170 66 282 138" }),
    ]),
    s("text", { class: "bj-arc bj-arc--1" }, [s("textPath", { href: "#bj-arc1", startOffset: "50%", "text-anchor": "middle" })]),
    s("text", { class: "bj-arc bj-arc--2" }, [s("textPath", { href: "#bj-arc2", startOffset: "50%", "text-anchor": "middle" })]),
    s("path", { d: starPath(170, 28, 9, 4), class: "bj-felt__star" }),
    s("path", { d: starPath(116, 52, 5, 2.2), class: "bj-felt__star" }),
    s("path", { d: starPath(224, 52, 5, 2.2), class: "bj-felt__star" }),
  ], { class: "bj-felt__art", preserveAspectRatio: "xMidYMid meet" });
  const arcs = feltArt.querySelectorAll("textPath");
  arcs[0].textContent = t("blackjack.felt.1");
  arcs[1].textContent = t("blackjack.felt.2");
  const watermark = h("div", "bj-felt__mark", [bellEmblem()]);

  // shoe (top right) and discard tray (top left): both show the real position in the 312-card shoe
  const shoeFill = h("span", "bj-shoe__fill");
  const shoeCut = h("span", "bj-shoe__cut");
  const shoeLabel = h("span", "bj-shoe__label");
  const shoe = h("div", "bj-shoe", [h("div", "bj-shoe__body", [shoeFill, shoeCut]), shoeLabel]);
  shoe.dataset.testid = "shoe";
  const trayFill = h("span", "bj-tray__fill");
  const tray = h("div", "bj-tray", [h("div", "bj-tray__body", [trayFill])]);

  // bet spot row: BET plate · chips on the spot · WIN plate
  const betPlate = plate({ label: t("blackjack.bet"), value: 0, tone: "gold", size: 19, testid: "bet", className: "bj-plate" });
  const win = plate({ label: t("blackjack.win"), value: 0, tone: "win", size: 19, testid: "win", className: "bj-plate bj-win" });
  const winProxy = h("span", "bj-win-proxy");
  winProxy.hidden = true;
  win.el.appendChild(winProxy);
  const mo = new MutationObserver(() => setDigits(win.value, winProxy.textContent ?? ""));
  mo.observe(winProxy, { childList: true, characterData: true, subtree: true });
  win.el.classList.add("is-zero");
  const stack = h("div", "bj-stack");
  stack.dataset.testid = "stack";
  const spotHint = h("span", "bj-spot__hint", [t("blackjack.say.bet")]);
  const spot = h("div", "bj-spot", [spotHint, stack]);
  const spotRow = h("div", "bj-spotrow", [betPlate.el, spot, win.el]);

  const banner = h("div", "bj-banner", [goldText(t("blackjack.banner"), { glow: "magenta", tag: "div", className: "bj-banner__t" }), neonText(t("blackjack.banner.sub"), { color: "gold", className: "bj-banner__s" })]);
  const shuffleEl = h("div", "bj-shuffle");
  shuffleEl.hidden = true;
  const shuffleText = neonText(t("blackjack.shuffle"), { color: "cyan", className: "bj-shuffle__t" });
  const shuffleCards = h("div", "bj-shuffle__cards");
  shuffleEl.append(shuffleCards, shuffleText);

  const tableEl = h("div", "bj-table", [
    h("div", "bj-felt"), watermark, feltArt, tray, shoe,
    h("div", "bj-zone bj-zone--dealer", [dealerHand.box]),
    h("div", "bj-zone bj-zone--player", [handsRow]),
    spotRow, banner, shuffleEl,
  ]);
  tableEl.dataset.testid = "table";
  const cab = h("div", "bj-cab", [tableEl]);

  // ---------------------------------------------------------------- dock: chips, status, buttons
  const say = h("div", "bj-say");
  const rackBtns = new Map<number, HTMLElement>();
  const rack = h("div", "bj-chips", CHIP_VALUES.map((v) => {
    const c = chip({ value: v, size: 56, testid: `chip-${v}`, aria: String(v), onTap: () => { core?.addChip(v); } });
    rackBtns.set(v, c.el);
    return c.el;
  }));
  const chipsRow = h("div", "bj-chiprow", [rack, say]);

  const btnClear = button({ label: t("blackjack.clear"), variant: "dark", size: "md", testid: "btn-clear", onTap: () => core?.clearBet() });
  const btnRebet = button({ label: t("blackjack.rebet"), variant: "violet", size: "md", testid: "btn-rebet", onTap: () => core?.rebet() });
  const btnDeal = button({ label: t("blackjack.deal"), variant: "gold", size: "md", shine: true, testid: "btn-deal", onTap: () => void core?.deal() });
  const betRow = h("div", "bj-row bj-row--bet", [btnClear, btnRebet, btnDeal]);
  const act = (a: Action) => () => { void core?.act(a); };
  const btnHit = button({ label: t("blackjack.hit"), variant: "gold", size: "md", testid: "btn-hit", onTap: act("H") });
  const btnStand = button({ label: t("blackjack.stand"), variant: "red", size: "md", testid: "btn-stand", onTap: act("S") });
  const btnDouble = button({ label: t("blackjack.double"), variant: "violet", size: "md", testid: "btn-double", onTap: act("D") });
  const btnSplit = button({ label: t("blackjack.split"), variant: "dark", size: "md", testid: "btn-split", onTap: act("P") });
  const actRow = h("div", "bj-row bj-row--act", [btnHit, btnStand, btnDouble, btnSplit]);
  const dock = h("div", "bj-dock", [chipsRow, betRow, actRow]);

  const screen = h("div", "bj", [h("div", "bj-sprite-host"), head, cab, dock]);
  screen.dataset.testid = "blackjack";
  (screen.firstElementChild as HTMLElement).innerHTML = spriteSvg();
  root.appendChild(screen);

  // ---------------------------------------------------------------- input
  const tapSound = (): void => fx.sfx.play("tap", { k: 0.6 });
  for (const b of [btnClear, btnRebet, btnDeal, btnHit, btnStand, btnDouble, btnSplit, ...rackBtns.values()]) {
    on(b, "pointerdown", (e) => { if ((e as PointerEvent).button <= 0) tapSound(); });
  }
  const KEYS: Record<string, Action> = { h: "H", s: "S", d: "D", p: "P" };
  on(window, "keydown", (e) => {
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !core || sh?.isOpen) return;
    const a = KEYS[e.key.toLowerCase()];
    if (a && core.state.legal.includes(a)) { e.preventDefault(); tapSound(); void core.act(a); return; }
    if ((e.code === "Space" || e.key === "Enter") && core.state.canDeal) { e.preventDefault(); tapSound(); void core.deal(); }
  });

  // ---------------------------------------------------------------- layout
  const relayout = (hd: HandEl): void => {
    const n = hd.cards.length;
    const W = hd.box.clientWidth || cw * 3;
    const step = n > 1 ? clamp((W - cw) / (n - 1), cw * 0.27, cw * 0.62) : 0;
    hd.cardsEl.style.width = `${(cw + step * (n - 1)).toFixed(1)}px`;
    hd.cards.forEach((el, i) => { el.style.left = `${(i * step).toFixed(1)}px`; el.style.zIndex = String(i + 1); });
    hd.cardsEl.classList.toggle("is-empty", n === 0);
  };
  const relayoutAll = (): void => { relayout(dealerHand); hands.forEach(relayout); };
  const layout = (): void => {
    const H = root.clientHeight || screen.clientHeight;
    const th = tableEl.clientHeight;
    if (!(H > 0 && th > 0)) return;
    const small = H < 560;
    screen.classList.toggle("is-small", small);
    const info = small ? 22 : 26;
    const avail = th - spotRow.offsetHeight - 2 * info - (small ? 46 : 62);
    const next = clamp(Math.floor(avail / (2 * CARD_ASPECT)), 38, 76);
    if (next !== cw) {
      cw = next;
      screen.style.setProperty("--cw", `${cw}px`);
    }
    relayoutAll();
  };
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  ro.observe(tableEl);
  offs.push(() => ro.disconnect());

  // ---------------------------------------------------------------- cards
  const makeCard = (card: number, up: boolean): HTMLElement => {
    const f = h("div", "bj-card__f");
    if (up && card >= 0) f.innerHTML = faceSvg(card);
    const b = h("div", "bj-card__b");
    b.innerHTML = backSvg();
    const el = h("div", `bj-card${up ? "" : " is-down"}`, [h("div", "bj-card__in", [f, b])]);
    return el;
  };
  const fly = (el: HTMLElement, from: DOMRect, ms: number, rot = -9): void => {
    if (ms <= 0 || !el.animate) return;
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg) scale(.5)`, opacity: 0 },
        { opacity: 1, offset: 0.14 },
        { transform: "none", opacity: 1 },
      ],
      { duration: ms, easing: "cubic-bezier(.18,.8,.25,1)" },
    );
  };
  const updateShoe = (info?: ShoeInfo): void => {
    const total = info?.total ?? 312;
    const left = clamp(1 - shoePos / total, 0, 1);
    shoeFill.style.transform = `scaleY(${left.toFixed(3)})`;
    trayFill.style.transform = `scaleY(${clamp(shoePos / total, 0, 1).toFixed(3)})`;
    if (info) {
      shoeCut.style.bottom = `${((1 - info.cut / total) * 100).toFixed(1)}%`;
      shoeLabel.textContent = `${t("blackjack.shoe")} ${info.no}`;
    }
  };

  const totalText = (total: number, soft: boolean): string => {
    if (total > 21) return t("blackjack.res.bust");
    return soft && total < 21 ? `${total - 10}/${total}` : String(total);
  };

  // ---------------------------------------------------------------- bet stack
  let stackFor = -1;
  const renderStack = (amount: number): void => {
    if (amount === stackFor) return;
    stackFor = amount;
    const list = chipsFor(amount);
    const piles = new Map<number, number>();
    for (const v of list) piles.set(v, (piles.get(v) ?? 0) + 1);
    stack.replaceChildren(...[...piles.entries()].map(([v, n]) => {
      const pile = h("span", "bj-pile");
      pile.dataset.value = String(v);
      pile.style.setProperty("--n", String(Math.min(n, 6)));
      for (let i = 0; i < Math.min(n, 6); i++) {
        const c = h("span", "bj-pile__chip", [chipArt(v, i === Math.min(n, 6) - 1 ? undefined : "")]);
        c.style.setProperty("--i", String(i));
        pile.append(c);
      }
      return pile;
    }));
    spotHint.hidden = amount > 0;
  };

  // ---------------------------------------------------------------- core → screen
  const render = (st: BjState4Ui): void => {
    const betting = st.phase === "bet";
    screen.dataset.phase = st.phase;
    betRow.hidden = !betting;
    actRow.hidden = betting;
    renderStack(betting ? st.bet : 0);
    spotHint.hidden = st.bet > 0 || !betting;
    betPlate.set(st.bet);
    if (betting) {
      for (const [v, el] of rackBtns) (el as HTMLButtonElement).disabled = !st.chipOk[v];
      btnClear.disabled = !st.canClear;
      btnRebet.disabled = !st.canRebet;
      btnDeal.disabled = !st.canDeal;
      say.textContent = "";
    } else {
      const can = (a: Action): boolean => st.phase === "player" && st.legal.includes(a);
      btnHit.disabled = !can("H");
      btnStand.disabled = !can("S");
      btnDouble.disabled = !can("D");
      btnSplit.disabled = !can("P");
      say.textContent = st.phase === "player" ? t("blackjack.say.player") : st.phase === "deal" ? t("blackjack.say.deal") : t("blackjack.say.act");
    }
    rack.classList.toggle("is-away", !betting);
    say.classList.toggle("is-on", !betting);
    if (st.phase === "deal" && !tableEl.classList.contains("is-dealing")) {
      winProxy.textContent = "0";
      win.el.classList.add("is-zero");
    }
    tableEl.classList.toggle("is-dealing", st.phase !== "bet");
    if (betting) shoePos = st.shoe.pos;
    updateShoe(st.shoe);
  };

  let sh: Overlay | null = null;
  const showSheet = (): void => {
    if (sh?.isOpen) return;
    sh = sheet({
      title: t("blackjack.short.title"),
      body: [h("p", "bj-sheet__body", [t("blackjack.short.body", { min: fmtCredits(MIN_BET.blackjack) })])],
      actions: [
        button({ label: t("blackjack.short.lobby"), variant: "violet", icon: "grid", testid: "short-lobby", onTap: () => { sh?.close(); ctx.nav.toLobby(); } }),
        button({ label: t("blackjack.short.cashout"), variant: "red", testid: "short-cashout", onTap: () => { sh?.close(); ctx.nav.requestCashout("cashout"); } }),
      ],
      testid: "sheet-short",
    });
    sh.open();
  };

  const nudge = (el: HTMLElement): void => {
    el.classList.remove("is-nudge");
    void el.offsetWidth;
    el.classList.add("is-nudge");
  };

  const sweepOut = (ms: number): void => {
    const els = [...dealerHand.cards, ...hands.flatMap((x) => x.cards)];
    const to = tray.getBoundingClientRect();
    for (const el of els) {
      if (ms > 0 && el.animate) {
        const r = el.getBoundingClientRect();
        const dx = to.left + to.width / 2 - (r.left + r.width / 2);
        const dy = to.top + to.height / 2 - (r.top + r.height / 2);
        const a = el.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) rotate(14deg) scale(.45)`, opacity: 0 }], { duration: ms, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" });
        a.onfinish = () => el.remove();
      } else el.remove();
    }
    dealerHand.cards.length = 0;
    for (const hd of hands) hd.cards.length = 0;
    // back to one empty hand
    while (hands.length > 1) hands.pop()!.box.remove();
    dealerHand.box.classList.add("is-idle");
    for (const hd of [dealerHand, ...hands]) {
      hd.total.hidden = true;
      hd.bet.hidden = true;
      hd.tag.hidden = true;
      hd.box.classList.remove("is-active", "is-win", "is-lose", "is-push");
    }
    handsRow.classList.remove("is-split");
    relayoutAll();
  };

  const view: BjView = {
    winEl: winProxy,
    tableEl,
    render,
    shuffle(info, ms) {
      shoePos = 0;
      shoeFill.style.transition = ms > 0 ? "transform 900ms var(--ease-out) 700ms" : "none";
      trayFill.style.transition = ms > 0 ? "transform 700ms var(--ease-out)" : "none";
      updateShoe(info);
      if (ms <= 0) return;
      shuffleEl.hidden = false;
      shuffleEl.classList.add("is-on");
      shuffleCards.replaceChildren();
      const N = 14;
      for (let i = 0; i < N; i++) {
        const side = i % 2 ? 1 : -1;
        const c = h("div", "bj-shuffle__card");
        c.innerHTML = backSvg();
        shuffleCards.append(c);
        if (c.animate) {
          const d = (i >> 1) * 90;
          c.animate(
            [
              { transform: `translate(${side * 62}px, ${(i % 3) * 3 - 3}px) rotate(${-side * 4}deg)`, opacity: 0 },
              { transform: `translate(${side * 62}px, ${(i % 3) * 3 - 3}px) rotate(${-side * 4}deg)`, opacity: 1, offset: 0.08 },
              { transform: `translate(${side * 4}px, ${-i * 1.2}px) rotate(${side * 3}deg)`, opacity: 1, offset: 0.5 },
              { transform: `translate(0, ${-i * 1.2}px) rotate(0deg)`, opacity: 1, offset: 0.66 },
              { transform: `translate(${(shoe.getBoundingClientRect().left - shuffleCards.getBoundingClientRect().left) * 0.6}px, ${-70 - i}px) rotate(18deg) scale(.5)`, opacity: 0 },
            ],
            { duration: ms - 160, delay: d * 0.55, easing: "ease-in-out", fill: "both" },
          );
        }
      }
      void clock.wait(ms).then(() => { shuffleEl.hidden = true; shuffleEl.classList.remove("is-on"); shoeFill.style.transition = ""; trayFill.style.transition = ""; });
    },
    move(m: Move) {
      switch (m.k) {
        case "card": {
          const hd = m.to === "dealer" ? dealerHand : ensureHand(m.hand);
          const el = makeCard(m.card, m.up);
          if (m.dbl) el.classList.add("is-dbl");
          hd.cards.push(el);
          hd.cardsEl.append(el);
          relayout(hd);
          fly(el, shoe.getBoundingClientRect(), m.ms);
          shoePos++;
          updateShoe();
          break;
        }
        case "flip": {
          const el = dealerHand.cards[1];
          if (!el) break;
          (el.querySelector(".bj-card__f") as HTMLElement).innerHTML = faceSvg(m.card);
          el.classList.remove("is-down");
          const inner = el.firstElementChild as HTMLElement;
          if (m.ms > 0 && inner.animate) {
            inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: m.ms, easing: "cubic-bezier(.3,.1,.2,1)" });
            el.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-9px) scale(1.1)", offset: 0.45 }, { transform: "none" }], { duration: m.ms, easing: "ease-in-out" });
          }
          break;
        }
        case "split": {
          const first = hands[0];
          const el = first.cards.pop();
          const second = ensureHand(1);
          if (!el) break;
          const from = el.getBoundingClientRect();
          second.cards.push(el);
          second.cardsEl.append(el);
          relayoutAll();
          if (m.ms > 0 && el.animate) {
            const to = el.getBoundingClientRect();
            el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "translateY(-12px)", offset: 0.5 }, { transform: "none" }], { duration: m.ms, easing: "cubic-bezier(.2,.8,.25,1)" });
          }
          break;
        }
        case "sweep":
          sweepOut(m.ms);
          break;
      }
    },
    table(v: TableVm) {
      dealerHand.box.classList.toggle("is-idle", v.dealerCards === 0);
      if (v.dealerCards > 0) {
        dealerHand.total.hidden = false;
        dealerHand.total.textContent = totalText(v.dealerTotal, v.dealerSoft);
        dealerHand.total.classList.toggle("is-bust", v.dealerTotal > 21);
        dealerHand.total.classList.toggle("is-21", v.dealerTotal === 21);
      } else dealerHand.total.hidden = true;
      v.hands.forEach((hv, i) => {
        const hd = ensureHand(i);
        hd.total.hidden = hv.cards === 0;
        hd.total.textContent = totalText(hv.total, hv.soft);
        hd.total.classList.toggle("is-bust", hv.total > 21);
        hd.total.classList.toggle("is-21", hv.total === 21);
        hd.box.classList.toggle("is-active", hv.active && v.hands.length > 1);
        hd.total.classList.toggle("is-active", hv.active);
        hd.bet.hidden = hv.bet <= 0;
        if (hv.bet > 0) {
          const top = chipsFor(hv.bet)[0] ?? 20;
          if (hd.betChip.dataset.v !== String(top)) { hd.betChip.dataset.v = String(top); hd.betChip.replaceChildren(chipArt(top, "")); }
          hd.betAmt.textContent = fmtCredits(hv.bet);
          hd.bet.classList.toggle("is-doubled", hv.doubled);
        }
      });
    },
    result(r: ResultVm) {
      r.hands.forEach((hr, i) => {
        const hd = hands[i];
        if (!hd) return;
        const kind = hr.res === "bj" || hr.res === "win" ? "win" : hr.res === "push" ? "push" : "lose";
        hd.box.classList.add(`is-${kind}`);
        hd.tag.className = `bj-tag bj-tag--${kind}${hr.res === "bj" ? " is-bj" : ""}`;
        hd.tag.replaceChildren(h("span", "bj-tag__t", [t(`blackjack.res.${hr.res}`)]));
        if (hr.pay > hr.bet) hd.tag.append(h("span", "bj-tag__a", [`+${fmtCredits(hr.pay - hr.bet)}`]));
        hd.tag.hidden = false;
        hd.total.classList.remove("is-active");
        hd.box.classList.remove("is-active");
      });
      if (r.payout > 0) {
        win.el.classList.remove("is-zero");
        winProxy.textContent = fmtCredits(r.payout);
      }
    },
    flourish() {
      banner.classList.remove("is-on");
      void banner.offsetWidth;
      banner.classList.add("is-on");
      void clock.wait(2100).then(() => banner.classList.remove("is-on"));
    },
    short(kind) {
      if (kind === "sheet") { showSheet(); return; }
      nudge(betPlate.el);
    },
    bind(c) {
      core = c;
      render(c.state);
      layout();
    },
    destroy() {
      for (const f of offs.splice(0)) f();
      mo.disconnect();
      sh?.close();
      screen.remove();
      core = null;
    },
  };
  return view;
}
