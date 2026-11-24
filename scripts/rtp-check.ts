// RTP / edge verification (ARCHITECTURE.md 11.2). Usage:
//   npm run rtp [-- --seed <s|random>] [--only <game>] [--quick]
import { createRng, createStreams, randomSeed } from "../shared/rng";
import type { Rng } from "../shared/rng";
import { returnOf, rouletteExact, spinWheel } from "../shared/rules/roulette";
import type { RouletteBet } from "../shared/rules/roulette";
import { CRASH, crashFromU, crashPoint, settleCrash } from "../shared/rules/crash";
import { simulateBj } from "../shared/rules/blackjack";
import { SLOT_A, SLOT_B, slotExact, spin } from "../shared/rules/slot";
import type { SlotConfig } from "../shared/rules/slot";
import { OCEAN, oceanExact, oceanFlush, oceanInit, oceanSpin } from "../shared/rules/ocean";
import { Acc, exactVerdict, formatRows, mcVerdict, rangeVerdict, zScore } from "./rtp-lib";
import type { Row } from "./rtp-lib";

interface Ctx { seed: string; scale: number } // scale: MC round multiplier (1 or 0.1)

/** One registry entry per game. exact and mc each return table rows. */
interface Check {
  game: string;
  exact?: () => Row[];
  mc: (ctx: Ctx) => Row[];
  criteria: string;
}

const rounds = (ctx: Ctx, n: number) => Math.max(1000, Math.round(n * ctx.scale));
const K = 4;

function mcRow(check: string, exact: number, a: Acc): Row {
  const s = a.stat();
  return { check, exact, sample: s.mean, se: s.se, z: zScore(s.mean, exact, s.se), pass: mcVerdict(s.mean, exact, s.se, K) };
}

// ---- roulette ----
const ROULETTE_BETS: { name: string; bet: RouletteBet }[] = [
  { name: "straight", bet: { kind: "straight", n: 17 } },
  { name: "split", bet: { kind: "split", a: 8, b: 11 } },
  ...(["red", "black", "odd", "even", "low", "high"] as const).map((k) => ({ name: k, bet: { kind: k } as RouletteBet })),
  ...([1, 2, 3] as const).flatMap((i) => [
    { name: `dozen${i}`, bet: { kind: "dozen", i } as RouletteBet },
    { name: `column${i}`, bet: { kind: "column", i } as RouletteBet },
  ]),
];

const roulette: Check = {
  game: "roulette",
  criteria: "exact 36/37 per bet kind; MC 1e6 per kind within 4 SE",
  exact: () => {
    // Every straight too, not just one sample, so a table typo anywhere is caught.
    const bets: RouletteBet[] = ROULETTE_BETS.map((b) => b.bet);
    for (let n = 0; n <= 36; n++) bets.push({ kind: "straight", n });
    const rows: Row[] = [];
    let bad = 0;
    for (const bet of bets) if (!exactVerdict(rouletteExact(bet), 36 / 37, 1e-12)) bad++;
    for (const { name, bet } of ROULETTE_BETS) {
      const v = rouletteExact(bet);
      rows.push({ check: `roulette/${name}`, exact: 36 / 37, sample: v, se: null, z: null, pass: exactVerdict(v, 36 / 37, 1e-12) });
    }
    rows.push({ check: `roulette/all ${bets.length} bets`, exact: 36 / 37, sample: null, se: null, z: null, pass: bad === 0 });
    return rows;
  },
  mc: (ctx) => {
    const n = rounds(ctx, 1_000_000);
    return ROULETTE_BETS.map(({ name, bet }) => {
      const rng = createRng(ctx.seed, "rtp:roulette:" + name);
      const placed = [{ bet, amt: 1 }];
      const a = new Acc();
      for (let i = 0; i < n; i++) a.add(returnOf(placed, spinWheel(rng)));
      return mcRow(`roulette/${name} mc`, rouletteExact(bet), a);
    });
  },
};

// ---- crash ----
const CRASH_TARGETS = [1.01, 1.5, 2, 10, 100];
const TWO32 = 4294967296;

/** P(crashFromU(u) >= t) over u = k / 2^32, k = 1..2^32, by integer bisection on the real function. */
function crashTail(t: number): number {
  let lo = 0, hi = TWO32; // crashFromU is non-increasing in k, so the qualifying k form a prefix
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (crashFromU(mid / TWO32) >= t) lo = mid; else hi = mid - 1;
  }
  return lo / TWO32;
}

