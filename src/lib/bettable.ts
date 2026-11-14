/**
 * "Bettable" = worth acting on. Sorting by raw model probability floods the desk with legs nobody prices sensibly
 * (a non-shooting centre under 0.5 threes, a non-shooter under shots): the model is right about them, and it does not matter.
 * This module only decides what RANKS as actionable. It never changes μ / r, never deletes a card row, never tags anything.
 *
 * A leg is bettable when: inputs are REAL, availability is known and not out / doubtful, expected usage clears a floor,
 * and (when a price is required) a real price exists whose chosen side is not worse than -maxJuice.
 * The feeds carry no attempt counts, so usage is judged on EXPECTED COUNT (μ) and projected minutes:
 * 3PM μ 0.4 is about 1.1 attempts at a league-average 36%.
 */
import { AvailabilityStatus, InputsSource } from './availability';

export type BetSport = 'nba' | 'nhl' | 'nfl' | 'mlb';
export type RankBy = 'ev' | 'edge' | 'p';

export interface BettableConfig {
  /** hide non-bettable rows by default (the "Full model" toggle turns this off) */
  bettableOnly: boolean;
  /** worst acceptable price on the chosen side (American, positive number: 175 = -175) */
  maxJuice: number;
  rankBy: RankBy;
  floors: {
    nbaMinutes: number; nbaTpmMu: number; nbaStlMu: number; nbaBlkMu: number;
    nhlSogMu: number; nhlPtsMu: number; nflRecMu: number; mlbAtBats: number;
  };
}
export const DEFAULT_BETTABLE: BettableConfig = {
  bettableOnly: true, maxJuice: 175, rankBy: 'ev',
  floors: { nbaMinutes: 12, nbaTpmMu: 0.4, nbaStlMu: 0.4, nbaBlkMu: 0.4, nhlSogMu: 1.0, nhlPtsMu: 0.2, nflRecMu: 1.0, mlbAtBats: 2 }
};
export const FLOOR_META: { key: keyof BettableConfig['floors']; label: string; help: string; step: number }[] = [
  { key: 'nbaMinutes', label: 'NBA minimum projected minutes', help: 'all NBA markets', step: 1 },
  { key: 'nbaTpmMu', label: 'NBA 3PM minimum expected makes', help: '0.4 ≈ 1.1 attempts/game', step: 0.05 },
  { key: 'nbaStlMu', label: 'NBA STL minimum expected', help: '', step: 0.05 },
  { key: 'nbaBlkMu', label: 'NBA BLK minimum expected', help: '', step: 0.05 },
  { key: 'nhlSogMu', label: 'NHL SOG minimum expected shots', help: '', step: 0.1 },
  { key: 'nhlPtsMu', label: 'NHL PTS minimum expected points', help: 'soft floor', step: 0.05 },
  { key: 'nflRecMu', label: 'NFL REC minimum expected receptions', help: 'skips pure non-targets', step: 0.1 },
  { key: 'mlbAtBats', label: 'MLB minimum projected at-bats', help: 'lineup must also be confirmed', step: 0.5 }
];

const BLOCKED = new Set<AvailabilityStatus>(['UNKNOWN', 'OUT', 'IR', 'INACTIVE', 'SCRATCHED', 'NOT_IN_LINEUP', 'DOUBTFUL']);
export const availabilityOk = (a: AvailabilityStatus | undefined) => !!a && !BLOCKED.has(a);

/** Why expected usage is too low for this market to be a real bet, or null. mu = expected count, pm = projected minutes / at-bats. */
export function usageIssue(sport: BetSport, market: string, mu: number, pm: number | null | undefined, cfg: BettableConfig): string | null {
  const f = cfg.floors;
  if (sport === 'nba') {
    if (pm != null && pm < f.nbaMinutes) return `low minutes (${pm.toFixed(0)} projected)`;
    if (market === 'tpm' && mu < f.nbaTpmMu) return `low 3PA (expected ${mu.toFixed(2)} threes)`;
    if (market === 'stl' && mu < f.nbaStlMu) return `low usage (expected ${mu.toFixed(2)} steals)`;
    if (market === 'blk' && mu < f.nbaBlkMu) return `low usage (expected ${mu.toFixed(2)} blocks)`;
  } else if (sport === 'nhl') {
    if (market === 'sog' && mu < f.nhlSogMu) return `low shot rate (expected ${mu.toFixed(2)})`;
    if (market === 'pts' && mu < f.nhlPtsMu) return `low points rate (expected ${mu.toFixed(2)})`;
  } else if (sport === 'nfl') {
    if (mu < f.nflRecMu) return `low target volume (expected ${mu.toFixed(2)} receptions)`;
  } else if (sport === 'mlb') {
    if (pm != null && pm < f.mlbAtBats) return `low at-bats (${pm.toFixed(1)} projected)`;
  }
  return null;
}

export interface BettableInput {
  sport: BetSport; market: string; mu: number; pm?: number | null;
  inputs: InputsSource | undefined; availability: AvailabilityStatus | undefined;
}
/** Model-side bettability (no price needed). */
export function bettableIssue(x: BettableInput, cfg: BettableConfig): string | null {
  if (x.inputs !== 'REAL') return 'estimated inputs';
  if (!availabilityOk(x.availability)) return `availability ${String(x.availability ?? 'unknown').toLowerCase().replace(/_/g, ' ')}`;
  return usageIssue(x.sport, x.market, x.mu, x.pm, cfg);
}
/** Price-side check for the chosen side's American odds. */
export function juiceIssue(chosenOdds: number | null | undefined, cfg: BettableConfig): string | null {
  if (chosenOdds == null) return null;
  return chosenOdds < -cfg.maxJuice ? `juice too high (${chosenOdds})` : null;
}

/* ------------------------------- best line -------------------------------- */
export interface LineEval { hasMarket: boolean; evOver: number | null; evUnder: number | null; edgeOver: number | null; edgeUnder: number | null }
export interface BestSide { side: 'over' | 'under'; ev: number | null; edge: number | null }
export function bestSide(e: LineEval | null | undefined): BestSide | null {
  if (!e || !e.hasMarket) return null;
  const cands: BestSide[] = [];
  if (e.evOver !== null || e.edgeOver !== null) cands.push({ side: 'over', ev: e.evOver, edge: e.edgeOver });
  if (e.evUnder !== null || e.edgeUnder !== null) cands.push({ side: 'under', ev: e.evUnder, edge: e.edgeUnder });
  if (!cands.length) return null;
  const score = (c: BestSide) => (c.ev ?? c.edge ?? -Infinity);
  return cands.sort((a, b) => score(b) - score(a))[0];
}
/** The posted line with the best EV (edge when no EV), over every priced line of one player-market. Ties go to the lower line. */
export function bestLine(lines: number[], evalAt: (line: number) => LineEval | null): ({ line: number } & BestSide) | null {
  let best: ({ line: number } & BestSide) | null = null;
  for (const line of [...lines].sort((a, b) => a - b)) {
    const b = bestSide(evalAt(line));
    if (!b) continue;
    const s = b.ev ?? b.edge ?? -Infinity, cur = best ? (best.ev ?? best.edge ?? -Infinity) : -Infinity;
    if (!best || s > cur + 1e-12) best = { line, ...b };
  }
  return best;
}
export function rankKey(rank: RankBy, b: BestSide | null, pBest: number): number {
  if (rank === 'p') return pBest;
  if (!b) return -Infinity; // unpriced rows sort below priced ones
  return rank === 'ev' ? (b.ev ?? b.edge ?? -Infinity) : (b.edge ?? b.ev ?? -Infinity);
}
