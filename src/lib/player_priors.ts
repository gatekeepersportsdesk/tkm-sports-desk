/**
 * Gatekeep Sports Desk — External Player-Rate Priors & Bayesian Shrinkage
 *
 * Implements external player-rate priors for NFL (receptions) and NBA (points,
 * rebounds, assists, threes), matching the MoneyPuck approach used for NHL.
 *
 * Sources:
 * - nfl_player_rates_prior.csv: NFL skill players (2023-2024 weekly data)
 * - nba_player_rates_prior.csv: NBA 2023-24 and 2024-25 historical rates
 * - nba_player_rates_current.csv: NBA 2025-26 current-season rates for form adjustment
 */

import { normalizePlayerName } from './nflverse';
import { NbaMarket } from '../types/nba';

export interface NflPlayerRatePrior {
  playerId: string;
  playerName: string;
  position: 'WR' | 'TE';
  games: number;
  avgTargets: number;
  avgReceptions: number;
  avgRecYards: number;
  totalTargets: number;
  totalReceptions: number;
}

export interface NbaPlayerRatePrior {
  playerId: string | number;
  playerName: string;
  gp: number;
  min: number; // average minutes per game
  pts: number; // points per game
  reb: number; // rebounds per game
  ast: number; // assists per game
  fg3m: number; // three-pointers made per game
}

export interface NflPriorShrinkage {
  shrunkAvg: number;
  priorAvg: number;
  priorGames: number;
  weight: number;
  source: string;
}

export interface NbaPriorShrinkage {
  shrunkRate: number; // per-minute rate
  baseRate: number;   // original per-minute rate
  priorPerMin: number;
  priorPerGame: number;
  priorGp: number;
  weight: number;
  source: string;
}

// Global in-memory lookup caches keyed by normalized player name
const nflPriors = new Map<string, NflPlayerRatePrior>();
const nbaPriors = new Map<string, NbaPlayerRatePrior>();
const nbaCurrentPriors = new Map<string, NbaPlayerRatePrior>();

let priorsInitialized = false;

