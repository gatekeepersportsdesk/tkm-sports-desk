/**
 * Correlated sampling layer (Gaussian copula over the validated marginals).
 *
 * Why a copula and not a from-scratch game simulator:
 *  - The closed-form negative-binomial marginals were validated on real data
 *    (NFL walk-forward backtest, interval coverage). A game-level simulator
 *    would have to re-earn that calibration; a copula keeps every player's
 *    marginal EXACTLY as priced and only adds the dependence between legs.
 *  - Joint questions (same-player shots + points, teammates, a stack) need the
 *    dependence; single-leg P(over) does not, and keeps using the closed form.
 *
 * Everything is seeded and deterministic: the same legs + seed + sims always
 * give the same answer (no flicker on re-render, tests are exact).
 */

export interface Marginal {
  /** mean */
  mu: number;
  /** negative-binomial dispersion (variance = mu + mu^2 / r); large r -> Poisson */
  r: number;
}

export interface JointResult {
  /** P(all legs win) from the sampled copula */
  p: number;
  /** P(all legs win) if the legs were independent (product of marginals) */
  pIndep: number;
  /** Monte Carlo standard error of p */
  se: number;
  sims: number;
}

/* ------------------------------ RNG / normal ------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Standard normal pair via Box-Muller. */
function normalPair(rng: () => number): [number, number] {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  const v = rng();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 via erf, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/* ------------------------- negative-binomial table ------------------------ */

function logGamma(z: number): number {
  const C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.138571095856205, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = C[0];
  for (let i = 1; i < 9; i++) x += C[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function nbPmf(k: number, mu: number, r: number): number {
  if (k < 0 || mu <= 0) return k === 0 ? 1 : 0;
  const p = r / (r + mu);
  return Math.exp(logGamma(k + r) - logGamma(k + 1) - logGamma(r) + r * Math.log(p) + k * Math.log(1 - p));
}

/** Cumulative table up to the point the tail is negligible. cdf[k] = P(Y <= k). */
export function nbCdfTable(m: Marginal, tail = 1e-9): Float64Array {
  const out: number[] = [];
  let cum = 0;
  const hardMax = Math.max(60, Math.ceil(m.mu + 12 * Math.sqrt(m.mu + (m.mu * m.mu) / m.r)));
  for (let k = 0; k <= hardMax; k++) {
    cum += nbPmf(k, m.mu, m.r);
    out.push(Math.min(1, cum));
    if (1 - cum < tail) break;
  }
  out[out.length - 1] = 1; // absorb the truncated tail
  return Float64Array.from(out);
}

/** Smallest k with cdf[k] >= u. */
export function quantile(cdf: Float64Array, u: number): number {
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] >= u) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/* ------------------------------ correlation ------------------------------- */

/** Lower Cholesky factor, or null if the matrix is not positive definite. */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-10) return null;
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/** Shrink off-diagonals toward 0 until the matrix is positive definite. */
export function makePositiveDefinite(corr: number[][]): { corr: number[][]; shrunk: boolean } {
  let m = corr.map(r => r.slice());
  let shrunk = false;
  for (let it = 0; it < 40; it++) {
    if (cholesky(m)) return { corr: m, shrunk };
    shrunk = true;
    m = m.map((row, i) => row.map((v, j) => (i === j ? 1 : v * 0.9)));
  }
  return { corr: m.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))), shrunk: true };
}

/* -------------------------------- sampling -------------------------------- */

/**
 * Draw `sims` joint samples: one Int32Array per marginal. Each marginal is
 * exactly negative binomial; dependence follows the Gaussian copula `corr`.
 */
