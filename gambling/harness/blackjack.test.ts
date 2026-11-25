/**
 * BLACKJACK 21 through the headless harness (ARCHITECTURE §11.1): real wallet, session, RoundApi and streams over a
 * ManualClock; the core drives the real rules engine with scripted players. Verifies money, the logged decisions,
 * the shoe's life across rounds, and fx on/off parity.
 */
import { describe, expect, it } from "vitest";
import { tierOf } from "../../shared/config";
import {
  CUT_POS, bjAct, bjDeal, bjSettle, bjView, cardFromStr, handValue, optimalAction, restoreShoe, trueCount,
  type Action, type BjState,
} from "../../shared/rules/blackjack";
import type { Ev } from "../../shared/schema";
import { createBjCore, handPay, headlessUi, type BjCore, type Decision } from "../games/blackjack/core";
import { createHeadlessCtx, type HeadlessCtx } from "./ctx";

type Policy = (d: Decision) => Action;
const basic: Policy = (d) => optimalAction(d.hand, d.up);
/** Hits below 15 (never doubles, never splits), stands otherwise. */
const hitBelow15: Policy = (d) => (handValue(d.hand.cards).total < 15 ? "H" : "S");
const BETS = [20, 100, 40, 500, 60, 120, 20, 340, 80, 1000];
const betOf = (i: number): number => BETS[i % BETS.length];

const outcomes = (evs: readonly Ev[]) =>
  evs.map((e) => ({ game: e.game, round: e.round, bet: e.bet, payout: e.payout, net: e.net, balance: e.balance, out: e.out, dec: e.dec }));

interface Out { shoe: number; pos: number; dealer: string[]; hands: { cards: string[]; bet: number; res: string }[] }
interface Dec { trueCountApprox: number; steps: { hand: number; action: Action; optimal: Action; trueCountApprox: number }[] }

/** Plays `n` rounds with `policy`; resolves with the core (disposed) and its settled Evs. */
async function playRounds(h: HeadlessCtx, n: number, policy: Policy, core: BjCore = createBjCore(h.ctx, headlessUi())): Promise<Ev[]> {
  const evs: Ev[] = [];
  const off = core.onSettle((e) => evs.push(e));
  for (let i = 0; i < n; i++) {
    if (!core.setBet(betOf(i))) break;
    let ev = await core.deal();
    for (let guard = 0; !ev && guard < 40; guard++) {
      const d = core.decision();
      if (!d) break;
      ev = await core.act(policy(d));
    }
    if (!ev) throw new Error("round did not finish");
  }
  await h.ctx.fx.idle();
  off();
  core.dispose();
  return evs;
}

const make = (seed: string, fx: "on" | "off", credits = 5_000_000): HeadlessCtx =>
  createHeadlessCtx({ seed, fx, game: "blackjack", startCredits: credits });

/** Replays a logged round from (shoe, pos) with the logged actions through the rules engine. */
function replay(h: HeadlessCtx, e: Ev, bet0: number, afford: (x: number) => boolean = () => true): { st: BjState; optimals: Action[]; tcs: number[] } {
  const out = e.out as unknown as Out;
  const dec = e.dec as unknown as Dec;
  let st = bjDeal(restoreShoe(out.shoe, h.ctx.rng.res("blackjack").at(out.shoe), out.pos), bet0);
  const optimals: Action[] = [], tcs: number[] = [];
  for (const s of dec.steps) {
    const view = bjView(st, afford);
    if (!view) throw new Error("logged step without a decision");
    optimals.push(optimalAction(view, st.dealer[0]));
    tcs.push(trueCount(st.shoe));
    st = bjAct(st, s.action);
  }
  return { st, optimals, tcs };
}

