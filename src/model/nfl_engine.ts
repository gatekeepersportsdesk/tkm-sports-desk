/**
 * Gatekeep Sports Desk — NFL Receptions Props Model (v1.6)
 *
 * v1.4 math is unchanged (OLS dropbacks, Bayesian shrinkage, Negative
 * Binomial pricing, 0.6 / 0.4 season-average blend). v1.5 fixes the plumbing
 * around it:
 *  - one pricing path (`priceNflProp`) so import / desk / seed can't drift
 *  - missing or one-sided odds are never fabricated into a +100 market
 *  - BET also needs positive EV at the price actually offered (a 3.0pt edge
 *    over the de-vigged line is not +EV once the vig is paid)
 *  - the 3-BET-per-game cap is a pure function applied everywhere
 *  - the walk-forward position ratio README describes is now computed from
 *    graded results (with a week cutoff so it cannot leak the future)
 */

import { logGamma as lgamma, nbinomPmfAlpha, lineProbsFromPmf } from './dist';
import { parseOdds as parseOddsStrict, priceMarket, expectedValue, DEFAULT_ONE_SIDED_HOLD } from '../lib/odds';

export const NFL_CONFIG = {
  model_version: "v1.6 walk-forward + 0.6/0.4 season-avg blend + injury-report teammate absence",
  dropback_base: 36.697,
  dropback_spread_coef: 0.3075,
  dropback_total_coef: 0.3562,
  dropback_min: 24,
  dropback_max: 52,
  blend_weight: 0.60,
  k_routes: 100.0,
  k_catch: 30.0,
  league_catch_rate: 0.680,
  league_tprr: 0.195,
  alpha: {
    WR: 0.100,
    TE: 0.125
  },
  alpha_fallback: 0.180,
  // Early-season dispersion inflation: alpha_eff = alpha * (1 + c / games).
  // Fit on 2024-2026 walk-forward data (7,964 player-games); config alphas themselves held up.
  alpha_games_c: 2.5,
  // Card rules (README section 1)
  edge_min: 0.03,
  max_chalk: -150,
  agreement_max: 1.5,
  game_cap: 3,
  // v1.5
  min_ev: 0.0,
  one_sided_hold: DEFAULT_ONE_SIDED_HOLD,
  // Walk-forward ratio
  ratio_prior: { WR: 0.9915, TE: 1.0283 } as Record<string, number>,
  ratio_clip: [0.85, 1.15] as [number, number],
  // In-season exponential decay (weeks). Prior-season replay is OFF: 2025 WR bias (actual/mu 0.91)
  // vanished in 2026 (1.00), so carrying last year's ratio forward made 2026 worse (1.065).
  ratio_half_life: 6,
  ratio_prior_season_weight: 0,
  // shrinkage strength in units of summed muStructural (~40 player-games at mean 2.2)
  ratio_k_mu: 88,
  // v1.6 teammate absence (pre-game knowable, from the official injury report: Out / Doubtful).
  // Pooled blocked-CV test (scripts/nfl_experiments/nfl_absence_form_v2.py, 6,529 WR/TE player-games, 2024-2026):
  // +0.0087 log-lik/row, 95% CI [+0.0049, +0.0125], positive in 2024 (+0.0114), 2025 (+0.0074) and 2026 (+0.0026).
  // Lost target share L (trailing-4 targets/gm of absent pass-catchers with >=3 targets/gm, >=3 prior games, played in the
  // last 4 weeks / that team's same pool) is redistributed proportionally: g = -ln(1-min(L,0.6)); mu *= exp(coef*g).
  absence_enabled: true,
  absence_coef: 0.60,
  absence_clip_share: 0.6,
  absence_min_tavg: 3,
  absence_min_games: 3,
  absence_window_weeks: 4,
  absence_max_factor: 1.5
  // Recent form (trailing 3-game receptions) was tested the same way and is deliberately NOT here:
  // pooled +0.0018 but 2026 is -0.0027 (CI [-0.0055, +0.0003]) and its coefficient flips sign on 2026-only data.
};

/** Dispersion for a player given games of data behind the rate estimates. */
export function effectiveAlpha(pos: string, games?: number): number {
  const base = (NFL_CONFIG.alpha as Record<string, number>)[pos] ?? NFL_CONFIG.alpha_fallback;
  if (!games || games <= 0) return base * (1 + NFL_CONFIG.alpha_games_c);
  return base * (1 + NFL_CONFIG.alpha_games_c / games);
}

