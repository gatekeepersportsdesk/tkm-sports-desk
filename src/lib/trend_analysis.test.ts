import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  computeStreak,
  evaluateGameOutcome,
  getConsistencyTier,
  analyzeDailyCardTrends,
  getMarketLabel
} from './trend_analysis.js';

test('normalizeName cleans punctuation, suffixes and casing', () => {
  assert.equal(normalizeName('Marvin Mims Jr.'), 'marvin mims');
  assert.equal(normalizeName('Amon-Ra St. Brown'), 'amonra st brown');
  assert.equal(normalizeName('Kenneth Walker III'), 'kenneth walker');
});

test('evaluateGameOutcome correctly scores OVER, UNDER, and PUSH', () => {
  assert.equal(evaluateGameOutcome(4, 2.5, 'OVER'), 'HIT');
  assert.equal(evaluateGameOutcome(2, 2.5, 'OVER'), 'MISS');
  assert.equal(evaluateGameOutcome(2, 2.5, 'UNDER'), 'HIT');
  assert.equal(evaluateGameOutcome(3, 2.5, 'UNDER'), 'MISS');
  assert.equal(evaluateGameOutcome(3, 3.0, 'OVER'), 'PUSH');
  assert.equal(evaluateGameOutcome(3, 3.0, 'UNDER'), 'PUSH');
});

test('computeStreak identifies winning and losing streaks accurately', () => {
  // 3 game win streak
  const w3 = computeStreak(['HIT', 'HIT', 'HIT', 'MISS', 'HIT']);
  assert.equal(w3.streak, 3);
  assert.equal(w3.streakType, 'W');
  assert.equal(w3.streakCount, 3);

  // 2 game slump
  const l2 = computeStreak(['MISS', 'MISS', 'HIT', 'HIT']);
  assert.equal(l2.streak, -2);
  assert.equal(l2.streakType, 'L');
  assert.equal(l2.streakCount, 2);

  // Push at beginning does not break streak
  const wPush = computeStreak(['PUSH', 'HIT', 'HIT', 'MISS']);
  assert.equal(wPush.streak, 2);
  assert.equal(wPush.streakType, 'W');

  // Empty outcomes
  const empty = computeStreak([]);
  assert.equal(empty.streak, 0);
  assert.equal(empty.streakType, 'NONE');
});

test('getConsistencyTier classifies performance brackets', () => {
  // Sample too small (< 3)
  const small = getConsistencyTier(1.0, 2, 2, 3);
  assert.equal(small.isConsistent, false);

  // Elite (80%+)
  const elite = getConsistencyTier(0.8, 10, 8, 3);
  assert.equal(elite.tier, 'elite');
  assert.equal(elite.isConsistent, true);

  // Hot (70% - 79%)
  const hot = getConsistencyTier(0.7, 10, 7, 3);
  assert.equal(hot.tier, 'hot');
  assert.equal(hot.isConsistent, true);

  // Solid (60% - 69%)
  const solid = getConsistencyTier(0.6, 10, 6, 3);
  assert.equal(solid.tier, 'consistent');
  assert.equal(solid.isConsistent, false);

  // Cold (<= 35%)
  const cold = getConsistencyTier(0.3, 10, 3, 3);
  assert.equal(cold.tier, 'cold');
  assert.equal(cold.isConsistent, false);
});

test('analyzeDailyCardTrends evaluates direct player game stat logs', () => {
  const currentCard = [
    {
      playerId: 101,
      name: 'Nathan MacKinnon',
      team: 'COL',
      opp: 'EDM',
      market: 'sog',
      line: 4.5,
      lean: 'OVER' as const
    },
    {
      playerId: 102,
      name: 'Cale Makar',
      team: 'COL',
      opp: 'EDM',
      market: 'sog',
      line: 2.5,
      lean: 'OVER' as const
    }
  ];

  const playerStatLogs = {
    101: {
      sog: [6, 5, 5, 7, 3, 5, 6, 4, 5, 6] // 8 of 10 > 4.5 -> 80% hit rate
    },
    102: {
      sog: [1, 2, 2, 3, 2, 1, 2, 3, 1, 2] // 2 of 10 > 2.5 -> 20% hit rate
    }
  };

  const res = analyzeDailyCardTrends({
    currentCard,
    playerStatLogs
  });

  assert.equal(res.totalAnalyzed, 2);
  assert.equal(res.consistentCount, 1);
  assert.equal(res.eliteCount, 1);

  // Ranked with highest hit rate first
  const top = res.trends[0];
  assert.equal(top.playerName, 'Nathan MacKinnon');
  assert.equal(top.hits, 8);
  assert.equal(top.sampleSize, 10);
  assert.equal(top.hitRate, 0.8);
  assert.equal(top.hitRatePct, 80);
  assert.equal(top.isConsistent, true);
  assert.equal(top.consistencyTier, 'elite');

  const bottom = res.trends[1];
  assert.equal(bottom.playerName, 'Cale Makar');
  assert.equal(bottom.hits, 2);
  assert.equal(bottom.hitRate, 0.2);
  assert.equal(bottom.isConsistent, false);
  assert.equal(bottom.consistencyTier, 'cold');
});

test('analyzeDailyCardTrends evaluates historical settled card rows', () => {
  const currentCard = [
    {
      playerId: 201,
      name: 'Nikola Jokic',
      team: 'DEN',
      opp: 'LAL',
      market: 'ast',
      line: 9.5,
      lean: 'OVER' as const
    }
  ];

  const historicalCardRows = [
    { playerId: 201, name: 'Nikola Jokic', team: 'DEN', market: 'ast', line: 9.5, actual: 12, result: 'HIT' as const, date: '2026-11-01' },
    { playerId: 201, name: 'Nikola Jokic', team: 'DEN', market: 'ast', line: 9.5, actual: 11, result: 'HIT' as const, date: '2026-10-30' },
    { playerId: 201, name: 'Nikola Jokic', team: 'DEN', market: 'ast', line: 9.5, actual: 14, result: 'HIT' as const, date: '2026-10-28' },
    { playerId: 201, name: 'Nikola Jokic', team: 'DEN', market: 'ast', line: 9.5, actual: 8, result: 'MISS' as const, date: '2026-10-26' },
    { playerId: 201, name: 'Nikola Jokic', team: 'DEN', market: 'ast', line: 9.5, actual: 10, result: 'HIT' as const, date: '2026-10-24' }
  ];

  const res = analyzeDailyCardTrends({
    currentCard,
    historicalCardRows
  });

  assert.equal(res.totalAnalyzed, 1);
  const jokic = res.trends[0];
  assert.equal(jokic.sampleSize, 5);
  assert.equal(jokic.hits, 4);
  assert.equal(jokic.hitRate, 0.8);
  assert.equal(jokic.isConsistent, true);
  assert.equal(jokic.streak, 3); // last 3 are hits: 12, 11, 14
});

test('getMarketLabel formats common sports markets', () => {
  assert.equal(getMarketLabel('sog'), 'Shots on Goal');
  assert.equal(getMarketLabel('pts'), 'Points');
  assert.equal(getMarketLabel('rec'), 'Receptions');
  assert.equal(getMarketLabel('hit'), '0.5 Hits');
});