describe("blackjack headless: money and outcomes", () => {
  it("payouts, bets and balance equal the rules engine's settlement (replayed from the log)", async () => {
    for (const [name, policy] of [["basic", basic], ["hit<15", hitBelow15]] as const) {
      const h = make("money-" + name, "on");
      const evs = await playRounds(h, 150, policy);
      expect(evs).toHaveLength(150);
      let bal = 5_000_000;
      for (const [i, e] of evs.entries()) {
        const { st } = replay(h, e, betOf(i));
        expect(st.phase).toBe("done");
        const s = bjSettle(st);
        expect(e.payout).toBe(s.payout);
        expect(e.bet).toBe(s.totalBet);
        expect(e.net).toBe(s.payout - s.totalBet);
        expect(e.out).toEqual(JSON.parse(JSON.stringify((e.out))));
        const out = e.out as unknown as Out;
        expect(out.hands.map((x) => x.res)).toEqual(s.hands.map((x) => x.res));
        expect(out.hands.map((x) => x.cards)).toEqual(s.hands.map((x) => x.cards.map((c) => `${"A23456789TJQK"[c % 13]}${"shdc"[Math.floor(c / 13)]}`)));
        // per-hand payouts add up to the round's payout
        expect(s.hands.reduce((a, x) => a + handPay(x.res, x.bet), 0)).toBe(s.payout);
        expect((e.disp as { tier: number }).tier).toBe(tierOf(e.payout, e.bet));
        bal += e.net;
        expect(e.balance).toBe(bal);
      }
      expect(h.rt.wallet.balance).toBe(bal);
      if (name === "basic") expect(evs.some((e) => (e.out as unknown as Out).hands.length === 2)).toBe(true);   // splits happen
      expect(evs.some((e) => (e.out as unknown as Out).hands.some((x) => x.res === "bj"))).toBe(true);
    }
  });

  it("a natural pays 3:2 (bet 100 returns 250) and a dealer natural against a natural pushes", async () => {
    const h = make("naturals", "off");
    const evs = await playRounds(h, 400, basic);
    const bj = evs.filter((e) => (e.out as unknown as Out).hands.length === 1 && (e.out as unknown as Out).hands[0].res === "bj");
    expect(bj.length).toBeGreaterThan(5);
    for (const e of bj) { expect(e.payout).toBe(e.bet * 2.5); expect((e.dec as unknown as Dec).steps).toHaveLength(0); }
    for (const e of evs) {
      const o = e.out as unknown as Out;
      if (o.hands.length === 1 && o.hands[0].cards.length === 2 && o.dealer.length === 2 && handValue(o.hands[0].cards.map(cardFromStr)).total === 21 && handValue(o.dealer.map(cardFromStr)).total === 21) {
        expect(o.hands[0].res).toBe("push");
      }
    }
  });
});

