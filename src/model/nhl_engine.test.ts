import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nbinomPmf, pOverLine, projectNhlSkater, shrinkRate, buildTeamFactors, opponentFactors,
  evaluateNhlMarket, ledgerUnits, classifyInputs, parseAmericanOdds, NHL_CONFIG, shrunkFactor, applyNhlFit, NHL_FITTED_KEYS
} from './nhl_engine.ts';
import { NhlPlayerSnapshot } from '../types/nhl.ts';
import { NHL_FIT } from '../data/nhl_fit.ts';

const skater = (o: Partial<NhlPlayerSnapshot> = {}): NhlPlayerSnapshot => ({
  playerId: 1, name: 'Test Skater', team: 'EDM', pos: 'F', toiAvg: 19,
  gp: 40, shots: 120, points: 28, priorGp: 82, priorShots: 246, priorPoints: 70,
  recentShots: [3, 2, 4], recentPoints: [1, 0, 1], availability: 'ACTIVE', inputsSource: 'REAL', ...o
});

test('NHL: nbinomPmf sums to ~1', () => {
  let sum = 0;
  for (let k = 0; k <= 40; k++) sum += nbinomPmf(k, 3.2, NHL_CONFIG.sog.r);
  assert.ok(Math.abs(sum - 1) < 1e-3);
});

test('NHL: P(over) falls as the line rises', () => {
  const ps = [1.5, 2.5, 3.5, 4.5].map(l => pOverLine(l, 3.5));
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1] > ps[i]);
});

test('NHL: a hot 4-game start is shrunk hard toward last season', () => {
  const r = shrinkRate({ gp: 4, total: 24, priorGp: 82, priorTotal: 164, posPrior: 2.0, shrinkK: 20, priorK: 20 });
  assert.ok(r.mu0 > 2.0 && r.mu0 < 3.0, `got ${r.mu0}`); // raw 6.0/gm would be absurd
});

test('NHL: with a big sample the current rate dominates', () => {
  const r = shrinkRate({ gp: 400, total: 1600, priorGp: 82, priorTotal: 164, posPrior: 2.0, shrinkK: 20, priorK: 20 });
  assert.ok(Math.abs(r.mu0 - 4.0) < 0.2);
});

test('NHL: rookie with no data prices from the position prior only', () => {
  const r = shrinkRate({ gp: 0, total: 0, priorGp: 0, priorTotal: 0, posPrior: 2.0, shrinkK: 20, priorK: 20 });
  assert.ok(Math.abs(r.mu0 - 2.0) < 1e-9);
});

test('NHL: points market is off when the feed has no points', () => {
  const proj = projectNhlSkater(skater({ points: null, priorPoints: null }), 'TOR');
  assert.equal(proj.pts, null);
  assert.ok(proj.sog.mu > 0);
});

test('NHL: shots + points are both priced with monotone probabilities', () => {
  const proj = projectNhlSkater(skater(), 'TOR');
  assert.ok(proj.pts);
  const p = proj.pts!.probs;
  assert.ok(p[0.5].p_over > p[1.5].p_over && p[1.5].p_over > p[2.5].p_over);
  // half lines never push
  assert.equal(proj.sog.probs[2.5].p_push, 0);
  assert.ok(Math.abs(p[0.5].p_over + p[0.5].p_under - 1) < 1e-9);
});

test('NHL: team factors are shrunk by games played and clamped', () => {
  const f = buildTeamFactors({
    AAA: { gp: 5, shotsAgainstPerGame: 36, goalsAgainstPerGame: 4 },
    BBB: { gp: 5, shotsAgainstPerGame: 24, goalsAgainstPerGame: 2 },
    CCC: { gp: 5, shotsAgainstPerGame: 30, goalsAgainstPerGame: 3 }
  });
  assert.ok(f.AAA.sog > 1 && f.AAA.sog < 1.1, `5 games should barely move it: ${f.AAA.sog}`);
  assert.ok(f.CCC.sog > 0.99 && f.CCC.sog < 1.01);
  const full = shrunkFactor(40, 30, 82);
  assert.ok(full > 1.2 && full <= 1.25);
  assert.equal(shrunkFactor(100, 30, 500), 1.25);
});

test('NHL: opponent factor source is labelled; static table is half weight', () => {
  assert.equal(opponentFactors('SJS').source, 'static');
  assert.ok(Math.abs(opponentFactors('SJS').sog - (1 + 0.18 * 0.5)) < 1e-9);
  assert.equal(opponentFactors('XXX').source, 'none');
  assert.equal(opponentFactors('SJS', { SJS: { sog: 1.05, pts: 1.02, source: 'live' } }).source, 'live');
});

test('NHL: inputs are ESTIMATED without a live feed or enough games', () => {
  assert.equal(classifyInputs(skater(), true), 'REAL');
  assert.equal(classifyInputs(skater(), false), 'ESTIMATED');
  assert.equal(classifyInputs(skater({ gp: 3, priorGp: 4 }), true), 'ESTIMATED');
});

const base = { availability: 'ACTIVE' as const, inputsSource: 'REAL' as const };

test('NHL decision: no price -> PASS, hasMarket false', () => {
  const d = evaluateNhlMarket({ pOver: 0.6, pUnder: 0.4, over: null, under: null, ...base });
  assert.equal(d.tag, 'PASS');
  assert.equal(d.hasMarket, false);
});

