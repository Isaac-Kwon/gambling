import type { Rng } from "../rng";

// ---------------------------------------------------------------------------
// Cards and rules
// ---------------------------------------------------------------------------

/** 0..51. rank = c % 13 (0 = A, 1..8 = 2..9, 9 = T, 10 = J, 11 = Q, 12 = K), suit = floor(c / 13). */
export type Card = number;

export interface BjRules { decks: 6; cut: 0.75; s17: true; bjPays: 1.5; das: true; resplit: false; surrender: false; peek: true }
export const BJ: BjRules = { decks: 6, cut: 0.75, s17: true, bjPays: 1.5, das: true, resplit: false, surrender: false, peek: true };

/** 312 cards. */
export const SHOE_CARDS = 52 * BJ.decks;
/** 234: a new shoe is shuffled at the start of a round when pos >= CUT_POS. */
export const CUT_POS = Math.round(SHOE_CARDS * BJ.cut);

const RANKS = "A23456789TJQK";
const SUITS = "shdc";

/** Blackjack value: A = 1, 2..9, T/J/Q/K = 10. */
export function cardValue(c: Card): number {
  const r = c % 13;
  return r === 0 ? 1 : r >= 9 ? 10 : r + 1;
}

/** Hi-Lo tag: 2..6 = +1, 7..9 = 0, T/J/Q/K/A = -1. */
export function hiLo(c: Card): number {
  const r = c % 13;
  return r === 0 || r >= 9 ? -1 : r <= 5 ? 1 : 0;
}

/** Two-character label for logs: rank `A23456789TJQK` + suit `shdc`, e.g. "As", "Td", "Kc". */
export function cardStr(c: Card): string {
  return RANKS[c % 13] + SUITS[Math.floor(c / 13)];
}

/** Inverse of cardStr. Throws on malformed input. */
export function cardFromStr(s: string): Card {
  const r = RANKS.indexOf(s.charAt(0)), su = SUITS.indexOf(s.charAt(1));
  if (s.length !== 2 || r < 0 || su < 0) throw new RangeError(`bad card "${s}"`);
  return su * 13 + r;
}

export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let hard = 0, ace = false;
  for (const c of cards) {
    const v = cardValue(c);
    hard += v;
    if (v === 1) ace = true;
  }
  return ace && hard + 10 <= 21 ? { total: hard + 10, soft: true } : { total: hard, soft: false };
}