/**
 * Normalizes CSV line columns with trim and quote removal.
 */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let curr = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
    } else if (c === ',' && !inQuote) {
      cols.push(curr.trim().replace(/^["']|["']$/g, ''));
      curr = '';
    } else {
      curr += c;
    }
  }
  cols.push(curr.trim().replace(/^["']|["']$/g, ''));
  return cols;
}

/**
 * Parses nfl_player_rates_prior.csv into map.
 * Expected columns: player_id, player_name, position, games, avg_targets, avg_receptions, avg_rec_yards, total_targets, total_receptions
 */
export function parseNflPlayerRatesPrior(csvContent: string): Map<string, NflPlayerRatePrior> {
  const map = new Map<string, NflPlayerRatePrior>();
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return map;

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const colId = header.findIndex(h => h === 'player_id' || h === 'id');
  const colName = header.findIndex(h => h === 'player_name' || h === 'name' || h === 'player');
  const colPos = header.findIndex(h => h === 'position' || h === 'pos');
  const colGames = header.findIndex(h => h === 'games' || h === 'gp');
  const colAvgTgt = header.findIndex(h => h === 'avg_targets' || h === 'targets_per_game');
  const colAvgRec = header.findIndex(h => h === 'avg_receptions' || h === 'receptions_per_game');
  const colAvgYds = header.findIndex(h => h === 'avg_rec_yards' || h === 'rec_yards_per_game');
  const colTotTgt = header.findIndex(h => h === 'total_targets');
  const colTotRec = header.findIndex(h => h === 'total_receptions');

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name = colName !== -1 ? cols[colName] : '';
    if (!name) continue;

    const games = colGames !== -1 ? parseInt(cols[colGames], 10) || 0 : 0;
    const avgRec = colAvgRec !== -1 ? parseFloat(cols[colAvgRec]) || 0 : 0;
    const avgTgt = colAvgTgt !== -1 ? parseFloat(cols[colAvgTgt]) || 0 : 0;
    const avgYds = colAvgYds !== -1 ? parseFloat(cols[colAvgYds]) || 0 : 0;
    const totTgt = colTotTgt !== -1 ? parseFloat(cols[colTotTgt]) || 0 : 0;
    const totRec = colTotRec !== -1 ? parseFloat(cols[colTotRec]) || 0 : 0;
    const pos = (colPos !== -1 && cols[colPos]?.toUpperCase() === 'TE' ? 'TE' : 'WR') as 'WR' | 'TE';
    const id = colId !== -1 ? cols[colId] : '';

    const record: NflPlayerRatePrior = {
      playerId: id,
      playerName: name,
      position: pos,
      games,
      avgTargets: avgTgt,
      avgReceptions: avgRec,
      avgRecYards: avgYds,
      totalTargets: totTgt,
      totalReceptions: totRec
    };

    const normDirect = normalizePlayerName(name);
    map.set(normDirect, record);
    // Also store spaced variant if name was "T.Kelce" -> "t kelce"
    const spaced = normalizePlayerName(name.replace(/[._]/g, ' '));
    if (spaced !== normDirect) {
      map.set(spaced, record);
    }
  }
  return map;
}

/**
 * Parses nba_player_rates_prior.csv or nba_player_rates_current.csv into map.
 * Expected columns: PLAYER_NAME, PLAYER_ID, GP, MIN, PTS, REB, AST, FG3M
 */
export function parseNbaPlayerRates(csvContent: string): Map<string, NbaPlayerRatePrior> {
  const map = new Map<string, NbaPlayerRatePrior>();
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return map;

  const header = parseCsvLine(lines[0]).map(h => h.toUpperCase());
  const colName = header.findIndex(h => h === 'PLAYER_NAME' || h === 'NAME' || h === 'PLAYER');
  const colId = header.findIndex(h => h === 'PLAYER_ID' || h === 'ID');
  const colGp = header.findIndex(h => h === 'GP' || h === 'GAMES');
  const colMin = header.findIndex(h => h === 'MIN' || h === 'MINUTES');
  const colPts = header.findIndex(h => h === 'PTS' || h === 'POINTS');
  const colReb = header.findIndex(h => h === 'REB' || h === 'REBOUNDS');
  const colAst = header.findIndex(h => h === 'AST' || h === 'ASSISTS');
  const colFg3m = header.findIndex(h => h === 'FG3M' || h === '3PM' || h === 'THREES');

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const name = colName !== -1 ? cols[colName] : '';
    if (!name) continue;

    const gp = colGp !== -1 ? parseInt(cols[colGp], 10) || 0 : 0;
    const min = colMin !== -1 ? parseFloat(cols[colMin]) || 0 : 0;
    const pts = colPts !== -1 ? parseFloat(cols[colPts]) || 0 : 0;
    const reb = colReb !== -1 ? parseFloat(cols[colReb]) || 0 : 0;
    const ast = colAst !== -1 ? parseFloat(cols[colAst]) || 0 : 0;
    const fg3m = colFg3m !== -1 ? parseFloat(cols[colFg3m]) || 0 : 0;
    const id = colId !== -1 ? cols[colId] : '';

    const record: NbaPlayerRatePrior = {
      playerId: id,
      playerName: name,
      gp,
      min,
      pts,
      reb,
      ast,
      fg3m
    };

    map.set(normalizePlayerName(name), record);
  }
  return map;
}

/**
 * Initializes priors by reading local files in Node.js environments (tests/server)
 * or fetching via HTTP endpoints in browser environments.
 */
export function initPlayerPriorsSync(data?: {
  nflPriorCsv?: string;
  nbaPriorCsv?: string;
  nbaCurrentCsv?: string;
}): void {
  if (data?.nflPriorCsv) {
    const parsed = parseNflPlayerRatesPrior(data.nflPriorCsv);
    parsed.forEach((val, key) => nflPriors.set(key, val));
  }
  if (data?.nbaPriorCsv) {
    const parsed = parseNbaPlayerRates(data.nbaPriorCsv);
    parsed.forEach((val, key) => nbaPriors.set(key, val));
  }
  if (data?.nbaCurrentCsv) {
    const parsed = parseNbaPlayerRates(data.nbaCurrentCsv);
    parsed.forEach((val, key) => nbaCurrentPriors.set(key, val));
  }
  priorsInitialized = true;
}

/**
 * Reads local fixture files directly when running inside Node (test runners, dev scripts, server).
 */
export function loadPriorsFromFsSync(): boolean {
  if (typeof window !== 'undefined') return false;
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      let fs: any = null;
      let path: any = null;

      if (typeof (process as any).getBuiltinModule === 'function') {
        fs = (process as any).getBuiltinModule('fs');
        path = (process as any).getBuiltinModule('path');
      } else {
        try {
          const req = (eval)('require');
          fs = req('fs');
          path = req('path');
        } catch { /* ignore */ }
      }

      if (!fs || !path) return false;

      const findAndRead = (filename: string): string | null => {
        const candidates = [
          path.resolve(process.cwd(), 'src/model/fixtures', filename),
          path.resolve(process.cwd(), 'fixtures', filename),
          path.resolve(process.cwd(), 'public/fixtures', filename),
          path.resolve(process.cwd(), 'public/data', filename)
        ];
        for (const p of candidates) {
          try {
            if (fs.existsSync(p)) {
              return fs.readFileSync(p, 'utf8');
            }
          } catch { /* continue */ }
        }
        return null;
      };

      const nflText = findAndRead('nfl_player_rates_prior.csv');
      if (nflText) {
        const parsed = parseNflPlayerRatesPrior(nflText);
        parsed.forEach((val, key) => nflPriors.set(key, val));
      }

      const nbaPriorText = findAndRead('nba_player_rates_prior.csv');
      if (nbaPriorText) {
        const parsed = parseNbaPlayerRates(nbaPriorText);
        parsed.forEach((val, key) => nbaPriors.set(key, val));
      }

      const nbaCurText = findAndRead('nba_player_rates_current.csv');
      if (nbaCurText) {
        const parsed = parseNbaPlayerRates(nbaCurText);
        parsed.forEach((val, key) => nbaCurrentPriors.set(key, val));
      }

      priorsInitialized = true;
      return true;
    }
  } catch {
    // Ignore in browser contexts
  }
  return false;
}