/** Lanczos approximation for ln(Gamma(z)) — kept as a named export for tests / callers. */
export function logGamma(z: number): number {
  return lgamma(z);
}

/**
 * Negative Binomial PMF: P(Y = k)
 * Dispersion alpha: Var = mu + alpha * mu^2
 */
export function nbinomPmf(k: number, mu: number, alpha: number): number {
  if (mu <= 0 || k < 0) return 0.0;
  return nbinomPmfAlpha(k, mu, alpha);
}

/**
 * Discrete line probabilities for integer or half-lines
 */
export function calculateDiscreteLineProbs(mu: number, line: number, alpha: number) {
  return lineProbsFromPmf(k => nbinomPmf(k, mu, alpha), line);
}

export function conditionalProbs(pOver: number, pUnder: number) {
  const sum = pOver + pUnder;
  if (sum <= 0) return { over: 0.5, under: 0.5 };
  return {
    over: pOver / sum,
    under: pUnder / sum
  };
}

/**
 * Legacy odds parser kept for UI call sites that need a displayable number.
 * `ok` is false when the input could not be parsed — callers that price a
 * market must check it (the old behaviour silently returned +100).
 */
export function parseOdds(str: string | number | null | undefined) {
  const p = parseOddsStrict(str);
  if (!p) return { imp: 0.5, dec: 2.0, us: 100, ok: false };
  return { imp: p.imp, dec: p.dec, us: p.us, ok: true };
}

/**
 * Two-way de-vig. With only one side priced the other side is inferred from
 * an assumed hold and `two_way` is false. Returns null if neither side parses.
 */
export function devigTwoWay(
  overOddsStr: string | number | null | undefined,
  underOddsStr: string | number | null | undefined,
  hold: number = NFL_CONFIG.one_sided_hold
) {
  const m = priceMarket(overOddsStr, underOddsStr, hold);
  if (!m) return null;
  return {
    fair_over: m.fairOver,
    fair_under: m.fairUnder,
    two_way: m.twoWay,
    hold: m.hold
  };
}

export function computeStructuralMu(
  stats: {
    routes: number;
    season_tprr: number;
    prior_tprr: number;
    receptions: number;
    targets: number;
    route_pct: number;
    walk_forward_ratio: number;
    season_avg_receptions: number;
    /** v1.6: -ln(1 - lost target share) from injury-report absences (0 / undefined = none or unknown) */
    absence_g?: number;
  },
  game: {
    spread: number;
    implied_total: number;
  }
) {
  const dropbacks = Math.min(
    NFL_CONFIG.dropback_max,
    Math.max(
      NFL_CONFIG.dropback_min,
      NFL_CONFIG.dropback_base
        + NFL_CONFIG.dropback_spread_coef * game.spread
        + NFL_CONFIG.dropback_total_coef * (game.implied_total - 22.0)
    )
  );

  const shrunkTprr = (stats.routes * stats.season_tprr + NFL_CONFIG.k_routes * stats.prior_tprr)
                   / (stats.routes + NFL_CONFIG.k_routes);

  const shrunkCatchRate = (stats.receptions + NFL_CONFIG.k_catch * NFL_CONFIG.league_catch_rate)
                        / (stats.targets + NFL_CONFIG.k_catch);

  const routePct = Math.min(1, Math.max(0, stats.route_pct));
  const ratio = Math.min(
    NFL_CONFIG.ratio_clip[1],
    Math.max(NFL_CONFIG.ratio_clip[0], stats.walk_forward_ratio)
  );

  const muStructural = Math.max(0.2, dropbacks * routePct * shrunkTprr * shrunkCatchRate);
  const muAdapted = muStructural * ratio;

  // v1.4 blend with season average receptions per game
  const blendedMu = Math.max(0.2, (NFL_CONFIG.blend_weight * muAdapted) + ((1.0 - NFL_CONFIG.blend_weight) * stats.season_avg_receptions));
  const g = Number.isFinite(stats.absence_g as number) ? Math.max(0, stats.absence_g as number) : 0;
  const absenceFactor = NFL_CONFIG.absence_enabled
    ? Math.min(NFL_CONFIG.absence_max_factor, Math.exp(NFL_CONFIG.absence_coef * g))
    : 1;
  const finalMu = blendedMu * absenceFactor;

  return {
    absenceFactor,
    dropbacks,
    shrunkTprr,
    shrunkCatchRate,
    muStructural,
    muAdapted,
    finalMu
  };
}

