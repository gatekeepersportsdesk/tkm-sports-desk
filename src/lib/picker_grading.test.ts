import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezePickerSnapshot,
  gradePickerWithCardRows,
  getPickerPerformance,
  normalizePlayerName,
  normalizeMarketKey,
  clearDailyPickerSnapshot,
  getDailyPickerSnapshot,
  gradeNbaPickerWithBoxLines,
  getPickerPlaysForInspection,
  classifyPickerBucket,
  seedPickerHistoryFromCsv,
  loadPickerSeedSync,
  getSeededGameByGameRollups
} from './picker_grading';
import { PlayItem } from '../components/common/TodaysPlaysSection';
import { CardRow } from './card_core';
import { PickOfTheDay } from './pick_of_the_day';

test('picker_grading: Normalization helpers', () => {
  assert.strictEqual(normalizePlayerName('Connor McDavid Jr.'), 'connor mcdavid');
  assert.strictEqual(normalizePlayerName('T.J. Watt'), 'tj watt');
  assert.strictEqual(normalizeMarketKey('sog'), 'shots');
  assert.strictEqual(normalizeMarketKey('Points'), 'points');
  assert.strictEqual(normalizeMarketKey('rec'), 'receptions');
  assert.strictEqual(normalizeMarketKey('tpm'), 'threes');
  assert.strictEqual(normalizeMarketKey('reb'), 'rebounds');
  assert.strictEqual(normalizeMarketKey('ast'), 'assists');
  assert.strictEqual(normalizeMarketKey('pra'), 'pra');
});

test('picker_grading: Strict mutually exclusive Edge vs Safe vs Avoid bucket assignment', () => {
  // EDGE beats SAFE even when prob >= safeThreshold
  const edgeHighProb = classifyPickerBucket(0.64, 7.5, true, 0.58);
  assert.deepStrictEqual(edgeHighProb, { isEdge: true, isSafe: false, isAvoid: false });

  // Non-edge with prob >= safeThreshold -> SAFE only
  const safeOnly = classifyPickerBucket(0.62, -1.2, true, 0.58);
  assert.deepStrictEqual(safeOnly, { isEdge: false, isSafe: true, isAvoid: false });

  // Positive edge but prob < 0.55 and < safeThreshold -> AVOID
  const lowProb = classifyPickerBucket(0.51, 3.0, true, 0.58);
  assert.deepStrictEqual(lowProb, { isEdge: false, isSafe: false, isAvoid: true });

  // Unpriced -> AVOID even with high prob
  const noOdds = classifyPickerBucket(0.68, 0, false, 0.58);
  assert.deepStrictEqual(noOdds, { isEdge: false, isSafe: false, isAvoid: true });
});

