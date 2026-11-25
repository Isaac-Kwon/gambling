import { describe, expect, it } from "vitest";
import { bjAct, bjDeal, cardFromStr, newShoe, type BjState, type Shoe } from "../../../shared/rules/blackjack";
import { createRng } from "../../../shared/rng";
import { affordableBet, emptyShown, handPay, initialMoves, movesFor, type Shown } from "./core";
import { chipsFor, faceSvg, backSvg } from "./art";

/** A shoe whose first cards are exactly `order` (then filler). */
function rigged(order: string[]): Shoe {
  const s = newShoe(1, createRng("rig", "t"));
  const head = order.map(cardFromStr);
  const rest = s.cards.filter((c) => { const i = head.indexOf(c); if (i >= 0) { head[i] = -1; return false; } return true; });
  return { ...s, cards: [...order.map(cardFromStr), ...rest] };
}

const apply = (shown: Shown, m: ReturnType<typeof movesFor>): Shown => {
  const out: Shown = { dealer: shown.dealer.slice(), holeUp: shown.holeUp, hands: shown.hands.map((h) => h.slice()) };
  for (const x of m) {
    if (x.k === "card") (x.to === "dealer" ? out.dealer : out.hands[x.hand]).push(x.card);
    else if (x.k === "flip") { out.dealer[1] = x.card; out.holeUp = true; }
    else if (x.k === "split") { const c = out.hands[0].pop() as number; out.hands.push([c]); }
  }
  return out;
};

describe("blackjack core: table moves", () => {
  it("deals player, dealer up, player, hole (face down, value not sent)", () => {
    const st = bjDeal(rigged(["8h", "6s", "8d", "Kh", "3c", "Td"]), 100);
    const m = initialMoves(st);
    expect(m.map((x) => (x.k === "card" ? [x.to, x.card, x.up] : x.k))).toEqual([
      ["hand", cardFromStr("8h"), true], ["dealer", cardFromStr("6s"), true], ["hand", cardFromStr("8d"), true], ["dealer", -1, false],
    ]);
  });

  it("a split moves the second card, deals one to the first hand and none to the second until its turn", () => {
    let st = bjDeal(rigged(["8h", "6s", "8d", "Kh", "3c", "Td", "2s", "9c", "4d"]), 100);
    let shown = apply(emptyShown(), initialMoves(st));
    st = bjAct(st, "P");
    const m = movesFor(shown, st);
    expect(m.map((x) => x.k)).toEqual(["split", "card"]);
    shown = apply(shown, m);
    expect(shown.hands.map((h) => h.length)).toEqual([2, 1]);
    st = bjAct(st, "S");   // first hand stands → second hand gets its card
    const m2 = movesFor(shown, st);
    expect(m2[0]).toMatchObject({ k: "card", to: "hand", hand: 1 });
  });

  it("when the player's turn ends the hole is flipped, then the dealer draws in order", () => {
    let st = bjDeal(rigged(["Tc", "6s", "6d", "Kh", "5c", "Td"]), 100);   // dealer 16 draws
    let shown = apply(emptyShown(), initialMoves(st));
    st = bjAct(st, "S");
    const m = movesFor(shown, st);
    expect(m[0].k).toBe("flip");
    expect(m.slice(1).every((x) => x.k === "card" && x.to === "dealer")).toBe(true);
    shown = apply(shown, m);
    expect(shown.dealer.map(String)).toEqual(st.dealer.map(String));
  });

  it("a doubled card is marked", () => {
    let st: BjState = bjDeal(rigged(["5c", "6s", "6d", "Kh", "9c", "Td"]), 100);
    const shown = apply(emptyShown(), initialMoves(st));
    st = bjAct(st, "D");
    const m = movesFor(shown, st, 0);
    expect(m[0]).toMatchObject({ k: "card", to: "hand", dbl: true });
  });
});

describe("blackjack core: small pure helpers", () => {
  it("handPay mirrors the settlement (3:2, win, push, nothing)", () => {
    expect(handPay("bj", 100)).toBe(250);
    expect(handPay("win", 100)).toBe(200);
    expect(handPay("push", 100)).toBe(100);
    expect(handPay("lose", 100)).toBe(0);
    expect(handPay("bust", 100)).toBe(0);
  });
  it("affordableBet floors to the unit and respects limits", () => {
    expect(affordableBet(10_000, 140)).toBe(140);
    expect(affordableBet(95, 500)).toBe(80);
    expect(affordableBet(19, 100)).toBe(0);
    expect(affordableBet(1e9, 5000)).toBe(2000);
  });
  it("chip stacks use the table chips and card art covers all 52 faces plus the back", () => {
    expect(chipsFor(620)).toEqual([500, 100, 20]);
    expect(chipsFor(40)).toEqual([20, 20]);
    for (let c = 0; c < 52; c++) expect(faceSvg(c)).toContain("<svg");
    expect(new Set(Array.from({ length: 52 }, (_, c) => faceSvg(c))).size).toBe(52);
    expect(backSvg()).toContain("OROBELLE");
  });
});
