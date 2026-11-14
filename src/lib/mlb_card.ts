/** MLB automatic daily card (0.5 hits): every confirmed-lineup batter priced before first pitch, graded from final box scores. */
import { MlbGameMatchup, MlbLedgerRow } from '../types/mlb';
import { scoreMlbHit, MLB_DEFAULT_TUNE } from '../model/mlb_engine';
import { batterForEngine, roundOf } from './mlb_stats';
import { CardRow, LABELS, Outcome, gradeCardRows, summarizeCard } from './card_core';
import { MlbBoxResult } from './mlb_grade';

export const MLB_MARKETS = ['hit'];
export const MLB_MARKET_LABEL: Record<string, string> = { hit: '0.5 hits' };
export type MlbPrediction = CardRow;

export const mlbPredictionId = (date: string, playerId: number | string) => `${date}:hit:${playerId}`;

/** a game that has demonstrably not started: not live and the status is a pre-game one */
export const mlbNotStarted = (g: Pick<MlbGameMatchup, 'live' | 'status'>) =>
  !g.live && !/final|game over|completed|postponed|cancel|suspend|progress|delay|manager challenge|review/i.test(g.status || '');

/** Confirmed lineups only (nothing is priced from projected lineups). Idempotent per batter-day. */
export function captureMlbCard(games: MlbGameMatchup[], existing: Set<string>, date: string, tune = MLB_DEFAULT_TUNE, now = Date.now()): MlbPrediction[] {
  const out: MlbPrediction[] = [];
  for (const g of games) {
    if (!g.confirmed || !mlbNotStarted(g)) continue;
    for (const b of g.batters) {
      if (b.availability === 'OUT' || b.availability === 'NOT_IN_LINEUP') continue;
      const id = mlbPredictionId(date, b.id);
      if (existing.has(id)) continue;
      const oppSp = b.isHome ? g.awaySp : g.homeSp;
      const hit = scoreMlbHit(batterForEngine(b), oppSp, g.park, roundOf(g.gameType), 4.4, tune);
      if (!Number.isFinite(hit.calP) || !(hit.ab > 0) || !Number.isFinite(hit.ba)) continue;
      const pOver = hit.calP; // P(>= 1 hit), no push possible at 0.5
      out.push({
        id, date, capturedAt: now, gameId: String(g.gamePk), market: 'hit', playerId: b.id, name: b.name, team: b.team,
        opp: b.isHome ? g.away : g.home, mu: hit.ba * hit.ab, r: null, line: 0.5, lean: pOver >= 0.5 ? 'OVER' : 'UNDER', pOver,
        pm: hit.ab, avg: Number.isFinite(b.seasonBa) ? b.seasonBa * hit.ab : null,
        inputs: hit.inputsReal && b.inputsSource === 'REAL' ? 'REAL' : b.inputsSource === 'UNKNOWN' ? 'UNKNOWN' : 'ESTIMATED',
        avail: b.availability ?? 'UNKNOWN', result: null, actual: null, minutes: null, err: null
      });
    }
  }
  return out;
}

export function gradeMlbCard(rows: MlbPrediction[], boxes: Record<string, MlbBoxResult | undefined>, today: string, staleDays = 7, now = Date.now()) {
  const resolve = (r: MlbPrediction): Outcome => {
    const box = boxes[r.gameId];
    if (!box) return { state: 'missing' };
    if (box.voided) return { state: 'postponed' };
    if (!box.final) return { state: 'notfinal' };
    const p = box.players[String(r.playerId)];
    if (!p || p.pa <= 0) return { state: 'dnp' };
    return { state: 'final', actual: p.hits, exposure: p.atBats };
  };
  return gradeCardRows(rows, resolve, today, LABELS.mlb, { staleDays, now });
}

export const summarizeMlbCard = (rows: MlbPrediction[], includeEstimated = false) => summarizeCard(rows, MLB_MARKETS, includeEstimated);

export function mlbEdgeKeys(ledger: MlbLedgerRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of ledger) if (!r.demo && r.call === 'PLAY' && (r.line ?? 0.5) === 0.5) s.add(mlbPredictionId(r.date, r.id));
  return s;
}
