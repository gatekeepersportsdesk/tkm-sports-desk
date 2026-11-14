/**
 * Gatekeep Sports Desk — calibration tooling.
 *
 * RotoBot publishes weekly calibration reports ("~80% of real lines landed
 * inside our stated 80% ranges"). This is the same idea for our desks:
 *  - Brier / log-loss, with the market's de-vigged price as the benchmark
 *  - reliability bins (does a stated 60% really hit ~60%?)
 *  - PIT-based interval coverage for count models (works for discrete data)
 *
 * Demo / simulated rows are always excluded so they can never flatter the
 * numbers.
 */

export interface BinaryPrediction {
  /** Model probability that the outcome (over) happens */
  p: number;
  /** 1 if it happened, 0 if not (pushes / voids must be filtered out first) */
  y: 0 | 1;
  /** Market de-vigged probability for the same side, if known */
  pMarket?: number | null;
  /** Simulated / seeded rows. Never counted. */
  demo?: boolean;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanP: number | null;
  hitRate: number | null;
}

export interface CalibrationSummary {
  n: number;
  brier: number | null;
  brierMarket: number | null;
  /** n of rows that carried a market price (basis for brierMarket) */
  nMarket: number;
  logLoss: number | null;
  meanP: number | null;
  hitRate: number | null;
  /** meanP - hitRate. Positive = model is over-confident on overs. */
  gap: number | null;
  bins: ReliabilityBin[];
}

const EPS = 1e-6;
const clamp01 = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

export function brierScore(preds: BinaryPrediction[]): number | null {
  if (!preds.length) return null;
  return preds.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / preds.length;
}

export function logLossScore(preds: BinaryPrediction[]): number | null {
  if (!preds.length) return null;
  return (
    preds.reduce((s, r) => {
      const p = clamp01(r.p);
      return s - (r.y === 1 ? Math.log(p) : Math.log(1 - p));
    }, 0) / preds.length
  );
}

export const DEFAULT_BIN_EDGES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.000001];

export function reliabilityBins(
  preds: BinaryPrediction[],
  edges: number[] = DEFAULT_BIN_EDGES
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inBin = preds.filter(r => r.p >= lo && r.p < hi);
    bins.push({
      lo,
      hi: Math.min(1, hi),
      n: inBin.length,
      meanP: inBin.length ? inBin.reduce((s, r) => s + r.p, 0) / inBin.length : null,
      hitRate: inBin.length ? inBin.reduce((s, r) => s + r.y, 0) / inBin.length : null
    });
  }
  return bins;
}

export function summarizeCalibration(all: BinaryPrediction[]): CalibrationSummary {
  const preds = all.filter(r => !r.demo && Number.isFinite(r.p));
  const withMarket = preds.filter(
    r => r.pMarket !== null && r.pMarket !== undefined && Number.isFinite(r.pMarket)
  );
  const meanP = preds.length ? preds.reduce((s, r) => s + r.p, 0) / preds.length : null;
  const hitRate = preds.length ? preds.reduce((s, r) => s + r.y, 0) / preds.length : null;
  return {
    n: preds.length,
    brier: brierScore(preds),
    brierMarket: withMarket.length
      ? withMarket.reduce((s, r) => s + ((r.pMarket as number) - r.y) ** 2, 0) / withMarket.length
      : null,
    nMarket: withMarket.length,
    logLoss: logLossScore(preds),
    meanP,
    hitRate,
    gap: meanP !== null && hitRate !== null ? meanP - hitRate : null,
    bins: reliabilityBins(preds)
  };
}

/* ------------------------------------------------------------------------ */
/* PIT / interval coverage for count outcomes (receptions, shots, points)   */
/* ------------------------------------------------------------------------ */

/** Deterministic pseudo-uniform in [0,1) from a string, so PIT is reproducible. */
export function hashUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000003) / 1000003;
}

/**
 * Randomised probability integral transform for a discrete outcome:
 * P(Y < actual) + u * P(Y = actual). Uniform on [0,1] when the model is right.
 */
export function discretePit(pmf: (k: number) => number, actual: number, u: number): number {
  let below = 0;
  for (let k = 0; k < actual; k++) below += pmf(k);
  return Math.min(1, below + u * pmf(actual));
}

export interface CoverageRow {
  level: number;
  observed: number | null;
  n: number;
}

/** Share of PIT values inside the central `level` interval (0.8 -> [0.1, 0.9]). */
export function pitCoverage(pits: number[], levels: number[] = [0.5, 0.8, 0.9]): CoverageRow[] {
  const clean = pits.filter(p => Number.isFinite(p));
  return levels.map(level => ({
    level,
    n: clean.length,
    observed: clean.length
      ? clean.filter(p => p >= (1 - level) / 2 && p <= 1 - (1 - level) / 2).length / clean.length
      : null
  }));
}

/** Rough 95% half-width for an observed proportion; shows whether n is big enough to trust. */
export function proportionMargin(p: number, n: number): number {
  return n > 0 ? 1.96 * Math.sqrt((p * (1 - p)) / n) : 1;
}
