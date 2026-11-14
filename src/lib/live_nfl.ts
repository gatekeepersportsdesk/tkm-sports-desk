import type { NflSlate } from './nfl_slate';
import type { NflGameContext } from '../types/nfl';

/**
 * Loads the week's slate (games + lines, receivers with walk-forward inputs,
 * official injury report, position ratios) built server-side from nflverse.
 * Returns null on any failure so the UI can say so instead of guessing.
 */
export async function fetchNflSlate(opts: { season?: number; week?: number } = {}): Promise<NflSlate | null> {
  try {
    const q = new URLSearchParams();
    if (opts.season) q.set('season', String(opts.season));
    if (opts.week) q.set('week', String(opts.week));
    const res = await fetch(`/api/nfl/slate${q.toString() ? `?${q}` : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.games)) throw new Error('bad slate payload');
    return data as NflSlate;
  } catch (e) {
    console.warn('NFL slate fetch failed', e);
    return null;
  }
}

export function gamesById(games: NflGameContext[]): Record<string, NflGameContext> {
  const out: Record<string, NflGameContext> = {};
  for (const g of games) out[g.id] = g;
  return out;
}

export interface NflGradesPayload {
  season: number;
  week: number;
  actuals: Record<string, { played: boolean; actual: number; team: string }>;
  finalTeams: string[];
}

/** Real final receptions for a finished week (nflverse), no simulation. */
export async function fetchNflGrades(season: number, week: number): Promise<NflGradesPayload | null> {
  try {
    const res = await fetch(`/api/nfl/grades?season=${season}&week=${week}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as NflGradesPayload;
  } catch (e) {
    console.warn('NFL grades fetch failed', e);
    return null;
  }
}
