/**
 * The automatic daily card: capture every player-market the model prices BEFORE tip-off, grade it from the real box
 * score afterwards, and summarise how good the projections actually were. No price, no clicking.
 *
 * Honesty rules built in:
 *  - only pre-game rows are captured (a game that is in progress or final is skipped), and a captured row is never rewritten;
 *  - a player who did not play is VOID, never a zero and never a miss;
 *  - headline numbers use REAL inputs with a known availability only; estimated / unknown rows are kept but reported separately;
 *  - the "win rate" is measured at the model's own line (about its mean). Counts are right-skewed, so 'under' wins more than half
 *    the time there for ANY model; the always-UNDER baseline is shown beside it. MAE vs the season-average comparator and
 *    interval coverage are the real quality tests.
 */
import { NbaMarket, NBA_MARKETS, NbaPlayerProjection, NbaPlayerSnapshot, NbaPrediction, NbaBoxLine, NbaLedgerRow, NBA_MARKET_UNIT } from '../types/nba';
import { NbaGame } from './nba_data';
import {
  LABELS,
  CardFilter,
  CardSummary,
  MarketStats,
  Outcome,
  filterCardRows,
  gradeCardRows,
  isHeadline as coreIsHeadline,
  mergeCardRows,
  reasonFor as coreReason,
  summarizeCard
} from './card_core';

const NOT_PLAYING = new Set(['OUT', 'IR', 'INACTIVE', 'SCRATCHED']);

export function predictionId(date: string, market: NbaMarket, playerId: number): string { return `${date}:${market}:${playerId}`; }

/**
 * Rows for every priced player-market that is not already logged. Idempotent: calling it again later in the day only adds
 * players that were not on the board before (a later injury-report change never rewrites an earlier row).
 */
export function captureDailyCard(
  projections: NbaPlayerProjection[],
  games: NbaGame[],
  players: NbaPlayerSnapshot[],
  existing: Set<string>,
  date: string,
  now = Date.now(),
  allowFinished = false
): NbaPrediction[] {
  const open = new Set(games.filter(g => allowFinished || (g.state === 'pre' && !g.completed && !g.postponed)).map(g => g.gameId));
  const byId = new Map(players.map(p => [p.playerId, p]));
  const out: NbaPrediction[] = [];
  for (const p of projections) {
    if (!p.gameId || !open.has(p.gameId) || NOT_PLAYING.has(p.availability)) continue;
    const snap = byId.get(p.playerId);
    for (const m of NBA_MARKETS) {
      const id = predictionId(date, m, p.playerId);
      if (existing.has(id)) continue;
      const mp = p.markets[m];
      const probs = mp.probs[mp.defaultLine];
      if (!probs) continue;
      const pOver = probs.p_over / Math.max(1e-9, 1 - probs.p_push);
      out.push({
        id, date, capturedAt: now, gameId: p.gameId, market: m, playerId: p.playerId, name: p.name, team: p.team, opp: p.opp,
        mu: mp.mu, r: mp.r, line: mp.defaultLine, lean: pOver >= 0.5 ? 'OVER' : 'UNDER', pOver,
        pm: mp.pm, rate: mp.rate, oppF: mp.oppFactor, absF: mp.absFactor, lvl: mp.level,
        avg: snap && snap.gp > 0 ? snap.cum[m] / snap.gp : null,
        inputs: p.inputsSource, avail: p.availability, result: null, actual: null, minutes: null, err: null
      });
    }
  }
  return out;
}

export const mergePredictions = mergeCardRows<NbaPrediction>;
export const isHeadline = coreIsHeadline;
export type { CardFilter, CardSummary, MarketStats };

/** A short, factual explanation built only from numbers we have (no invented causes). */
export function reasonFor(r: Pick<NbaPrediction, 'mu' | 'r' | 'line' | 'lean' | 'pm'>, actual: number, minutes: number, result: 'HIT' | 'MISS' | 'PUSH'): string {
  return coreReason(r, actual, minutes, result, LABELS.nba);
}

/** Grade pending rows from real box lines. DNP / zero minutes = VOID; a game that never appears long after its date = VOID. */
export function gradePredictions(
  rows: NbaPrediction[], lines: NbaBoxLine[], today: string, staleDays = 7, now = Date.now()
): { rows: NbaPrediction[]; graded: number; pending: number; voided: number } {
  const byGame = new Map<string, Map<number, NbaBoxLine>>();
  for (const l of lines) {
    const m = byGame.get(l.gameId) ?? new Map<number, NbaBoxLine>();
    m.set(l.playerId, l);
    byGame.set(l.gameId, m);
  }
  const resolve = (r: NbaPrediction): Outcome => {
    const g = byGame.get(r.gameId);
    if (!g) return { state: 'missing' };
    const l = g.get(r.playerId as number);
    if (!l || l.dnp || !(l.minutes > 0)) return { state: 'dnp' };
    return { state: 'final', actual: l.actual[r.market], exposure: l.minutes };
  };
  return gradeCardRows(rows, resolve, today, LABELS.nba, { staleDays, now });
}

export const summarizePredictions = (all: NbaPrediction[], includeEstimated = false) => summarizeCard(all, NBA_MARKETS, includeEstimated);

/** player-markets that also have a priced STAB / FADE logged the same day (the "edge plays" filter) */
export function edgeKeys(ledger: NbaLedgerRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of ledger) if (r.tag !== 'PASS') s.add(predictionId(r.date, r.market, r.playerId));
  return s;
}

export const filterPredictions = (rows: NbaPrediction[], f: CardFilter, market: NbaMarket | 'all', edge: Set<string>, includeEstimated: boolean) =>
  filterCardRows(rows, f, market, edge, includeEstimated);

export { NBA_MARKET_UNIT };
