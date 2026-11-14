/** NHL automatic daily card: captures every priced skater market before puck drop, grades from the official box score. */
import { NhlSkaterProjection, NhlGameMatchup, NhlLedgerRow, NhlMarket } from '../types/nhl';
import { CardRow, LABELS, Outcome, gradeCardRows, summarizeCard } from './card_core';
import { NhlBoxResult } from './nhl_data';

export const NHL_MARKETS: NhlMarket[] = ['sog', 'pts'];
export const NHL_MARKET_LABEL: Record<NhlMarket, string> = { sog: 'Shots on goal', pts: 'Points' };
export type NhlPrediction = CardRow;
const NOT_PLAYING = new Set(['OUT', 'IR', 'INACTIVE', 'SCRATCHED']);

export const nhlPredictionId = (date: string, market: string, playerId: number | string) => `${date}:${market}:${playerId}`;
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Rows for every priced skater market not already logged, games not yet started only. Idempotent. */
export function captureNhlCard(
  projections: NhlSkaterProjection[], games: NhlGameMatchup[], existing: Set<string>, date: string, now = Date.now()
): NhlPrediction[] {
  const open = new Set(games.filter(g => Number.isFinite(Date.parse(g.startTimeUtc)) && now < Date.parse(g.startTimeUtc)).map(g => g.gameId));
  const out: NhlPrediction[] = [];
  for (const p of projections) {
    if (p.gameId === undefined || !open.has(p.gameId) || NOT_PLAYING.has(p.availability)) continue;
    for (const m of NHL_MARKETS) {
      const mp = m === 'sog' ? p.sog : p.pts;
      if (!mp) continue;
      const id = nhlPredictionId(date, m, p.playerId);
      if (existing.has(id)) continue;
      const probs = mp.probs[mp.defaultLine];
      if (!probs || !Number.isFinite(mp.mu)) continue;
      const pOver = probs.p_over / Math.max(1e-9, 1 - probs.p_push);
      const recent = m === 'sog' ? p.recentShots : p.recentPoints;
      out.push({
        id, date, capturedAt: now, gameId: String(p.gameId), market: m, playerId: p.playerId, name: p.name, team: p.team, opp: p.opp,
        mu: mp.mu, r: mp.r, line: mp.defaultLine, lean: pOver >= 0.5 ? 'OVER' : 'UNDER', pOver,
        pm: p.toiAvg > 0 ? p.toiAvg : null, avg: mean(recent),
        inputs: p.inputsSource, avail: p.availability, result: null, actual: null, minutes: null, err: null
      });
    }
  }
  return out;
}

export function gradeNhlCard(
  rows: NhlPrediction[], boxes: Record<string, NhlBoxResult | undefined>, today: string, staleDays = 7, now = Date.now()
) {
  const resolve = (r: NhlPrediction): Outcome => {
    const box = boxes[r.gameId];
    if (!box) return { state: 'missing' };
    if (box.voided) return { state: 'postponed' };
    if (!box.final) return { state: 'notfinal' };
    const p = box.players[String(r.playerId)];
    if (!p || !(p.toiSec > 0)) return { state: 'dnp' };
    return { state: 'final', actual: r.market === 'sog' ? p.sog : p.points, exposure: p.toiSec / 60 };
  };
  return gradeCardRows(rows, resolve, today, LABELS.nhl, { staleDays, now });
}

export const summarizeNhlCard = (rows: NhlPrediction[], includeEstimated = false) => summarizeCard(rows, NHL_MARKETS, includeEstimated);

/** player-markets that also have a priced STAB / FADE logged the same day */
export function nhlEdgeKeys(ledger: NhlLedgerRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of ledger) if (r.tag !== 'PASS' && !r.demo) s.add(nhlPredictionId(r.date, r.market, r.playerId));
  return s;
}
