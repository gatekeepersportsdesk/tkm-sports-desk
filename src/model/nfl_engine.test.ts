import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logGamma,
  nbinomPmf,
  calculateDiscreteLineProbs,
  computeStructuralMu,
  evaluateCardRules,
  parseOdds,
  devigTwoWay
} from './nfl_engine.ts';

test('NFL: logGamma accurate on integer and fractional values', () => {
  // Gamma(1) = 1 -> logGamma = 0
  assert.ok(Math.abs(logGamma(1)) < 1e-6);
  // Gamma(5) = 24 -> logGamma = ln(24) ≈ 3.1780538
  assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-5);
  // Gamma(0.5) = sqrt(pi) -> logGamma = 0.5 * ln(pi)
  assert.ok(Math.abs(logGamma(0.5) - 0.5 * Math.log(Math.PI)) < 1e-5);
});

test('NFL: nbinomPmf sums approximately to 1 over plausible range', () => {
  const mu = 4.5;
  const alpha = 0.10; // WR alpha
  let sum = 0;
  for (let k = 0; k <= 30; k++) {
    sum += nbinomPmf(k, mu, alpha);
  }
  assert.ok(Math.abs(sum - 1.0) < 0.001, `Sum was ${sum}`);
});

test('NFL: discrete probabilities split correctly for half lines', () => {
  const mu = 5.0;
  const alpha = 0.10;
  const probs = calculateDiscreteLineProbs(mu, 4.5, alpha);
  assert.equal(probs.p_push, 0);
  assert.ok(probs.p_over > 0 && probs.p_over < 1);
  assert.ok(probs.p_under > 0 && probs.p_under < 1);
  assert.ok(Math.abs(probs.p_over + probs.p_under - 1.0) < 1e-6);
});

test('NFL: structural mu OLS dropbacks and shrinkage work as specified', () => {
  const stats = {
    routes: 135.5,
    season_tprr: 0.3688,
    prior_tprr: 0.3919,
    receptions: 36,
    targets: 50,
    route_pct: 0.8633,
    walk_forward_ratio: 0.9915,
    season_avg_receptions: 7.20
  };
  const game = {
    spread: -3.0,
    implied_total: 22.25
  };
  const res = computeStructuralMu(stats, game);
  assert.ok(res.dropbacks > 30 && res.dropbacks < 45, `Dropbacks was ${res.dropbacks}`);
  assert.ok(res.shrunkTprr > 0.35 && res.shrunkTprr < 0.40);
  assert.ok(res.shrunkCatchRate > 0.65 && res.shrunkCatchRate < 0.75);
  assert.ok(res.finalMu > 5.0 && res.finalMu < 10.0, `Final mu was ${res.finalMu}`);
});

test('NFL: card rules enforce BET, PASS, and OFF constraints correctly', () => {
  // Edge >= 3%, price >= -150, deviation <= 1.5 -> BET
  const bet = evaluateCardRules(0.05, -110, 5.0, 5.2);
  assert.equal(bet.status, 'BET');

  // Small edge (< 3%) -> PASS
  const passEdge = evaluateCardRules(0.02, -110, 5.0, 5.2);
  assert.equal(passEdge.status, 'PASS');

  // Heavy chalk worse than -150 (e.g. -175) -> PASS
  const passChalk = evaluateCardRules(0.06, -175, 5.0, 5.2);
  assert.equal(passChalk.status, 'PASS');

  // High deviation |mu - season_avg| > 1.5 -> OFF
  const offDeviation = evaluateCardRules(0.06, -110, 5.0, 2.8);
  assert.equal(offDeviation.status, 'OFF');
});

test('NFL: odds parsing and two-way devigging', () => {
  const parsedMinus = parseOdds('-110');
  assert.equal(parsedMinus.us, -110);
  assert.ok(Math.abs(parsedMinus.imp - (110 / 210)) < 1e-4);

  const parsedPlus = parseOdds('+130');
  assert.equal(parsedPlus.us, 130);

  const devigged = devigTwoWay('-110', '-110');
  assert.ok(devigged);
  assert.ok(Math.abs(devigged.fair_over - 0.5) < 1e-4);
  assert.ok(Math.abs(devigged.fair_under - 0.5) < 1e-4);
});
