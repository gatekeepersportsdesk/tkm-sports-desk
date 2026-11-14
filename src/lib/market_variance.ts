/**
 * Market Variance & Line Movement Detection Engine
 * 
 * Flags proposition lines with high market variance by:
 * 1. Comparing the user's model probability against external/sportsbook implied probability (divergence).
 * 2. Flagging significant shifts in the daily-card average (projection vs baseline/season avg).
 * 3. Detecting multi-book line disagreement / line spreads from external odds feeds (TheOddsAPI).
 * 
 * Strict honesty rules:
 * - Transparent scoring and math without hidden multipliers.
 * - Works offline or without API keys by computing daily-card shifts and model-market spread.
 * - Gracefully incorporates external book line movements when available.
 */

import { NbaPlayerProjection, NbaMarket, NbaOddsEntry } from '../types/nba';
import { NhlSkaterProjection, NhlMarket, NhlOddsEntry } from '../types/nhl';
import { NflPropSnapshot } from '../types/nfl';
import { CardRow } from './card_core';

export interface ExternalBookMovement {
  player: string;
  sport: 'nba' | 'nhl' | 'nfl';
  market: string;
  minLine: number;
  maxLine: number;
  lineSpread: number;
  consensusLine: number;
  bookCount: number;
  books?: Array<{ book: string; line: number; overOdds?: number | null; underOdds?: number | null }>;
  steamDirection?: 'OVER' | 'UNDER' | 'NEUTRAL';
}

export type MarketVarianceLevel = 'HIGH' | 'MODERATE' | 'NORMAL';

export interface MarketVarianceInfo {
  level: MarketVarianceLevel;
  score: number; // 0 to 100
  isHighVariance: boolean;
  reasons: string[];
  
  // Model vs Market Probabilities
  modelProb: number;                 // 0.0 - 1.0 (lean side or P(over))
  marketImpliedProb: number | null;  // 0.0 - 1.0 de-vigged / raw implied
  probDivergence: number | null;     // |modelProb - marketImpliedProb| (percentage points)
  
  // Daily Card / Historical Average Shift
  projectedMu: number;
  baselineAvg: number | null;        // season avg, mu0, or naive card avg
  shiftPct: number | null;           // % change from baseline to current projected mu
  shiftAbsolute: number | null;      // |mu - baselineAvg|
  
  // Line Level Discrepancy
  selectedLine: number;
  baselineLine: number;
  lineDiff: number;                  // |selectedLine - baselineLine|
  
  // External Book Disagreement (if available)
  externalMovement?: ExternalBookMovement;
}

/** Convert American odds to raw implied probability (0.0 - 1.0) */
export function americanToImpliedProb(odds: number | string | null | undefined): number | null {
  if (odds == null || odds === '') return null;
  const n = typeof odds === 'number' ? odds : parseInt(String(odds).replace(/[+]/g, ''), 10);
  if (isNaN(n) || Math.abs(n) < 100) return null;
  if (n < 0) {
    return Math.abs(n) / (Math.abs(n) + 100);
  } else {
    return 100 / (n + 100);
  }
}

/** De-vig two-way American odds to fair implied probability for Over */
export function devigTwoWay(overOdds: number | null | undefined, underOdds: number | null | undefined): { fairOver: number; fairUnder: number } | null {
  const pOverRaw = americanToImpliedProb(overOdds);
  const pUnderRaw = americanToImpliedProb(underOdds);
  if (pOverRaw == null || pUnderRaw == null) return null;
  const total = pOverRaw + pUnderRaw;
  if (total <= 0) return null;
  return {
    fairOver: pOverRaw / total,
    fairUnder: pUnderRaw / total
  };
}

/**
 * Core variance evaluation function
 */