// Auto-run synchronous FS loader if in Node.js
loadPriorsFromFsSync();

/**
 * Async browser loader that fetches the prior CSVs from public/fixtures or server routes.
 */
export async function loadPlayerPriorsClient(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const [nflRes, nbaPriorRes, nbaCurRes] = await Promise.all([
      fetch('/fixtures/nfl_player_rates_prior.csv').catch(() => null),
      fetch('/fixtures/nba_player_rates_prior.csv').catch(() => null),
      fetch('/fixtures/nba_player_rates_current.csv').catch(() => null)
    ]);

    if (nflRes && nflRes.ok) {
      const text = await nflRes.text();
      const parsed = parseNflPlayerRatesPrior(text);
      parsed.forEach((val, key) => nflPriors.set(key, val));
    }

    if (nbaPriorRes && nbaPriorRes.ok) {
      const text = await nbaPriorRes.text();
      const parsed = parseNbaPlayerRates(text);
      parsed.forEach((val, key) => nbaPriors.set(key, val));
    }

    if (nbaCurRes && nbaCurRes.ok) {
      const text = await nbaCurRes.text();
      const parsed = parseNbaPlayerRates(text);
      parsed.forEach((val, key) => nbaCurrentPriors.set(key, val));
    }

    priorsInitialized = true;
  } catch (err) {
    console.warn('[player_priors] Client fetch failed, using memory/fallback:', err);
  }
}

/**
 * Look up NFL player prior by name. Supports both full names ("Travis Kelce")
 * and abbreviated/initial formats ("T.Kelce" or "t kelce").
 */
export function getNflPlayerPrior(playerName: string): NflPlayerRatePrior | undefined {
  if (!priorsInitialized) loadPriorsFromFsSync();
  const norm = normalizePlayerName(playerName);
  const direct = nflPriors.get(norm);
  if (direct) return direct;

  // If queried as full name "Travis Kelce", check initial formats "t kelce" and "tkelce"
  const parts = norm.split(' ');
  if (parts.length >= 2) {
    const initSpaced = `${parts[0][0]} ${parts.slice(1).join(' ')}`;
    const foundSpaced = nflPriors.get(initSpaced);
    if (foundSpaced) return foundSpaced;

    const initCompact = `${parts[0][0]}${parts.slice(1).join('')}`;
    const foundCompact = nflPriors.get(initCompact);
    if (foundCompact) return foundCompact;
  }
  return undefined;
}

/**
 * Look up NBA player historical prior and current-season rates by name.
 */
export function getNbaPlayerPrior(playerName: string): {
  prior?: NbaPlayerRatePrior;
  current?: NbaPlayerRatePrior;
} {
  if (!priorsInitialized) loadPriorsFromFsSync();
  const key = normalizePlayerName(playerName);
  return {
    prior: nbaPriors.get(key),
    current: nbaCurrentPriors.get(key)
  };
}

/**
 * Bayesian shrinkage for NFL receptions:
 * Shrinks recent-form / season average receptions toward avg_receptions from
 * the NFL prior. Uses weight based on games played (more games = more weight on prior).
 *
 * Weight formula: weight = games / (games + K)
 * Shrunk = (1 - weight) * recentAvg + weight * priorAvg
 */