test('picker_grading: Freezing snapshot classifies exclusive buckets, stamps POTD crown, and protects historical immutability', () => {
  clearDailyPickerSnapshot('nhl_test', '2026-11-09');
  const plays: PlayItem[] = [
    {
      id: 'p1',
      player: 'Connor McDavid',
      team: 'EDM',
      opp: 'CGY',
      market: 'shots',
      side: 'OVER',
      line: 3.5,
      odds: -115,
      prob: 0.62,
      edge: 7.5,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'p2',
      player: 'Leon Draisaitl',
      team: 'EDM',
      opp: 'CGY',
      market: 'points',
      side: 'OVER',
      line: 1.5,
      odds: -145,
      prob: 0.61,
      edge: -0.5,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'p3',
      player: 'Unpriced Rookie',
      team: 'EDM',
      opp: 'CGY',
      market: 'shots',
      side: 'OVER',
      line: 1.5,
      odds: null,
      prob: 0.60,
      edge: 0,
      hasOdds: false,
      hasMarket: false
    }
  ];

  const potd: PickOfTheDay = {
    sport: 'nhl',
    sportLabel: 'NHL Shots & Points',
    player: 'Connor McDavid',
    team: 'EDM',
    opp: 'CGY',
    market: 'sog',
    marketLabel: 'Shots on Goal',
    side: 'over',
    line: 3.5,
    odds: -115,
    modelProb: 0.62,
    edge: 7.5,
    ev: 0.16
  };

  const date = '2026-11-09';
  const snap1 = freezePickerSnapshot('nhl_test', date, plays, 0.58, false, potd);
  assert.ok(snap1 !== null);
  assert.strictEqual(snap1.plays.length, 3);

  // McDavid meets Edge -> Edge ONLY (NOT Safe) and stamped POTD
  const mcdavid = snap1.plays.find(p => p.player === 'Connor McDavid');
  assert.strictEqual(mcdavid?.isEdge, true);
  assert.strictEqual(mcdavid?.isSafe, false, 'Edge plays must NEVER double-list under Safe');
  assert.strictEqual(mcdavid?.isAvoid, false);
  assert.strictEqual(mcdavid?.isPotd, true);

  // Draisaitl has prob 61% but negative edge -> Safe ONLY (different market: points)
  const drai = snap1.plays.find(p => p.player === 'Leon Draisaitl');
  assert.strictEqual(drai?.isEdge, false);
  assert.strictEqual(drai?.isSafe, true);
  assert.strictEqual(drai?.isAvoid, false);
  assert.strictEqual(drai?.isPotd, false);

  // Unpriced rookie -> Avoid (no odds)
  const rookie = snap1.plays.find(p => p.player === 'Unpriced Rookie');
  assert.strictEqual(rookie?.isAvoid, true);
  assert.strictEqual(rookie?.isEdge, false);
  assert.strictEqual(rookie?.isSafe, false);

  // Re-freezing same date with different plays must return frozen snapshot without mutating
  const mutatedPlays: PlayItem[] = [];
  const snap2 = freezePickerSnapshot('nhl_test', date, mutatedPlays, 0.58);
  assert.strictEqual(snap2?.plays.length, 3, 'Historical membership must stay frozen');
});

test('picker_grading: Grading against multi-market card rows settles shots & points exclusively and supports market/POTD filters', () => {
  const cardRows: CardRow[] = [
    {
      id: 'c1',
      date: '2026-11-09',
      capturedAt: Date.now(),
      gameId: 'g1',
      market: 'shots',
      playerId: 101,
      name: 'Connor McDavid',
      team: 'EDM',
      opp: 'CGY',
      mu: 4.2,
      r: 10,
      line: 3.5,
      lean: 'OVER',
      pOver: 0.62,
      pm: 22,
      avg: 3.8,
      inputs: 'REAL',
      avail: 'ACTIVE',
      result: 'HIT',
      actual: 5,
      minutes: 23,
      err: 0.8
    },
    {
      id: 'c2',
      date: '2026-11-09',
      capturedAt: Date.now(),
      gameId: 'g1',
      market: 'points',
      playerId: 102,
      name: 'Leon Draisaitl',
      team: 'EDM',
      opp: 'CGY',
      mu: 1.7,
      r: 10,
      line: 1.5,
      lean: 'OVER',
      pOver: 0.61,
      pm: 21,
      avg: 1.5,
      inputs: 'REAL',
      avail: 'ACTIVE',
      result: 'HIT',
      actual: 2,
      minutes: 22,
      err: 0.3
    }
  ];

  gradePickerWithCardRows('nhl_test', cardRows);

  const perfAll = getPickerPerformance('nhl_test', 'today', '2026-11-09', 'all');
  assert.strictEqual(perfAll.edge.hits, 1);
  assert.strictEqual(perfAll.edge.decided, 1);
  assert.strictEqual(perfAll.edge.hitRate, 100);
  // Safe bucket must only contain Draisaitl (never McDavid)
  assert.strictEqual(perfAll.safe.hits, 1);
  assert.strictEqual(perfAll.safe.decided, 1);
  assert.strictEqual(perfAll.totalDecided, 2);
  assert.strictEqual(perfAll.potd?.hits, 1);
  assert.strictEqual(perfAll.potd?.decided, 1);

  // Market filter: shots shows only McDavid (Edge), points shows only Draisaitl (Safe)
  const perfShots = getPickerPerformance('nhl_test', 'today', '2026-11-09', 'sog');
  assert.strictEqual(perfShots.edge.decided, 1);
  assert.strictEqual(perfShots.safe.decided, 0);

  const perfPoints = getPickerPerformance('nhl_test', 'today', '2026-11-09', 'points');
  assert.strictEqual(perfPoints.edge.decided, 0);
  assert.strictEqual(perfPoints.safe.decided, 1);

  const potdRows = getPickerPlaysForInspection('nhl_test', 'today', '2026-11-09', 'all', 'all', 'all', true);
  assert.strictEqual(potdRows.length, 1);
  assert.strictEqual(potdRows[0].player, 'Connor McDavid');
  assert.strictEqual(potdRows[0].isPotd, true);
  assert.strictEqual(potdRows[0].result, 'HIT');
});

