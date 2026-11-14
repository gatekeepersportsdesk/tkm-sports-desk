import test from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToImpliedProb,
  devigTwoWay,
  evaluateMarketVariance,
  getNbaMarketVariance,
  getNhlMarketVariance,
  getNflMarketVariance
} from './market_variance';
import { NbaPlayerProjection } from '../types/nba';
import { NhlSkaterProjection } from '../types/nhl';
import { NflPropSnapshot } from '../types/nfl';

test('market_variance: americanToImpliedProb converts negative and positive odds', () => {
  const p110 = americanToImpliedProb(-110);
  assert.ok(p110 !== null);
  assert.ok(Math.abs(p110 - 0.5238) < 0.001);

  const pPlus120 = americanToImpliedProb('+120');
  assert.ok(pPlus120 !== null);
  assert.ok(Math.abs(pPlus120 - 0.4545) < 0.001);

  assert.equal(americanToImpliedProb(''), null);
  assert.equal(americanToImpliedProb(null), null);
});

test('market_variance: devigTwoWay de-vigs two-way American lines', () => {
  const fair = devigTwoWay(-110, -110);
  assert.ok(fair !== null);
  assert.ok(Math.abs(fair.fairOver - 0.5) < 0.001);
  assert.ok(Math.abs(fair.fairUnder - 0.5) < 0.001);

  const fairAsym = devigTwoWay(-150, +130);
  assert.ok(fairAsym !== null);
  assert.ok(fairAsym.fairOver > 0.55);
  assert.ok(fairAsym.fairUnder < 0.45);
});

test('market_variance: flags high variance when model diverges significantly from market odds', () => {
  // Model has 68% on Over, but book prices Over at -110 (50% de-vigged fair) -> 18pp divergence
  const res = evaluateMarketVariance({
    modelProb: 0.68,
    line: 24.5,
    projectedMu: 25.0,
    baselineAvg: 24.8,
    overOdds: -110,
    underOdds: -110,
    lean: 'OVER'
  });

  assert.equal(res.level, 'HIGH');
  assert.equal(res.isHighVariance, true);
  assert.ok(res.probDivergence !== null && res.probDivergence >= 17);
  assert.ok(res.reasons.some(r => r.includes('diverges')));
});

test('market_variance: flags high variance when daily-card average has significant shift', () => {
  // Baseline season average was 18.0, but current card projection mu is 25.2 (+40% shift due to teammate out)
  const res = evaluateMarketVariance({
    modelProb: 0.54,
    line: 21.5,
    projectedMu: 25.2,
    baselineAvg: 18.0,
    overOdds: -110,
    underOdds: -110,
    lean: 'OVER'
  });

  assert.equal(res.level, 'HIGH');
  assert.equal(res.isHighVariance, true);
  assert.ok(res.shiftPct !== null && res.shiftPct >= 35);
  assert.ok(res.reasons.some(r => r.includes('daily-card shift')));
});

test('market_variance: flags high variance when multi-book external movement shows high line spread', () => {
  const res = evaluateMarketVariance({
    modelProb: 0.52,
    line: 25.5,
    projectedMu: 25.0,
    baselineAvg: 25.0,
    externalMovement: {
      player: 'Luka Doncic',
      sport: 'nba',
      market: 'pts',
      minLine: 24.5,
      maxLine: 26.5,
      lineSpread: 2.0,
      consensusLine: 25.5,
      bookCount: 4,
      steamDirection: 'OVER'
    }
  });

  assert.equal(res.level, 'HIGH');
  assert.equal(res.isHighVariance, true);
  assert.ok(res.reasons.some(r => r.includes('sportsbook disagreement') || r.includes('line variance')));
});

test('market_variance: evaluates normal variance on well-aligned prop', () => {
  const res = evaluateMarketVariance({
    modelProb: 0.52,
    line: 24.5,
    defaultLine: 24.5,
    projectedMu: 24.6,
    baselineAvg: 24.5,
    overOdds: -110,
    underOdds: -110,
    lean: 'OVER'
  });

  assert.equal(res.level, 'NORMAL');
  assert.equal(res.isHighVariance, false);
});
