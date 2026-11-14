/**
 * Game-level Monte Carlo (volume -> Dirichlet shares -> outcomes).
 *
 * Per team, per simulated game:
 *   1. team volume   V ~ NegBin(mean M, dispersion rV)          (gamma-Poisson: lambda ~ Gamma(rV, M/rV))
 *   2. shares        p ~ Dirichlet(alpha * pi)                   (pi_i = player i's share of M)
 *   3. outcomes      X_i | lambda, p ~ Poisson(lambda * p_i * q_i)
 *      (Poisson splitting: this IS a multinomial allocation of a Poisson(lambda) volume, thinned by
 *       the catch/convert rate q_i. NFL receptions = targets thinned by catch rate; NHL shots q = 1.)
 *   4. NHL points are a second stage coupled to the same skater's simulated shots and to a team
 *      "goal environment" factor shared by teammates (a goal pays several skaters).
 *
 * Nothing here is eyeballed. (rV, alpha) are SOLVED per game, analytically, so that
 *   - every player's marginal variance matches the validated closed-form negative binomial, and
 *   - the mean teammate residual correlation equals the MEASURED value (see gamesim_params.ts).
 * The closed form stays the path for single-leg prices; this layer exists for joint questions.
 *
 * Deterministic: same inputs + seed + sims -> same answer.
 */
import { mulberry32, hashSeed, normCdf, nbCdfTable, quantile, legWins, fairAmerican, Leg } from './sampler';
import { GAMESIM_PARAMS } from './gamesim_params';
import { NHL_CONFIG } from './nhl_engine';

/* ------------------------------- primitives ------------------------------- */

type Rng = () => number;

