import { describe, expect, it } from "vitest";
import { createRng, createStreams } from "../rng";
import {
  BJ, CUT_POS, SHOE_CARDS, basicPolicy, bjAct, bjDeal, bjLegal, bjOut, bjSettle, bjView, cardFromStr, cardStr, cardValue,
  handValue, hiLo, needsShuffle, newShoe, optimalAction, playRound, restoreShoe, simulateBj, trueCount,
  type Action, type BjPolicy, type BjState, type HandView, type Shoe,
} from "./blackjack";

const C = cardFromStr;
const cards = (s: string) => s.split(" ").map(C);
/** A shoe whose first cards are `s` (deal order: player, up, player, hole, then draws). */
const stacked = (s: string): Shoe => ({ no: 7, cards: cards(s), pos: 0, rc: 0 });
const view = (s: string, o: { double?: boolean; split?: boolean; fromSplit?: boolean } = {}): HandView =>
  ({ cards: cards(s), fromSplit: o.fromSplit ?? false, can: { double: o.double ?? true, split: o.split ?? true } });
const prefixCount = (sh: Shoe, n: number) => { let rc = 0; for (let i = 0; i < n; i++) rc += hiLo(sh.cards[i]); return rc; };
const play = (st: BjState, ...acts: Action[]) => acts.reduce((s, a) => bjAct(s, a), st);
const rr = createStreams("bj-test").res("blackjack");