describe("blackjack headless: decisions log", () => {
  it("every decision is logged with the basic-strategy action for the visible state and the count at that moment", async () => {
    const h = make("decisions", "on");
    const evs = await playRounds(h, 200, hitBelow15);   // a deliberately imperfect player: optimal != action sometimes
    let steps = 0, differs = 0, same = 0;
    for (const [i, e] of evs.entries()) {
      const dec = e.dec as unknown as Dec;
      const { optimals, tcs } = replay(h, e, betOf(i));
      expect(dec.steps).toHaveLength(optimals.length);
      expect(dec.trueCountApprox).toBe(trueCount(restoreShoe((e.out as unknown as Out).shoe, h.ctx.rng.res("blackjack").at((e.out as unknown as Out).shoe), (e.out as unknown as Out).pos)));
      dec.steps.forEach((s, k) => {
        expect(s.optimal).toBe(optimals[k]);
        expect(s.trueCountApprox).toBe(tcs[k]);
        expect(["H", "S", "D", "P"]).toContain(s.action);
        expect(Object.keys(s).sort()).toEqual(["action", "hand", "optimal", "trueCountApprox"]);
        steps++;
        if (s.action === s.optimal) same++; else differs++;
      });
    }
    expect(steps).toBeGreaterThan(150);
    expect(differs).toBeGreaterThan(10);
    expect(same).toBeGreaterThan(10);
  });

  it("the basic-strategy player logs action === optimal everywhere", async () => {
    const h = make("decisions2", "off");
    const evs = await playRounds(h, 200, basic);
    for (const e of evs) for (const s of (e.dec as unknown as Dec).steps) expect(s.action).toBe(s.optimal);
    expect(evs.some((e) => (e.dec as unknown as Dec).steps.some((s) => s.action === "D"))).toBe(true);
    expect(evs.some((e) => (e.dec as unknown as Dec).steps.some((s) => s.action === "P"))).toBe(true);
  });

  it("without credit for the extra stake, DOUBLE and SPLIT are not offered and `optimal` takes the fallback", async () => {
    let checked = 0;
    for (let k = 0; k < 40; k++) {
      const h = make("short-" + k, "off", 1000);
      const core = createBjCore(h.ctx, headlessUi());
      expect(core.setBet(600)).toBe(true);   // balance 400 left: not enough for +600
      let ev = await core.deal();
      while (!ev) {
        const d = core.decision()!;
        expect(d.legal).not.toContain("D");
        expect(d.legal).not.toContain("P");
        expect(core.state.legal).toEqual(d.legal);
        expect(await core.act("D")).toBeNull();   // refused: still waiting for a decision
        expect(core.decision()).not.toBeNull();
        ev = await core.act(optimalAction(d.hand, d.up));
        checked++;
      }
      const dec = ev.dec as unknown as Dec;
      const { optimals } = replay(h, ev, 600, () => false);
      expect(dec.steps.map((s) => s.optimal)).toEqual(optimals);
      expect(dec.steps.every((s) => s.optimal === "H" || s.optimal === "S")).toBe(true);
      expect(ev.bet).toBe(600);
      core.dispose();
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("a double or a split takes the extra stake from the wallet at that moment", async () => {
    const h = make("extra-stake", "off", 100_000);
    const evs = await playRounds(h, 200, basic);
    const dbl = evs.find((e) => (e.dec as unknown as Dec).steps.some((s) => s.action === "D"));
    const spl = evs.find((e) => (e.dec as unknown as Dec).steps.some((s) => s.action === "P"));
    expect(dbl && dbl.bet).toBeGreaterThan(0);
    expect(spl && spl.bet).toBeGreaterThan(0);
    const o = (spl as Ev).out as unknown as Out;
    expect(o.hands).toHaveLength(2);
    expect((spl as Ev).bet).toBe(o.hands[0].bet + o.hands[1].bet);
  });
});

describe("blackjack headless: the shoe", () => {
  it("persists across rounds (position continues, cards come from the shoe order) and reshuffles at the cut", async () => {
    const h = make("shoe", "off");
    const evs = await playRounds(h, 160, hitBelow15);
    let reshuffles = 0;
    let prevEnd = 0, prevShoe = 1;
    for (const [i, e] of evs.entries()) {
      const o = e.out as unknown as Out;
      if (i === 0) { expect(o.shoe).toBe(1); expect(o.pos).toBe(0); }
      else if (prevEnd >= CUT_POS) { expect(o.shoe).toBe(prevShoe + 1); expect(o.pos).toBe(0); reshuffles++; }
      else { expect(o.shoe).toBe(prevShoe); expect(o.pos).toBe(prevEnd); }
      const used = o.dealer.length + o.hands.reduce((a, x) => a + x.cards.length, 0);
      const shoe = restoreShoe(o.shoe, h.ctx.rng.res("blackjack").at(o.shoe), 0);
      const drawn = shoe.cards.slice(o.pos, o.pos + used).map((c) => `${"A23456789TJQK"[c % 13]}${"shdc"[Math.floor(c / 13)]}`).sort();
      const shown = [...o.dealer, ...o.hands.flatMap((x) => x.cards)].sort();
      expect(shown).toEqual(drawn);
      prevEnd = o.pos + used;
      prevShoe = o.shoe;
    }
    expect(reshuffles).toBeGreaterThanOrEqual(2);
    expect(h.ctx.store.get<{ no: number; pos: number }>("blackjack.shoe")).toMatchObject({ no: prevShoe, pos: prevEnd });
  });

  it("is kept when the table is left and entered again, and when a session is resumed from the store", async () => {
    const h = make("shoe-leave", "on");
    const first = await playRounds(h, 7, basic);
    const last = first[first.length - 1].out as unknown as Out;
    const end = last.pos + last.dealer.length + last.hands.reduce((a, x) => a + x.cards.length, 0);
    expect(end).toBeLessThan(CUT_POS);
    // a new core over the same session store = leaving and coming back
    const second = await playRounds(h, 3, basic);
    const o = second[0].out as unknown as Out;
    expect(o.shoe).toBe(last.shoe);
    expect(o.pos).toBe(end);
    // the stored value alone rebuilds the shoe (it is what the resume snapshot carries)
    const stored = h.ctx.store.get<{ no: number; pos: number; rc: number }>("blackjack.shoe") as { no: number; pos: number; rc: number };
    const rebuilt = restoreShoe(stored.no, h.ctx.rng.res("blackjack").at(stored.no), stored.pos);
    expect(rebuilt.rc).toBe(stored.rc);
  });

  it("shoe order depends only on (seed, shoe number): players with different bets and policies see the same cards", async () => {
    const a = await playRounds(make("same-shoe", "on"), 30, basic);
    const b = await playRounds(make("same-shoe", "off"), 30, hitBelow15);
    const cards = (evs: Ev[]) => {
      const o = evs[0].out as unknown as Out;
      return [o.dealer[0], o.hands[0].cards[0], o.hands[0].cards[1], o.dealer[1]];
    };
    expect(cards(a)).toEqual(cards(b));   // first four cards of shoe 1 are the same
  });
});

describe("blackjack headless: fx on/off parity", () => {
  it.each([["basic strategy", basic], ["hit below 15", hitBelow15]] as const)("200 rounds, %s: identical outcomes, wallet and decisions", async (_n, policy) => {
    const on = make("parity", "on");
    const off = make("parity", "off");
    const evOn = await playRounds(on, 200, policy);
    const evOff = await playRounds(off, 200, policy);
    await on.rt.whenSettled();
    await off.rt.whenSettled();
    expect(evOn).toHaveLength(200);
    expect(outcomes(evOn)).toEqual(outcomes(evOff));
    expect(on.rt.wallet.balance).toBe(off.rt.wallet.balance);
    expect(evOff.every((e) => Array.isArray(e.fx) && e.fx.length === 0)).toBe(true);
    for (const e of evOn) {
      const d = e.disp as { tier: number; celebrate?: boolean };
      expect(d.tier).toBe(tierOf(e.payout, e.bet));
      expect(d.celebrate === true).toBe(e.payout > 0);
      expect((e.fx ?? []).some((r) => r.type === "tier")).toBe(e.payout > 0);
      expect((evOff[evOn.indexOf(e)].disp as Record<string, unknown>)).toEqual({ tier: d.tier });
    }
    // a natural gets the extra confetti on top of the tier bundle
    const nat = evOn.filter((e) => (e.out as unknown as Out).hands.some((x) => x.res === "bj"));
    expect(nat.length).toBeGreaterThan(3);
    for (const e of nat) expect((e.fx ?? []).some((r) => r.type === "particles:confetti")).toBe(true);
    // losses are silent: only the deal's own sounds, no celebration records
    for (const e of evOn) if (e.payout === 0) expect((e.fx ?? []).filter((r) => !/^sfx:(card|chip)$/.test(r.type))).toEqual([]);
  });

  it("leaving mid-round settles the round as a stand without a celebration", async () => {
    const h = make("dispose", "on");
    const core = createBjCore(h.ctx, headlessUi());
    const evs: Ev[] = [];
    core.onSettle((e) => evs.push(e));
    core.setBet(100);
    const ev = await core.deal();
    expect(core.canLeave()).toBe(ev !== null);
    if (!ev) {
      core.dispose();
      expect(evs).toHaveLength(1);
      expect((evs[0].fx ?? []).filter((r) => !/^sfx:(card|chip)$/.test(r.type))).toEqual([]);
    } else {
      core.dispose();
    }
    expect(h.ctx.rounds.active).toBeNull();
  });
});

