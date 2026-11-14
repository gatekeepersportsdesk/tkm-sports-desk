import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateNhlTeam, simulateNflTeam, simJoint, meanVarFromSim, simulateNhlGame, simulateNflGame, calibrateShares, gammaDraw, poissonDraw, normInv } from './gamesim.ts';
import { mulberry32 } from './sampler.ts';

const nhlRoster = (n = 14): { id: string; pos: string; muShots: number; muPoints: number | null }[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, pos: i < 8 ? 'F' : 'D', muShots: 1.2 + 0.12 * (i % 7), muPoints: 0.25 + 0.03 * (i % 6) }));
const mean = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
const varOf = (a: ArrayLike<number>) => { const m = mean(a); let v = 0; for (let i = 0; i < a.length; i++) v += (a[i] - m) ** 2; return v / (a.length - 1); };
const corr = (a: ArrayLike<number>, b: ArrayLike<number>) => { const ma = mean(a), mb = mean(b); let n = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); x += (a[i] - ma) ** 2; y += (b[i] - mb) ** 2; } return n / Math.sqrt(x * y); };

test('gamesim: primitives (normInv, gamma and poisson draws have the right moments)', () => {
  assert.ok(Math.abs(normInv(0.975) - 1.95996) < 1e-4); assert.ok(Math.abs(normInv(0.5)) < 1e-9);
  const rng = mulberry32(1); let g = 0, p = 0; const N = 40000;
  for (let i = 0; i < N; i++) { g += gammaDraw(2.5, rng); p += poissonDraw(3.2, rng); }
  assert.ok(Math.abs(g / N - 2.5) < 0.05); assert.ok(Math.abs(p / N - 3.2) < 0.05);
});

test('gamesim NHL: each skater marginal matches the priced mean and negative-binomial variance', () => {
  const ros = nhlRoster(); const sim = simulateNhlTeam({ players: ros, sims: 20000, seed: 11, sogR: 16, ptsR: 36, rhoShotsPoints: 0.276 });
  assert.ok(sim.exact, 'calibration should hit both targets for a normal roster');
  for (const p of ros) {
    const s = sim.draws[p.id].sog!, q = sim.draws[p.id].pts!;
    assert.ok(Math.abs(mean(s) - p.muShots) / p.muShots < 0.04, `shots mean ${p.id}`);
    const reqV = p.muShots + p.muShots ** 2 / 16;
    assert.ok(Math.abs(varOf(s) - reqV) / reqV < 0.10, `shots var ${p.id}`);
    assert.ok(Math.abs(mean(q) - p.muPoints!) / p.muPoints! < 0.06, `points mean ${p.id}`);
  }
});

test('gamesim NHL: same skater shots and points are positively dependent; teammates mildly so', () => {
  const ros = nhlRoster(); const sim = simulateNhlTeam({ players: ros, sims: 20000, seed: 12, sogR: 16, ptsR: 36, rhoShotsPoints: 0.276 });
  const cs: number[] = [];
  for (const p of ros) cs.push(corr(sim.draws[p.id].sog!, sim.draws[p.id].pts!));
  assert.ok(mean(cs) > 0.12 && mean(cs) < 0.30, `same-skater corr ${mean(cs)}`);
  const tm: number[] = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) tm.push(corr(sim.draws[ros[i].id].pts!, sim.draws[ros[j].id].pts!));
  assert.ok(mean(tm) > 0.04 && mean(tm) < 0.16, `teammate points corr ${mean(tm)} (measured +0.096)`);
});

test('gamesim NHL: joint of positively dependent legs beats the product; under/under too', () => {
  const sim = simulateNhlTeam({ players: nhlRoster(), sims: 30000, seed: 13, sogR: 16, ptsR: 36, rhoShotsPoints: 0.276 });
  const d = sim.draws.s2;
  const over = simJoint([{ draws: d.sog!, line: 2.5, side: 'over' }, { draws: d.pts!, line: 0.5, side: 'over' }]);
  assert.ok(over.p > over.pIndep * 1.1, `over/over ${over.p} vs ${over.pIndep}`);
  const under = simJoint([{ draws: d.sog!, line: 1.5, side: 'under' }, { draws: d.pts!, line: 0.5, side: 'under' }]);
  assert.ok(under.p > under.pIndep * 1.05);
  const mixed = simJoint([{ draws: d.sog!, line: 2.5, side: 'over' }, { draws: d.pts!, line: 0.5, side: 'under' }]);
  assert.ok(mixed.p < mixed.pIndep);
});

test('gamesim: deterministic for the same inputs and seed, different for another seed', () => {
  const a = simulateNhlTeam({ players: nhlRoster(), sims: 3000, seed: 'x' }), b = simulateNhlTeam({ players: nhlRoster(), sims: 3000, seed: 'x' }), c = simulateNhlTeam({ players: nhlRoster(), sims: 3000, seed: 'y' });
  assert.deepEqual(Array.from(a.draws.s0.sog!), Array.from(b.draws.s0.sog!));
  assert.notDeepEqual(Array.from(a.draws.s0.sog!), Array.from(c.draws.s0.sog!));
});