function randn(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Inverse standard normal CDF (Acklam), |relative error| < 1.2e-9. */
export function normInv(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425, hi = 1 - lo;
  if (p <= 0) return -8; if (p >= 1) return 8;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Gamma(shape, 1) — Marsaglia & Tsang, with the shape < 1 boost. */
export function gammaDraw(shape: number, rng: Rng): number {
  if (!(shape > 0)) return 0;
  if (shape < 1) {
    let u = 0; while (u === 0) u = rng();
    return gammaDraw(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do { x = randn(rng); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Poisson: Knuth for small means; larger means are split into exact independent pieces. */
export function poissonDraw(lambda: number, rng: Rng): number {
  if (!(lambda > 0)) return 0;
  if (lambda > 20) {
    const pieces = Math.ceil(lambda / 20);
    let total = 0;
    for (let i = 0; i < pieces; i++) total += poissonDraw(lambda / pieces, rng);
    return total;
  }
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

/* ------------------------------ calibration ------------------------------- */

export interface ShareSlot {
  /** player id, or a bucket for everyone not listed */
  id: string;
  /** mean of the final counted outcome (receptions, shots...) */
  mu: number;
  /** required marginal variance of the outcome (negative binomial: mu + mu^2 / r); null for the unlisted bucket */
  reqVar: number | null;
  /** conversion from the allocated volume to the counted outcome (catch rate for NFL; 1 for NHL shots) */
  q: number;
}

export interface ShareCalibration {
  /** team volume dispersion (V ~ NegBin(M, rV)); Infinity = Poisson volume */
  rV: number;
  /** Dirichlet concentration over the shares; small = shares swing a lot */
  alpha: number;
  /** false if the targets could not both be met (the closest feasible point is used) */
  exact: boolean;
  targetCorr: number;
  /** teammate correlation the solved parameters imply (analytic, mean over listed pairs) */
  impliedCorr: number;
  /** mean(model variance / required variance) over listed players */
  varRatio: number;
}

function modelVarX(slot: ShareSlot, M: number, K: number, alpha: number): number {
  const m = slot.mu / slot.q; // mean of the allocated volume
  const eXX1 = slot.q * slot.q * K * m * (m * alpha + M) / (alpha + 1); // E[X(X-1)]
  return eXX1 + slot.mu - slot.mu * slot.mu;
}

/**
 * Solve (rV, alpha) so that Sum of model variances = Sum of required variances AND the mean pairwise
 * teammate correlation equals targetCorr. Closed form in K = 1 + 1/rV:
 *    Cov(X_i, X_j) = mu_i mu_j (K alpha/(alpha+1) - 1)
 *    Var(X_i)      = q^2 K m (m alpha + M)/(alpha+1) + mu - mu^2          (m = mu/q, M = sum of m)
 */
export function calibrateShares(slots: ShareSlot[], targetCorr: number): ShareCalibration {
  const listed = slots.filter(s => s.reqVar !== null);
  const M = slots.reduce((a, s) => a + s.mu / s.q, 0);
  // required covariance factor c from the target correlation (averaged over listed pairs)
  let sdProd = 0, muProd = 0, pairs = 0;
  for (let i = 0; i < listed.length; i++) for (let j = 0; j < listed.length; j++) if (i !== j) {
    sdProd += Math.sqrt(listed[i].reqVar! * listed[j].reqVar!); muProd += listed[i].mu * listed[j].mu; pairs++;
  }
  const c = pairs ? (targetCorr * sdProd) / muProd : 0;
  const Kof = (alpha: number) => (1 + c) * (alpha + 1) / alpha;
  const reqTotal = listed.reduce((a, s) => a + s.reqVar!, 0);
  const g = (alpha: number) => listed.reduce((a, s) => a + modelVarX(s, M, Kof(alpha), alpha), 0) - reqTotal;
  // K must be >= 1: for c < 0 that caps alpha
  let lo = 0.05, hi = 1e5;
  if (c < 0) hi = Math.min(hi, ((1 + c) / -c) * 0.999);
  if (hi <= lo) hi = lo * 1.0001;
  let exact = true, alpha: number;
  const gLo = g(lo), gHi = g(hi);
  if (gLo * gHi > 0) {
    exact = false;
    alpha = Math.abs(gLo) < Math.abs(gHi) ? lo : hi; // closest feasible end
  } else {
    for (let it = 0; it < 80; it++) {
      const mid = Math.sqrt(lo * hi);
      if (g(mid) > 0) lo = mid; else hi = mid; // model variance falls as alpha grows
    }
    alpha = Math.sqrt(lo * hi);
  }
  let K = Math.max(1, Kof(alpha));
  const rV = K - 1 < 1e-9 ? Infinity : 1 / (K - 1);
  const impliedC = K * alpha / (alpha + 1) - 1;
  const impliedCorr = sdProd ? (impliedC * muProd) / sdProd : 0;
  const varRatio = reqTotal ? listed.reduce((a, s) => a + modelVarX(s, M, K, alpha), 0) / reqTotal : 1;
  return { rV, alpha, exact: exact && Math.abs(varRatio - 1) < 0.02, targetCorr, impliedCorr, varRatio };
}

/* -------------------------------- results --------------------------------- */

export type SimMarket = 'sog' | 'pts' | 'rec';

export interface SimResult {
  sims: number;
  seed: number;
  /** `${playerId}|${market}` -> counts per simulated game */
  counts: Map<string, Int16Array>;
  teamOf: Map<string, string>;
  calibration: Record<string, ShareCalibration>;
}

export const simKey = (playerId: string | number, market: SimMarket) => `${playerId}|${market}`;

export interface SimLeg { playerId: string | number; market: SimMarket; line: number; side: 'over' | 'under' }

export interface SimJoint {
  /** P(all legs win), pushes count as not winning (same convention as the closed form) */
  p: number;
  /** product of the legs' simulated marginals (what independence would say) */
  pIndep: number;
  se: number;
  sims: number;
  marginals: number[];
  /** fair American price for the joint */
  fair: number | null;
}

export function legSeries(sim: SimResult, leg: SimLeg): Int16Array {
  const s = sim.counts.get(simKey(leg.playerId, leg.market));
  if (!s) throw new Error(`no simulated series for ${leg.playerId}|${leg.market}`);
  return s;
}

export function jointFromSim(sim: SimResult, legs: SimLeg[]): SimJoint {
  const series = legs.map(l => legSeries(sim, l));
  const n = sim.sims;
  let wins = 0; const each = new Array(legs.length).fill(0);
  for (let s = 0; s < n; s++) {
    let ok = true;
    for (let i = 0; i < legs.length; i++) {
      const w = legWins(series[i][s], legs[i]);
      if (w) each[i]++; else ok = false;
    }
    if (ok) wins++;
  }
  const marginals = each.map(x => x / n);
  const p = wins / n;
  return { p, pIndep: marginals.reduce((a, b) => a * b, 1), se: Math.sqrt((p * (1 - p)) / n), sims: n, marginals, fair: fairAmerican(p) };
}

/** Empirical distribution of one player's outcome: P(X = k) for k = 0..max. */
export function distributionFromSim(sim: SimResult, playerId: string | number, market: SimMarket): number[] {
  const s = sim.counts.get(simKey(playerId, market));
  if (!s) return [];
  let max = 0; for (let i = 0; i < s.length; i++) if (s[i] > max) max = s[i];
  const out = new Array(max + 1).fill(0);
  for (let i = 0; i < s.length; i++) out[s[i]]++;
  return out.map(x => x / s.length);
}

export function meanVarFromSim(sim: SimResult, playerId: string | number, market: SimMarket): { mean: number; variance: number } {
  const s = sim.counts.get(simKey(playerId, market))!;
  let sum = 0; for (let i = 0; i < s.length; i++) sum += s[i];
  const mean = sum / s.length; let v = 0; for (let i = 0; i < s.length; i++) v += (s[i] - mean) ** 2;
  return { mean, variance: v / (s.length - 1) };
}

export function pearsonFromSim(sim: SimResult, a: SimLeg, b: SimLeg): number {
  const x = legSeries(sim, a), y = legSeries(sim, b); const n = x.length;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/* ------------------------------ team simulator ---------------------------- */

interface TeamSpec {
  team: string;
  slots: ShareSlot[];
  calib: ShareCalibration;
}

/** Draw one team's per-sim outcome counts for every slot (including the unlisted bucket). */
function simulateTeam(spec: TeamSpec, sims: number, rng: Rng): Int16Array[] {
  const { slots, calib } = spec;
  const M = slots.reduce((a, s) => a + s.mu / s.q, 0);
  const pi = slots.map(s => s.mu / s.q / M);
  const out = slots.map(() => new Int16Array(sims));
  const g = new Array(slots.length).fill(0);
  for (let s = 0; s < sims; s++) {
    const lambda = Number.isFinite(calib.rV) ? M * gammaDraw(calib.rV, rng) / calib.rV : M;
    let tot = 0;
    for (let i = 0; i < slots.length; i++) { g[i] = gammaDraw(calib.alpha * pi[i], rng); tot += g[i]; }
    for (let i = 0; i < slots.length; i++) out[i][s] = poissonDraw(lambda * (g[i] / tot) * slots[i].q, rng);
  }
  return out;
}

function nbVar(mu: number, r: number): number { return mu + (mu * mu) / r; }

/* ---------------------------------- NHL ----------------------------------- */

export interface NhlSimSkater {
  id: string | number;
  team: string;
  /** mean shots and its negative-binomial r (the validated closed form) */
  sogMu: number; sogR: number;
  /** mean points and r, or null when the feed has no points for this skater */
  ptsMu: number | null; ptsR: number;
}

export interface NhlSimOptions {
  sims?: number;
  seed?: number | string;
  /** shots <-> points copula parameter for the same skater (latent Gaussian correlation) */
  rhoShotsPoints?: number;
  /** teammate shots residual correlation target */
  shotsTeammateCorr?: number;
  /** loading of the shared team "goal environment" factor on every teammate's points */
  pointsTeamLoading?: number;
}

export function simulateNhlGame(skaters: NhlSimSkater[], opts: NhlSimOptions = {}): SimResult {
  const P = GAMESIM_PARAMS.nhl;
  const sims = Math.max(1000, Math.round(opts.sims ?? 15000));
  const seed = typeof opts.seed === 'number' ? opts.seed
    : hashSeed(String(opts.seed ?? '') + JSON.stringify(skaters.map(s => [s.id, s.sogMu, s.sogR, s.ptsMu, s.ptsR])) + sims);
  const rng = mulberry32(seed);
  const a = Math.max(0, Math.min(0.95, opts.rhoShotsPoints ?? P.rhoShotsPoints));
  const b = Math.max(0, Math.min(Math.sqrt(Math.max(0, 1 - a * a)) * 0.999, opts.pointsTeamLoading ?? P.pointsTeamLoading));
  const cEps = Math.sqrt(Math.max(1e-9, 1 - a * a - b * b));
  const counts = new Map<string, Int16Array>(); const teamOf = new Map<string, string>(); const calibration: Record<string, ShareCalibration> = {};
  const teams = Array.from(new Set(skaters.map(s => s.team)));
  for (const team of teams) {
    const roster = skaters.filter(s => s.team === team && s.sogMu > 0);
    if (!roster.length) continue;
    const slots: ShareSlot[] = roster.map(s => ({ id: String(s.id), mu: s.sogMu, reqVar: nbVar(s.sogMu, s.sogR), q: 1 }));
    const calib = calibrateShares(slots, opts.shotsTeammateCorr ?? P.shotsTeammateCorr);
    calibration[team] = calib;
    const shots = simulateTeam({ team, slots, calib }, sims, rng);
    // team goal environment: one standard-normal draw per simulated game per team
    const G = new Float64Array(sims); for (let s = 0; s < sims; s++) G[s] = randn(rng);
    roster.forEach((sk, i) => {
      const key = simKey(sk.id, 'sog'); counts.set(key, shots[i]); teamOf.set(key, team);
      if (sk.ptsMu === null || !(sk.ptsMu > 0)) return;
      const cdfS = nbCdfTable({ mu: sk.sogMu, r: sk.sogR });
      const cdfP = nbCdfTable({ mu: sk.ptsMu, r: sk.ptsR });
      const pts = new Int16Array(sims);
      for (let s = 0; s < sims; s++) {
        const x = shots[i][s];
        const hi = x < cdfS.length ? cdfS[x] : 1, lo = x > 0 ? (x - 1 < cdfS.length ? cdfS[x - 1] : 1) : 0;
        let u = lo + rng() * (hi - lo);
        u = Math.min(1 - 1e-9, Math.max(1e-9, u));
        const z = a * normInv(u) + b * G[s] + cEps * randn(rng);
        pts[s] = quantile(cdfP, Math.min(1 - 1e-12, Math.max(1e-12, normCdf(z))));
      }
      const pk = simKey(sk.id, 'pts'); counts.set(pk, pts); teamOf.set(pk, team);
    });
  }
  return { sims, seed, counts, teamOf, calibration };
}

/* ---------------------------------- NFL ----------------------------------- */

export interface NflSimReceiver {
  id: string | number;
  team: string;
  /** mean receptions and the closed-form negative-binomial alpha (variance = mu + alpha mu^2) */
  mu: number; alpha: number;
  /** catch rate used to turn the allocated targets into receptions */
  catchRate: number;
}

export interface NflSimOptions {
  sims?: number;
  seed?: number | string;
  teammateCorr?: number;
  /** mean targets not given to a listed receiver, per team (RBs, unlisted WR/TE). Default from params. */
  otherTargets?: Record<string, number>;
}

export function simulateNflGame(receivers: NflSimReceiver[], opts: NflSimOptions = {}): SimResult {
  const P = GAMESIM_PARAMS.nfl;
  const sims = Math.max(1000, Math.round(opts.sims ?? 15000));
  const seed = typeof opts.seed === 'number' ? opts.seed
    : hashSeed(String(opts.seed ?? '') + JSON.stringify(receivers.map(s => [s.id, s.mu, s.alpha, s.catchRate])) + sims);
  const rng = mulberry32(seed);
  const counts = new Map<string, Int16Array>(); const teamOf = new Map<string, string>(); const calibration: Record<string, ShareCalibration> = {};
  for (const team of Array.from(new Set(receivers.map(s => s.team)))) {
    const roster = receivers.filter(s => s.team === team && s.mu > 0);
    if (!roster.length) continue;
    const listedTargets = roster.reduce((a, s) => a + s.mu / s.catchRate, 0);
    const other = opts.otherTargets?.[team] ?? P.otherTargetsShare * listedTargets / (1 - P.otherTargetsShare);
    const slots: ShareSlot[] = roster.map(s => ({ id: String(s.id), mu: s.mu, reqVar: s.mu + s.alpha * s.mu * s.mu, q: Math.min(0.95, Math.max(0.3, s.catchRate)) }));
    slots.push({ id: '__other__', mu: other * P.otherCatchRate, reqVar: null, q: P.otherCatchRate });
    const calib = calibrateShares(slots, opts.teammateCorr ?? P.teammateCorr);
    calibration[team] = calib;
    const out = simulateTeam({ team, slots, calib }, sims, rng);
    roster.forEach((sk, i) => { const k = simKey(sk.id, 'rec'); counts.set(k, out[i]); teamOf.set(k, team); });
  }
  return { sims, seed, counts, teamOf, calibration };
}

/** Leg adapter so legacy code can describe a leg with a closed-form marginal and still query the sim. */
export function toSimLeg(l: Leg & { playerId: string | number; market: SimMarket }): SimLeg {
  return { playerId: l.playerId, market: l.market, line: l.line, side: l.side };
}

/* ------------------------- UI-facing team adapters ------------------------- */
// The desks hold ONE team's priced players and want per-player draws they can combine into joints. These adapters call
// the calibrated simulators above (nothing here re-fits or overrides their parameters).

export interface TeamSimOut<K extends string> {
  /** playerId -> one value per simulated game, per market */
  draws: Record<string, Partial<Record<K, Int16Array>>>;
  sims: number;
  seed: number;
  /** false if the variance / teammate-correlation targets could not both be met for this roster */
  exact: boolean;
  calibration: ShareCalibration;
}

export function simulateNhlTeam(a: {
  players: { id: string; pos?: string; muShots: number; muPoints: number | null }[];
  sims?: number; seed?: number | string;
  sogR?: number; ptsR?: number; rhoShotsPoints?: number;
}): TeamSimOut<'sog' | 'pts'> {
  const sogR = a.sogR ?? NHL_CONFIG.sog.r, ptsR = a.ptsR ?? NHL_CONFIG.pts.r;
  const skaters: NhlSimSkater[] = a.players.filter(p => p.muShots > 0).map(p => ({
    id: p.id, team: 'T', sogMu: p.muShots, sogR, ptsMu: p.muPoints !== null && p.muPoints > 0 ? p.muPoints : null, ptsR
  }));
  const res = simulateNhlGame(skaters, { sims: a.sims, seed: a.seed, rhoShotsPoints: a.rhoShotsPoints ?? NHL_CONFIG.rhoShotsPoints });
  const draws: TeamSimOut<'sog' | 'pts'>['draws'] = {};
  skaters.forEach(s => {
    const id = String(s.id);
    draws[id] = { sog: res.counts.get(simKey(id, 'sog')), pts: res.counts.get(simKey(id, 'pts')) };
  });
  const calibration = res.calibration.T;
  return { draws, sims: res.sims, seed: res.seed, exact: !!calibration?.exact, calibration };
}

export function simulateNflTeam(a: {
  players: { id: string; mu: number; catchRate: number; alpha?: number }[];
  sims?: number; seed?: number | string; alpha?: number;
}): TeamSimOut<'rec'> {
  const recv: NflSimReceiver[] = a.players.filter(p => p.mu > 0).map(p => ({
    id: p.id, team: 'T', mu: p.mu, alpha: p.alpha ?? a.alpha ?? 0.1, catchRate: p.catchRate
  }));
  const res = simulateNflGame(recv, { sims: a.sims, seed: a.seed });
  const draws: TeamSimOut<'rec'>['draws'] = {};
  recv.forEach(r => { draws[String(r.id)] = { rec: res.counts.get(simKey(String(r.id), 'rec')) }; });
  const calibration = res.calibration.T;
  return { draws, sims: res.sims, seed: res.seed, exact: !!calibration?.exact, calibration };
}

export interface DrawLeg { draws: ArrayLike<number>; line: number; side: 'over' | 'under' }

/** Joint probability of legs that were drawn from the SAME simulated games (pushes count as not winning). */
export function simJoint(legs: DrawLeg[]): { p: number; pIndep: number; se: number; legP: number[] } {
  if (!legs.length) return { p: 0, pIndep: 0, se: 0, legP: [] };
  const n = legs[0].draws.length;
  const each = new Array(legs.length).fill(0); let all = 0;
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let j = 0; j < legs.length; j++) {
      if (legWins(legs[j].draws[i], legs[j])) each[j]++; else ok = false;
    }
    if (ok) all++;
  }
  const legP = each.map(x => x / n); const p = all / n;
  return { p, pIndep: legP.reduce((a, b) => a * b, 1), se: Math.sqrt((p * (1 - p)) / n), legP };
}
