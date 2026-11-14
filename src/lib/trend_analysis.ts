/**
 * Trend Analysis & L10 Hit Rate Engine for Gatekeep Sports Desk.
 * Calculates hit rates, streaks, and consistency metrics over the last 10 games
 * for players currently active in the daily card across NFL, NHL, NBA, and MLB.
 *
 * Rules:
 *  - Only considers settled historical games (VOID / DNP are excluded).
 *  - Evaluates up to the 10 most recent settled games per player and market.
 *  - Supports both direct game stat logs and historical graded daily card / ledger rows.
 *  - Identifies "Consistent Performers" (e.g. >= 70% L10 hit rate).
 *  - Pure, decoupled calculation logic with zero UI or side effects.
 */

export interface TrendGameLog {
  date?: string;
  actual: number;
  line: number;
  lean: 'OVER' | 'UNDER';
  outcome: 'HIT' | 'MISS' | 'PUSH';
}

export interface PlayerTrend {
  playerId: string | number;
  playerName: string;
  team: string;
  opp: string;
  market: string;
  marketLabel: string;
  currentLine: number;
  currentLean: 'OVER' | 'UNDER';
  sampleSize: number; // up to 10 games
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number; // 0.0 to 1.0 (hits / decided)
  hitRatePct: number; // e.g. 80.0 (%)
  streak: number; // +3 = 3 consecutive hits, -2 = 2 consecutive misses, 0 = none
  streakType: 'W' | 'L' | 'NONE';
  streakCount: number;
  recentOutcomes: Array<'HIT' | 'MISS' | 'PUSH'>; // newest first
  avgActual: number;
  lineDiff: number; // avgActual - currentLine
  isConsistent: boolean; // hitRate >= threshold with sampleSize >= minGames
  consistencyTier: 'elite' | 'hot' | 'consistent' | 'average' | 'cold';
  consistencyBadge: string;
  logs: TrendGameLog[];
}

export interface CurrentCardPlayer {
  id?: string;
  playerId: string | number;
  name: string;
  team: string;
  opp?: string;
  market: string;
  line: number;
  lean?: 'OVER' | 'UNDER';
  result?: 'HIT' | 'MISS' | 'PUSH' | 'VOID' | null;
  actual?: number | null;
  minutes?: number | null;
  date?: string;
}

export interface HistoricalSettledRow {
  playerId?: string | number;
  playerName?: string;
  name?: string;
  team?: string;
  market?: string;
  line?: number;
  lean?: 'OVER' | 'UNDER' | 'over' | 'under';
  side?: 'over' | 'under' | null;
  actual?: number | null;
  hit?: number | null;
  result?: string | null;
  date?: string;
}

export interface TrendAnalysisParams {
  /** Players currently active in the daily card / board */
  currentCard: CurrentCardPlayer[];
  /** Historical settled card rows */
  historicalCardRows?: CurrentCardPlayer[];
  /** Historical settled ledger rows */
  settledLedgerRows?: HistoricalSettledRow[];
  /** Direct player recent game numbers by player ID or name: { [idOrName]: { [market]: number[] } } */
  playerStatLogs?: Record<string | number, Record<string, number[]>>;
  /** Minimum games in sample to qualify as consistent (default 3) */
  minGames?: number;
  /** Hit rate threshold to be labeled consistent (default 0.70) */
  consistentThreshold?: number;
}

export interface TrendAnalysisSummary {
  totalAnalyzed: number;
  consistentCount: number;
  eliteCount: number;
  avgL10HitRate: number;
  trends: PlayerTrend[];
  consistentPerformers: PlayerTrend[];
}

export const MARKET_DISPLAY_NAMES: Record<string, string> = {
  // NBA
  pts: 'Points',
  reb: 'Rebounds',
  ast: 'Assists',
  tpm: '3-Pointers',
  pra: 'Pts+Reb+Ast',
  stl: 'Steals',
  blk: 'Blocks',
  // NHL
  sog: 'Shots on Goal',
  // NFL
  rec: 'Receptions',
  receptions: 'Receptions',
  // MLB
  hit: '0.5 Hits',
  hits: '0.5 Hits'
};

export function getMarketLabel(market: string): string {
  const m = market.toLowerCase();
  return MARKET_DISPLAY_NAMES[m] || market.toUpperCase();
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’\-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .trim();
}

/**
 * Calculates current streak from an array of outcomes (newest first).
 * Consecutive 'PUSH' outcomes do not break a streak, but are not counted as wins.
 */
