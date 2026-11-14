/**
 * Player Card Form & Context Helpers (L5/L10, Opponent Factor, Lean Reason)
 *
 * Provides compact, scannable form metrics under player cards:
 * - L5 & L10 hit rates against the current line
 * - L5 & L10 average actual stats
 * - Games played in window (missing form returns null/empty, NEVER 0%)
 * - Opponent ranking indicator (Top 10 vs Bottom 10 defense)
 * - NBA minutes trend (L5 vs season average)
 * - Concise "Why this lean" one-liner
 */

export interface FormWindow {
  games: number;
  hits: number;
  hitRatePct: number | null;
  avgStat: number | null;
}

export interface PlayerCardForm {
  l5: FormWindow;
  l10: FormWindow;
  hasForm: boolean;
  whyThisLean: string;
  oppTier: 'top10_tough' | 'bottom10_soft' | 'neutral';
  oppBadge: string;
  minutesTrend?: {
    diff: number;
    text: string;
    direction: 'up' | 'down' | 'flat';
  };
}

/**
 * Computes L5 and L10 hit rates and averages from recent game logs.
 * `logs` are ordered most recent first.
 * Missing logs yield `{ games: 0, hits: 0, hitRatePct: null, avgStat: null }`, never `0%`.
 */
export function computePlayerCardForm(
  logs: number[] | null | undefined,
  line: number,
  lean: 'OVER' | 'UNDER' = 'OVER',
  options?: {
    oppFactor?: number;
    edge?: number;
    seasonMinAvg?: number;
    recentMinutes?: number[];
    marketLabel?: string;
  }
): PlayerCardForm {
  const safeLogs = (logs || []).filter(n => typeof n === 'number' && Number.isFinite(n));

  const calcWindow = (windowSize: number): FormWindow => {
    const slice = safeLogs.slice(0, windowSize);
    const games = slice.length;
    if (games === 0) {
      return { games: 0, hits: 0, hitRatePct: null, avgStat: null };
    }
    let hits = 0;
    let sum = 0;
    for (const val of slice) {
      sum += val;
      if (lean === 'OVER') {
        if (val > line) hits++;
      } else {
        if (val < line) hits++;
      }
    }
    const hitRatePct = Math.round((hits / games) * 100);
    const avgStat = Math.round((sum / games) * 10) / 10;
    return { games, hits, hitRatePct, avgStat };
  };

  const l5 = calcWindow(5);
  const l10 = calcWindow(10);
  const hasForm = l5.games > 0 || l10.games > 0;

  // Opponent Defense Ranking Indicator
  let oppTier: 'top10_tough' | 'bottom10_soft' | 'neutral' = 'neutral';
  let oppBadge = '';
  const factor = options?.oppFactor ?? 1.0;
  if (factor <= 0.94) {
    oppTier = 'top10_tough';
    oppBadge = 'DEF T10 (Tough)';
  } else if (factor >= 1.06) {
    oppTier = 'bottom10_soft';
    oppBadge = 'DEF B10 (Soft)';
  }

  // NBA Minutes Trend
  let minutesTrend: PlayerCardForm['minutesTrend'] = undefined;
  if (options?.recentMinutes && options.recentMinutes.length > 0 && options?.seasonMinAvg) {
    const rMins = options.recentMinutes.slice(0, 5);
    const l5MinAvg = rMins.reduce((a, b) => a + b, 0) / rMins.length;
    const diff = Math.round((l5MinAvg - options.seasonMinAvg) * 10) / 10;
    if (Math.abs(diff) >= 1.5) {
      minutesTrend = {
        diff,
        text: `${diff > 0 ? '▲ +' : '▼ '}${diff}m L5`,
        direction: diff > 0 ? 'up' : 'down'
      };
    }
  }

  // "Why this lean" one-liner
  const rawEdge = options?.edge;
  const edge = (rawEdge != null && Number.isFinite(rawEdge) && Math.abs(rawEdge) <= 50) ? rawEdge : null;
  const whyParts: string[] = [];

  if (edge !== null && edge >= 5.0) {
    whyParts.push(`High edge (+${edge.toFixed(1)}pp)`);
  } else if (edge !== null && edge >= 2.0) {
    whyParts.push(`Positive EV (+${edge.toFixed(1)}pp edge)`);
  }

  if (l10.games >= 5 && l10.hitRatePct !== null) {
    if (l10.hitRatePct >= 70) {
      whyParts.push(`L10 hit rate ${l10.hitRatePct}% (${l10.hits}/${l10.games})`);
    } else if (l10.hitRatePct <= 30 && lean === 'UNDER') {
      whyParts.push(`Under in ${l10.games - l10.hits}/${l10.games} L10`);
    } else if (l5.games >= 3 && l5.hitRatePct !== null && l5.hitRatePct >= 80) {
      whyParts.push(`Hot L5: ${l5.hits}/${l5.games} cleared`);
    }
  } else if (l5.games >= 3 && l5.hitRatePct !== null && l5.hitRatePct >= 75) {
    whyParts.push(`Recent form: ${l5.hits}/${l5.games} cleared`);
  }

  if (oppTier === 'bottom10_soft') {
    whyParts.push('soft opponent defense');
  } else if (oppTier === 'top10_tough') {
    whyParts.push('tough matchup context');
  }

  if (minutesTrend && minutesTrend.direction === 'up') {
    whyParts.push(`minutes surging (${minutesTrend.text})`);
  }

  const whyThisLean = whyParts.length > 0
    ? whyParts.join(', ') + '.'
    : `${lean} ${line} based on Bayesian prior shrinkage and matchup projection.`;

  return {
    l5,
    l10,
    hasForm,
    whyThisLean,
    oppTier,
    oppBadge,
    minutesTrend
  };
}