function isNatural(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

// ---------------------------------------------------------------------------
// Shoe
// ---------------------------------------------------------------------------

/**
 * Plain JSON. `cards` is the full shuffled order and is never mutated after newShoe (state copies share it).
 * `pos` = next card index. `rc` = Hi-Lo running count of the cards that have been shown face up.
 * At a round boundary every dealt card has been shown (the hole card is turned over when the round ends),
 * so rc === sum of hiLo(cards[0..pos)) — see restoreShoe.
 */
export interface Shoe { no: number; cards: Card[]; pos: number; rc: number }

/** 6 decks (each card id 0..51 six times), shuffled with rng. Use rng = streams.res("blackjack").at(no). */
export function newShoe(no: number, rng: Rng): Shoe {
  const cards: Card[] = new Array(SHOE_CARDS);
  for (let i = 0; i < SHOE_CARDS; i++) cards[i] = i % 52;
  rng.shuffle(cards);
  return { no, cards, pos: 0, rc: 0 };
}

/** Rebuild a shoe at a round boundary from (no, pos) alone, e.g. for resume or to replay a log's `out.shoe/out.pos`. */
export function restoreShoe(no: number, rng: Rng, pos: number): Shoe {
  const s = newShoe(no, rng);
  let rc = 0;
  for (let i = 0; i < pos; i++) rc += hiLo(s.cards[i]);
  return { no, cards: s.cards, pos, rc };
}

/** Checked only at the start of a round. */
export function needsShuffle(s: Shoe): boolean {
  return s.pos >= CUT_POS;
}

/** Running count / remaining decks ((cards.length - pos) / 52), rounded to the nearest 0.5 (halves away from zero). */
export function trueCount(s: Shoe): number {
  const left = s.cards.length - s.pos;
  if (left <= 0) return 0;
  const x = (s.rc * 52) / left;
  return (Math.sign(x) * Math.round(Math.abs(x) * 2)) / 2 + 0;
}

function draw(s: Shoe, shown: boolean): Card {
  if (s.pos >= s.cards.length) throw new RangeError("shoe exhausted");
  const c = s.cards[s.pos++];
  if (shown) s.rc += hiLo(c);
  return c;
}

// ---------------------------------------------------------------------------
// Basic strategy (S17, DAS, no surrender, peek, 4-8 decks)
// ---------------------------------------------------------------------------

export type Action = "H" | "S" | "D" | "P";
export interface HandView { cards: readonly Card[]; fromSplit: boolean; can: { double: boolean; split: boolean } }

// Columns: dealer 2 3 4 5 6 7 8 9 T A.  D = double else hit, d = double else stand.
const HARD: Record<number, string> = {
  9: "HDDDDHHHHH",
  10: "DDDDDDDDHH",
  11: "DDDDDDDDDH",
  12: "HHSSSHHHHH",
  13: "SSSSSHHHHH", 14: "SSSSSHHHHH", 15: "SSSSSHHHHH", 16: "SSSSSHHHHH",
};
const SOFT: Record<number, string> = {
  13: "HHHDDHHHHH", 14: "HHHDDHHHHH",
  15: "HHDDDHHHHH", 16: "HHDDDHHHHH",
  17: "HDDDDHHHHH",
  18: "SddddSSHHH",
};
// Pair rows by card value (1 = A). Only "P" cells matter; anything else falls through to the total.
const PAIR: Record<number, string> = {
  1: "PPPPPPPPPP",
  2: "PPPPPPHHHH", 3: "PPPPPPHHHH",
  4: "HHHPPHHHHH",
  5: "DDDDDDDDHH",
  6: "PPPPPHHHHH",
  7: "PPPPPPHHHH",
  8: "PPPPPPPPPP",
  9: "PPPPPSPPSS",
  10: "SSSSSSSSSS",
};

/** Column index 0..9 for a dealer up value 1..10 (2..9 → 0..7, 10 → 8, A → 9). */
function colOf(upValue: number): number {
  return upValue === 1 ? 9 : upValue - 2;
}

/**
 * The chart by its inputs. pairValue: value of the pair (1 = A) when splitting is allowed, else 0.
 * Returns only actions allowed by canDouble / pairValue.
 */
export function chartAction(total: number, soft: boolean, pairValue: number, upValue: number, canDouble: boolean): Action {
  const col = colOf(upValue);
  if (pairValue > 0 && PAIR[pairValue][col] === "P") return "P";
  let cell: string;
  if (total > 21) cell = "S";
  else if (soft) cell = total >= 19 ? "S" : total <= 12 ? "H" : SOFT[total][col];
  else cell = total >= 17 ? "S" : total <= 8 ? "H" : HARD[total][col];
  if (cell === "D") return canDouble ? "D" : "H";
  if (cell === "d") return canDouble ? "D" : "S";
  return cell as Action;
}

/**
 * Basic strategy for the decision on `hand`. Never returns an action that `hand.can`/the rules forbid:
 * D not allowed → H (soft 18's d → S); split not allowed → the hard/soft row of the same total (A,A → soft 12 = H).
 */
export function optimalAction(hand: HandView, dealerUp: Card, rules: BjRules = BJ): Action {
  const cards = hand.cards;
  const two = cards.length === 2;
  const canDouble = two && hand.can.double && (!hand.fromSplit || rules.das);
  const canSplit = two && hand.can.split && (!hand.fromSplit || rules.resplit) && cardValue(cards[0]) === cardValue(cards[1]);
  const { total, soft } = handValue(cards);
  return chartAction(total, soft, canSplit ? cardValue(cards[0]) : 0, cardValue(dealerUp), canDouble);
}

// ---------------------------------------------------------------------------
// Round engine
// ---------------------------------------------------------------------------

export interface BjHand { cards: Card[]; bet: number; fromSplit: boolean; doubled: boolean; done: boolean }
export type BjPhase = "player" | "done";
/**
 * Plain JSON. bjDeal/bjAct return new states and never mutate their inputs (`shoe.cards` is shared).
 * dealer = [up, hole, ...draws]; the hole card counts toward shoe.rc only once `holeShown`.
 * `start` = shoe.pos before the deal (log as out.pos). `turn` = index of the hand to act.
 */
export type BjState = {
  shoe: Shoe; start: number; bet: number;
  dealer: Card[]; holeShown: boolean; dealerBj: boolean;
  hands: BjHand[]; turn: number; phase: BjPhase;
};
export type BjRes = "win" | "lose" | "push" | "bj" | "bust";
export interface BjSettled { payout: number; totalBet: number; hands: { cards: Card[]; bet: number; res: BjRes }[] }

function showHole(st: BjState): void {
  if (!st.holeShown) {
    st.holeShown = true;
    st.shoe.rc += hiLo(st.dealer[1]);
  }
}

/** Deals in place into `shoe` (which the new state owns). */
function dealInto(shoe: Shoe, bet: number): BjState {
  if (!(bet > 0) || !Number.isFinite(bet)) throw new RangeError(`bet must be > 0, got ${bet}`);
  const start = shoe.pos;
  const p1 = draw(shoe, true), up = draw(shoe, true), p2 = draw(shoe, true), hole = draw(shoe, false);
  const dealer = [up, hole];
  const hand: BjHand = { cards: [p1, p2], bet, fromSplit: false, doubled: false, done: false };
  // Peek: a dealer natural always has A or T up, so peeking on A/T finds every one before the player acts.
  const dealerBj = isNatural(dealer);
  const st: BjState = { shoe, start, bet, dealer, holeShown: false, dealerBj, hands: [hand], turn: 0, phase: "player" };
  if (dealerBj || isNatural(hand.cards)) {
    hand.done = true;
    st.turn = 1;
    showHole(st);
    st.phase = "done";
  }
  return st;
}

function finishDealer(st: BjState): void {
  showHole(st);
  let live = false;
  for (const h of st.hands) if (handValue(h.cards).total <= 21) live = true;
  if (live) while (handValue(st.dealer).total < 17) st.dealer.push(draw(st.shoe, true));   // S17: stands on soft 17
  st.phase = "done";
}

/** Moves to the next hand that needs a decision, dealing split hands their second card; plays the dealer at the end. */
function advance(st: BjState): void {
  while (st.turn < st.hands.length) {
    const h = st.hands[st.turn];
    if (h.cards.length === 1) {
      h.cards.push(draw(st.shoe, true));
      if (cardValue(h.cards[0]) === 1) h.done = true;   // split aces: one card each
    }
    if (!h.done && handValue(h.cards).total >= 21) h.done = true;   // bust or 21: no further decision
    if (!h.done) return;
    st.turn++;
  }
  finishDealer(st);
}

function canDoubleHand(h: BjHand, rules: BjRules): boolean {
  return h.cards.length === 2 && (!h.fromSplit || rules.das);
}
function canSplitHand(st: BjState, h: BjHand, rules: BjRules): boolean {
  return h.cards.length === 2 && (!h.fromSplit || rules.resplit) && st.hands.length === 1
    && cardValue(h.cards[0]) === cardValue(h.cards[1]);
}

function actInto(st: BjState, a: Action, rules: BjRules = BJ): void {
  if (st.phase !== "player") throw new Error("bjAct: not the player's turn");
  const h = st.hands[st.turn];
  switch (a) {
    case "H":
      h.cards.push(draw(st.shoe, true));
      if (handValue(h.cards).total >= 21) h.done = true;
      break;
    case "S":
      h.done = true;
      break;
    case "D":
      if (!canDoubleHand(h, rules)) throw new Error("bjAct: double not allowed");
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(draw(st.shoe, true));
      h.done = true;
      break;
    case "P": {
      if (!canSplitHand(st, h, rules)) throw new Error("bjAct: split not allowed");
      const second = h.cards.pop() as Card;
      h.fromSplit = true;
      st.hands.splice(st.turn + 1, 0, { cards: [second], bet: h.bet, fromSplit: true, doubled: false, done: false });
      break;
    }
    default:
      throw new Error(`bjAct: unknown action ${String(a)}`);
  }
  advance(st);
}

function cloneState(st: BjState): BjState {
  return {
    ...st,
    shoe: { ...st.shoe },
    dealer: st.dealer.slice(),
    hands: st.hands.map((h) => ({ ...h, cards: h.cards.slice() })),
  };
}

/**
 * Starts a round: player, dealer up, player, dealer hole. Dealer naturals are found by the peek and end the round
 * (player natural → push); a player natural ends it too. Does not mutate `shoe`; check needsShuffle first.
 */
export function bjDeal(shoe: Shoe, bet: number): BjState {
  return dealInto({ ...shoe }, bet);
}

/** Applies a player action to the current hand; when the player's turn ends the dealer plays out. Throws if illegal. */
export function bjAct(st: BjState, a: Action): BjState {
  const next = cloneState(st);
  actInto(next, a);
  return next;
}

/** Legal actions for the current hand, in the order H S D P. D and P also need canAfford(hand bet). */
export function bjLegal(st: BjState, canAfford: (extra: number) => boolean): Action[] {
  if (st.phase !== "player") return [];
  const h = st.hands[st.turn];
  const out: Action[] = ["H", "S"];
  if (canDoubleHand(h, BJ) && canAfford(h.bet)) out.push("D");
  if (canSplitHand(st, h, BJ) && canAfford(h.bet)) out.push("P");
  return out;
}

/** The current decision as a HandView (for optimalAction / logging), or null when no decision is pending. */
export function bjView(st: BjState, canAfford: (extra: number) => boolean = () => true): HandView | null {
  if (st.phase !== "player") return null;
  const h = st.hands[st.turn];
  const legal = bjLegal(st, canAfford);
  return { cards: h.cards, fromSplit: h.fromSplit, can: { double: legal.includes("D"), split: legal.includes("P") } };
}

/** payout = total returned to the wallet (stakes included) over all hands; totalBet includes doubles and splits. */
export function bjSettle(st: BjState): BjSettled {
  if (st.phase !== "done") throw new Error("bjSettle: round not finished");
  const d = handValue(st.dealer).total;
  let payout = 0, totalBet = 0;
  const hands = st.hands.map((h) => {
    const t = handValue(h.cards).total;
    const natural = !h.fromSplit && isNatural(h.cards);
    let res: BjRes, pay: number;
    if (st.dealerBj) { res = natural ? "push" : "lose"; pay = natural ? h.bet : 0; }
    else if (natural) { res = "bj"; pay = h.bet + h.bet * BJ.bjPays; }
    else if (t > 21) { res = "bust"; pay = 0; }
    else if (d > 21 || t > d) { res = "win"; pay = 2 * h.bet; }
    else if (t === d) { res = "push"; pay = h.bet; }
    else { res = "lose"; pay = 0; }
    payout += pay;
    totalBet += h.bet;
    return { cards: h.cards.slice(), bet: h.bet, res };
  });
  return { payout, totalBet, hands };
}

/** The `Ev.out` record for a finished round: shoe number, shoe position before the deal, cards as cardStr labels. */
export function bjOut(st: BjState): { shoe: number; pos: number; dealer: string[]; hands: { cards: string[]; bet: number; res: BjRes }[] } {
  const s = bjSettle(st);
  return {
    shoe: st.shoe.no, pos: st.start,
    dealer: st.dealer.map(cardStr),
    hands: s.hands.map((h) => ({ cards: h.cards.map(cardStr), bet: h.bet, res: h.res })),
  };
}

// ---------------------------------------------------------------------------
// Fast simulation (understanding worker, scripts). Same engine as bjDeal/bjAct, without per-action copies.
// ---------------------------------------------------------------------------

/** Chooses an action from the visible state. Must return an action allowed by `hand.can` (H and S always are). */
export type BjPolicy = (hand: HandView, dealerUp: Card, shoe: Shoe) => Action;
export const basicPolicy: BjPolicy = (hand, up) => optimalAction(hand, up);

const ALWAYS = (): boolean => true;

/** Plays one whole round from `shoe` with `policy` (unlimited bankroll). Does not mutate `shoe`; returns the advanced shoe. */
export function playRound(shoe: Shoe, bet: number, policy: BjPolicy = basicPolicy): { shoe: Shoe; payout: number; totalBet: number; state: BjState } {
  const st = dealInto({ ...shoe }, bet);
  while (st.phase === "player") {
    const view = bjView(st, ALWAYS) as HandView;
    const a = policy(view, st.dealer[0], st.shoe);
    actInto(st, a);
  }
  const r = bjSettle(st);
  return { shoe: st.shoe, payout: r.payout, totalBet: r.totalBet, state: st };
}

export interface BjSimOpts {
  rounds: number;
  /** Generator for shoe number `no` (1, 2, …), e.g. (no) => streams.res("blackjack").at(no). */
  shoeRng: (no: number) => Rng;
  policy?: BjPolicy;
  /** Initial bet per round, chosen from the shoe state before the deal (default 1). */
  betOf?: (shoe: Shoe) => number;
  /** Called after each round with net = payout − totalBet, the initial bet and the true count before the deal. */
  onRound?: (net: number, bet: number, tc: number) => void;
}
/** mean / sd / se are of net per unit of initial bet, per round (player's view: negative = player loses). */
export interface BjSimStats { rounds: number; shoes: number; initial: number; wagered: number; net: number; mean: number; sd: number; se: number }

/** Plays `rounds` rounds through consecutive real shoes, reshuffling only at the cut card. */
export function simulateBj(o: BjSimOpts): BjSimStats {
  const policy = o.policy ?? basicPolicy;
  let shoe = newShoe(1, o.shoeRng(1));
  let shoes = 1, initial = 0, wagered = 0, net = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < o.rounds; i++) {
    if (needsShuffle(shoe)) { shoe = newShoe(shoe.no + 1, o.shoeRng(shoe.no + 1)); shoes++; }
    const bet = o.betOf ? o.betOf(shoe) : 1;
    const tc = o.onRound ? trueCount(shoe) : 0;
    const r = playRound(shoe, bet, policy);
    shoe = r.shoe;
    const n = r.payout - r.totalBet;
    const x = n / bet;
    initial += bet; wagered += r.totalBet; net += n; sum += x; sumSq += x * x;
    if (o.onRound) o.onRound(n, bet, tc);
  }
  const k = o.rounds;
  const mean = k > 0 ? sum / k : 0;
  const sd = k > 1 ? Math.sqrt(Math.max(0, (sumSq - k * mean * mean) / (k - 1))) : 0;
  return { rounds: k, shoes, initial, wagered, net, mean, sd, se: k > 0 ? sd / Math.sqrt(k) : 0 };
}