test('picker_grading: clearDailyPickerSnapshot removes frozen snapshot and allows re-freezing', () => {
  const plays: PlayItem[] = [
    {
      id: 'p_clear',
      player: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      market: 'pts',
      side: 'OVER',
      line: 26.5,
      odds: -110,
      prob: 0.65,
      edge: 12.0,
      hasOdds: true,
      hasMarket: true
    }
  ];

  freezePickerSnapshot('nba_test', '2026-11-10', plays, 0.58);
  assert.ok(getDailyPickerSnapshot('nba_test', '2026-11-10') !== null);

  clearDailyPickerSnapshot('nba_test', '2026-11-10');
  assert.strictEqual(getDailyPickerSnapshot('nba_test', '2026-11-10'), null);

  const correctedPlays: PlayItem[] = [
    {
      id: 'p_clear_corr',
      player: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      market: 'pts',
      side: 'OVER',
      line: 27.5,
      odds: -105,
      prob: 0.61,
      edge: 8.5,
      hasOdds: true,
      hasMarket: true
    }
  ];
  const snap = freezePickerSnapshot('nba_test', '2026-11-10', correctedPlays, 0.58);
  assert.strictEqual(snap?.plays[0].line, 27.5);
});

test('picker_grading: gradeNbaPickerWithBoxLines grades NBA plays across pts/reb/ast/pra from box lines', () => {
  clearDailyPickerSnapshot('nba_box_test', '2026-11-10');
  const plays: PlayItem[] = [
    {
      id: 'nba_p1',
      player: 'Giannis Antetokounmpo',
      team: 'MIL',
      opp: 'NYK',
      market: 'pts',
      side: 'OVER',
      line: 31.5,
      odds: -115,
      prob: 0.60,
      edge: 6.5,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'nba_p2',
      player: 'Karl-Anthony Towns',
      team: 'NYK',
      opp: 'MIL',
      market: 'reb',
      side: 'UNDER',
      line: 12.5,
      odds: -110,
      prob: 0.59,
      edge: 6.0,
      hasOdds: true,
      hasMarket: true
    },
    {
      id: 'nba_p3',
      player: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      market: 'pra',
      side: 'OVER',
      line: 38.5,
      odds: -110,
      prob: 0.60,
      edge: 5.5,
      hasOdds: true,
      hasMarket: true
    }
  ];

  freezePickerSnapshot('nba', '2026-11-10', plays, 0.58, true);

  const boxLines = [
    {
      playerId: 201,
      name: 'Giannis Antetokounmpo',
      team: 'MIL',
      opp: 'NYK',
      date: '2026-11-10',
      minutes: 35,
      dnp: false,
      actual: { pts: 34, reb: 12, ast: 7, tpm: 1 }
    },
    {
      playerId: 202,
      name: 'Karl-Anthony Towns',
      team: 'NYK',
      opp: 'MIL',
      date: '2026-11-10',
      minutes: 32,
      dnp: false,
      actual: { pts: 21, reb: 10, ast: 3, tpm: 2 }
    },
    {
      playerId: 203,
      name: 'Jalen Brunson',
      team: 'NYK',
      opp: 'MIL',
      date: '2026-11-10',
      minutes: 34,
      dnp: false,
      actual: { pts: 30, reb: 4, ast: 8, tpm: 3 }
    }
  ];

  const gradedCount = gradeNbaPickerWithBoxLines(boxLines);
  assert.ok(gradedCount >= 3);

  const inspected = getPickerPlaysForInspection('nba', 'today', '2026-11-10');
  const giannis = inspected.find(p => p.player === 'Giannis Antetokounmpo');
  const kat = inspected.find(p => p.player === 'Karl-Anthony Towns');
  const brunson = inspected.find(p => p.player === 'Jalen Brunson');

  assert.strictEqual(giannis?.result, 'HIT');
  assert.strictEqual(giannis?.actual, 34);
  assert.strictEqual(kat?.result, 'HIT');
  assert.strictEqual(kat?.actual, 10);
  assert.strictEqual(brunson?.result, 'HIT');
  assert.strictEqual(brunson?.actual, 42);
});

