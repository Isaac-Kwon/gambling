/**
 * The ABYSS LEGEND cabinet frame (ARCHITECTURE §3), code-drawn DOM + CSS: a back-lit marquee sign with chase
 * bulbs, LED read-outs (Press Start 2P), a chrome bezel around the screen (underwater backdrop, static scanlines
 * and vignette), a deck with the coin slot (decor), the TURBO switch and the ticket mouth, and the control panel
 * with three round arcade buttons BET / START / STOP — the real controls, in the thumb zone.
 * Static structure only; the view wires it up.
 */
import { goldText, h } from "../../src/ui/index";

export interface Cabinet {
  root: HTMLElement;
  sign: HTMLElement;
  lamp: HTMLElement;
  ledCredit: HTMLElement;
  ledBet: HTMLElement;
  ledWin: HTMLElement;
  bezel: HTMLElement;
  screen: HTMLElement;
  /** Holds the reels window, win lines and glass. */
  stage: HTMLElement;
  bonus: { el: HTMLElement; amt: HTMLElement; chain: HTMLElement };
  deck: HTMLElement;
  turbo: HTMLButtonElement;
  mouth: HTMLElement;
  panel: HTMLElement;
  btnBet: HTMLButtonElement;
  btnStart: HTMLButtonElement;
  btnStop: HTMLButtonElement;
}

const led = (label: string, cls: string, tone = "") => {
  const v = h("span", `ocean-led__v ui-led ${tone}`, ["0"]);
  return { el: h("div", `ocean-led ${cls}`, [h("span", "ocean-led__k", [label]), v]), v };
};

/** Round arcade push button: chrome ring, coloured dome, label under the dome. */
function arcadeButton(o: { label: string; tone: "y" | "r" | "b"; size: "md" | "lg"; testid: string }): HTMLButtonElement {
  const b = h("button", `ocean-ab ocean-ab--${o.tone} ocean-ab--${o.size}`, [
    h("span", "ocean-ab__ring", [h("span", "ocean-ab__cap", [h("span", "ocean-ab__shine")])]),
    h("span", "ocean-ab__label", [o.label]),
  ]);
  b.type = "button";
  b.dataset.testid = o.testid;
  return b;
}

export function buildCabinet(t: (k: string) => string): Cabinet {
  // ---- marquee sign
  const bulbs = h("div", "ocean-sign__bulbs", [h("i", "ocean-sign__chase"), h("i", "ocean-sign__chase ocean-sign__chase--b")]);
  const ko = goldText(t("ocean.title"), { glow: "cyan", tag: "h1", className: "ocean-sign__ko" });
  const en = h("div", "ocean-sign__en", [t("ocean.sub")]);
  const lamp = h("div", "ocean-lamp", [h("span", "ocean-lamp__bulb"), h("span", "ocean-lamp__label", [t("ocean.bonus")])]);
  lamp.dataset.testid = "ocean-lamp";
  const fish = (side: string) => h("i", `ocean-sign__fish ocean-sign__fish--${side}`);
  const sign = h("div", "ocean-sign", [
    h("div", "ocean-sign__glow"), bulbs,
    h("div", "ocean-sign__row", [fish("l"), h("div", "ocean-sign__text", [ko, en]), fish("r")]),
  ]);

  // ---- LED meters
  const credit = led(t("ocean.credit"), "ocean-led--credit", "ui-led--teal");
  const bet = led(t("ocean.bet"), "ocean-led--bet");
  const win = led(t("ocean.win"), "ocean-led--win");
  credit.el.dataset.testid = "ocean-credit";
  win.el.dataset.testid = "win";
  const leds = h("div", "ocean-leds", [credit.el, bet.el, win.el]);

  // ---- bezel + screen
  const stage = h("div", "ocean-stage");
  const bonusAmt = h("span", "ocean-bonus__amt");
  const bonusChain = h("span", "ocean-bonus__chain");
  const bonus = h("div", "ocean-bonus", [h("span", "ocean-bonus__k", [t("ocean.bonus")]), bonusAmt, bonusChain]);
  bonus.dataset.testid = "ocean-bonus";
  bonus.hidden = true;
  const bubbles = h("div", "ocean-bg__bubbles");
  for (let i = 0; i < 10; i++) {
    const b = h("i", "ocean-bg__bubble");
    b.style.setProperty("--x", `${6 + ((i * 37) % 88)}%`);
    b.style.setProperty("--d", `${-((i * 1.3) % 7).toFixed(1)}s`);
    b.style.setProperty("--z", `${(0.45 + ((i * 5) % 7) / 9).toFixed(2)}`);
    b.style.setProperty("--t", `${(5.5 + ((i * 3) % 5)).toFixed(1)}s`);
    bubbles.append(b);
  }
  const bg = h("div", "ocean-bg", [
    h("i", "ocean-bg__shaft"), h("i", "ocean-bg__shaft ocean-bg__shaft--2"), h("i", "ocean-bg__shaft ocean-bg__shaft--3"),
    h("i", "ocean-bg__floor"), bubbles,
  ]);
  const screen = h("div", "ocean-screen", [bg, stage, bonus, h("div", "ocean-scan")]);
  screen.dataset.testid = "ocean-screen";
  const bolts = [0, 1, 2, 3].map((i) => h("i", `ocean-bezel__bolt ocean-bezel__bolt--${i}`));
  const bezel = h("div", "ocean-bezel", [...bolts, lamp, screen]);

  // ---- deck: coin slot · TURBO · ticket mouth
  const coin = h("div", "ocean-coin", [h("span", "ocean-coin__slot", [h("i")]), h("span", "ocean-coin__label", [t("ocean.coin")])]);
  const turbo = h("button", "ocean-turbo", [h("span", "ocean-turbo__lamp"), h("span", "ocean-turbo__label", [t("ocean.turbo")])]);
  turbo.type = "button";
  turbo.dataset.testid = "btn-turbo";
  turbo.setAttribute("aria-pressed", "false");
  const mouth = h("div", "ocean-mouth", [h("span", "ocean-mouth__label", [t("ocean.ticket")]), h("span", "ocean-mouth__slit")]);
  const deck = h("div", "ocean-deck", [coin, turbo, mouth]);

  const cab = h("div", "ocean-cab", [leds, bezel, deck]);

  // ---- control panel
  const btnBet = arcadeButton({ label: t("ocean.bet"), tone: "y", size: "md", testid: "btn-bet" });
  const btnStart = arcadeButton({ label: t("ocean.start"), tone: "r", size: "lg", testid: "btn-spin" });
  const btnStop = arcadeButton({ label: t("ocean.stop"), tone: "b", size: "md", testid: "btn-stop" });
  const panel = h("div", "ocean-panel", [
    h("i", "ocean-panel__screw ocean-panel__screw--l"), h("i", "ocean-panel__screw ocean-panel__screw--r"),
    btnBet, btnStart, btnStop,
  ]);

  const root = h("div", "ocean", [sign, cab, panel]);
  root.dataset.testid = "ocean";
  return {
    root, sign, lamp, ledCredit: credit.v, ledBet: bet.v, ledWin: win.v, bezel, screen, stage,
    bonus: { el: bonus, amt: bonusAmt, chain: bonusChain }, deck, turbo, mouth, panel,
    btnBet, btnStart, btnStop,
  };
}