export function shrinkNflReceptions(
  recentAvg: number,
  prior: NflPlayerRatePrior | undefined,
  k: number = 8.0 // default shrinkage pseudo-games
): NflPriorShrinkage {
  if (!prior || prior.games <= 0 || !Number.isFinite(prior.avgReceptions) || prior.avgReceptions <= 0) {
    return {
      shrunkAvg: recentAvg,
      priorAvg: recentAvg,
      priorGames: 0,
      weight: 0,
      source: 'none'
    };
  }

  const games = Math.max(0, prior.games);
  const weight = games / (games + k);
  const shrunkAvg = (1 - weight) * recentAvg + weight * prior.avgReceptions;

  return {
    shrunkAvg: Math.round(shrunkAvg * 1000) / 1000,
    priorAvg: prior.avgReceptions,
    priorGames: games,
    weight: Math.round(weight * 1000) / 1000,
    source: 'nfl_player_rates_prior.csv'
  };
}

/**
 * Bayesian shrinkage for NBA models (points, rebounds, assists, threes):
 * Shrinks recent-form per-minute rate toward the corresponding column from
 * historical prior (PTS, REB, AST, FG3M).
 *
 * Optionally blends current-season file with smaller weight (e.g. 20%) to react to new schemes.
 */
export function shrinkNbaMarketRate(
  basePerMinRate: number,
  market: NbaMarket,
  projMinutes: number,
  priorRecord: NbaPlayerRatePrior | undefined,
  curRecord: NbaPlayerRatePrior | undefined,
  k: number = 20.0 // pseudo-games for NBA (season is 82 games)
): NbaPriorShrinkage {
  if (!priorRecord || priorRecord.gp <= 0) {
    return {
      shrunkRate: basePerMinRate,
      baseRate: basePerMinRate,
      priorPerMin: basePerMinRate,
      priorPerGame: basePerMinRate * projMinutes,
      priorGp: 0,
      weight: 0,
      source: 'none'
    };
  }

  // Extract relevant stat from prior
  let priorPerGame = 0;
  if (market === 'pts') priorPerGame = priorRecord.pts;
  else if (market === 'reb') priorPerGame = priorRecord.reb;
  else if (market === 'ast') priorPerGame = priorRecord.ast;
  else if (market === 'tpm') priorPerGame = priorRecord.fg3m;
  else if (market === 'pra') priorPerGame = priorRecord.pts + priorRecord.reb + priorRecord.ast;
  else {
    // Steals or blocks without external column: fall back with 0 weight
    return {
      shrunkRate: basePerMinRate,
      baseRate: basePerMinRate,
      priorPerMin: basePerMinRate,
      priorPerGame: basePerMinRate * projMinutes,
      priorGp: 0,
      weight: 0,
      source: 'none'
    };
  }

  if (priorPerGame <= 0) {
    return {
      shrunkRate: basePerMinRate,
      baseRate: basePerMinRate,
      priorPerMin: basePerMinRate,
      priorPerGame: basePerMinRate * projMinutes,
      priorGp: 0,
      weight: 0,
      source: 'none'
    };
  }

  // Blend in current season if available (20% current, 80% prior)
  let targetPerGame = priorPerGame;
  let source = 'nba_player_rates_prior.csv';
  if (curRecord && curRecord.gp >= 3) {
    let curPerGame = 0;
    if (market === 'pts') curPerGame = curRecord.pts;
    else if (market === 'reb') curPerGame = curRecord.reb;
    else if (market === 'ast') curPerGame = curRecord.ast;
    else if (market === 'tpm') curPerGame = curRecord.fg3m;
    else if (market === 'pra') curPerGame = curRecord.pts + curRecord.reb + curRecord.ast;

    if (curPerGame > 0) {
      targetPerGame = 0.80 * priorPerGame + 0.20 * curPerGame;
      source = 'nba_player_rates_prior + current (80/20)';
    }
  }

  // Determine per-minute rate: use player's average minutes in prior (or projected minutes)
  const priorMinutes = priorRecord.min > 0 ? priorRecord.min : Math.max(projMinutes, 15);
  const priorPerMin = targetPerGame / priorMinutes;

  // Weight based on games played in historical prior
  const weight = priorRecord.gp / (priorRecord.gp + k);
  const shrunkRate = (1 - weight) * basePerMinRate + weight * priorPerMin;

  return {
    shrunkRate: Math.max(0.001, Math.round(shrunkRate * 10000) / 10000),
    baseRate: basePerMinRate,
    priorPerMin: Math.round(priorPerMin * 10000) / 10000,
    priorPerGame: Math.round(targetPerGame * 100) / 100,
    priorGp: priorRecord.gp,
    weight: Math.round(weight * 1000) / 1000,
    source
  };
}