test('gamesim NHL: no points feed means no points draws, never a made-up series', () => {
  const ros = nhlRoster(); ros[3] = { ...ros[3], muPoints: null };
  const sim = simulateNhlTeam({ players: ros, sims: 2000, seed: 5 });
  assert.equal(sim.draws.s3.pts, undefined); assert.ok(sim.draws.s3.sog); assert.ok(sim.draws.s4.pts);
});

test('gamesim NHL: zero-mean skaters are excluded and a one-skater team does not crash', () => {
  const sim = simulateNhlTeam({ players: [{ id: 'a', muShots: 2, muPoints: 0.4 }, { id: 'b', muShots: 0, muPoints: 0 }], sims: 2000, seed: 1 });
  assert.ok(sim.draws.a.sog); assert.equal(sim.draws.b, undefined);
});

test('gamesim NFL: marginals match priced mean and NB variance; teammate correlation near the measured +0.027', () => {
  const pl = [{ id: 'w1', mu: 5.4, catchRate: 0.66, alpha: 0.1 }, { id: 'w2', mu: 4.1, catchRate: 0.64, alpha: 0.1 }, { id: 'w3', mu: 3.2, catchRate: 0.65, alpha: 0.1 }, { id: 't1', mu: 3.0, catchRate: 0.68, alpha: 0.125 }];
  const sim = simulateNflTeam({ players: pl, sims: 40000, seed: 21 });
  for (const p of pl) {
    const d = sim.draws[p.id].rec!;
    assert.ok(Math.abs(mean(d) - p.mu) / p.mu < 0.03, `mean ${p.id}`);
    const rv = p.mu + (p.alpha ?? 0.1) * p.mu ** 2;
    assert.ok(Math.abs(varOf(d) - rv) / rv < 0.10, `var ${p.id} ${varOf(d)} vs ${rv}`);
  }
  const cs: number[] = [];
  for (let i = 0; i < pl.length; i++) for (let j = i + 1; j < pl.length; j++) cs.push(corr(sim.draws[pl[i].id].rec!, sim.draws[pl[j].id].rec!));
  assert.ok(Math.abs(mean(cs) - 0.027) < 0.02, `teammate corr ${mean(cs)}`);
});

test('gamesim: conditional on team volume shares compete (negative), unconditional dependence is the measured near-zero', () => {
  const sim = simulateNflGame([{ id: 'a', team: 'T', mu: 5, alpha: 0.1, catchRate: 0.65 }, { id: 'b', team: 'T', mu: 5, alpha: 0.1, catchRate: 0.65 }], { sims: 30000, seed: 3 });
  const a = sim.counts.get('a|rec')!, b = sim.counts.get('b|rec')!;
  assert.ok(Math.abs(corr(a, b)) < 0.1);
  assert.ok(Number.isFinite(sim.calibration.T.alpha) && sim.calibration.T.alpha > 0);
});

test('gamesim: calibrateShares hits the variance target and reports when it cannot', () => {
  const ok = calibrateShares([{ id: 'a', mu: 3, reqVar: 3 + 0.1 * 9, q: 0.65 }, { id: 'b', mu: 3, reqVar: 3 + 0.1 * 9, q: 0.65 }, { id: 'o', mu: 2, reqVar: null, q: 0.7 }], 0.03);
  assert.ok(ok.exact && Math.abs(ok.varRatio - 1) < 0.02 && Math.abs(ok.impliedCorr - 0.03) < 0.005, JSON.stringify(ok));
  const impossible = calibrateShares([{ id: 'a', mu: 3, reqVar: 3.0001, q: 1 }, { id: 'b', mu: 3, reqVar: 3.0001, q: 1 }], 0.5);
  assert.equal(impossible.exact, false);
});

test('gamesim simJoint: single leg equals its marginal; pushes never win; contradictory legs are impossible', () => {
  const draws = Int16Array.from([0, 1, 2, 2, 3, 3, 3, 4]);
  assert.equal(simJoint([{ draws, line: 2.5, side: 'over' }]).p, 4 / 8);
  assert.equal(simJoint([{ draws, line: 3, side: 'over' }]).p, 1 / 8);  // integer line: 3 is a push, only 4 wins
  assert.equal(simJoint([{ draws, line: 3, side: 'under' }]).p, 4 / 8); // 0,1,2,2 win; 3s push
  assert.equal(simJoint([{ draws, line: 2.5, side: 'over' }, { draws, line: 2.5, side: 'under' }]).p, 0);
  assert.equal(simJoint([]).p, 0);
});

test('gamesim: opponents are independent by construction (two teams, no cross dependence)', () => {
  const sim = simulateNhlGame([
    ...nhlRoster(10).map((p, i) => ({ id: `a${i}`, team: 'A', sogMu: p.muShots, sogR: 16, ptsMu: p.muPoints, ptsR: 36 })),
    ...nhlRoster(10).map((p, i) => ({ id: `b${i}`, team: 'B', sogMu: p.muShots, sogR: 16, ptsMu: p.muPoints, ptsR: 36 }))], { sims: 20000, seed: 8 });
  const c = corr(sim.counts.get('a1|pts')!, sim.counts.get('b1|pts')!);
  assert.ok(Math.abs(c) < 0.03, `cross-team corr ${c}`);
  assert.ok(meanVarFromSim(sim, 'a1', 'sog').mean > 0);
});