export function computeStreak(outcomes: Array<'HIT' | 'MISS' | 'PUSH'>): {
  streak: number;
  streakType: 'W' | 'L' | 'NONE';
  streakCount: number;
} {
  if (!outcomes || outcomes.length === 0) {
    return { streak: 0, streakType: 'NONE', streakCount: 0 };
  }

  // Find first non-push outcome
  let firstIdx = 0;
  while (firstIdx < outcomes.length && outcomes[firstIdx] === 'PUSH') {
    firstIdx++;
  }

  if (firstIdx >= outcomes.length) {
    return { streak: 0, streakType: 'NONE', streakCount: 0 };
  }

  const target = outcomes[firstIdx];
  if (target !== 'HIT' && target !== 'MISS') {
    return { streak: 0, streakType: 'NONE', streakCount: 0 };
  }

  let count = 0;
  for (let i = firstIdx; i < outcomes.length; i++) {
    const res = outcomes[i];
    if (res === target) {
      count++;
    } else if (res === 'PUSH') {
      // push doesn't add to count, continues streak check
      continue;
    } else {
      break;
    }
  }

  return {
    streak: target === 'HIT' ? count : -count,
    streakType: target === 'HIT' ? 'W' : 'L',
    streakCount: count
  };
}

/**
 * Evaluates whether an actual stat clears or hits a prop line.
 */
export function evaluateGameOutcome(
  actual: number,
  line: number,
  lean: 'OVER' | 'UNDER' = 'OVER'
): 'HIT' | 'MISS' | 'PUSH' {
  if (actual === line) return 'PUSH';
  if (lean === 'OVER') {
    return actual > line ? 'HIT' : 'MISS';
  } else {
    return actual < line ? 'HIT' : 'MISS';
  }
}

/**
 * Assigns a consistency tier and badge based on hit rate and games evaluated.
 */
export function getConsistencyTier(
  hitRate: number,
  sampleSize: number,
  hits: number,
  minGames = 3
): { tier: PlayerTrend['consistencyTier']; badge: string; isConsistent: boolean } {
  if (sampleSize < minGames) {
    return { tier: 'average', badge: `${hits}/${sampleSize} L10`, isConsistent: false };
  }

  if (hitRate >= 0.80) {
    return { tier: 'elite', badge: `🔥 ELITE ${Math.round(hitRate * 100)}% (${hits}/${sampleSize})`, isConsistent: true };
  }
  if (hitRate >= 0.70) {
    return { tier: 'hot', badge: `⚡ HOT ${Math.round(hitRate * 100)}% (${hits}/${sampleSize})`, isConsistent: true };
  }
  if (hitRate >= 0.60) {
    return { tier: 'consistent', badge: `SOLID ${Math.round(hitRate * 100)}% (${hits}/${sampleSize})`, isConsistent: false };
  }
  if (hitRate <= 0.35) {
    return { tier: 'cold', badge: `❄️ COLD ${Math.round(hitRate * 100)}% (${hits}/${sampleSize})`, isConsistent: false };
  }
  return { tier: 'average', badge: `${hits}/${sampleSize} L10`, isConsistent: false };
}

/**
 * Extracts and calculates trends for players in the current daily card.
 */
