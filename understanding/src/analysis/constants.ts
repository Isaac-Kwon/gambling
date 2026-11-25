// Constants for the analysis page. Every number here is either derived elsewhere (see the comment) or sourced.
// Edges of the other games are not hardcoded: see edges.ts (computed from shared/rules).

/**
 * Credit → KRW conversion used for the "what this would have been in money" card.
 * User decision 2026-11-25 (ARCHITECTURE §13 item 2): 1 credit = 10 KRW.
 */
export const KRW_PER_CREDIT = 10;

/**
 * 2026 Korean statutory minimum wage, KRW per hour (applies 2026-01-01 .. 2026-12-31).
 * Source: 고용노동부 고시 (Ministry of Employment and Labor notice),
 * https://moel.go.kr/news/enews/report/enewsView.do?news_seq=19659
 * Update this together with MIN_WAGE_YEAR and MIN_WAGE_SOURCE when the year changes.
 */
export const MIN_WAGE_KRW_PER_HOUR: number | null = 10_320;
export const MIN_WAGE_YEAR = 2026;
export const MIN_WAGE_SOURCE = "https://moel.go.kr/news/enews/report/enewsView.do?news_seq=19659";

/**
 * Blackjack house edge under basic strategy, per initial bet, for this table's rules (6 decks, S17, 3:2, DAS,
 * one split, no surrender, peek). Measured by scripts/rtp-check.ts: 10^7 rounds, 0.4957% (SE 0.036%p)
 * — docs/DECISIONS.md 2026-11-24 [blackjack]. A deviation from basic strategy only makes it larger.
 */
export const BLACKJACK_EDGE = 0.004957;

/** Tier from which a win is a "big win" marker (2 = BIG WIN, payout ≥ 5× bet; shared/config TIER_MIN). */
export const BIG_TIER = 2;

/** Roulette: a run of this many same-colour results is highlighted on the result board (ARCHITECTURE §9.1). */
export const STREAK_MIN = 3;