test('picker_grading: Seeding CSVs loads NHL & NBA decided history idempotently, stamps POTD, and NEVER seeds NFL', () => {
  // Synthetic guard against NFL & pending rows & existing snapshot preservation
  clearDailyPickerSnapshot('nfl', '2026-11-12');
  const csvSample = [
    'Date,Sport,Matchup,Player,Team,Opponent,Market,Side,Line,Odds,Model_Win_Prob,Model_Mu,Edge_pp,Buckets,Result,Actual_Stat',
    '2026-11-12,NFL,KC vs BUF,Travis Kelce,KC,BUF,Receptions,OVER,4.5,-110,61.0%,5.2,8.5,EDGE,WON,6',
    '2026-11-12,NHL,EDM vs CGY,Pending Skater,EDM,CGY,Shots on Goal,OVER,3.5,-110,59.0%,3.9,5.0,EDGE,PENDING,'
  ].join('\n');
  seedPickerHistoryFromCsv(csvSample);
  assert.strictEqual(getDailyPickerSnapshot('nfl', '2026-11-12'), null, 'Must never seed NFL picker history');

  // Clear real seed dates so loadPickerSeedSync hydrates cleanly from public/data/gatekeep_picker_seed_*.csv
  for (const sp of ['nhl', 'nba']) {
    for (const d of ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) {
      clearDailyPickerSnapshot(sp, d);
    }
  }
  const firstSeed = loadPickerSeedSync();
  assert.strictEqual(firstSeed.importedPlays, 785);
  assert.ok(firstSeed.importedDates >= 10);

  // Idempotent second call must NOT overwrite existing dates
  const secondSeed = loadPickerSeedSync();
  assert.strictEqual(secondSeed.importedDates, 0);
  assert.ok(secondSeed.skippedDates >= 10);

  const rollups = getSeededGameByGameRollups('all');
  assert.strictEqual(rollups.length, 130);
  assert.strictEqual(rollups.some(r => r.sport === 'NFL'), false);

  const nhlPlays = getPickerPlaysForInspection('nhl', 'all', '2026-11-14');
  assert.ok(nhlPlays.length > 0);
  assert.ok(nhlPlays.some(p => p.isPotd), 'Seeded NHL history must carry POTD crown');
  assert.strictEqual(nhlPlays.some(p => p.isEdge && p.isSafe), false, 'Zero Edge+Safe overlap');

  const nbaPlays = getPickerPlaysForInspection('nba', 'all', '2026-11-14');
  assert.ok(nbaPlays.length > 0);
  assert.ok(nbaPlays.some(p => p.isPotd), 'Seeded NBA history must carry POTD crown');
});