export interface CardRuleOptions {
  /** Expected value (per 1u) at the price offered for the recommended side */
  ev?: number | null;
  /** false when only one side of the market was priced */
  twoWay?: boolean;
  /** false when no line / odds were entered at all */
  hasMarket?: boolean;
}

export function evaluateCardRules(
  edge: number,
  recommendedOddsUs: number | string,
  modelMu: number,
  seasonAvg: number,
  opts: CardRuleOptions = {}
): { status: 'BET' | 'PASS' | 'OFF'; reason: string } {
  const oddsNum = typeof recommendedOddsUs === 'string' ? parseOdds(recommendedOddsUs).us : recommendedOddsUs;

  if (opts.hasMarket === false) {
    return { status: "PASS", reason: "No market line / odds entered" };
  }

  // 1. Edge constraint: >= 3.0 percentage points
  if (edge < NFL_CONFIG.edge_min) {
    return { status: "PASS", reason: "Edge under +3.0 pts threshold" };
  }

  // 2. Favorite price constraint: no shorter than -150
  if (oddsNum < NFL_CONFIG.max_chalk) {
    return { status: "PASS", reason: `Price ${oddsNum} exceeds maximum playable chalk (${NFL_CONFIG.max_chalk})` };
  }

  // 2b. Edge over the DE-VIGGED line is not edge over the price you pay.
  if (opts.ev !== undefined && opts.ev !== null && opts.ev <= NFL_CONFIG.min_ev) {
    return { status: "PASS", reason: `Edge clears +3.0 pts but EV at ${oddsNum > 0 ? '+' : ''}${oddsNum} is ${(opts.ev * 100).toFixed(1)}% (vig eats it)` };
  }

  // 2c. One-sided price: the opposite side's fair price is only an assumption.
  if (opts.twoWay === false) {
    return { status: "PASS", reason: "One-sided price — enter both Over and Under odds to qualify" };
  }

  // 3. Agreement constraint: |model_mu - season_avg| <= 1.5
  if (Math.abs(modelMu - seasonAvg) > NFL_CONFIG.agreement_max) {
    return { status: "OFF", reason: `Model mu (${modelMu.toFixed(2)}) deviates > 1.5 rec from season avg (${seasonAvg.toFixed(2)})` };
  }

  return { status: "BET", reason: "Meets edge, price tolerance, and historical form agreement." };
}

/* -------------------------------------------------------------------------- */
/* One pricing path: mu + line + odds -> everything the desk shows            */
/* -------------------------------------------------------------------------- */

export interface NflPriceResult {
  p_over: number;
  p_under: number;
  p_push: number;
  fair_over: number;
  fair_under: number;
  lean: 'OVER' | 'UNDER';
  /** probability edge of the recommended side vs the de-vigged market */
  edge: number;
  /** expected value per 1u at the price offered for the recommended side */
  ev: number | null;
  oddsOffered: number;
  twoWay: boolean;
  hasMarket: boolean;
  status: 'BET' | 'PASS' | 'OFF';
  reason: string;
}

export function priceNflProp(args: {
  mu: number;
  alpha: number;
  line: number;
  overOdds?: string | number | null;
  underOdds?: string | number | null;
  seasonAvg: number;
}): NflPriceResult {
  const probs = calculateDiscreteLineProbs(args.mu, args.line, args.alpha);
  const cond = conditionalProbs(probs.p_over, probs.p_under);
  const market = priceMarket(args.overOdds, args.underOdds, NFL_CONFIG.one_sided_hold);

  if (!market) {
    // No usable price. Show the model's lean but never let it qualify.
    const lean = cond.over >= cond.under ? 'OVER' : 'UNDER';
    return {
      p_over: cond.over,
      p_under: cond.under,
      p_push: probs.p_push,
      fair_over: 0.5,
      fair_under: 0.5,
      lean,
      edge: 0,
      ev: null,
      oddsOffered: 0,
      twoWay: false,
      hasMarket: false,
      status: 'PASS',
      reason: 'No market line / odds entered'
    };
  }

  const edgeOver = cond.over - market.fairOver;
  const edgeUnder = cond.under - market.fairUnder;
  // Only recommend a side we have a price for
  let leanOver = edgeOver >= edgeUnder;
  if (leanOver && market.over === null) leanOver = false;
  if (!leanOver && market.under === null) leanOver = true;

  const bestEdge = leanOver ? edgeOver : edgeUnder;
  const chosen = leanOver ? market.over : market.under;
  const lean: 'OVER' | 'UNDER' = leanOver ? 'OVER' : 'UNDER';
  const pWin = leanOver ? cond.over : cond.under;
  // Pushes refund the stake, so the sign of EV is that of the conditional (push-free) bet
  const ev = chosen ? expectedValue(pWin, chosen.dec) : null;
  const oddsOffered = chosen ? chosen.us : 0;

  const card = evaluateCardRules(bestEdge, oddsOffered, args.mu, args.seasonAvg, {
    ev,
    twoWay: market.twoWay,
    hasMarket: true
  });

  return {
    p_over: cond.over,
    p_under: cond.under,
    p_push: probs.p_push,
    fair_over: market.fairOver,
    fair_under: market.fairUnder,
    lean,
    edge: bestEdge,
    ev,
    oddsOffered,
    twoWay: market.twoWay,
    hasMarket: true,
    status: card.status,
    reason: card.reason
  };
}