export function sampleCopula(
  marginals: Marginal[],
  corr: number[][],
  opts: { sims: number; seed: number }
): Int32Array[] {
  const n = marginals.length;
  const { corr: pd } = makePositiveDefinite(corr);
  const L = cholesky(pd)!;
  const tables = marginals.map(m => nbCdfTable(m));
  const out = marginals.map(() => new Int32Array(opts.sims));
  const rng = mulberry32(opts.seed);
  const z = new Array(n).fill(0);
  for (let s = 0; s < opts.sims; s++) {
    for (let i = 0; i < n; i += 2) {
      const [a, b] = normalPair(rng);
      z[i] = a;
      if (i + 1 < n) z[i + 1] = b;
    }
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let j = 0; j <= i; j++) x += L[i][j] * z[j];
      out[i][s] = quantile(tables[i], normCdf(x));
    }
  }
  return out;
}

export interface Leg {
  marginal: Marginal;
  line: number;
  side: 'over' | 'under';
}

export function legWins(value: number, leg: Pick<Leg, 'line' | 'side'>): boolean {
  return leg.side === 'over' ? value > leg.line : value < leg.line;
}

/** Marginal probability a leg wins under its own negative binomial (no push on half lines). */
export function legProb(leg: Leg): number {
  const cdf = nbCdfTable(leg.marginal);
  const t = Math.floor(leg.line);
  const at = (k: number) => (k < 0 ? 0 : k >= cdf.length ? 1 : cdf[k]); // P(Y <= k)
  if (leg.side === 'over') return 1 - at(t); // Y > line
  return leg.line === t ? at(t - 1) : at(t); // Y < line (integer lines exclude the push)
}

/** P(every leg wins), sampled through the copula, next to the independent product. */
export function jointProbability(
  legs: Leg[],
  corr: number[][],
  opts: { sims?: number; seed?: number } = {}
): JointResult {
  const sims = Math.max(500, Math.round(opts.sims ?? 15000));
  const seed = opts.seed ?? hashSeed(JSON.stringify(legs.map(l => [l.marginal, l.line, l.side])) + JSON.stringify(corr));
  const draws = sampleCopula(legs.map(l => l.marginal), corr, { sims, seed });
  let wins = 0;
  for (let s = 0; s < sims; s++) {
    let ok = true;
    for (let i = 0; i < legs.length; i++) if (!legWins(draws[i][s], legs[i])) { ok = false; break; }
    if (ok) wins++;
  }
  const p = wins / sims;
  return {
    p,
    pIndep: legs.reduce((acc, l) => acc * legProb(l), 1),
    se: Math.sqrt((p * (1 - p)) / sims),
    sims
  };
}

/** 2-leg helper with a single correlation. */
export function jointPair(a: Leg, b: Leg, rho: number, opts: { sims?: number; seed?: number } = {}): JointResult {
  return jointProbability([a, b], [[1, rho], [rho, 1]], opts);
}

/**
 * Equicorrelated block structure for legs from several games: `rhoSameTeam`
 * between legs on the same team in the same game, `rhoOpp` between opposing
 * teams in the same game, 0 across games.
 */
export function teamCorrelation(
  legs: Array<{ game: string; team: string }>,
  rhoSameTeam: number,
  rhoOpp: number
): number[][] {
  return legs.map((a, i) => legs.map((b, j) => {
    if (i === j) return 1;
    if (a.game !== b.game) return 0;
    return a.team === b.team ? rhoSameTeam : rhoOpp;
  }));
}

/** Probability -> fair American price (for display only). */
export function fairAmerican(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

/**
 * Correlation priors. NFL values are MEASURED (scripts/estimate_nfl_corr.ts on
 * nflverse 2025 wk3-18 + 2026 wk3-6, walk-forward residuals); NHL values are
 * PRIORS because the NHL feed could not be reached to measure them. Both are
 * overridable and meant to be replaced by numbers from your own ledger.
 */
export const CORR_PRIORS = {
  nfl: {
    /** WR/TE teammates, residual corr (n=14,126 pairs, +/-0.016 at 95%) */
    teammates: 0.03,
    /** opposing receivers in the same game (n=16,051 pairs, +/-0.015) */
    opponents: 0.0,
    measured: true as const
  },
  nhl: {
    /** same skater, game shots vs game points. PRIOR, not measured. */
    shotsPoints: 0.35,
    measured: false as const
  }
};