const crash: Check = {
  game: "crash",
  criteria: "grid RTP 0.99 +- 0.0005 at 1.01/1.5/2/10/100; MC 1e6 at 2x, 10x within 4 SE",
  exact: () => CRASH_TARGETS.map((t) => {
    const v = t * crashTail(t);
    return { check: `crash/grid ${t}x`, exact: 1 - CRASH.edge, sample: v, se: null, z: null, pass: exactVerdict(v, 1 - CRASH.edge, 0.0005) };
  }),
  mc: (ctx) => {
    const n = rounds(ctx, 1_000_000);
    const BET = 100_000; // large stake so settleCrash's integer floor is exact
    return [2, 10].map((t) => {
      const rng: Rng = createRng(ctx.seed, "rtp:crash:" + t);
      const a = new Acc();
      for (let i = 0; i < n; i++) a.add(settleCrash(BET, crashPoint(rng), t) / BET);
      return mcRow(`crash/${t}x mc`, t * crashTail(t), a);
    });
  },
};

// ---- blackjack ----
const BJ_LO = 0.0035, BJ_HI = 0.0075;
const blackjack: Check = {
  game: "blackjack",
  criteria: "basic strategy 1e7 rounds, edge in [0.35%, 0.75%]",
  mc: (ctx) => {
    const n = rounds(ctx, 10_000_000);
    const res = createStreams(ctx.seed).res("blackjack");
    const s = simulateBj({ rounds: n, shoeRng: (no) => res.at(no) });
    const edge = -s.mean;
    // --quick has a much larger SE, so widen the band by 4 SE there only.
    const slack = ctx.scale < 1 ? K * s.se : 0;
    const mid = (BJ_LO + BJ_HI) / 2;
    return [{
      check: "blackjack/edge basic" + (slack ? " (quick)" : ""),
      exact: mid, sample: edge, se: s.se, z: null,
      pass: rangeVerdict(edge, BJ_LO, BJ_HI, slack), note: "band 0.35-0.75%" + (slack ? " +-4SE" : ""),
    }];
  },
};

// ---- slot (variants a and b) ----
const SLOT_TARGET = 0.94, SLOT_TOL = 0.0005;
const SLOT_B_HIT = 0.30, SLOT_B_HIT_TOL = 0.02;

function slotCheck(cfg: SlotConfig): Check {
  const name = "slot-" + cfg.id;
  let ex: ReturnType<typeof slotExact> | null = null;
  const exact = () => (ex ??= slotExact(cfg));
  return {
    game: name,
    criteria: `exact ${SLOT_TARGET} +- ${SLOT_TOL}` + (cfg.id === "b" ? `, hit rate ${SLOT_B_HIT} +- ${SLOT_B_HIT_TOL}` : "") + "; MC 1e7 within 4 SE",
    exact: () => {
      const e = exact();
      const rows: Row[] = [{
        check: `${name}/exact`, exact: SLOT_TARGET, sample: e.ret, se: null, z: null,
        pass: exactVerdict(e.ret, SLOT_TARGET, SLOT_TOL), note: `${e.sumLinePay}/${e.cycle}, sd ${e.sigma.toFixed(3)}`,
      }];
      if (cfg.id === "b") {
        const h = e.hit / e.cycle;
        rows.push({ check: `${name}/hit rate`, exact: SLOT_B_HIT, sample: h, se: null, z: null, pass: exactVerdict(h, SLOT_B_HIT, SLOT_B_HIT_TOL), note: `${e.hit} combos` });
      }
      return rows;
    },
    mc: (ctx) => {
      const n = rounds(ctx, 10_000_000);
      const rng = createRng(ctx.seed, "rtp:" + name);
      const lines = cfg.lines.length;
      const a = new Acc();
      for (let i = 0; i < n; i++) a.add(spin(cfg, rng, 1).payout / lines);
      return [mcRow(`${name} mc`, exact().ret, a)];
    },
  };
}

// ---- ocean ----
/** Binomial check row: count successes out of n against probability p, pass within K sigma. */
function binomRow(check: string, k: number, n: number, p: number): Row {
  const se = Math.sqrt((p * (1 - p)) / n);
  const s = n > 0 ? k / n : 0;
  return { check, exact: p, sample: s, se, z: zScore(s, p, se), pass: n > 0 && mcVerdict(s, p, se, K) };
}