/* -------------------------------------------------------------------------- */
/* Game cap: max 3 BET suggestions per game, ranked by edge                   */
/* -------------------------------------------------------------------------- */

export function applyGameCap<T extends { gameKey: string; cardStatus: 'BET' | 'PASS' | 'OFF'; cardReason: string; edge: number }>(
  snaps: T[],
  cap: number = NFL_CONFIG.game_cap
): T[] {
  const byGame = new Map<string, T[]>();
  for (const s of snaps) {
    if (s.cardStatus !== 'BET') continue;
    const arr = byGame.get(s.gameKey) || [];
    arr.push(s);
    byGame.set(s.gameKey, arr);
  }
  const demote = new Set<T>();
  byGame.forEach(arr => {
    [...arr].sort((a, b) => b.edge - a.edge).slice(cap).forEach(s => demote.add(s));
  });
  if (demote.size === 0) return snaps;
  return snaps.map(s =>
    demote.has(s)
      ? { ...s, cardStatus: 'PASS' as const, cardReason: `Game cap exceeded (ranked below top ${cap} edges for this game)` }
      : s
  );
}

/* -------------------------------------------------------------------------- */
/* Walk-forward position ratio                                                */
/* -------------------------------------------------------------------------- */

export interface RatioObservation {
  pos: 'WR' | 'TE';
  /** pre-ratio structural mu the model predicted */
  muStructural: number;
  actual: number;
  played: boolean;
  week: number;
  season: number;
}

/**
 * Position-specific actual / predicted with in-season exponential decay, shrunk
 * toward the prior ratio and clipped to [0.85, 1.15]. Only observations strictly
 * BEFORE (season, week) are used, so a week's prices can never see that week's
 * results. Prior-season observations get `ratio_prior_season_weight` (default 0).
 */
export function computeWalkForwardRatios(
  obs: RatioObservation[],
  asOf: { season: number; week: number }
): Record<'WR' | 'TE', { ratio: number; n: number }> {
  const out = {} as Record<'WR' | 'TE', { ratio: number; n: number }>;
  (['WR', 'TE'] as const).forEach(pos => {
    const prior = NFL_CONFIG.ratio_prior[pos] ?? 1.0;
    let sumActual = 0;
    let sumPred = 0;
    let n = 0;
    for (const o of obs) {
      if (o.pos !== pos || !o.played || !(o.muStructural > 0)) continue;
      const before = o.season < asOf.season || (o.season === asOf.season && o.week < asOf.week);
      if (!before) continue;
      const sameSeason = o.season === asOf.season;
      const age = sameSeason ? asOf.week - o.week : (asOf.season - o.season) * 18 + (asOf.week - o.week);
      const w = (sameSeason ? 1 : NFL_CONFIG.ratio_prior_season_weight) * Math.pow(0.5, age / NFL_CONFIG.ratio_half_life);
      if (w <= 0) continue;
      sumActual += w * o.actual;
      sumPred += w * o.muStructural;
      n++;
    }
    if (sumPred <= 0) {
      out[pos] = { ratio: prior, n: 0 };
      return;
    }
    const raw = sumActual / sumPred;
    const wShrink = sumPred / (sumPred + NFL_CONFIG.ratio_k_mu);
    const shrunk = prior + wShrink * (raw - prior);
    out[pos] = {
      ratio: Math.min(NFL_CONFIG.ratio_clip[1], Math.max(NFL_CONFIG.ratio_clip[0], shrunk)),
      n
    };
  });
  return out;
}