export function evaluateMarketVariance(params: {
  modelProb: number;
  line: number;
  defaultLine?: number;
  projectedMu: number;
  baselineAvg?: number | null;
  overOdds?: number | string | null;
  underOdds?: number | string | null;
  lean?: 'OVER' | 'UNDER';
  externalMovement?: ExternalBookMovement;
}): MarketVarianceInfo {
  const {
    modelProb,
    line,
    defaultLine = line,
    projectedMu,
    baselineAvg,
    overOdds,
    underOdds,
    lean,
    externalMovement
  } = params;

  const reasons: string[] = [];
  let score = 0;

  // 1. Calculate Market Implied Probability & Divergence
  const numOver = typeof overOdds === 'string' ? parseInt(overOdds.replace('+', ''), 10) : overOdds;
  const numUnder = typeof underOdds === 'string' ? parseInt(underOdds.replace('+', ''), 10) : underOdds;
  const devigged = devigTwoWay(numOver, numUnder);
  
  let marketImpliedProb: number | null = null;
  if (devigged) {
    marketImpliedProb = lean === 'UNDER' ? devigged.fairUnder : devigged.fairOver;
  } else {
    // Single-sided price fallback
    const singleRaw = lean === 'UNDER' ? americanToImpliedProb(numUnder) : americanToImpliedProb(numOver);
    if (singleRaw != null) {
      marketImpliedProb = singleRaw / 1.05; // 5% assumed hold
    }
  }

  let probDivergence: number | null = null;
  if (marketImpliedProb != null) {
    probDivergence = Math.abs(modelProb - marketImpliedProb) * 100;
    if (probDivergence >= 18) {
      score += 45;
      reasons.push(`Model diverges sharply from market price (Δ ${probDivergence.toFixed(1)}pp)`);
    } else if (probDivergence >= 12) {
      score += 30;
      reasons.push(`High model vs market probability divergence (Δ ${probDivergence.toFixed(1)}pp)`);
    } else if (probDivergence >= 7) {
      score += 15;
      reasons.push(`Moderate market pricing difference (Δ ${probDivergence.toFixed(1)}pp)`);
    }
  }

  // 2. Daily Card / Baseline Average Shift
  let shiftPct: number | null = null;
  let shiftAbsolute: number | null = null;
  if (baselineAvg != null && baselineAvg > 0) {
    shiftAbsolute = Math.abs(projectedMu - baselineAvg);
    shiftPct = ((projectedMu - baselineAvg) / baselineAvg) * 100;
    const absPct = Math.abs(shiftPct);

    if (absPct >= 28 || shiftAbsolute >= 2.5) {
      score += 40;
      reasons.push(`Significant daily-card shift (${shiftPct > 0 ? '+' : ''}${shiftPct.toFixed(1)}% vs baseline avg)`);
    } else if (absPct >= 18 || shiftAbsolute >= 1.5) {
      score += 25;
      reasons.push(`Notable projection shift (${shiftPct > 0 ? '+' : ''}${shiftPct.toFixed(1)}% vs baseline)`);
    } else if (absPct >= 12) {
      score += 10;
    }
  }

  // 3. Line Movement / Discrepancy from Model Median Default
  const lineDiff = Math.abs(line - defaultLine);
  if (lineDiff >= 2.0) {
    score += 25;
    reasons.push(`Line moved ${lineDiff.toFixed(1)} points away from model median line`);
  } else if (lineDiff >= 1.0) {
    score += 15;
    reasons.push(`Line adjusted by ${lineDiff.toFixed(1)} pt from base line`);
  }

  // 4. External Book Disagreement (TheOddsAPI or multi-book entries)
  if (externalMovement) {
    if (externalMovement.lineSpread >= 1.5) {
      score += 35;
      reasons.push(`High sportsbook disagreement (spread of ${externalMovement.lineSpread.toFixed(1)} pts across ${externalMovement.bookCount} books)`);
    } else if (externalMovement.lineSpread >= 1.0) {
      score += 20;
      reasons.push(`Sportsbook line variance (${externalMovement.minLine} to ${externalMovement.maxLine} across books)`);
    }

    if (externalMovement.steamDirection && externalMovement.steamDirection !== 'NEUTRAL') {
      score += 15;
      reasons.push(`External steam detected toward ${externalMovement.steamDirection}`);
    }
  }

  // Determine Level
  const finalScore = Math.min(100, score);
  let level: MarketVarianceLevel = 'NORMAL';
  if (finalScore >= 50 || (probDivergence != null && probDivergence >= 15) || (shiftPct != null && Math.abs(shiftPct) >= 28)) {
    level = 'HIGH';
  } else if (finalScore >= 25 || (probDivergence != null && probDivergence >= 9) || (shiftPct != null && Math.abs(shiftPct) >= 16)) {
    level = 'MODERATE';
  }

  return {
    level,
    score: finalScore,
    isHighVariance: level === 'HIGH',
    reasons: reasons.length > 0 ? reasons : ['Within standard market variance'],
    modelProb,
    marketImpliedProb,
    probDivergence,
    projectedMu,
    baselineAvg: baselineAvg ?? null,
    shiftPct,
    shiftAbsolute,
    selectedLine: line,
    baselineLine: defaultLine,
    lineDiff,
    externalMovement
  };
}