const ocean: Check = {
  game: "ocean",
  criteria: "exact base+bonus 0.92 +- 0.001; MC 2e7: trigger and multiple frequencies within binomial 4 sigma, conservation after flush, total within 4 SE",
  exact: () => {
    const e = oceanExact(OCEAN);
    return [{
      check: "ocean/exact", exact: 0.92, sample: e.total, se: null, z: null,
      pass: exactVerdict(e.total, 0.92, 0.001), note: `base ${(e.base * 100).toFixed(3)}% + bonus ${(e.bonus * 100).toFixed(3)}%`,
    }];
  },
  mc: (ctx) => {
    const n = rounds(ctx, 20_000_000);
    const BET = 20;
    const rng = createRng(ctx.seed, "rtp:ocean");
    const multIdx = new Map(OCEAN.bonus.map((b, i) => [b.mult, i]));
    const multCount = new Array<number>(OCEAN.bonus.length).fill(0);
    let st = oceanInit();
    let paid = 0, released = 0, triggeredTotal = 0, triggers = 0;
    // Per-round return with each bonus credited at its trigger round: i.i.d. across rounds, so its SE is honest.
    // Its sum equals what was actually paid (rounds + final flush) by conservation, checked below.
    const a = new Acc();
    // The queue is usually empty at the very end, so also flush a copy once mid-run while it is not.
    let mid: { round: number; ok: boolean } | null = null;
    for (let i = 0; i < n; i++) {
      const o = oceanSpin(OCEAN, st, rng, BET);
      st = o.state;
      const r = o.result;
      paid += r.payout;
      released += r.seqPay;
      let x = r.basePay;
      if (r.triggered) {
        triggers++;
        triggeredTotal += r.triggered.total;
        x += r.triggered.total;
        multCount[multIdx.get(r.triggered.mult)!]++;
      }
      a.add(x / BET);
      if (!mid && i >= n / 2 && st.queue.length > 0) {
        const g = oceanFlush(st)!;
        mid = { round: st.round, ok: released + g.amount === triggeredTotal && g.state.round === st.round };
      }
    }
    const f = oceanFlush(st);
    const flushAmt = f ? f.amount : 0;
    paid += flushAmt;
    const ex = oceanExact(OCEAN).total;
    const rows: Row[] = [binomRow("ocean/trigger rate", triggers, n, 1 / OCEAN.triggerDen)];
    const wSum = OCEAN.bonus.reduce((t, b) => t + b.w, 0);
    OCEAN.bonus.forEach((b, i) => rows.push(binomRow(`ocean/mult ${b.mult}x freq`, multCount[i], triggers, b.w / wSum)));
    const conserved = released + flushAmt === triggeredTotal;
    rows.push({
      check: "ocean/conservation", exact: null, sample: null, se: null, z: null, pass: conserved && mid !== null && mid.ok,
      note: `released ${released} + flush ${flushAmt} ${conserved ? "=" : "!="} triggered ${triggeredTotal}; mid-run flush at ${mid?.round ?? "-"} ${mid?.ok ? "ok" : "FAIL"}`,
    });
    const s = a.stat();
    const sample = paid / (n * BET);
    rows.push({
      check: "ocean mc", exact: ex, sample, se: s.se, z: zScore(sample, ex, s.se),
      pass: mcVerdict(sample, ex, s.se, K) && Math.abs(sample - s.mean) < 1e-9,
    });
    return rows;
  },
};

const CHECKS: Check[] = [slotCheck(SLOT_A), slotCheck(SLOT_B), ocean, roulette, crash, blackjack];

// ---- CLI ----
function parseArgs(argv: string[]) {
  let seed = "rtp-ci", only: string | null = null, quick = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seed") seed = argv[++i] ?? "";
    else if (a === "--only") only = argv[++i] ?? "";
    else if (a === "--quick") quick = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!seed) throw new Error("--seed needs a value");
  if (seed === "random") seed = randomSeed();
  if (only !== null && !CHECKS.some((c) => c.game === only)) throw new Error(`--only: unknown game "${only}" (have ${CHECKS.map((c) => c.game).join(", ")})`);
  return { seed, only, quick };
}

function main(): number {
  const { seed, only, quick } = parseArgs(process.argv.slice(2));
  const ctx: Ctx = { seed, scale: quick ? 0.1 : 1 };
  console.log(`rtp-check seed=${seed}${quick ? " (quick: 10x fewer MC rounds)" : ""}${only ? " only=" + only : ""}`);
  const t0 = Date.now();
  const rows: Row[] = [];
  for (const c of CHECKS) {
    if (only && c.game !== only) continue;
    const t1 = Date.now();
    if (c.exact) rows.push(...c.exact());
    rows.push(...c.mc(ctx));
    console.error(`  ${c.game} done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  }
  console.log(formatRows(rows));
  const failed = rows.filter((r) => !r.pass);
  console.log(`\n${rows.length - failed.length}/${rows.length} passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed.length) { console.log("FAILED: " + failed.map((r) => r.check).join(", ")); return 1; }
  return 0;
}

process.exit(main());
