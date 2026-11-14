import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nbCdfTable, nbPmf, sampleCopula, jointPair, jointProbability, legProb, teamCorrelation,
  makePositiveDefinite, cholesky, mulberry32, normCdf, fairAmerican, CORR_PRIORS
} from './sampler.ts';

const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
const variance = (a: ArrayLike<number>) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return s / a.length; };
const corrOf = (x: ArrayLike<number>, y: ArrayLike<number>) => {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

test('sampler: NB cdf table is a proper CDF and the pmf sums to 1', () => {
  const t = nbCdfTable({ mu: 3.2, r: 15.13 });
  assert.equal(t[t.length - 1], 1);
  for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1]);
  let s = 0; for (let k = 0; k < 60; k++) s += nbPmf(k, 3.2, 15.13);
  assert.ok(Math.abs(s - 1) < 1e-6);
});

test('sampler: sampled marginals match the closed-form NB (mean, variance, P(over))', () => {
  const m = { mu: 2.8, r: 15.13 };
  const [x] = sampleCopula([m], [[1]], { sims: 60000, seed: 7 });
  assert.ok(Math.abs(mean(x) - m.mu) < 0.03, `mean ${mean(x)}`);
  const theoVar = m.mu + (m.mu * m.mu) / m.r;
  assert.ok(Math.abs(variance(x) - theoVar) / theoVar < 0.05, `var ${variance(x)} vs ${theoVar}`);
  let over = 0; for (const v of x) if (v > 2.5) over++;
  assert.ok(Math.abs(over / x.length - legProb({ marginal: m, line: 2.5, side: 'over' })) < 0.01);
});

test('sampler: marginals are untouched by the correlation (copula property)', () => {
  const a = { mu: 3.1, r: 15.13 }, b = { mu: 0.7, r: 12 };
  const [x, y] = sampleCopula([a, b], [[1, 0.6], [0.6, 1]], { sims: 60000, seed: 11 });
  assert.ok(Math.abs(mean(x) - a.mu) < 0.04);
  assert.ok(Math.abs(mean(y) - b.mu) < 0.02);
  assert.ok(corrOf(x, y) > 0.3); // dependence is real (discreteness attenuates the latent 0.6)
});

test('sampler: rho = 0 reproduces the independent product; +rho raises over/over; -rho lowers it', () => {
  const sog = { marginal: { mu: 3.4, r: 15.13 }, line: 2.5, side: 'over' as const };
  const pts = { marginal: { mu: 0.8, r: 12 }, line: 0.5, side: 'over' as const };
  const zero = jointPair(sog, pts, 0, { sims: 40000, seed: 3 });
  assert.ok(Math.abs(zero.p - zero.pIndep) < 4 * zero.se + 0.004, `${zero.p} vs ${zero.pIndep}`);
  const pos = jointPair(sog, pts, 0.35, { sims: 40000, seed: 3 });
  assert.ok(pos.p > pos.pIndep + 0.01);
  const neg = jointPair(sog, pts, -0.35, { sims: 40000, seed: 3 });
  assert.ok(neg.p < neg.pIndep - 0.01);
});

test('sampler: over-vs-under legs flip the sign of the dependence', () => {
  const a = { marginal: { mu: 3.4, r: 15.13 }, line: 2.5, side: 'over' as const };
  const b = { marginal: { mu: 0.8, r: 12 }, line: 0.5, side: 'under' as const };
  const j = jointPair(a, b, 0.35, { sims: 40000, seed: 5 });
  assert.ok(j.p < j.pIndep - 0.005);
});

test('sampler: deterministic for the same inputs, different for another seed', () => {
  const a = { marginal: { mu: 3.4, r: 15.13 }, line: 2.5, side: 'over' as const };
  const b = { marginal: { mu: 0.8, r: 12 }, line: 0.5, side: 'over' as const };
  const r1 = jointPair(a, b, 0.3, { sims: 5000 });
  const r2 = jointPair(a, b, 0.3, { sims: 5000 });
  assert.equal(r1.p, r2.p);
  assert.notEqual(jointPair(a, b, 0.3, { sims: 5000, seed: 1 }).p, jointPair(a, b, 0.3, { sims: 5000, seed: 2 }).p);
});

test('sampler: legProb handles half and integer lines on both sides', () => {
  const m = { mu: 3, r: 15.13 };
  const over25 = legProb({ marginal: m, line: 2.5, side: 'over' });
  const under25 = legProb({ marginal: m, line: 2.5, side: 'under' });
  assert.ok(Math.abs(over25 + under25 - 1) < 1e-9);
  const o3 = legProb({ marginal: m, line: 3, side: 'over' });
  const u3 = legProb({ marginal: m, line: 3, side: 'under' });
  assert.ok(Math.abs(o3 + u3 + nbPmf(3, 3, 15.13) - 1) < 1e-6); // push mass is the remainder
});

test('sampler: a non-positive-definite matrix is repaired, not crashed on', () => {
  const bad = [[1, 0.95, -0.95], [0.95, 1, 0.95], [-0.95, 0.95, 1]];
  assert.equal(cholesky(bad), null);
  const fixed = makePositiveDefinite(bad);
  assert.ok(fixed.shrunk && cholesky(fixed.corr));
  const out = sampleCopula([{ mu: 3, r: 15 }, { mu: 3, r: 15 }, { mu: 3, r: 15 }], bad, { sims: 1000, seed: 1 });
  assert.equal(out.length, 3);
});

test('sampler: team correlation blocks (same team, opponent, other game)', () => {
  const c = teamCorrelation([
    { game: 'g1', team: 'A' }, { game: 'g1', team: 'A' }, { game: 'g1', team: 'B' }, { game: 'g2', team: 'C' }
  ], 0.03, -0.01);
  assert.equal(c[0][1], 0.03);
  assert.equal(c[0][2], -0.01);
  assert.equal(c[0][3], 0);
  assert.equal(c[2][2], 1);
  const j = jointProbability(
    [0, 1, 2].map(() => ({ marginal: { mu: 4, r: 10 }, line: 3.5, side: 'over' as const })),
    teamCorrelation([{ game: 'g', team: 'A' }, { game: 'g', team: 'A' }, { game: 'h', team: 'C' }], 0.03, 0),
    { sims: 20000, seed: 9 }
  );
  assert.ok(Math.abs(j.p - j.pIndep) < 0.02); // measured NFL rho is tiny, so a stack is ~independent
});

test('sampler: helpers (rng range, normal cdf, fair price, priors flagged measured/prior)', () => {
  const rng = mulberry32(1); for (let i = 0; i < 1000; i++) { const u = rng(); assert.ok(u >= 0 && u < 1); }
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6 && Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.equal(fairAmerican(0.6), -150);
  assert.equal(fairAmerican(0.4), 150);
  assert.equal(fairAmerican(0), null);
  assert.equal(CORR_PRIORS.nfl.measured, true);
  assert.equal(CORR_PRIORS.nhl.measured, false);
});