/**
 * NBA Market Variance Evaluator
 */
export function getNbaMarketVariance(
  projection: NbaPlayerProjection,
  market: NbaMarket,
  line: number,
  entry?: NbaOddsEntry,
  external?: ExternalBookMovement
): MarketVarianceInfo {
  const mp = projection.markets[market];
  const modelP = mp.probs[line]?.p_over ?? 0.5;
  const lean: 'OVER' | 'UNDER' = modelP >= 0.5 ? 'OVER' : 'UNDER';
  const effectiveModelP = lean === 'OVER' ? modelP : (1 - modelP);

  // Baseline average: mp.mu0 (base expectation before opponent/absence factor)
  // or season rate * projected minutes
  const baseline = mp.mu0 > 0 ? mp.mu0 : (mp.rate * mp.pm);

  return evaluateMarketVariance({
    modelProb: effectiveModelP,
    line,
    defaultLine: mp.defaultLine,
    projectedMu: mp.mu,
    baselineAvg: baseline,
    overOdds: entry?.over,
    underOdds: entry?.under,
    lean,
    externalMovement: external
  });
}

/**
 * NHL Market Variance Evaluator
 */
export function getNhlMarketVariance(
  projection: NhlSkaterProjection,
  market: NhlMarket,
  line: number,
  entry?: NhlOddsEntry,
  external?: ExternalBookMovement
): MarketVarianceInfo {
  const mp = market === 'sog' ? projection.sog : projection.pts;
  if (!mp) {
    return evaluateMarketVariance({
      modelProb: 0.5,
      line,
      defaultLine: line,
      projectedMu: 0,
      baselineAvg: null
    });
  }

  const modelP = mp.probs[line]?.p_over ?? 0.5;
  const lean: 'OVER' | 'UNDER' = modelP >= 0.5 ? 'OVER' : 'UNDER';
  const effectiveModelP = lean === 'OVER' ? modelP : (1 - modelP);

  // In NHL, mp.mu0 is the shrunk per-game rate before opponent adjustment
  return evaluateMarketVariance({
    modelProb: effectiveModelP,
    line,
    defaultLine: mp.defaultLine,
    projectedMu: mp.mu,
    baselineAvg: mp.mu0,
    overOdds: entry?.over,
    underOdds: entry?.under,
    lean,
    externalMovement: external
  });
}

/**
 * NFL Receptions Market Variance Evaluator
 */
export function getNflMarketVariance(
  snapshot: NflPropSnapshot,
  external?: ExternalBookMovement
): MarketVarianceInfo {
  const modelP = snapshot.lean === 'OVER' ? snapshot.p_over : snapshot.p_under;
  
  // Baseline average: snapshot.seasonAvg or snapshot.muStructural
  const baseline = snapshot.seasonAvg > 0 ? snapshot.seasonAvg : (snapshot.muStructural || snapshot.mu);

  return evaluateMarketVariance({
    modelProb: modelP,
    line: snapshot.line,
    defaultLine: snapshot.line,
    projectedMu: snapshot.mu,
    baselineAvg: baseline,
    overOdds: snapshot.overOdds,
    underOdds: snapshot.underOdds,
    lean: snapshot.lean,
    externalMovement: external
  });
}

/**
 * CardRow (Daily Card) Market Variance Evaluator
 */
export function getCardRowMarketVariance(row: CardRow): MarketVarianceInfo {
  const modelP = row.lean === 'OVER' ? row.pOver : (1 - row.pOver);
  return evaluateMarketVariance({
    modelProb: modelP,
    line: row.line,
    defaultLine: row.line,
    projectedMu: row.mu,
    baselineAvg: row.avg,
    lean: row.lean
  });
}