test('NHL decision: over STAB when it beats the de-vigged price and EV > 0', () => {
  const d = evaluateNhlMarket({ pOver: 0.62, pUnder: 0.38, over: -110, under: -110, ...base });
  assert.equal(d.tag, 'STAB');
  assert.equal(d.side, 'over');
  assert.ok(d.ev! > 0 && d.edge > 5 && d.twoWay);
});

test('NHL decision: FADE needs a real under price', () => {
  const oneSided = evaluateNhlMarket({ pOver: 0.35, pUnder: 0.65, over: -110, under: null, ...base });
  assert.equal(oneSided.tag, 'PASS');
  assert.match(oneSided.reason, /under is not priced/);
  const both = evaluateNhlMarket({ pOver: 0.35, pUnder: 0.65, over: -110, under: -110, ...base });
  assert.equal(both.tag, 'FADE');
  assert.equal(both.side, 'under');
});

test('NHL decision: an edge that does not survive the vig is not a bet', () => {
  const d = evaluateNhlMarket({ pOver: 0.799, pUnder: 0.201, over: -400, under: null, maxChalk: -1000, ...base });
  assert.equal(d.tag, 'PASS');
  assert.match(d.reason, /vig/);
});

test('NHL decision: chalk ceiling, estimated inputs, and availability gate', () => {
  assert.equal(evaluateNhlMarket({ pOver: 0.9, pUnder: 0.1, over: -250, under: 190, ...base }).tag, 'PASS');
  assert.equal(evaluateNhlMarket({ pOver: 0.62, pUnder: 0.38, over: -110, under: -110, availability: 'ACTIVE', inputsSource: 'ESTIMATED' }).tag, 'PASS');
  assert.equal(evaluateNhlMarket({ pOver: 0.62, pUnder: 0.38, over: -110, under: -110, availability: 'OUT', inputsSource: 'REAL' }).tag, 'PASS');
  const unk = evaluateNhlMarket({ pOver: 0.62, pUnder: 0.38, over: -110, under: -110, availability: 'UNKNOWN', inputsSource: 'REAL' });
  assert.equal(unk.tag, 'PASS');
  assert.match(unk.reason, /Availability unconfirmed/);
});

test('NHL decision: integer lines remove the push from both sides', () => {
  const d = evaluateNhlMarket({ pOver: 0.4, pUnder: 0.4, pPush: 0.2, over: 100, under: 100, ...base });
  assert.ok(Math.abs(d.edgeOver!) < 1e-9); // 0.5 vs 0.5 once the push is refunded
});

test('NHL: parseAmericanOdds rejects garbage instead of defaulting', () => {
  assert.equal(parseAmericanOdds('abc'), null);
  assert.equal(parseAmericanOdds(''), null);
  assert.equal(parseAmericanOdds('+120'), 120);
  assert.equal(parseAmericanOdds('−135'), -135);
});

test('NHL: ledger units use the odds of the tagged side', () => {
  const row = { tag: 'FADE' as const, side: 'under' as const, overOdds: -120, underOdds: 100, result: 'UNDER' as const };
  assert.equal(ledgerUnits(row), 1);
  assert.equal(ledgerUnits({ ...row, result: 'OVER' }), -1);
  assert.equal(ledgerUnits({ ...row, result: 'PUSH' }), 0);
  assert.equal(ledgerUnits({ ...row, tag: 'PASS', side: null }), null);
});

test('NHL tuning: overrides change the projection and reset restores it', async () => {
  const { applyNhlTuning, NHL_TUNING_DEFAULTS } = await import('./nhl_engine.ts');
  const p = skater({ gp: 10, shots: 40, priorGp: 82, priorShots: 164 });
  const before = projectNhlSkater(p, 'TOR');
  applyNhlTuning({ sogShrinkK: 1, sogR: 5 });
  const after = projectNhlSkater(p, 'TOR');
  assert.ok(after.sog.mu0 > before.sog.mu0, 'less shrinkage moves the rate toward the current 4.0/gm');
  assert.equal(after.sog.r, 5);
  applyNhlTuning({ ...NHL_TUNING_DEFAULTS });
  assert.equal(projectNhlSkater(p, 'TOR').sog.mu0, before.sog.mu0);
});

test('NHL: fit overlay applies only in-bounds fitted numbers and does nothing when null', () => {
  const before = JSON.stringify(NHL_CONFIG);
  const priorCfg = JSON.parse(before);
  assert.deepEqual(applyNhlFit(null), []);
  assert.equal(JSON.stringify(NHL_CONFIG), before);
  const used = applyNhlFit({ source: 'test', fitSeason: 2026, testSeason: 2026, nTrainRows: 10, nTestRows: 10, evidence: {}, splitNote: '',
    values: { sogR: 17.2, ptsR: 999, sogShrinkK: 33, rhoShotsPoints: Number.NaN, bogus: 1 } });
  assert.deepEqual(used.sort(), ['sogR', 'sogShrinkK']);
  assert.equal(NHL_CONFIG.sog.r, 17.2);
  assert.equal(NHL_CONFIG.sog.shrinkK, 33);
  assert.notEqual(NHL_CONFIG.pts.r, 999);
  assert.equal(NHL_CONFIG.pts.r, priorCfg.pts.r);
  assert.equal(NHL_FITTED_KEYS.length, NHL_FIT ? Object.keys(NHL_FIT.values).length : 0); // only what the shipped fit file contains
  NHL_CONFIG.sog.r = priorCfg.sog.r; NHL_CONFIG.sog.shrinkK = priorCfg.sog.shrinkK; // restore for later tests
});