/**
 * Returns color class for edge values:
 * - Green when edge > 5%
 * - Yellow when 2% <= edge <= 5%
 * - Gray when edge < 2%
 */
export function getEdgeColorClass(edge: number | null | undefined, hasMarket: boolean = true): string {
  if (!hasMarket || edge == null || !Number.isFinite(edge) || Math.abs(edge) > 50) {
    return 'text-[#556277]';
  }
  if (edge > 5.0) {
    return 'text-emerald-400 font-bold';
  }
  if (edge >= 2.0) {
    return 'text-amber-300 font-semibold';
  }
  return 'text-[#8b97ac] font-normal';
}

/**
 * Detects if recent form fights the selected side/lean:
 * - Under selected but L10 avg clearly above line, or L10 hit rate on side <= 40%
 * - Over selected but L10 avg clearly below line, or L10 hit rate on side <= 40%
 * - Falls back to L5 if L10 has fewer than 5 games
 * - Returns false when logs are missing (never warns on null form)
 */
export function isFormFightingLean(
  form: PlayerCardForm | undefined | null,
  side: 'OVER' | 'UNDER' | 'over' | 'under' | string,
  line: number
): boolean {
  if (!form || !form.hasForm) return false;
  const isOver = side.toUpperCase() === 'OVER';
  const { l5, l10 } = form;

  // L10 has primary weight if >= 5 games
  if (l10 && l10.games >= 5 && l10.hitRatePct !== null && l10.avgStat !== null) {
    if (isOver) {
      return l10.hitRatePct <= 40 || l10.avgStat < line;
    } else {
      return l10.hitRatePct <= 40 || l10.avgStat > line;
    }
  }

  // Fallback to L5 if >= 3 games
  if (l5 && l5.games >= 3 && l5.hitRatePct !== null && l5.avgStat !== null) {
    if (isOver) {
      return l5.hitRatePct <= 40 || l5.avgStat < line;
    } else {
      return l5.hitRatePct <= 40 || l5.avgStat > line;
    }
  }

  return false;
}
