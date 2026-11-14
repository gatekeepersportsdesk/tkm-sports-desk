/** NFL automatic daily card (receptions): every live-input WR/TE priced before kickoff, graded from nflverse finals. */
import { NflGameContext, NflPlayerStats, NflPropSnapshot } from '../types/nfl';
import { CardRow, LABELS, Outcome, gradeCardRows, summarizeCard } from './card_core';
import { baselineSnapshot, NflImportContext } from './nfl_import';
import { normalizePlayerName } from './nflverse';
import type { NflGradesPayload } from './live_nfl';

export const NFL_MARKETS = ['rec'];
export const NFL_MARKET_LABEL: Record<string, string> = { rec: 'Receptions' };
export type NflPrediction = CardRow;
const NOT_PLAYING = new Set(['OUT', 'IR', 'INACTIVE', 'SCRATCHED']);

export const nflPredictionId = (season: number, week: number, name: string) => `${season}-${week}:rec:${normalizePlayerName(name)}`;

/**
 * Rows for every nflverse-backed receiver whose game has a known kickoff that has not happened. Seed / estimated pools are
 * not logged (no live inputs). Idempotent per player-week; a later injury change never rewrites an earlier row.
 */
export function captureNflCard(
  games: Record<string, NflGameContext>, rosters: Record<string, NflPlayerStats[]>,
  ctx: Pick<NflImportContext, 'injuries' | 'injuriesAvailable'>, existing: Set<string>, date: string, now = Date.now()
): NflPrediction[] {
  const out: NflPrediction[] = [];
  for (const g of Object.values(games)) {
    if (g.played || g.kickoffAt == null || !(now < g.kickoffAt)) continue;
    for (const team of [g.home, g.away]) {
      for (const p of rosters[team] || []) {
        if (p.source !== 'nflverse') continue;
        const id = nflPredictionId(g.season, g.week, p.name);
        if (existing.has(id)) continue;
        const s = baselineSnapshot(p, g, ctx);
        const avail = s.availability ?? 'UNKNOWN';
        if (NOT_PLAYING.has(avail) || !Number.isFinite(s.mu) || !(s.alpha > 0)) continue;
        out.push({
          id, date, capturedAt: now, gameId: g.id, market: 'rec', playerId: normalizePlayerName(p.name), name: p.name, team: p.team,
          opp: p.team === g.home ? g.away : g.home, mu: s.mu, r: 1 / s.alpha, line: s.line, lean: s.lean,
          pOver: s.p_over / Math.max(1e-9, 1 - (s.p_push ?? 0)), pm: null, avg: p.season_avg > 0 ? p.season_avg : null,
          inputs: s.inputsSource ?? 'UNKNOWN', avail, result: null, actual: null, minutes: null, err: null, season: g.season, week: g.week
        });
      }
    }
  }
  return out;
}

/** payloads keyed `${season}-${week}`; a missing payload leaves the row pending (VOID only when very stale). */
export function gradeNflCard(rows: NflPrediction[], payloads: Record<string, NflGradesPayload | null | undefined>, today: string, staleDays = 14, now = Date.now()) {
  const resolve = (r: NflPrediction): Outcome => {
    const g = payloads[`${r.season}-${r.week}`];
    if (!g) return { state: 'missing' };
    if (!g.finalTeams.includes(r.team)) return { state: 'notfinal' };
    const a = g.actuals[String(r.playerId)];
    if (!a || !a.played) return { state: 'dnp' };
    return { state: 'final', actual: a.actual, exposure: null };
  };
  return gradeCardRows(rows, resolve, today, LABELS.nfl, { staleDays, now });
}

export const summarizeNflCard = (rows: NflPrediction[], includeEstimated = false) => summarizeCard(rows, NFL_MARKETS, includeEstimated);

/** weeks that still hold ungraded rows (what the auto-grader needs to fetch) */
export const nflPendingWeeks = (rows: NflPrediction[]) => Array.from(new Set(rows.filter(r => r.result === null).map(r => `${r.season}-${r.week}`)));

export function nflEdgeKeys(snaps: NflPropSnapshot[]): Set<string> {
  const s = new Set<string>();
  for (const x of snaps) if (x.hasMarket !== false && x.cardStatus === 'BET') s.add(nflPredictionId(x.season, x.week, x.player));
  return s;
}
