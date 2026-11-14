/**
 * NFL slate builder: turns raw nflverse CSV text into everything the desk needs
 * for one week (games with lines, receivers with walk-forward inputs, official
 * injury report, position ratios). Pure function + an injectable downloader so it
 * can be tested offline against real CSV files.
 */
import {
  parseCsv, buildNflReceiverStats, buildNflGames, buildNflInjuries,
  computeNflRatiosFromHistory, buildNflActuals, NflActual, currentNflWeek, nflSeasonFor, normalizePlayerName,
  NflInjuryInfo, CsvRow
} from './nflverse';
import { NflGameContext, NflPlayerStats } from '../types/nfl';

export interface NflSlate {
  season: number;
  week: number;
  generatedAt: string;
  /** last completed week included in the receiver inputs */
  asOfWeek: number;
  games: NflGameContext[];
  receivers: Record<string, NflPlayerStats[]>;
  injuries: Record<string, NflInjuryInfo>;
  /** false when no injury report could be loaded (availability is then UNKNOWN) */
  injuriesAvailable: boolean;
  ratios: Record<'WR' | 'TE', { ratio: number; n: number }>;
  warnings: string[];
}

export interface NflverseFiles {
  stats: string;
  snaps: string;
  players: string;
  injuries?: string;
  games: string;
  priorStats?: string;
  priorSnaps?: string;
}

export function buildNflSlate(files: NflverseFiles, opts: { season?: number; week?: number; now?: Date } = {}): NflSlate {
  const now = opts.now ?? new Date();
  const season = opts.season ?? nflSeasonFor(now);
  const gamesRows = parseCsv(files.games);
  const week = opts.week ?? currentNflWeek(gamesRows, season);
  const warnings: string[] = [];

  const playersRows = parseCsv(files.players);
  const current = { statsRows: parseCsv(files.stats), snapRows: parseCsv(files.snaps), playersRows };
  const prior = files.priorStats && files.priorSnaps
    ? { statsRows: parseCsv(files.priorStats), snapRows: parseCsv(files.priorSnaps), playersRows }
    : undefined;
  if (!prior) warnings.push('No prior-season data: TPRR priors fall back to league averages.');

  const ratios = computeNflRatiosFromHistory({ season, week, current, prior, gamesRows });
  const injuriesRows = files.injuries ? parseCsv(files.injuries) : undefined;
  const receivers = buildNflReceiverStats({
    season, week, current, prior,
    ratios: { WR: ratios.WR.ratio, TE: ratios.TE.ratio },
    injuriesRows
  });

  const games = buildNflGames(gamesRows, season, week);
  const missingLines = games.filter(g => g.hasLine === false).length;
  if (missingLines) warnings.push(`${missingLines} game(s) have no spread/total yet — they will not be priced.`);

  let injuries: Record<string, NflInjuryInfo> = {};
  if (injuriesRows) injuries = buildNflInjuries(injuriesRows, season, week);
  else warnings.push('Injury report unavailable — availability is UNKNOWN until you confirm it.');

  return {
    season, week, generatedAt: now.toISOString(), asOfWeek: week - 1,
    games, receivers, injuries, injuriesAvailable: Boolean(files.injuries), ratios, warnings
  };
}

/** Look up a player on the official injury report (normalized name). */
export function injuryFor(slate: Pick<NflSlate, 'injuries'>, name: string): NflInjuryInfo | undefined {
  return slate.injuries[normalizePlayerName(name)];
}

/* ------------------------------ downloading ------------------------------- */

const GH = 'https://github.com/nflverse/nflverse-data/releases/download';
export function nflverseUrls(season: number) {
  return {
    stats: `${GH}/stats_player/stats_player_week_${season}.csv`,
    snaps: `${GH}/snap_counts/snap_counts_${season}.csv`,
    priorStats: `${GH}/stats_player/stats_player_week_${season - 1}.csv`,
    priorSnaps: `${GH}/snap_counts/snap_counts_${season - 1}.csv`,
    injuries: `${GH}/injuries/injuries_${season}.csv`,
    players: `${GH}/players/players.csv`,
    games: 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
  };
}

export async function downloadNflverseFiles(
  season: number,
  fetchText: (url: string) => Promise<string>
): Promise<NflverseFiles> {
  const u = nflverseUrls(season);
  const opt = async (url: string) => { try { return await fetchText(url); } catch { return undefined; } };
  const [stats, snaps, players, games, injuries, priorStats, priorSnaps] = await Promise.all([
    fetchText(u.stats), fetchText(u.snaps), fetchText(u.players), fetchText(u.games),
    opt(u.injuries), opt(u.priorStats), opt(u.priorSnaps)
  ]);
  return { stats, snaps, players, games, injuries, priorStats, priorSnaps };
}

export type { CsvRow };

/** Final receptions for a finished week (real grading, no simulation). */
export function buildNflGrades(files: Pick<NflverseFiles, 'stats' | 'snaps' | 'players' | 'games'>, season: number, week: number) {
  const inp = { statsRows: parseCsv(files.stats), snapRows: parseCsv(files.snaps), playersRows: parseCsv(files.players) };
  return buildNflActuals(inp, parseCsv(files.games), season, week);
}
export type { NflActual };
