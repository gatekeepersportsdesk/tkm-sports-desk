/**
 * Gatekeep Sports Desk — shared discrete distributions.
 * NFL receptions and NHL shots / points all price off the same Negative
 * Binomial family, so the math lives here once.
 */

const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.138571095856205,
  9.9843695780195716e-6,
  1.5056327351493116e-7
];

/** Lanczos approximation of ln(Gamma(z)). */
export function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_C[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_C[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function poissonPmf(k: number, mu: number): number {
  if (k < 0) return 0;
  if (mu <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-mu + k * Math.log(mu) - logGamma(k + 1));
}

/**
 * Negative Binomial PMF parameterised by mean `mu` and size `r`
 * (Var = mu + mu^2 / r). r -> infinity recovers the Poisson.
 */
export function nbinomPmfR(k: number, mu: number, r: number): number {
  if (k < 0 || mu <= 0) return 0.0;
  if (!Number.isFinite(r) || r > 1e6) return poissonPmf(k, mu);
  const p = r / (r + mu);
  const logPmf =
    logGamma(k + r) - (logGamma(k + 1) + logGamma(r)) + r * Math.log(p) + k * Math.log(1.0 - p);
  return Math.exp(logPmf);
}

/** Same distribution parameterised by dispersion alpha = 1 / r. */
export function nbinomPmfAlpha(k: number, mu: number, alpha: number): number {
  if (alpha <= 0.0001) return poissonPmf(k, mu);
  return nbinomPmfR(k, mu, 1.0 / alpha);
}

/** P(Y <= k) for the Negative Binomial. */
export function nbinomCdfR(k: number, mu: number, r: number): number {
  let cdf = 0;
  for (let i = 0; i <= Math.floor(k); i++) cdf += nbinomPmfR(i, mu, r);
  return Math.min(1, cdf);
}

export interface LineProbs {
  p_over: number;
  p_under: number;
  p_push: number;
}

/**
 * Over / under / push probabilities for a line given a PMF.
 * Half lines never push; integer lines push on exact hits.
 */
export function lineProbsFromPmf(pmf: (k: number) => number, line: number): LineProbs {
  const isInteger = line === Math.floor(line);
  const target = Math.floor(line);
  let below = 0;
  for (let k = 0; k < target; k++) below += pmf(k);
  const exact = pmf(target);
  if (isInteger) {
    const under = below;
    const push = exact;
    return { p_under: under, p_push: push, p_over: Math.max(0, 1 - under - push) };
  }
  const under = below + exact;
  return { p_under: under, p_push: 0, p_over: Math.max(0, 1 - under) };
}

/** Smallest k with CDF >= q. */
export function pmfQuantile(pmf: (k: number) => number, q: number, maxK = 60): number {
  let cum = 0;
  for (let k = 0; k <= maxK; k++) {
    cum += pmf(k);
    if (cum >= q) return k;
  }
  return maxK;
}
