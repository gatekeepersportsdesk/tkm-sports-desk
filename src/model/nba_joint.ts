/**
 * NBA joints: a Gaussian copula over the validated Negative Binomial marginals, with correlations MEASURED on real box
 * scores (scripts/nba/fit_nba.py, held-out residuals, matched on the copula scale; src/data/nba_fit.ts `corr`).
 *
 * What the measurement says (and what this therefore models):
 *  - SAME player, different stats: clearly correlated (points-threes about 0.7, points-rebounds 0.3, points-assists 0.2).
 *  - TEAMMATES and OPPONENTS: at most a few hundredths. Any pair inside its own sampling noise is set to exactly 0.
 *    So a "stack" of different players prices close to the product, and the tool says so instead of inventing structure.
 *  - PRA already contains points + rebounds + assists, so a PRA leg together with one of its parts for the SAME player
 *    is refused (a copula cannot represent an exact sum).
 * Pricing is a display of fair probabilities; it never produces a bet signal.
 */
import { NBA_CONFIG } from './nba_engine';
import { NBA_MARKETS, NbaMarket } from '../types/nba';
import { jointProbability, JointResult, Leg } from './sampler';

export interface NbaJointLeg {
  playerId: number;
  team: string;
  /** the game the legs come from; legs from different games are independent */
  gameId: string;
  market: NbaMarket;
  mu: number;
  r: number;
  line: number;
  side: 'over' | 'under';
}

export type NbaRelation = 'samePlayer' | 'teammate' | 'opponent';

export function measuredRho(rel: NbaRelation, a: NbaMarket, b: NbaMarket): number {
  const t = NBA_CONFIG.fit.corr[rel];
  const ia = NBA_MARKETS.indexOf(a), ib = NBA_MARKETS.indexOf(b);
  const key = ia <= ib ? `${a}|${b}` : `${b}|${a}`;
  return t[key] ?? 0;
}

/** Why a set of legs cannot be priced together, or null. */
export function jointConflict(legs: Pick<NbaJointLeg, 'playerId' | 'market'>[]): string | null {
  const seen = new Set<string>();
  for (const l of legs) {
    const k = `${l.playerId}|${l.market}`;
    if (seen.has(k)) return 'Two legs on the same player and stat: pick one line.';
    seen.add(k);
  }
  const parts: NbaMarket[] = ['pts', 'reb', 'ast'];
  for (const l of legs) {
    if (l.market === 'pra' && legs.some(o => o.playerId === l.playerId && parts.includes(o.market))) return 'PRA already includes points, rebounds and assists for that player: drop one of the legs.';
  }
  return null;
}

export function nbaLegCorrelation(legs: Pick<NbaJointLeg, 'playerId' | 'team' | 'gameId' | 'market'>[]): number[][] {
  return legs.map((a, i) => legs.map((b, j) => {
    if (i === j) return 1;
    if (a.gameId !== b.gameId) return 0;
    if (a.playerId === b.playerId) return measuredRho('samePlayer', a.market, b.market);
    return measuredRho(a.team === b.team ? 'teammate' : 'opponent', a.market, b.market);
  }));
}

export interface NbaJointResult extends JointResult { corr: number[][]; conflict: string | null }

export function priceNbaJoint(legs: NbaJointLeg[], opts: { sims?: number; seed?: number } = {}): NbaJointResult {
  const conflict = jointConflict(legs);
  const corr = nbaLegCorrelation(legs);
  if (conflict || legs.length === 0) return { p: 0, pIndep: 0, se: 0, sims: 0, corr, conflict: conflict ?? 'No legs.' };
  const sl: Leg[] = legs.map(l => ({ marginal: { mu: l.mu, r: l.r }, line: l.line, side: l.side }));
  return { ...jointProbability(sl, corr, opts), corr, conflict: null };
}