describe("cards and shoe", () => {
  it("card helpers", () => {
    for (let c = 0; c < 52; c++) expect(C(cardStr(c))).toBe(c);
    expect(cardStr(0)).toBe("As");
    expect(cardStr(12)).toBe("Ks");
    expect(cardStr(13 + 9)).toBe("Th");
    expect([0, 1, 5, 6, 8, 9, 12].map(cardValue)).toEqual([1, 2, 6, 7, 9, 10, 10]);
    expect([0, 1, 5, 6, 8, 9, 12].map(hiLo)).toEqual([-1, 1, 1, 0, 0, -1, -1]);
    expect(() => C("1s")).toThrow();
  });

  it("312-card shoe: every card id exactly 6 times, balanced Hi-Lo, order from at(no) only", () => {
    const s = newShoe(3, rr.at(3));
    expect(SHOE_CARDS).toBe(312);
    expect(s.cards).toHaveLength(312);
    const n = new Array(52).fill(0);
    for (const c of s.cards) n[c]++;
    expect(n.every((k) => k === 6)).toBe(true);
    expect(prefixCount(s, 312)).toBe(0);
    expect(s).toMatchObject({ no: 3, pos: 0, rc: 0 });
    expect(newShoe(3, rr.at(3)).cards).toEqual(s.cards);
    expect(newShoe(4, rr.at(4)).cards).not.toEqual(s.cards);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("cut card at 75% (234), checked only between rounds", () => {
    expect(CUT_POS).toBe(234);
    const s = newShoe(1, rr.at(1));
    expect(needsShuffle({ ...s, pos: 233 })).toBe(false);
    expect(needsShuffle({ ...s, pos: 234 })).toBe(true);
  });

  it("handValue", () => {
    expect(handValue(cards("As 6d"))).toEqual({ total: 17, soft: true });
    expect(handValue(cards("As 6d Th"))).toEqual({ total: 17, soft: false });
    expect(handValue(cards("As Ad"))).toEqual({ total: 12, soft: true });
    expect(handValue(cards("As Ad 9c"))).toEqual({ total: 21, soft: true });
    expect(handValue(cards("Ts 6d 8c"))).toEqual({ total: 24, soft: false });
    expect(handValue(cards("Ks Qd"))).toEqual({ total: 20, soft: false });
  });

  it("trueCount = rc / remaining decks, rounded to 0.5", () => {
    const s = newShoe(1, rr.at(1));
    expect(trueCount({ ...s, pos: 104, rc: 5 })).toBe(1.5);    // 5 / 4 = 1.25
    expect(trueCount({ ...s, pos: 104, rc: -5 })).toBe(-1.5);
    expect(trueCount({ ...s, pos: 104, rc: 4 })).toBe(1);
    expect(trueCount({ ...s, pos: 0, rc: 3 })).toBe(0.5);       // 3 / 6
    expect(trueCount({ ...s, pos: 208, rc: 7 })).toBe(3.5);
    expect(Object.is(trueCount({ ...s, pos: 0, rc: -1 }), 0)).toBe(true);   // -1/6 rounds to 0, not -0
  });

  it("restoreShoe rebuilds (cards, rc) from (no, pos)", () => {
    const s = restoreShoe(2, rr.at(2), 100);
    expect(s.cards).toEqual(newShoe(2, rr.at(2)).cards);
    expect(s.rc).toBe(prefixCount(s, 100));
  });
});

// §9.2, transcribed independently of the implementation. Columns: dealer 2 3 4 5 6 7 8 9 T A.
const UP = ["2c", "3c", "4c", "5c", "6c", "7c", "8c", "9c", "Tc", "Ac"];
const HARD: Record<number, string> = {
  5: "HHHHHHHHHH", 6: "HHHHHHHHHH", 7: "HHHHHHHHHH", 8: "HHHHHHHHHH",
  9: "HDDDDHHHHH", 10: "DDDDDDDDHH", 11: "DDDDDDDDDH", 12: "HHSSSHHHHH",
  13: "SSSSSHHHHH", 14: "SSSSSHHHHH", 15: "SSSSSHHHHH", 16: "SSSSSHHHHH",
  17: "SSSSSSSSSS", 18: "SSSSSSSSSS", 19: "SSSSSSSSSS", 20: "SSSSSSSSSS", 21: "SSSSSSSSSS",
};
const SOFT: Record<number, string> = {
  13: "HHHDDHHHHH", 14: "HHHDDHHHHH", 15: "HHDDDHHHHH", 16: "HHDDDHHHHH", 17: "HDDDDHHHHH",
  18: "SddddSSHHH", 19: "SSSSSSSSSS", 20: "SSSSSSSSSS", 21: "SSSSSSSSSS",
};
const PAIRS: [string, string][] = [
  ["2s 2d", "PPPPPPHHHH"], ["3s 3d", "PPPPPPHHHH"], ["4s 4d", "HHHPPHHHHH"], ["5s 5d", "DDDDDDDDHH"],
  ["6s 6d", "PPPPPHHHHH"], ["7s 7d", "PPPPPPHHHH"], ["8s 8d", "PPPPPPPPPP"], ["9s 9d", "PPPPPSPPSS"],
  ["Ts Td", "SSSSSSSSSS"], ["As Ad", "PPPPPPPPPP"],
];
/** Two-card (where possible) representative of a hard total, never a pair. */
const hardHand = (t: number) => (t <= 11 ? `2s ${t - 2}d` : t <= 19 ? `Ts ${t === 20 ? "T" : t - 10}d` : t === 20 ? "Ts Kd" : "Ts 5d 6h")
  .replace(" 10d", " Td").replace(" 1d", " Ad");
const softHand = (t: number) => (t <= 20 ? `As ${t - 11 === 10 ? "T" : t - 11}d` : "As 5d 5h");
/** Expected action from a chart cell given whether doubling is allowed. */
const cell = (c: string, canDouble: boolean): Action => (c === "D" ? (canDouble ? "D" : "H") : c === "d" ? (canDouble ? "D" : "S") : (c as Action));

describe("optimalAction = §9.2 chart, every cell", () => {
  it("hard 5–21 × 10 dealer cards (two-card hands; hard 20 = T,K with split off; hard 21 = 3 cards)", () => {
    for (let t = 5; t <= 21; t++) {
      const h = view(hardHand(t), { split: false });
      expect(handValue(h.cards)).toEqual({ total: t, soft: false });
      const twoCards = h.cards.length === 2;
      UP.forEach((u, i) => expect([t, u, optimalAction(h, C(u))]).toEqual([t, u, cell(HARD[t][i], twoCards)]));
    }
  });
  it("soft 13–21 × 10 dealer cards (soft 21 = A,5,5)", () => {
    for (let t = 13; t <= 21; t++) {
      const h = view(softHand(t));
      expect(handValue(h.cards)).toEqual({ total: t, soft: true });
      const twoCards = h.cards.length === 2;
      UP.forEach((u, i) => expect([t, u, optimalAction(h, C(u))]).toEqual([t, u, cell(SOFT[t][i], twoCards)]));
    }
  });
  it("10 pair types × 10 dealer cards", () => {
    for (const [p, row] of PAIRS) UP.forEach((u, i) => expect([p, u, optimalAction(view(p), C(u))]).toEqual([p, u, row[i]]));
  });
  it("ten-value pairs of different ranks (K,Q) are the T,T row", () => {
    UP.forEach((u) => expect(optimalAction(view("Ks Qd"), C(u))).toBe("S"));
  });
  it("default rules argument is BJ", () => {
    expect(optimalAction(view("6s 5d"), C("6c"), BJ)).toBe(optimalAction(view("6s 5d"), C("6c")));
  });
});

describe("optimalAction fallbacks", () => {
  it("double not allowed: D → H, soft 18's d → S", () => {
    const noD = { double: false };
    expect(optimalAction(view("6s 5d", noD), C("6c"))).toBe("H");
    expect(optimalAction(view("2s 7d", noD), C("4c"))).toBe("H");
    expect(optimalAction(view("As 6d", noD), C("4c"))).toBe("H");
    expect(optimalAction(view("As 7d", noD), C("4c"))).toBe("S");
    expect(optimalAction(view("As 7d", noD), C("9c"))).toBe("H");
    // three-card hands can never double
    expect(optimalAction(view("As 2d 5h"), C("5c"))).toBe("S");   // soft 18 vs 5
    expect(optimalAction(view("2s 3d 6h"), C("6c"))).toBe("H");   // hard 11 vs 6
    expect(optimalAction(view("As 2d 2h"), C("5c"))).toBe("H");   // soft 15 vs 5
  });
  it("split not allowed: same total's hard/soft row (A,A = soft 12 = H)", () => {
    const noP = { split: false };
    UP.forEach((u) => expect(optimalAction(view("As Ad", noP), C(u))).toBe("H"));
    expect(optimalAction(view("5s 5d", noP), C("6c"))).toBe("D");
    expect(optimalAction(view("8s 8d", noP), C("9c"))).toBe("H");
    expect(optimalAction(view("8s 8d", noP), C("6c"))).toBe("S");
    expect(optimalAction(view("4s 4d", noP), C("5c"))).toBe("H");
    expect(optimalAction(view("2s 2d", noP), C("4c"))).toBe("H");
    expect(optimalAction(view("9s 9d", noP), C("6c"))).toBe("S");
    expect(optimalAction(view("6s 6d", noP), C("4c"))).toBe("S");
    expect(optimalAction(view("7s 7d", noP), C("7c"))).toBe("H");
  });
  it("after a split: no resplit, double allowed (DAS)", () => {
    expect(optimalAction(view("8s 8d", { fromSplit: true }), C("Tc"))).toBe("H");
    expect(optimalAction(view("8s 8d", { fromSplit: true }), C("5c"))).toBe("S");
    expect(optimalAction(view("8s 3d", { fromSplit: true }), C("Tc"))).toBe("D");
    expect(optimalAction(view("As 7d", { fromSplit: true }), C("5c"))).toBe("D");
  });
});

describe("round engine", () => {
  it("player natural pays 3:2; hole card is counted when shown", () => {
    const st = bjDeal(stacked("As 9h Kd 7c"), 20);
    expect(st.phase).toBe("done");
    expect(st.holeShown).toBe(true);
    expect(st.shoe.rc).toBe(-2);
    expect(bjLegal(st, () => true)).toEqual([]);
    expect(bjSettle(st)).toEqual({ payout: 50, totalBet: 20, hands: [{ cards: cards("As Kd"), bet: 20, res: "bj" }] });
  });

  it("dealer natural found by the peek (A up and T up): round ends, player loses only the bet", () => {
    for (const [up, hole] of [["Ad", "Kc"], ["Qd", "Ac"]]) {
      const st = bjDeal(stacked(`Ts ${up} 9h ${hole} 5s 5s`), 20);
      expect(st.phase).toBe("done");
      expect(st.dealerBj).toBe(true);
      expect(st.dealer).toHaveLength(2);
      expect(bjSettle(st)).toMatchObject({ payout: 0, totalBet: 20, hands: [{ res: "lose" }] });
    }
  });

  it("both naturals push", () => {
    expect(bjSettle(bjDeal(stacked("As Ad Kh Kc"), 20))).toMatchObject({ payout: 20, totalBet: 20, hands: [{ res: "push" }] });
  });

  it("peek with no natural continues; up card and player cards counted, hole not yet", () => {
    const st = bjDeal(stacked("Ts Td 6h 9c"), 20);
    expect(st.phase).toBe("player");
    expect(st.dealerBj).toBe(false);
    expect(st.shoe.rc).toBe(-1 - 1 + 1);
    expect(st.start).toBe(0);
    expect(st.shoe.pos).toBe(4);
    expect(bjLegal(st, () => true)).toEqual(["H", "S", "D"]);
    expect(bjLegal(st, () => false)).toEqual(["H", "S"]);
    expect(bjView(st)).toEqual({ cards: cards("Ts 6h"), fromSplit: false, can: { double: true, split: false } });
  });

  it("double: one card, bet doubled", () => {
    const st = play(bjDeal(stacked("6s 6d 5h Td 9c 7s"), 20), "D");
    expect(st.phase).toBe("done");
    expect(st.dealer.map(cardStr)).toEqual(["6d", "Td", "7s"]);
    expect(bjSettle(st)).toEqual({ payout: 80, totalBet: 40, hands: [{ cards: cards("6s 5h 9c"), bet: 40, res: "win" }] });
  });

  it("split aces: one card each, A+K after a split is 21 but not a natural (pays 1:1)", () => {
    const st0 = bjDeal(stacked("As 6s Ad Ts Kh 9c 2h"), 20);
    expect(bjLegal(st0, () => true)).toEqual(["H", "S", "D", "P"]);
    const st = bjAct(st0, "P");
    expect(st.phase).toBe("done");
    expect(st.hands.map((h) => h.cards.map(cardStr))).toEqual([["As", "Kh"], ["Ad", "9c"]]);
    expect(st.dealer.map(cardStr)).toEqual(["6s", "Ts", "2h"]);
    expect(bjSettle(st)).toMatchObject({ payout: 80, totalBet: 40, hands: [{ res: "win", bet: 20 }, { res: "win", bet: 20 }] });
  });

  it("split once only, double after split, second hand gets its card when its turn comes", () => {
    let st = bjAct(bjDeal(stacked("8s 6c 8h Tc 8d 3s Ts 5h"), 20), "P");
    expect(st.hands.map((h) => h.cards.length)).toEqual([2, 1]);
    expect(bjLegal(st, () => true)).toEqual(["H", "S", "D"]);   // 8,8 again: no resplit
    st = bjAct(st, "S");
    expect(st.hands[1].cards.map(cardStr)).toEqual(["8h", "3s"]);
    expect(bjLegal(st, () => true)).toEqual(["H", "S", "D"]);
    st = bjAct(st, "D");
    expect(st.phase).toBe("done");
    expect(handValue(st.dealer).total).toBe(21);
    expect(bjSettle(st)).toMatchObject({ payout: 40, totalBet: 60, hands: [{ res: "lose", bet: 20 }, { res: "push", bet: 40 }] });
  });

  it("S17: dealer stands on soft 17, hits 16", () => {
    const soft17 = play(bjDeal(stacked("Ts Ac 8h 6d 5s"), 20), "S");
    expect(soft17.dealer).toHaveLength(2);
    expect(bjSettle(soft17).hands[0].res).toBe("win");
    const hard16 = play(bjDeal(stacked("Ts Tc 7h 6d As 5s"), 20), "S");
    expect(hard16.dealer.map(cardStr)).toEqual(["Tc", "6d", "As"]);   // 17 (hard) → stand
    expect(bjSettle(hard16).hands[0].res).toBe("push");
  });

  it("all hands bust: dealer draws nothing but shows the hole card", () => {
    const st = play(bjDeal(stacked("Ts 6c 6h Tc Kd 5s"), 20), "H");
    expect(st.phase).toBe("done");
    expect(st.dealer).toHaveLength(2);
    expect(st.holeShown).toBe(true);
    expect(bjSettle(st)).toMatchObject({ payout: 0, hands: [{ res: "bust" }] });
    expect(st.shoe.rc).toBe(prefixCount(st.shoe, st.shoe.pos));
  });

  it("reaching 21 ends the hand", () => {
    const st = play(bjDeal(stacked("5s 9c 6h Tc Td 2s"), 20), "H");
    expect(st.phase).toBe("done");
    expect(bjSettle(st)).toMatchObject({ payout: 40, hands: [{ res: "win" }] });
  });

  it("illegal actions throw; inputs are not mutated", () => {
    const shoe = stacked("Ts 9c 6h 7c 2d 2s 2h 2c");
    const snap = JSON.stringify(shoe);
    const st = bjDeal(shoe, 20);
    expect(JSON.stringify(shoe)).toBe(snap);
    const s1 = JSON.stringify(st);
    expect(() => bjAct(st, "P")).toThrow();
    const st2 = bjAct(st, "H");
    expect(JSON.stringify(st)).toBe(s1);
    expect(() => bjAct(st2, "D")).toThrow();
    const done = bjAct(st2, "S");
    expect(() => bjAct(done, "H")).toThrow();
    expect(() => bjSettle(st2)).toThrow();
    expect(() => bjDeal(shoe, 0)).toThrow();
  });

  it("bjOut is the Ev.out record", () => {
    const shoe = { ...stacked("2c 2c 2c 2c As 9h Kd 7c"), pos: 4, rc: 4 };
    expect(bjOut(bjDeal(shoe, 100))).toEqual({
      shoe: 7, pos: 4, dealer: ["9h", "7c"], hands: [{ cards: ["As", "Kd"], bet: 100, res: "bj" }],
    });
  });
});

describe("real shoe across rounds", () => {
  /** Plays through shoes with the public immutable API, checking count invariants along the way. */
  function runPublic(rounds: number, policy: BjPolicy) {
    let shoe = newShoe(1, rr.at(1));
    const res: { no: number; pos: number; payout: number; totalBet: number }[] = [];
    for (let i = 0; i < rounds; i++) {
      if (needsShuffle(shoe)) shoe = newShoe(shoe.no + 1, rr.at(shoe.no + 1));
      expect(shoe.rc).toBe(prefixCount(shoe, shoe.pos));            // round boundary: every dealt card has been shown
      let st = bjDeal(shoe, 20);
      while (st.phase === "player") {
        // mid-round: everything dealt is counted except the hole card
        expect(st.shoe.rc).toBe(prefixCount(st.shoe, st.shoe.pos) - hiLo(st.dealer[1]));
        st = bjAct(st, policy(bjView(st) as HandView, st.dealer[0], st.shoe));
      }
      const s = bjSettle(st);
      res.push({ no: shoe.no, pos: shoe.pos, payout: s.payout, totalBet: s.totalBet });
      shoe = st.shoe;
    }
    return { res, shoe };
  }

  it("rc stays equal to the Hi-Lo sum of shown cards; the fast path gives identical rounds", () => {
    const pub = runPublic(1500, basicPolicy);
    expect(pub.shoe.no).toBeGreaterThan(20);
    let shoe = newShoe(1, rr.at(1));
    for (const r of pub.res) {
      if (needsShuffle(shoe)) shoe = newShoe(shoe.no + 1, rr.at(shoe.no + 1));
      expect([shoe.no, shoe.pos]).toEqual([r.no, r.pos]);
      const f = playRound(shoe, 20);
      expect([f.payout, f.totalBet]).toEqual([r.payout, r.totalBet]);
      shoe = f.shoe;
    }
    expect(restoreShoe(pub.shoe.no, rr.at(pub.shoe.no), pub.shoe.pos)).toEqual(pub.shoe);
  });

  it("the player's choices never change the card order", () => {
    const hitTo15: BjPolicy = (h) => (handValue(h.cards).total < 15 ? "H" : "S");
    const a = runPublic(300, basicPolicy), b = runPublic(300, hitTo15);
    const shoeNo = Math.min(a.shoe.no, b.shoe.no);
    expect(newShoe(shoeNo, rr.at(shoeNo)).cards).toEqual(a.shoe.no === shoeNo ? a.shoe.cards : b.shoe.cards);
  });
});

describe("simulation", () => {
  it("2×10^5 rounds of basic strategy: plausible mean net, and the count predicts the next round", () => {
    const hi = { n: 0, s: 0 }, lo = { n: 0, s: 0 };
    const r = simulateBj({
      rounds: 200_000, shoeRng: (no) => createStreams("bj-sim").res("blackjack").at(no),
      onRound: (net, bet, tc) => { const b = tc >= 2 ? hi : tc <= -2 ? lo : null; if (b) { b.n++; b.s += net / bet; } },
    });
    // Real shoe → real counting edge: at 10^7 rounds TC ≥ +2 averaged ≈ +1.2% and TC ≤ −2 ≈ −2.3% (gap ≈ 4σ at this size).
    expect(hi.n).toBeGreaterThan(20_000);
    expect(lo.n).toBeGreaterThan(20_000);
    expect(hi.s / hi.n - lo.s / lo.n).toBeGreaterThan(0.01);
    // expected ≈ −0.45% ± 0.26%p (1σ); a missing 3:2, double or split would move it by ≥ 1.5%p
    expect(r.mean).toBeGreaterThan(-0.016);
    expect(r.mean).toBeLessThan(0.006);
    expect(r.sd).toBeGreaterThan(1.1);
    expect(r.sd).toBeLessThan(1.2);
    expect(r.wagered / r.initial).toBeGreaterThan(1.08);   // doubles + splits add ~12–13% to the action
    expect(r.wagered / r.initial).toBeLessThan(1.18);
    expect(r.shoes).toBeGreaterThan(4000);
  });

  it("deterministic for a given generator", () => {
    const go = () => simulateBj({ rounds: 2000, shoeRng: (no) => createRng("x", "bj" + no) });
    expect(go()).toEqual(go());
  });
});