export function analyzeDailyCardTrends(params: TrendAnalysisParams): TrendAnalysisSummary {
  const {
    currentCard,
    historicalCardRows = [],
    settledLedgerRows = [],
    playerStatLogs = {},
    minGames = 3,
    consistentThreshold = 0.70
  } = params;

  if (!currentCard || currentCard.length === 0) {
    return {
      totalAnalyzed: 0,
      consistentCount: 0,
      eliteCount: 0,
      avgL10HitRate: 0,
      trends: [],
      consistentPerformers: []
    };
  }

  // Deduplicate current card by player + market (using most recent row if duplicates exist)
  const currentByPlayerMarket = new Map<string, CurrentCardPlayer>();
  for (const row of currentCard) {
    const key = `${row.playerId || normalizeName(row.name)}|${row.market.toLowerCase()}`;
    currentByPlayerMarket.set(key, row);
  }

  const trends: PlayerTrend[] = [];

  for (const player of currentByPlayerMarket.values()) {
    const normPlayerName = normalizeName(player.name);
    const mkt = player.market.toLowerCase();
    const line = player.line;
    const lean = player.lean || (line <= 0.5 ? 'OVER' : 'OVER');

    const logs: TrendGameLog[] = [];

    // 1. Check direct stat logs (e.g. NHL skater recentShots/recentPoints)
    const directLogs =
      playerStatLogs[player.playerId]?.[mkt] ||
      playerStatLogs[normPlayerName]?.[mkt] ||
      playerStatLogs[player.name]?.[mkt];

    if (Array.isArray(directLogs) && directLogs.length > 0) {
      // directLogs has up to 10 recent game numbers (newest first or oldest first)
      const sample = directLogs.slice(0, 10);
      for (const actual of sample) {
        if (typeof actual === 'number' && Number.isFinite(actual)) {
          const outcome = evaluateGameOutcome(actual, line, lean);
          logs.push({ actual, line, lean, outcome });
        }
      }
    }

    // 2. If direct logs are absent or less than 10, supplement with historical settled card rows
    if (logs.length < 10 && historicalCardRows.length > 0) {
      const matchingCardRows = historicalCardRows
        .filter(r => {
          if (!r) return false;
          const samePlayer =
            (r.playerId && String(r.playerId) === String(player.playerId)) ||
            normalizeName(r.name) === normPlayerName;
          const sameMarket = r.market.toLowerCase() === mkt;
          const isSettled = r.result === 'HIT' || r.result === 'MISS' || r.result === 'PUSH';
          return samePlayer && sameMarket && isSettled;
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      for (const r of matchingCardRows) {
        if (logs.length >= 10) break;
        // avoid duplicate dates if already present
        if (r.date && logs.some(l => l.date === r.date)) continue;

        const actual = typeof r.actual === 'number' ? r.actual : (r.result === 'HIT' ? (line + 1) : Math.max(0, line - 1));
        const rowLean = r.lean || lean;
        let outcome: 'HIT' | 'MISS' | 'PUSH' = 'MISS';
        if (r.result === 'HIT') outcome = 'HIT';
        else if (r.result === 'PUSH') outcome = 'PUSH';
        else outcome = evaluateGameOutcome(actual, line, rowLean);

        logs.push({
          date: r.date,
          actual,
          line,
          lean: rowLean,
          outcome
        });
      }
    }

    // 3. Supplement with settled ledger rows if needed
    if (logs.length < 10 && settledLedgerRows.length > 0) {
      const matchingLedgerRows = settledLedgerRows
        .filter(r => {
          if (!r) return false;
          const rName = normalizeName(r.playerName || r.name || '');
          const samePlayer = (r.playerId && String(r.playerId) === String(player.playerId)) || rName === normPlayerName;
          const rMkt = (r.market || '').toLowerCase();
          const sameMarket = rMkt === mkt || (!rMkt && mkt === 'hit');
          const isSettled =
            r.result === 'OVER' ||
            r.result === 'UNDER' ||
            r.result === 'HIT' ||
            r.result === 'MISS' ||
            r.result === 'PUSH' ||
            r.hit !== null && r.hit !== undefined;
          return samePlayer && sameMarket && isSettled;
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      for (const r of matchingLedgerRows) {
        if (logs.length >= 10) break;
        if (r.date && logs.some(l => l.date === r.date)) continue;

        let outcome: 'HIT' | 'MISS' | 'PUSH' = 'MISS';
        const actual = typeof r.actual === 'number' ? r.actual : typeof r.hit === 'number' ? r.hit : 0;

        if (r.result === 'PUSH') outcome = 'PUSH';
        else if (r.result === 'HIT' || r.hit === 1) outcome = 'HIT';
        else if (r.result === 'OVER' || r.result === 'UNDER') {
          const rowSide = (r.side || r.lean || '').toUpperCase();
          outcome = r.result === rowSide ? 'HIT' : 'MISS';
        } else {
          outcome = evaluateGameOutcome(actual, line, lean);
        }

        logs.push({
          date: r.date,
          actual,
          line,
          lean,
          outcome
        });
      }
    }

    // If still zero games, evaluate player's baseline if provided
    if (logs.length === 0) {
      continue;
    }

    const sampleSize = logs.length;
    const hits = logs.filter(l => l.outcome === 'HIT').length;
    const misses = logs.filter(l => l.outcome === 'MISS').length;
    const pushes = logs.filter(l => l.outcome === 'PUSH').length;
    const decided = hits + misses;
    const hitRate = decided > 0 ? hits / decided : 0;
    const hitRatePct = Math.round(hitRate * 1000) / 10;

    const outcomes = logs.map(l => l.outcome);
    const { streak, streakType, streakCount } = computeStreak(outcomes);

    const sumActual = logs.reduce((acc, l) => acc + l.actual, 0);
    const avgActual = Math.round((sumActual / sampleSize) * 100) / 100;
    const lineDiff = Math.round((avgActual - line) * 100) / 100;

    const { tier, badge, isConsistent } = getConsistencyTier(hitRate, sampleSize, hits, minGames);
    const qualifiedConsistent = isConsistent && hitRate >= consistentThreshold && sampleSize >= minGames;

    trends.push({
      playerId: player.playerId,
      playerName: player.name,
      team: player.team,
      opp: player.opp || '—',
      market: mkt,
      marketLabel: getMarketLabel(mkt),
      currentLine: line,
      currentLean: lean,
      sampleSize,
      hits,
      misses,
      pushes,
      hitRate,
      hitRatePct,
      streak,
      streakType,
      streakCount,
      recentOutcomes: outcomes,
      avgActual,
      lineDiff,
      isConsistent: qualifiedConsistent,
      consistencyTier: tier,
      consistencyBadge: badge,
      logs
    });
  }

  // Sort: highest hit rate first, then most hits, then streak
  trends.sort((a, b) => {
    if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (b.sampleSize !== a.sampleSize) return b.sampleSize - a.sampleSize;
    return b.streak - a.streak;
  });

  const consistentPerformers = trends.filter(t => t.isConsistent);
  const eliteCount = trends.filter(t => t.consistencyTier === 'elite').length;
  const avgL10HitRate =
    trends.length > 0 ? trends.reduce((acc, t) => acc + t.hitRate, 0) / trends.length : 0;

  return {
    totalAnalyzed: trends.length,
    consistentCount: consistentPerformers.length,
    eliteCount,
    avgL10HitRate: Math.round(avgL10HitRate * 1000) / 10,
    trends,
    consistentPerformers
  };
}
